import { asRecord, asText, collator, compareNullable, matchesText, type PropertyTypeSpec } from "./shared";
import type { CellValue } from "../types";

/**
 * Place / Location — "accepts address", in the wishlist's words.
 * ---------------------------------------------------------------------------
 * This used to be one freeform string, and the note here said geocoding and an
 * autocomplete belong on the server and that coordinates should stay *out* of the value.
 * The first half is still right (`src/server/places.ts` owns the network, the key-shaped
 * decisions and the cache). The second half is now wrong, and the reason is the map view
 * the owner has already asked for: a map needs one point per *row*, and a table's rows are
 * cells. Coordinates in a separate property would have to be kept in step with the address
 * by hand, and the first row somebody edits by typing would plot at the old point forever.
 * So the point rides with the value.
 *
 * The shapes, and why there are exactly two:
 *
 *   "12 Rue de Rivoli, Paris"                          a string — typed, not picked
 *   { address, name?, lat, lng, id? }                 an object — picked from a search
 *
 * **A value with no point is stored as the bare string.** That is not an oversight; it is
 * what keeps today's bytes identical for every cell that was typed by hand, keeps a text
 * filter reading the same thing a person sees, and makes the object mean one thing only:
 * *this place has a location*. `placePoint` is therefore the map view's whole entry point —
 * a string answers `null` and the map has to decide what to do with an unplottable row,
 * which is honest, where 0,0 would be a lie in the Gulf of Guinea.
 */
export interface PlaceValue {
  address: string;
  /* The point's own name — "Eiffel Tower" rather than its postal line. Optional because a
     picked address line is often already the name. */
  name?: string;
  lat: number;
  lng: number;
  /* The provider's stable id (`osm_type:osm_id`), so a map marker can keep its identity
     across a re-search instead of being matched by label. */
  id?: string;
  /* Present only when the point is the *road* the address is on, not the door — see
     `composedHits`. A map that drew both the same way would claim a precision the map data
     does not have, so the difference is stored with the value rather than left to be guessed
     from how many decimals a coordinate happens to have. */
  approx?: true;
}

/** One row of a search, before it is committed. `label` is the bold line; `address` is what
 *  the cell will read.
 *
 *  `label` and `name` are two different facts, and the difference was the owner's second
 *  complaint: searching "Grahovo Brdo 1" produced a row headed *Turistična kmetija Mahnič*,
 *  which is the farm standing at that address. The farm's name is a real fact about the
 *  place and must survive into the stored value — but the row has to answer what was typed,
 *  so the bold line is the address and the farm becomes the dim line beside it. */
export interface PlaceHit {
  id: string | null;
  /** The bold line: whichever field of the result answered the query. */
  label: string;
  /** The place's own name — "Eiffel Tower" rather than its postal line. Stored, not shown. */
  name: string;
  context: string;
  address: string;
  lat: number;
  lng: number;
  /** True when the point is the road the address sits on rather than the door itself. */
  approx?: boolean;
}

const blank = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** A finite number out of a JSON value, or `null`. Strings are accepted because a provider
 *  that sends `"48.8584"` is not wrong, only careless, and refusing it would drop a point. */
function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** A point, or `null`. Range-checked here rather than in the view, so nothing downstream
 *  can plot 91° north of the pole. */
export function placePoint(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const y = finite(lat);
  const x = finite(lng);
  if (y === null || x === null) return null;
  if (Math.abs(y) > 90 || Math.abs(x) > 180) return null;
  return { lat: y, lng: x };
}

/** Both stored shapes read as one thing. `point` is `null` for a typed address, which is
 *  the distinction the map view needs and the difference `placePoint` refuses to invent. */
export interface PlaceReading {
  address: string;
  name: string;
  id: string;
  point: { lat: number; lng: number } | null;
  /** True when `point` is the road, not the door. A map draws it differently; nothing else
   *  changes, because the address is the same either way. */
  approximate: boolean;
}

export function placeReading(value: CellValue): PlaceReading {
  const record = asRecord(value);
  if (record) {
    return {
      address: blank(record.address),
      name: blank(record.name),
      id: blank(record.id),
      point: placePoint(record.lat, record.lng),
      approximate: record.approx === true,
    };
  }
  return { address: asText(value).trim(), name: "", id: "", point: null, approximate: false };
}

