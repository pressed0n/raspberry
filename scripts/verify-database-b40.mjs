// Verifies B40/B41 in a real browser against the running app, and writes *nothing*.
//
// The rule in `docs/TESTING.md` is that a UI write is proved by intercepting the request
// in the browser and asserting the body the UI built — not by letting it land and then
// cleaning up. So `window.fetch` is patched inside the page: every non-GET `/api/databases*`
// call is recorded and *rejected*, which means the app sees a failed save (it shows its
// banner, which is honest) and the owner's database is untouched.
//
//   $env:PORT=3000; node scripts/verify-database-b40.mjs
//
// It reads the page id from the database directly (read-only) because there is no list
// endpoint by design — a database lives in a page's content, and that is its index.
import { DatabaseSync } from "node:sqlite";
import { openBrowser } from "./browser-session.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
/* Which sqlite file to read the fixture page id out of — the *same* variable the server
   honours, so `BASE` and the file it reads cannot drift apart. Hardcoding
   `data/raspberry.sqlite` meant the probe picked a page from the owner's database and then
   navigated the isolated instance to a page that does not exist there, which reads as
   "waitFor timed out: the table" — a probe failure that looks like a broken app. */
const DB_PATH = (process.env.DATABASE_URL ?? "file:./data/raspberry.sqlite").replace(/^file:/, "");
/* The same probe at both widths the project verifies at. A trailing row that lines up at
   1400px and drifts at 390px is not aligned — it is aligned on one screen. */
const WIDTH = Number(process.env.W ?? 1400);
const HEIGHT = Number(process.env.H ?? 900);

function pageWithDatabase() {
  /* An explicit page wins: the isolated instance on :3100 is seeded by
     `scripts/seed-qa.mjs` and its database is not the owner's. */
  if (process.env.PAGE_ID) return { pageId: process.env.PAGE_ID, title: "QA page", databaseId: "" };
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const pages = db.prepare("SELECT id,title,content FROM pages WHERE deleted_at IS NULL").all();
  for (const page of pages) {
    const content = String(page.content ?? "");
    const block = content.match(/"databaseId":"([0-9a-f-]{36})"/);
    if (block) return { pageId: String(page.id), title: String(page.title), databaseId: block[1] };
  }
  return null;
}

const target = pageWithDatabase();
if (!target) {
  console.log("No page contains a database block — nothing to verify against.");
  process.exit(0);
}
console.log(`page "${target.title}" (${target.pageId}) → database ${target.databaseId}`);

const b = await openBrowser({ width: WIDTH, height: HEIGHT, url: `${BASE}/` });

