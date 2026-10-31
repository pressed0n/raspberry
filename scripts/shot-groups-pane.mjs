// Look at the Status-groups pane, not claim anything about it.
//
// The owner rejected the micro-caps label "GROUPS, TOP TO BOTTOM" as fluff, so this captures
// the pane before/after at both widths to judge the layout by eye. It writes nothing: it
// opens the property menu, opens the pane, screenshots, and closes.
//
// Usage (needs the disposable instance from run-groups-shot.ps1):
//   BASE=http://127.0.0.1:3103 PAGE=<page id> STATUS=<property id> node scripts/shot-groups-pane.mjs [w] [h] [name]
import { openBrowser } from "../browser-session.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const PAGE = process.env.PAGE;
const STATUS = process.env.STATUS;
const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 900);
const name = process.argv[4] ?? `groups-pane-${width}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!PAGE || !STATUS) throw new Error("PAGE and STATUS are required");

const b = await openBrowser({ url: `${BASE}/#${PAGE}`, width, height });
try {
  await b.waitFor(`!!document.querySelector("tr.db-row[data-row-id]")`, { label: "the table is up" });

  // The Status header's own label — clicking a column name opens its menu.
  const trigger = await b.evaluate(`(() => {
    const th = [...document.querySelectorAll('th.db-th')]
      .find((candidate) => (candidate.querySelector('.db-th-text')?.textContent ?? '').trim() === "Status");
    if (!th) return null;
    th.scrollIntoView({ block: "nearest", inline: "nearest" });
    const button = th.querySelector(".db-th-label");
    if (!button) return null;
    const r = button.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!trigger) throw new Error("no menu button on the Status header");
  await b.mouse(trigger.x, trigger.y);
  await sleep(160);

  // The property menu itself, for comparison: the same 28px icon button holds the column's
  // icon there, which is where this bordered shape is established.
  console.log(await b.shot(`${name}-menu`));


  const item = await b.evaluate(`(() => {
    const surface = [...document.querySelectorAll('[data-db-popover]')].at(-1);
    const row = [...(surface?.querySelectorAll('.db-menu-item') ?? [])]
      .find((candidate) => (candidate.querySelector('.db-menu-label') ?? candidate).textContent.trim() === "Status groups");
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!item) throw new Error('no "Status groups" row in the property menu');
  await b.mouse(item.x, item.y);
  await b.waitFor(`!!document.querySelector('.db-groups-pane')`, { label: "the pane opened" });
  await sleep(200);

  // What the pane actually contains, in words — so the picture has a caption.
  console.log(
    await b.evaluate(`(() => {
      const pane = document.querySelector('.db-groups-pane');
      return [...pane.querySelectorAll('p, .db-menu-item, .db-group-row')]
        .map((el) => el.className + ' | ' + el.textContent.trim().replace(/\\s+/g, ' '))
        .join('\\n');
    })()`),
  );

  console.log(await b.shot(name));
} finally {
  await b.close();
}
