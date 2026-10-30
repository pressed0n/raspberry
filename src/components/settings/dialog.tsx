"use client";
/* Raspberry — settings dialog (B30, one surface in B32, rail in B33, two tiers in B34)
   ---------------------------------------------------------------------------
   One record, one dialog. Every control writes the whole `Settings` object back
   through `withVars`, then applies it, then stores it — so the cache the
   pre-paint script reads can never lag behind what is on screen.

   History worth keeping: B31 moved settings from a route to a modal and split it
   into four pages behind a side menu; B32 decided four pages for one page of
   controls was a menu pretending to be a filing cabinet, and collapsed them into
   a single Appearance surface — but took the menu with it. B33 puts the menu back
   at one row. It is not a filing cabinet again: the rail exists because settings
   will grow, and a menu retrofitted around a finished surface always ends up with
   the wrong keyboard model. The section list is data (`src/lib/settings-nav.ts`),
   so the second section is an object, not a refactor.

   Vertical space is the other half of B33. The Theme group became a segmented
   control on the heading line, the three per-group explainers became one hint,
   and a block colour now shows its ink and its fill on the same three rows
   instead of asking you to switch between them. The surface went from scrolling
   to fitting.

   B34 finished the same argument in three moves, all of them subtractions:

     · the "Link hues" checkbox is gone. Unticking it produced a colour nobody
       wants — a fill 50 points off its own ink on the wheel — so the link is now
       the behaviour rather than a preference (`setEntry` has no flag);
     · the strip got shorter (24px) and its unselected chips got quieter (a 0.5
       veil), because eight of nine chips are not the answer;
     · Primary and tick split into two tiers. The strip picks, the sliders tune,
       and the sliders are shut until asked for. Three sliders on a colour most
       people will choose from a chip was 44px per group spent on almost nobody.

   Editing is scoped to the theme you are looking at. Both themes have their own
   defaults (a fill that works on #0d0c0c is not a fill that works on #fff), and
   offering two sets of sliders at once makes it ambiguous which one the preview
   is showing. The theme switch is the first row of the surface and the preview
   follows it.
*/

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  COLOR_LABELS,
  COLOR_NAMES,
  DEFAULT_PALETTE,
  hslToHex,
  resolvePalette,
  setEntry,
  withAxis,
  type ColorGroup,
  type ColorName,
  type Hsl,
  type ThemeMode,
} from "@/lib/palette";
import {
  DEFAULT_SETTINGS,
  applyPalette,
  clearPalette,
  readSettings,
  storeSettings,
  serialiseSettings,
  withVars,
  type Settings,
} from "@/lib/settings";
import { DEFAULT_SECTION_ID, findSection } from "@/lib/settings-nav";
import { applyTheme, readTheme, storeTheme, type Theme } from "@/lib/theme";
import { Check, Copy } from "lucide-react";
import Modal from "../modal";
import { Axis, AdvancedPanel, AdvancedToggle, Group, PairAxis, SwatchStrip, type Swatch } from "./controls";
import SettingsNav from "./nav";
import PalettePreview from "./preview";

/** The three integers of an HSL colour, in the order they read on a slider.
 *  `name` is the spoken label; `short` is what fits in a 34px column. */