/** The map view's whole entry point: the stored point, or `null` for a typed address — a row
 *  it cannot plot, rather than a row it plots at 0,0. */
export function placeCoordinates(value: CellValue): { lat: number; lng: number } | null {
  return placeReading(value).point;
}

/** A reading that is known to have a point — the only shape a card can draw. */
export type PlaceCard = PlaceReading & { point: { lat: number; lng: number } };

/**
 * Which place the card should draw, or `null` when the surface should be the list.
 *
 * Three conditions, and each one is a bug if it is missing:
 *
 * - **a point.** A typed address is a sentence, not a location. There is nothing to draw, and a
 *   map of nothing would be a map of the Gulf of Guinea.
 * - **the draft still reads that address.** The card is not a mode to be entered and left; it is
 *   what this cell already knows. The moment a keystroke changes the text, the person is asking a
 *   new question and the list is the answer — so the state cannot get stuck, because there is no
 *   state.
 * - **`picked` wins while it is what is on screen.** A pick whose write is still in flight has a
 *   value the server has not echoed back yet; drawing the *stored* value for that frame would show
 *   the previous place's map for a moment.
 */
export function placeCard(stored: CellValue, picked: PlaceReading | null, draft: string): PlaceCard | null {
  const typed = draft.trim();
  const held = picked !== null && typed === picked.address ? picked : placeReading(stored);
  if (held.point === null || typed === "" || typed !== held.address) return null;
  return held as PlaceCard;
}

/** What a cell, an export and a formula's string cast read. Never the JSON. */
export function placeAddress(value: CellValue): string {
  return placeReading(value).address;
}

/**
 * A search hit, as the value that gets stored.
 *
 * The one shape decision lives here rather than at the call site, so the client cannot
 * commit a point it did not get from a provider and the tests can compare round trips.
 */
export function placeValueOf(hit: PlaceHit): CellValue {
  const point = placePoint(hit.lat, hit.lng);
  if (point === null) return hit.address.trim();
  const name = hit.name.trim();
  return {
    address: hit.address.trim(),
    ...(name && name !== hit.address.trim() ? { name } : {}),
    lat: point.lat,
    lng: point.lng,
    ...(hit.id ? { id: hit.id } : {}),
    ...(hit.approx ? { approx: true as const } : {}),
  };
}

/* ---------------------------------------------------------------------------
   The provider's answer, read into hits.
   ---------------------------------------------------------------------------
   Photon (photon.komoot.io) rather than Nominatim, and the difference is a policy, not a
   preference: OSM's usage policy for Nominatim explicitly forbids "auto-complete search" —
   query-as-you-type — and Photon exists for exactly that. Its answer is GeoJSON, which is
   why this is a mapper rather than a parser.
   --------------------------------------------------------------------------- */

const key = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Case and accents folded away: "Rašica" and "rasica" are one word to a person who is typing
 * quickly, so they have to be one word to the ranker too. `\p{L}` rather than `a-z` on
 * purpose — a fold that ate Cyrillic would turn "Рашица" into the empty string, and an empty
 * query string matches *everything*, which is the worst possible failure here.
 */