try {
  /* --- open the page ------------------------------------------------------------------
     The app addresses a page in the URL hash. Setting it *after* the shell has mounted —
     rather than loading `/#id` cold — is what makes it deterministic: on a cold load the
     app restores its own last page and can overwrite the hash before it is read. */
  await b.waitFor(`document.querySelectorAll("a,button").length > 3`, { timeoutMs: 15000, label: "the shell" });
  /* Cold-load the page first — that is the path the app supports — and only fall back to
     setting the hash on the live document if the cold load restored some other page. */
  await b.send("Page.navigate", { url: `${BASE}/#${target.pageId}` });
  await new Promise((r) => setTimeout(r, 1500));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await b.evaluate(`!!document.querySelector(".db-table")`)) break;
    await b.evaluate(`location.hash = ${JSON.stringify(target.pageId)}; true`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  await b.waitFor(`!!document.querySelector(".db-table")`, { timeoutMs: 20000, label: "the table" });
  console.log("shot:", await b.shot("b40-table"));

  /* `ALLOW_WRITES=1` means "this instance is disposable". It is set for the isolated
     copy on :3100 only, and it exists because two of these checks cannot be proved
     without a real 409 and a real clear: `window.__allow` is what lets exactly one PATCH
     through, and only while a check says so. */
  const allowWrites = process.env.ALLOW_WRITES === "1";
  const databaseId = await b.evaluate(`(async () => {
    const response = await fetch(location.origin + "/api/pages/${target.pageId}");
    const body = await response.json();
    const page = body.page ?? body;
    const match = JSON.stringify(page.content ?? page).match(/"databaseId":"([0-9a-f-]{36})"/);
    return match ? match[1] : null;
  })()`);

  /* --- the intercept, installed after the load so a reload cannot wipe it --------- */
  await b.evaluate(`
    window.__writes = [];
    window.__realFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      const method = String(init?.method ?? (typeof input === "string" ? "GET" : input?.method) ?? "GET").toUpperCase();
      if (url.includes("/api/databases") && method !== "GET") {
        window.__writes.push({ url, method, body: init?.body ?? null });
        /* __allow is the one place a probe may let a write land. It is only ever true on
           the isolated instance (:3100, seeded by scripts/scratch/seed-qa.mjs), and only
           for the single click being proved — everything else, and everything against the
           owner's database on :3000, is recorded and refused. */
        if (window.__allow === true && method === "PATCH") return window.__realFetch(input, init);
        return Promise.reject(new Error("probe: write intercepted on purpose"));
      }
      return window.__realFetch(input, init);
    };
    true;
  `);

  /* --- B41: the trailing row is a row, and it lines up ------------------------- */
  const trailing = await b.evaluate(`(() => {
    const table = document.querySelector(".db-table");
    const rows = [...table.querySelectorAll("tbody tr")];
    const last = rows[rows.length - 1];
    if (!last || !last.classList.contains("db-row-new")) return { has: false, rows: rows.length };
    const input = last.querySelector(".db-new-title");
    const dataRow = rows.find((row) => !row.classList.contains("db-row-new"));
    /* Compared like with like: the *name field* in a real row, not the first input in it
       (that one is the gutter's checkbox, 48px to the left of the name's text axis). */
    const dataInput = dataRow?.querySelector(".db-cell-name .db-cell-input");
    const a = input?.getBoundingClientRect();
    const c = dataInput?.getBoundingClientRect();
    const lastCells = [...last.cells].map((cell) => cell.className.replace(/db-cell /g, "").trim());
    const dataCells = dataRow ? [...dataRow.cells].map((cell) => cell.className.replace(/db-cell /g, "").trim()) : [];
    return {
      has: true,
      rows: rows.length,
      placeholder: input?.placeholder ?? null,
      titleX: a ? Math.round(a.left) : null,
      dataX: c ? Math.round(c.left) : null,
      lastCells,
      dataCells,
      sameCell: lastCells.length === dataCells.length,
    };
  })()`);
  b.check("B41: the last row of the table is the 'New page' row", trailing.has, JSON.stringify(trailing));
  if (trailing.has) {
    b.check("B41: its name starts on the same pixel as every other name", trailing.titleX === trailing.dataX, `${trailing.titleX} vs ${trailing.dataX}`);
    b.check("B41: it has as many cells as a data row, so the columns are the table's",
      trailing.sameCell, `new: ${trailing.lastCells}; data: ${trailing.dataCells}`);
  }

  /* --- type-to-create: the POST body, intercepted ------------------------------ */
  if (trailing.has) {
    await b.evaluate(`(() => {
      const input = document.querySelector(".db-row-new input");
      input.focus();
      input.scrollIntoView({ block: "center" });
      return true;
    })()`);
    await b.type("Probe page");
    await b.key("Enter", { code: "Enter", keyCode: 13 });
    await new Promise((r) => setTimeout(r, 400));
    const created = await b.evaluate(`window.__writes.find((w) => /\\/rows$/.test(w.url) && w.method === "POST") ?? null`);
    b.check("B41: typing a name and pressing Enter asks for one page with that title",
      created !== null && JSON.parse(created.body).title === "Probe page",
      created ? created.url + " " + created.body : "no POST /rows was made");
    b.check("B41: nothing was written — the request was intercepted", created !== null && await b.evaluate(`window.__writes.length > 0`));
  }

  /* --- the keyboard: Enter moves down the column, Tab is the browser's own --------- */
  const keyboard = await b.evaluate(`(() => {
    const table = document.querySelector(".db-table");
    const rows = [...table.querySelectorAll("tbody tr")].filter((row) => !row.classList.contains("db-row-new"));
    if (rows.length < 2) return { skipped: true };
    const start = rows[0].querySelector(".db-cell-name .db-cell-input");
    if (!start) return { skipped: true };
    start.focus();
    start.select();
    const before = rows.indexOf(start.closest("tr"));
    return { before, ok: document.activeElement === start };
  })()`);
  if (!keyboard.skipped) {
    await b.key("Enter", { code: "Enter", keyCode: 13 });
    await new Promise((r) => setTimeout(r, 300));
    const moved = await b.evaluate(`(() => {
      const table = document.querySelector(".db-table");
      const rows = [...table.querySelectorAll("tbody tr")].filter((row) => !row.classList.contains("db-row-new"));
      const row = document.activeElement?.closest("tr");
      return { row: rows.indexOf(row), active: document.activeElement?.tagName ?? null };
    })()`);
    b.check("B41: Enter in a Name cell moves to the cell below, not out of the table",
      moved.row === keyboard.before + 1 && moved.active === "INPUT", JSON.stringify({ from: keyboard.before, ...moved }));
  }

  /* --- B40: Change type, and what it sends -------------------------------------
     The *last* property column, not the first: the first column is the title, and the
     title cannot change type (a row is a page, and a page's name is text everywhere).
     The first run of this probe opened that menu, found Change type disabled — correctly
     — and read it as a failure of the feature. */
  const menu = await b.evaluate(`(() => {
    const headers = [...document.querySelectorAll(".db-th .db-th-label, .db-th-label, .db-th button")]
      .filter((node) => {
        const text = (node.textContent ?? "").trim();
        return text.length > 0 && !/^Add property$/i.test(text);
      });
    /* The last one: the first column is the title, and a title cannot change type. */
    const header = headers[headers.length - 1];
    if (!header) return null;
    const box = header.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, label: (header.textContent ?? "").trim() };
  })()`);
  b.check("B40: a column header is clickable", menu !== null, menu ? menu.label : "none found");
  if (menu && /^Add property$/i.test(menu.label)) {
    /* The owner's live database has one column — the title — and a title cannot change
       type. Recording that as a skip is honest; recording it as a failure taught the first
       run of this probe to look like a broken feature when it was a correct refusal. */
    console.log("  SKIP B40: Change type — this table has no column that can change type");
  } else if (menu) {
    await b.mouse(menu.x, menu.y);
    await b.waitFor(`!!document.querySelector("[role=menu], .menu-surface, .db-menu")`, { label: "the property menu" });
    const hasChangeType = await b.evaluate(`(() => {
      const item = [...document.querySelectorAll("[role=menuitem], .menu-item, button")]
        .find((node) => /^Change type$/i.test((node.textContent ?? "").trim()));
      /* A disabled item is the table saying "this column cannot change type" — the title
         column always, and any column whose caller passed no handler. Both are correct, and
         both are a skip rather than a failure. */
      return item ? (item.disabled ? "disabled" : "enabled") : null;
    })()`);
    b.check("B40: the property menu offers Change type", hasChangeType !== null);
    await b.shot("b40-menu");

    if (hasChangeType === "disabled") {
      console.log("  SKIP B40: Change type is correctly disabled — this is the title column");
    } else if (hasChangeType === "enabled") {
      const sub = await b.evaluate(`(() => {
        const item = [...document.querySelectorAll("[role=menuitem], .menu-item, button")]
          .find((node) => /^Change type$/i.test((node.textContent ?? "").trim()));
        const box = item.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      })()`);
      /* Hover, not click. `MenuSub` opens on `mouseenter` and *toggles* on click, so a
         click after the pointer arrives closes it again — the failure this probe had on
         its first run, and the reason the assertion is "the submenu has items" rather
         than "the item was clicked". */
      await b.move(sub.x, sub.y);
      await new Promise((r) => setTimeout(r, 400));
      const types = await b.evaluate(`(() => {
        const labels = new Set();
        for (const node of document.querySelectorAll("[role=menuitem]")) labels.add((node.textContent ?? "").trim());
        return [...labels];
      })()`);
      b.check("B40: the submenu lists the types a column can hold", types.length >= 10, types.join(", "));
      await b.shot("b40-change-type");

      const picked = await b.evaluate(`(() => {
        const item = [...document.querySelectorAll("[role=menuitem], .menu-item, button")]
          .find((node) => (node.textContent ?? "").trim() === "Number");
        if (!item) return null;
        const box = item.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      })()`);
      if (picked) {
        /* On the disposable instance the first click is a write that *should* land, because
           the answer being proved is the server's 409. */
        if (allowWrites) await b.evaluate("window.__allow = true; true");
        await b.mouse(picked.x, picked.y);
        await new Promise((r) => setTimeout(r, 700));
        if (allowWrites) await b.evaluate("window.__allow = false; true");
        const patch = await b.evaluate(`window.__writes.find((w) => /\\/properties\\/[^/]+$/.test(w.url) && w.method === "PATCH") ?? null`);
        const body = patch ? JSON.parse(patch.body) : null;
        b.check("B40: picking a type sends ONE patch naming that type",
          body !== null && body.type === "number" && typeof body.mutationId === "string",
          patch ? patch.url + " " + patch.body : "no PATCH /properties was made");

        /* --- the refusal, and the choice it becomes ----------------------------------
           Only meaningful where a write may land (the isolated instance): the Note column
           holds "a" and "b", neither of which reads as a number, so the server must refuse
           and say "2 cells". The menu must then offer the second, explicit answer. */
        if (allowWrites) {
          /* The banner is what carries the refusal, so wait for the *server's* words rather
             than for a fixed delay: the previous click's intercepted failure is still on
             screen for a moment, and reading it is how this check first "failed". */
          await b.waitFor(`(document.querySelector(".db-failure")?.textContent ?? "").includes("cannot read")`, { timeoutMs: 6000, label: "the server's refusal" });
          const banner = await b.evaluate(`document.querySelector(".db-failure")?.textContent ?? ""`);
          b.check("B40: a type change that would lose values is refused, with the count",
            /2 cells/.test(banner) && /cannot read/.test(banner), banner.trim().slice(0, 140));

          const reopened = await b.evaluate(`(() => {
            const header = [...document.querySelectorAll(".db-th .db-th-label, .db-th-label, .db-th button")]
              .filter((node) => { const text = (node.textContent ?? "").trim(); return text.length > 0 && !/^Add property$/i.test(text); })
              .pop();
            if (!header) return null;
            const box = header.getBoundingClientRect();
            return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
          })()`);
          await b.mouse(reopened.x, reopened.y);
          await new Promise((r) => setTimeout(r, 250));
          const offer = await b.evaluate(`(() => {
            const sub = [...document.querySelectorAll("[role=menuitem]")]
              .find((node) => /^Change type$/i.test((node.textContent ?? "").trim()));
            if (!sub) return null;
            const box = sub.getBoundingClientRect();
            return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
          })()`);
          if (offer) await b.move(offer.x, offer.y);
          await new Promise((r) => setTimeout(r, 400));
          /* `[role=menuitem]` only: the failure banner is a `<button>` whose text also says
             "change the type anyway", and matching it is how this check first read the
             banner as the menu item. A menu item is a menu item, and the banner is not one. */
          const anyway = await b.evaluate(`(() => {
            const item = [...document.querySelectorAll("[role=menuitem]")]
              .find((node) => /^Clear \\d+ cells? and use /i.test((node.textContent ?? "").trim()));
            if (!item) return null;
            const box = item.getBoundingClientRect();
            return { x: box.left + box.width / 2, y: box.top + box.height / 2, text: (item.textContent ?? "").trim() };
          })()`);
          b.check("B40: the refusal becomes a second item that says, in words, what it clears",
            anyway !== null && /clear 2 cells/i.test(anyway.text), anyway?.text ?? "no destructive item");
          await b.shot("b40-anyway");

          if (anyway) {
            await b.evaluate(`window.__allow = true; true`);
            /* Re-measured immediately before the click: the rect from the check above is a
               few hundred milliseconds old and the submenu can have closed underneath it. */
            const point = await b.evaluate(`(() => {
              const item = [...document.querySelectorAll("[role=menuitem]")]
                .find((node) => /^Clear \\d+ cells? and use /i.test((node.textContent ?? "").trim()));
              if (!item) return null;
              const box = item.getBoundingClientRect();
              return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
            })()`);
            /* Clicked through the DOM rather than the pointer: the submenu and the failure
               banner can overlap, and a mouse click at the item's centre lands on whichever
               is on top. `.click()` dispatches the same event React listens for, and this
               check is about *which request the item sends*, not about hit-testing. */
            const clicked = await b.evaluate(`(() => {
              const item = [...document.querySelectorAll("[role=menuitem]")]
                .find((node) => /^Clear \\d+ cells? and use /i.test((node.textContent ?? "").trim()));
              if (!item) return false;
              item.click();
              return true;
            })()`);
            console.log("clicked the destructive item:", clicked);
            await new Promise((r) => setTimeout(r, 1200));
            await b.evaluate(`window.__allow = false; true`);
            const sent = await b.evaluate(`window.__writes.map((w) => w.url.split("/").pop() + " " + w.method + " " + (w.body ?? ""))`);
            console.log("writes seen:", JSON.stringify(sent, null, 1));
            b.check("B40: 'clear the cells' is a request that says so, not a plain type change",
              await b.evaluate(`window.__writes.some((w) => w.method === "PATCH" && String(w.body ?? "").includes("clearUnconvertible"))`));
            const after = await b.evaluate(`fetch(location.origin + "/api/databases/${databaseId}").then((r) => r.json()).then((body) => {
              const database = body.database ?? body;
              const note = database.properties.find((property) => property.name === "Note");
              return { type: note?.type ?? null, cells: database.rows.map((row) => row.cells[note.id] ?? null) };
            })`);
            b.check("B40: 'change anyway' really changes the type", after.type === "number", JSON.stringify(after));
            /* The claim being checked is "the 2 values it counted are gone", not "the column
               holds 2 nulls": a column with three rows has three empty cells now, and two of
               them were emptied by this click. */
            b.check("B40: and clears exactly the values it counted",
              after.cells.filter((value) => value !== null).length === 0, JSON.stringify(after.cells));
          }
        }
      }
    }
  }

  await b.report();
} catch (error) {
  console.log("probe failed:", error.message);
  console.log("shot:", await b.shot("b40-failure"));
  await b.report();
}