const AXES: readonly { key: keyof Hsl; short: string; name: string; max: number; suffix: string }[] = [
  { key: "h", short: "Hue", name: "Hue", max: 359, suffix: "°" },
  { key: "s", short: "Sat", name: "Saturation", max: 100, suffix: "%" },
  { key: "l", short: "Light", name: "Lightness", max: 100, suffix: "%" },
];

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [theme, setTheme] = useState<Theme>("dark");
  const [section, setSection] = useState(DEFAULT_SECTION_ID);
  const [selected, setSelected] = useState<ColorName>("red");
  const [copied, setCopied] = useState(false);
  /* Both start shut, and they stay independent: opening the primary sliders is a
     statement about the primary colour, not about the tick. Neither lives in the
     stored record — a palette is worth remembering, a panel that happened to be
     open when the dialog closed is not. */
  const [open, setOpen] = useState({ accent: false, tick: false });
  const toggleOpen = (key: "accent" | "tick") =>
    setOpen((current) => ({ ...current, [key]: !current[key] }));

  // Server render and first client render must agree, so state starts at the
  // defaults and the stored record lands in the effect. Anyone who has not
  // customised anything sees no movement at all.
  useEffect(() => {
    const stored = readSettings();
    const active = readTheme();
    setSettings(stored);
    setTheme(active);
    applyPalette(active, stored.palette);
  }, []);

  const palette = useMemo(() => resolvePalette(settings.palette), [settings.palette]);
  const mode = theme as ThemeMode;

  const commit = useCallback((next: Settings) => {
    setSettings(next);
    storeSettings(next);
    applyPalette(theme as ThemeMode, next.palette);
  }, [theme]);

  const edit = useCallback((mutate: (current: Settings) => Settings["palette"]) => {
    commit(withVars({ version: 1, palette: mutate(settings) }));
  }, [commit, settings]);

  const switchTheme = (next: Theme) => {
    applyTheme(next);
    storeTheme(next);
    setTheme(next);
    applyPalette(next as ThemeMode, settings.palette);
  };

  const setPartAxis = (group: ColorGroup, axis: keyof Hsl, value: number) => {
    const current = palette[mode][group][selected];
    edit((snapshot) =>
      setEntry(snapshot.palette, mode, selected, group, withAxis(current, axis, value)),
    );
  };

  const setAccentAxis = (axis: keyof Hsl, value: number) => {
    edit((snapshot) => ({
      ...snapshot.palette,
      accent: { ...snapshot.palette.accent, [mode]: withAxis(palette.accent[mode], axis, value) },
    }));
  };

  const setTickAxis = (axis: keyof Hsl, value: number) => {
    edit((snapshot) => ({
      ...snapshot.palette,
      checkbox: { ...snapshot.palette.checkbox, [mode]: withAxis(palette.checkbox[mode], axis, value) },
    }));
  };

  /** Reset wipes both halves of one colour name — which is exactly what the dot
   *  on a swatch promises, since it lights up when *either* half is off-default. */
  const resetColour = () => {
    edit((snapshot) => {
      const themeOverride = { ...snapshot.palette[mode] };
      delete themeOverride.text?.[selected];
      delete themeOverride.background?.[selected];
      return { ...snapshot.palette, [mode]: themeOverride };
    });
  };

  const resetAll = () => {
    clearPalette(mode);
    const next = withVars({ version: 1, palette: {} });
    setSettings(next);
    storeSettings(next);
  };

  /* Copies the same JSON `parseSettings` reads back, so the round trip can be
     checked without opening devtools. A blocked clipboard is not an error worth a
     banner: the button simply stops claiming it copied. */
  const copyRecord = async () => {
    try {
      await navigator.clipboard.writeText(serialiseSettings(settings));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  /* The nine hue choices are the palette's own text colours, so a picked primary
     can never be a colour no block can hold. The strip shows text colours in all
     three groups for the same reason: fills sit at 17–20% lightness, where nine
     chips would be nine near-blacks. */
  const hueSwatches: Swatch[] = COLOR_NAMES.map((name) => ({
    label: COLOR_LABELS[name],
    hsl: palette[mode].text[name],
  }));

  const isEdited = (name: ColorName) =>
    (["text", "background"] as const).some(
      (group) => hslToHex(palette[mode][group][name]) !== hslToHex(DEFAULT_PALETTE[mode][group][name]),
    );

  const blockSwatches: Swatch[] = COLOR_NAMES.map((name) => ({
    label: COLOR_LABELS[name],
    hsl: palette[mode].text[name],
    edited: isEdited(name),
  }));

  const accentHue = palette.accent[mode];
  const tickHue = palette.checkbox[mode];
  const accentIndex = hueSwatches.findIndex((swatch) => swatch.hsl.h === accentHue.h);
  const tickIndex = hueSwatches.findIndex((swatch) => swatch.hsl.h === tickHue.h);

  const textHsl = palette[mode].text[selected];
  const fillHsl = palette[mode].background[selected];

  const customised = Object.keys(settings.vars.dark).length + Object.keys(settings.vars.light).length > 0;
  const meta = findSection(section) ?? findSection(DEFAULT_SECTION_ID);

  return (
    <Modal
      title="Settings"
      variant="settings"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="set-btn" onClick={() => void copyRecord()} title="Copy the settings record as JSON">
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span className="set-btn-label">{copied ? "Copied" : "Copy"}</span>
          </button>
          <button type="button" className="set-btn" onClick={resetAll}
            disabled={!customised} title={`Clear every ${mode} override`}>
            {/* No `set-btn-label` class: that is what collapses below 560px, and a
                button with no icon and no words is an empty pill. */}
            <span>Reset all</span>
          </button>
        </>
      }
    >
      <div className="set-shell">
        <SettingsNav active={section} onSelect={setSection} />

        <div className="set-body">
          <header className="set-intro">
            {/* The theme switch is the first row of the surface rather than a
                group of its own: it is one choice, and a group header plus a
                paragraph to say "dark or light" cost 70px. */}
            <div className="set-intro-row">
              <h3>{meta?.label}</h3>
              <div className="segmented" role="group" aria-label="Theme">
                {(["dark", "light"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={theme === option ? "is-active" : ""}
                    aria-pressed={theme === option}
                    onClick={() => switchTheme(option)}
                  >
                    {option === "dark" ? "Dark" : "Light"}
                  </button>
                ))}
              </div>
            </div>
            {meta && <p className="set-hint">{meta.lede}</p>}
          </header>

          <Group
            title="Block colours"
            action={
              <button type="button" className="set-link" onClick={resetColour} disabled={!isEdited(selected)}>
                Reset {COLOR_LABELS[selected].toLowerCase()}
              </button>
            }
          >
            <SwatchStrip
              label="Block colour"
              swatches={blockSwatches}
              active={COLOR_NAMES.indexOf(selected)}
              onPick={(index) => setSelected(COLOR_NAMES[index])}
            />

            {/* Ink and fill, on the same three rows. The chip is the pair seen
                as it is actually used — letters on a highlight — and doubles as
                the live sample that the two header words cannot give. */}
            <div className="pair" role="group" aria-label="Text and fill of the block colour">
              <div className="pair-head" aria-hidden>
                <span className="pair-chip" style={{ color: hslToHex(textHsl), background: hslToHex(fillHsl) }}>
                  Aa
                </span>
                <span>Text</span>
                <span>Fill</span>
              </div>
              {AXES.map((axis) => (
                <PairAxis
                  key={axis.key}
                  label={axis.short}
                  name={axis.name}
                  max={axis.max}
                  suffix={axis.suffix}
                  text={textHsl[axis.key]}
                  fill={fillHsl[axis.key]}
                  onChange={(part, value) => setPartAxis(part, axis.key, value)}
                  testId={`block-${axis.key}`}
                />
              ))}
            </div>
          </Group>

          <Group
            title="Primary colour"
            action={
              <AdvancedToggle
                open={open.accent}
                controls="accent-advanced"
                onToggle={() => toggleOpen("accent")}
              >
                Advanced
              </AdvancedToggle>
            }
          >
            <SwatchStrip
              label="Primary colour hue"
              swatches={hueSwatches}
              active={accentIndex}
              onPick={(index) => setAccentAxis("h", hueSwatches[index].hsl.h)}
            />
            <AdvancedPanel open={open.accent} id="accent-advanced">
              <div className="axes">
                <Axis label="Hue" name="Hue" max={359} suffix="°" value={accentHue.h} onChange={(v) => setAccentAxis("h", v)} testId="accent-h" />
                <Axis label="Sat" name="Saturation" max={100} suffix="%" value={accentHue.s} onChange={(v) => setAccentAxis("s", v)} testId="accent-s" />
                <Axis label="Light" name="Lightness" max={100} suffix="%" value={accentHue.l} onChange={(v) => setAccentAxis("l", v)} testId="accent-l" />
              </div>
            </AdvancedPanel>
          </Group>

          <Group
            title="Checklist tick"
            action={
              <AdvancedToggle
                open={open.tick}
                controls="tick-advanced"
                onToggle={() => toggleOpen("tick")}
              >
                Advanced
              </AdvancedToggle>
            }
          >
            <SwatchStrip
              label="Checklist tick hue"
              swatches={hueSwatches}
              active={tickIndex}
              onPick={(index) => setTickAxis("h", hueSwatches[index].hsl.h)}
            />
            <AdvancedPanel open={open.tick} id="tick-advanced">
              <div className="axes">
                <Axis label="Hue" name="Hue" max={359} suffix="°" value={tickHue.h} onChange={(v) => setTickAxis("h", v)} testId="tick-h" />
                <Axis label="Sat" name="Saturation" max={100} suffix="%" value={tickHue.s} onChange={(v) => setTickAxis("s", v)} testId="tick-s" />
                <Axis label="Light" name="Lightness" max={100} suffix="%" value={tickHue.l} onChange={(v) => setTickAxis("l", v)} testId="tick-l" />
              </div>
            </AdvancedPanel>
          </Group>
        </div>

        <aside className="set-side">
          <div className="set-side-inner">
            <h3>Preview</h3>
            <PalettePreview />
          </div>
        </aside>
      </div>
    </Modal>
  );
}