export function foldPlace(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** What somebody typed, split into the name and the house number it ends with. */
export interface PlaceQuery {
  /** The part that names something: `Rašica`. */
  words: string;
  /** The house number the query ends with, folded: `53`, `12a`. `null` when there is none. */
  number: string | null;
  /** The same number as it was typed. A row that repeats the address back — "Rašica 53" for a
   *  door the map does not have — must not silently rewrite `12A` as `12a`. */
  numberText: string;
  /** True when there is both a name and a number — an address, not a name. */
  address: boolean;
}

/**
 * "Rašica 53" is two requests' worth of information in one box: a name, and a house on it.
 *
 * Splitting them is the whole fix for the owner's first example. Photon treats a trailing
 * number as the thing to match and lets the street name go fuzzy, so `Rašica 53` came back
 * as *Rašice 53* in Slovakia with the actual Slovenian village pushed off the list entirely.
 * Asked as `Rašica`, the same index answers correctly and instantly.
 *
 * Only a *trailing* number counts. "5 Trubarjeva cesta" stays one phrase, which is a
 * limitation, not an oversight: the number-first form is rare in the languages this table is
 * written in and guessing wrong there would split a street name that contains a digit.
 */
export function readQuery(query: string): PlaceQuery {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const last = (words[words.length - 1] ?? "").replace(/[,.;]+$/, "");
  const match = /^(\d+[a-z]*)$/i.exec(last);
  if (match && words.length > 1) {
    return { words: words.slice(0, -1).join(" "), number: match[1].toLowerCase(), numberText: match[1], address: true };
  }
  return { words: words.join(" "), number: null, numberText: "", address: false };
}

/** Every field of a provider feature that could answer a query, read once. */
interface PlaceParts {
  /** The place's own name, and only when the provider gave one. Kept apart from the address
   *  line so a row's bold text is never built in a different word order to its address. */
  own: string;
  /** "Rašica" — the street, without the number. */
  street: string;
  /** "1315 Velike Lašče" — postal code and settlement. */
  place: string;
  /** "Velike Lašče" — the settlement on its own, without the postcode. Two long roads cross a
   *  postal boundary, so a village is what a door's *place* is, not a postcode. */
  settlement: string;
  state: string;
  country: string;
  house: string;
  /** The provider's own classification: `house`, `street`, `city`, `district`, `other`. */
  kind: string;
  /** True for a road. The one thing a house number is an address *on*, and the whole basis of
   *  `composedHits`'s idea of where an unmapped door belongs. */
  road: boolean;
  point: { lat: number; lng: number };
  id: string | null;
}

/**
 * "Rašica 53" or "12 Rue de Rivoli" — the same two facts in the order the query used them.
 *
 * There is no formatted address in a Photon answer: only `street` and `housenumber` as
 * separate tags. So the order has to be chosen, and choosing one order for everybody makes
 * half of them wrong. Slovenian, Croatian and most of Europe write the street first;
 * France, the US and the UK write the number first. The one reliable signal about which
 * convention the person in front of this box uses is **the order they typed**, so the row
 * repeats it. A query with no number has no order to repeat, and falls back to house-first,
 * which is what this column did before it ranked anything.
 */
function lineOf(parts: PlaceParts, numberLast: boolean): string {
  if (parts.house === "") return parts.street;
  if (parts.street === "") return parts.house;
  return numberLast ? `${parts.street} ${parts.house}` : `${parts.house} ${parts.street}`;
}

/** The place's own name, or its address line when it has none — the fallback chain this
 *  column has always had, now in the same word order as the address it falls back to. */
function nameOf(parts: PlaceParts, numberLast: boolean): string {
  return parts.own || lineOf(parts, numberLast) || parts.place || parts.state || parts.country;
}

function placeParts(feature: unknown): PlaceParts | null {
  const record = asRecord(feature as CellValue);
  if (!record) return null;
  const geometry = asRecord(record.geometry);
  const coordinates = geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  /* GeoJSON is `[lng, lat]`, and reading it the other way puts Europe in Somalia. */
  const point = placePoint(coordinates[1], coordinates[0]);
  if (point === null) return null;

  const properties = asRecord(record.properties) ?? {};
  const house = blank(properties.housenumber);
  const street = blank(properties.street);
  const settlement = blank(properties.city) || blank(properties.district);
  const place = [blank(properties.postcode), settlement].filter(Boolean).join(" ");
  const state = blank(properties.state);
  const country = blank(properties.country);
  const name = blank(properties.name);
  /* A feature with no name at all is a coordinate pretending to be a place; a list row that
     reads ", , France" is worse than one row fewer. */
  if (name === "" && house === "" && street === "" && place === "" && state === "" && country === "") return null;

  const osmId = properties.osm_id === undefined || properties.osm_id === null ? "" : String(properties.osm_id);
  const osmType = blank(properties.osm_type);
  const kind = blank(properties.type);
  return {
    own: name,
    street,
    place,
    settlement,
    state,
    country,
    house,
    kind,
    /* Photon says `street` for a road and `highway` is the OSM key underneath it; either one
       alone is enough, and both are read because a feature may carry one and not the other. */
    road: kind === "street" || blank(properties.osm_key) === "highway",
    point,
    id: osmId && osmType ? `${osmType}:${osmId}` : null,
  };
}

/* ---------------------------------------------------------------------------
   Which half of a result answered the query.
   ---------------------------------------------------------------------------
   Three lines, and each one has a job the others cannot do:

     label    the field that answered what was typed — bold, so the row reads as an answer
     context  everything that tells this place from its namesake — dim
     address  the postal line, which is what the cell stores and reads

   "Rašica 40" is one place and two sentences: `Rašica 40` (where it is) and
   `Petrol - Rašica, 1315 Velike Lašče` (what else is true of it).
   --------------------------------------------------------------------------- */

/** Does `field` answer what was typed? Deliberately looser than the ranker: this decides
 *  which words go on the bold line, and a near miss should still be allowed to label its own
 *  row. The ranker is what decides whether the row belongs in the list at all. */
function answers(field: string, words: string): boolean {
  const q = foldPlace(words);
  if (q === "") return true;
  const folded = foldPlace(field);
  if (folded === "") return false;
  return folded.includes(q) || q.includes(folded);
}

function labelOf(parts: PlaceParts, words: string, numberLast: boolean): string {
  for (const field of [parts.own, lineOf(parts, numberLast), parts.place]) {
    if (field !== "" && answers(field, words)) return field;
  }
  return nameOf(parts, numberLast);
}

function contextOf(parts: PlaceParts, label: string, numberLast: boolean): string {
  /* A part that *is* the label is not a second fact, and two parts that read the same are one
     part — Photon returns `state` and `city` as the same string constantly. */
  const seen = new Set([key(label)]);
  const kept: string[] = [];
  for (const part of [parts.own, lineOf(parts, numberLast), parts.place, parts.state, parts.country]) {
    if (part === "") continue;
    const folded = key(part);
    if (seen.has(folded)) continue;
    seen.add(folded);
    kept.push(part);
  }
  return kept.join(", ");
}

/** Parts that read the same are one part — Photon returns `state` and `city` as the same string
 *  constantly — and an empty part is not a part at all. */
function joinUnique(parts: string[]): string {
  return parts
    .filter(Boolean)
    .filter((part, index, all) => all.findIndex((other) => key(other) === key(part)) === index)
    .join(", ");
}

/** The postal line: what the cell reads and what gets stored. The place's own name is *not*
 *  in it — "Grahovo Brdo 1, 6210 Sežana, Slovenija" is an address, and
 *  "Grahovo Brdo 1, Turistična kmetija Mahnič, 6210 Sežana, Slovenija" is a sentence. */
function addressOf(parts: PlaceParts, numberLast: boolean): string {
  return joinUnique([lineOf(parts, numberLast) || nameOf(parts, numberLast), parts.place, parts.state, parts.country]);
}

/* ---------------------------------------------------------------------------
   Ranking.
   ---------------------------------------------------------------------------
   The owner's words: "of course I don't want you to fix just those 2, they are just showing
   that there is a global problem". The global problem is that a geocoder's index is global:
   every country has a street, and the one you meant has no special status.

   So the list is re-ordered here, after the provider, by how well each result answers the
   query. Two rules do most of the work and both were measured against real answers:

     * a house number that disagrees is a different door, not a near miss
     * a *name* that disagrees is fatal when a number is present, because the number alone
       cannot tell two towns apart — that is why "Rašica 53" surfaced Slovakia
   --------------------------------------------------------------------------- */

const tokens = (text: string): string[] => text.split(" ").filter(Boolean);

function bigrams(text: string): Set<string> {
  const clean = text.replace(/ /g, "");
  const out = new Set<string>();
  for (let index = 0; index < clean.length - 1; index++) out.add(clean.slice(index, index + 2));
  return out;
}

/** Sørensen–Dice over character pairs: "Rašica" against "Rašice" scores 0.8, against
 *  "Radića" 0.6, against "Pariz" 0. It is a *similarity*, not a match. */
function dice(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return a === b ? 1 : 0;
  let common = 0;
  for (const gram of left) if (right.has(gram)) common++;
  return (2 * common) / (left.size + right.size);
}

/** How strongly a set of fields answers the query's name, 0..1. */
export function placeMatch(words: string, fields: string[], address = false): number {
  if (foldPlace(words) === "" && words.trim() === "") return 1;
  const q = foldPlace(words);
  if (q === "") return 0.5;
  const folded = fields.map(foldPlace).filter(Boolean);
  if (folded.length === 0) return 0;
  if (folded.some((field) => field === q)) return 1;
  /* Typing forward shortens the query against a field — "grahovo brd" is on its way to
     "grahovo brdo" — and a query longer than the field happens the same way in reverse. */
  if (folded.some((field) => field.startsWith(q) || q.startsWith(field))) return 0.9;
  const wanted = tokens(q);
  if (folded.some((field) => wanted.every((word) => tokens(field).some((token) => token.startsWith(word))))) return 0.85;
  if (folded.some((field) => wanted.every((word) => field.includes(word)))) return 0.7;
  /* Not the same name. A typo must still be findable — "Eifel Tower" is the Eiffel Tower —
     but in an address query a near miss is the wrong country: "Rašice" is not "Rašica" and it
     is five hundred kilometres away. The ceiling is the entire difference. */
  const combined = folded.join(" ");
  const best = Math.max(...folded.map((field) => dice(q, field)), dice(q, combined));
  return best * (address ? 0.45 : 0.9);
}

interface Ranked {
  parts: PlaceParts;
  words: number;
  score: number;
  index: number;
}

/** A house number that disagrees is the wrong door; a result with no house at all is the
 *  street the door is on, which is the honest answer when the number is not mapped. */
function numberFit(query: PlaceQuery, parts: PlaceParts): number {
  if (query.number === null) return 0;
  const house = foldPlace(parts.house);
  if (house === "") return 0.12;
  if (house === query.number) return 0.55;
  return -0.65;
}

/* ---------------------------------------------------------------------------
   The house number the map data does not have.
   ---------------------------------------------------------------------------
   The owner's second report on the same feature: "Query doesn't give Rašica 53, only Rašica."
   That is not a ranking fault, it is a fact — OpenStreetMap has exactly two addresses on the
   road Rašica (40 and 12a), and no 53 anywhere in the country. No amount of ordering can
   produce a door that was never mapped, and Notion's `Rašica 53, 1315 Velike Lašče` therefore
   cannot be coming from an OpenStreetMap geocoder at all.

   So the app stops pretending the number is a filter and treats it as an address: when no
   result carries the typed house number, the typed address becomes the row, anchored to the
   best place that *can* carry it. Two rules decide the anchor, and both are about what a
   house number is:

     * a door is an address on a **road**, so roads are what is looked at; a village with no
       mapped roads is the fallback, because a village is still an address space;
     * a road name exists in many settlements, so the road is read **where most of that name's
       own roads are** — `Rašica` has four in Velike Lašče and two in Ljubljana, and both
       houses the map does have on it (40 and 12a) are in Velike Lašče. The count is a proxy,
       and the honest one available without a second request.

   The point is the road's, not the door's, so the hit carries `approx` and the value stores
   it. Everything else about the row is the address the person typed: the row that comes back
   is `Rašica 53 / 1315 Velike Lašče, Slovenija`, and the cell afterwards reads the address
   they typed with the place they chose.
   --------------------------------------------------------------------------- */

/** Kinds that can have a house number on them. A road first; a settlement when the road is not
 *  in the answer at all. A landmark, a stream and a shop cannot — "Eiffel Tower 1" is not an
 *  address, and composing one would be the app inventing a place rather than finding one. */
function addressable(parts: PlaceParts): boolean {
  return parts.road || parts.kind === "locality" || parts.kind === "district" || parts.kind === "city" || parts.kind === "county";
}

/** The host's own name with no house number on it — what a typed number is appended to. */
function hostOf(parts: PlaceParts): string {
  return parts.street || parts.own || parts.place || parts.state || parts.country;
}

/** Which settlement a candidate is in, as a group key. The postcode is deliberately *not* part
 *  of it: one village's road is split across three postcodes because the road is long, and
 *  three rows reading "Rašica 53" with different postcodes is a worse question than one. */
function settlementOf(parts: PlaceParts): string {
  return key(parts.settlement) || key(parts.place) || key(parts.state) || key(parts.country);
}

function composedHits(ordered: Ranked[], plan: PlaceQuery, limit: number): PlaceHit[] {
  if (plan.number === null) return [];
  const eligible = ordered.filter((entry) => entry.words >= 0.7 && addressable(entry.parts) && hostOf(entry.parts) !== "");
  const roads = eligible.filter((entry) => entry.parts.road);
  const hosts = roads.length > 0 ? roads : eligible;
  if (hosts.length === 0) return [];

  const groups = new Map<string, { count: number; best: Ranked }>();
  for (const entry of hosts) {
    const group = groups.get(settlementOf(entry.parts));
    if (group === undefined) {
      groups.set(settlementOf(entry.parts), { count: 1, best: entry });
      continue;
    }
    group.count += 1;
    if (entry.score > group.best.score) group.best = entry;
  }

  /* The settlement most of the name's roads are in first, then the best-ranked road in each —
     which is also the postcode that road is filed under. */
  const rankedGroups = [...groups.values()].sort(
    (a, b) => b.count - a.count || b.best.score - a.best.score || a.best.index - b.best.index,
  );

  const hits: PlaceHit[] = [];
  for (const group of rankedGroups) {
    const parts = group.best.parts;
    const label = `${hostOf(parts)} ${plan.numberText}`.trim();
    hits.push({
      /* No provider object stands for this door, so there is no id to keep: the road's id
         would claim two doors on the same road are one place. */
      id: null,
      label,
      name: parts.own,
      /* The dim line is what tells these rows apart, and the road's name is already on the
         bold line — so it is the postal part that goes beside, not the whole address again. */
      context: joinUnique([parts.place, parts.state, parts.country]),
      address: joinUnique([label, parts.place, parts.state, parts.country]),
      lat: parts.point.lat,
      lng: parts.point.lng,
      approx: true,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * The list a surface draws: scored, ordered, de-duplicated, capped.
 *
 * `matchedNumber` is reported separately because the surface has to be able to say so: when
 * somebody types a house number that no result carries, the rows are that address placed on
 * the road rather than the doors themselves, and a list of bare streets under a typed number
 * reads as the app ignoring half of what was typed. It is a fact about the *map data*, so the
 * app can say it plainly instead of implying it.
 */
export function placeResults(features: unknown, query = "", limit = 6): { hits: PlaceHit[]; matchedNumber: boolean } {
  if (!Array.isArray(features)) return { hits: [], matchedNumber: false };
  const plan = readQuery(query);
  /* The query's own word order, echoed back by every row it produces. */
  const numberLast = plan.address;
  const ranked: Ranked[] = [];
  features.forEach((feature, index) => {
    const parts = placeParts(feature);
    if (parts === null) return;
    const line = lineOf(parts, numberLast);
    ranked.push({ parts, words: placeMatch(plan.words, [parts.own, line, parts.place], plan.address), score: 0, index });
  });

  for (const entry of ranked) {
    entry.score = entry.words + numberFit(plan, entry.parts) - entry.index * 1e-4;
  }

  /* One country, usually. A person typing an address is looking in one country, and Photon's
     index holds the same street name in every one of them — which is precisely how a search
     for a Slovenian village answered with Slovakia. The best *credible* result decides the
     country; anything in it that already resembles the query gets a small lift. The floor of
     0.6 is what stops the bonus from promoting an unrelated place in the right country over
     a genuine match in another. */
  const anchor = [...ranked].filter((entry) => entry.words >= 0.85).sort((a, b) => b.score - a.score)[0];
  const country = anchor === undefined ? "" : key(anchor.parts.country);
  if (country !== "") {
    for (const entry of ranked) {
      if (entry.words >= 0.6 && key(entry.parts.country) === country) entry.score += 0.25;
    }
  }

  /* When we are confident what somebody meant, show only results that match it.
     This is what removes "53 Rašice" from a search for a Slovenian village: the query names
     Rašica exactly, so a street spelled Rašice and standing five hundred kilometres away in
     another country is not a near miss to be listed seventh — it is a different word. When
     nothing matches well (a typo, or a name this index spells differently) the floor is off
     and the best guesses are all there is.

     It applies to *address* queries only, and that is not a technicality. A house number makes
     every street ending in that number a candidate in every country, so the name has to be
     held to a standard; a name on its own has no such failure mode, and the provider's other
     suggestions next to it are usually neighbours worth having — searching "Eiffel" should
     still offer the park at its foot. */
  const bestWords = ranked.reduce((best, entry) => Math.max(best, entry.words), 0);
  const floor = plan.address && bestWords >= 0.85;
  const ordered = (floor ? ranked.filter((entry) => entry.words >= 0.7) : ranked)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  /* A house number that no result carries is not an answer — it is a question the map data
     cannot answer. `matchedNumber` is the whole report of that, and when it is false the rows
     stop being "the places around it" and become the address that was typed, placed on the
     road it would be on. */
  const matchedNumber = plan.number !== null && ordered.some((entry) => foldPlace(entry.parts.house) === plan.number);
  if (!matchedNumber) {
    const composed = composedHits(ordered, plan, limit);
    if (composed.length > 0) return { hits: composed, matchedNumber: false };
  }

  /* Photon returns the same square twice — as a `node` and a `way`, occasionally with a
     differently-detailed address — and a person reads two identical rows as a bug in the app
     rather than in the data. Three keys, because they answer three different questions:
     the provider id catches the same *object* twice; the label catches an address the
     provider formatted two ways; and the name with its point catches the same *place*
     recorded as two objects, which is what OSM actually does for most landmarks. Rounded to
     four decimals — about eleven metres — because that is the distance below which two
     results are the same doorway. */
  const seen = new Set<string>();
  const hits: PlaceHit[] = [];
  for (const entry of ordered) {
    const label = labelOf(entry.parts, plan.words, numberLast);
    const context = contextOf(entry.parts, label, numberLast);
    const keys = [
      entry.parts.id === null ? "" : `id:${entry.parts.id}`,
      `label:${key([label, context].filter(Boolean).join(", "))}`,
      `place:${key(nameOf(entry.parts, numberLast))}@${entry.parts.point.lat.toFixed(4)},${entry.parts.point.lng.toFixed(4)}`,
    ].filter(Boolean);
    if (keys.some((entry2) => seen.has(entry2))) continue;
    for (const entry2 of keys) seen.add(entry2);
    hits.push({
      id: entry.parts.id,
      label,
      name: nameOf(entry.parts, numberLast),
      context,
      address: addressOf(entry.parts, numberLast),
      lat: entry.parts.point.lat,
      lng: entry.parts.point.lng,
    });
    if (hits.length >= limit) break;
  }
  return { hits, matchedNumber };
}

/** One feature as a row, without ranking it against anything. */
export function placeHit(feature: unknown, query = ""): PlaceHit | null {
  const parts = placeParts(feature);
  if (parts === null) return null;
  const plan = readQuery(query);
  const numberLast = plan.address;
  const label = labelOf(parts, plan.words, numberLast);
  return {
    id: parts.id,
    label,
    name: nameOf(parts, numberLast),
    context: contextOf(parts, label, numberLast),
    address: addressOf(parts, numberLast),
    lat: parts.point.lat,
    lng: parts.point.lng,
  };
}

/** The list a surface draws when there is no query to rank against — kept for callers that
 *  already hold an ordered list (a reverse geocode, a fixture). */
export function placeHits(features: unknown, limit = 6): PlaceHit[] {
  return placeResults(features, "", limit).hits;
}


export const placeProperty: PropertyTypeSpec<{ requireAddress?: boolean }> = {
  type: "place",
  label: "Place",
  empty: () => null,
  coerce: (raw) => {
    if (Array.isArray(raw)) return null;
    const record = asRecord(raw as CellValue);
    if (record) {
      const address = blank(record.address);
      if (address === "") return null;
      const point = placePoint(record.lat, record.lng);
      /* No point, no object: see the file header. `{address}` and `"address"` are the same
         place, and storing both spellings would make a filter and a map disagree. */
      if (point === null) return address;
      const name = blank(record.name);
      const id = blank(record.id);
      return {
        address,
        ...(name && name !== address ? { name } : {}),
        ...point,
        ...(id ? { id } : {}),
        /* Kept, not recomputed: the approximation is a fact about where the point came from,
           and a `coerce` that dropped it would turn a road back into a doorstep on the way
           through the server. */
        ...(record.approx === true ? { approx: true as const } : {}),
      };
    }
    const text = asText(raw as CellValue).trim();
    return text === "" ? null : text;
  },
  isEmpty: (value) => placeAddress(value) === "",
  compare: (a, b) => compareNullable(
    placeAddress(a) === "" ? null : placeAddress(a),
    placeAddress(b) === "" ? null : placeAddress(b),
    collator.compare,
  ),
  format: (value) => placeAddress(value),
  /* Was `matchesText(operator, value, operand)`, which stringified the *object* into the
     comparison: "is Paris" then never matched a picked place, because the value it compared
     was `{"address":"Paris","lat":…}`. A filter reads what the cell reads. */
  fits: (operator, value, operand) => matchesText(operator, placeAddress(value) === "" ? null : placeAddress(value), operand),
  aggregates: ["count", "unique"],
};
