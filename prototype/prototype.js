// Raspberry — B18/B19 prototype harness.
// Nothing here ships. It exists so the design can be operated, not just looked at.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const app = $("#app");
const palette = $("#palette");
const paletteInput = $("#palette-input");
const moreMenu = $("#more-menu");
const moreBtn = $("#more");
const scroll = $("#scroll");
const topbar = $("#topbar");
const title = $(".doc-title");

/* ---------- theme ---------- */
const applyTheme = (theme) => {
  document.documentElement.dataset.theme = theme;
  $("#icon-moon").hidden = theme === "dark";
  $("#icon-sun").hidden = theme === "light";
  try { localStorage.setItem("raspberry-theme", theme); } catch {}
};

const stored = (() => { try { return localStorage.getItem("raspberry-theme"); } catch { return null; } })();
applyTheme(stored || "dark");

$("#theme").addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

/* ---------- sidebar ---------- */
const isMobile = () => window.matchMedia("(max-width: 860px)").matches;

$("#collapse").addEventListener("click", () => {
  if (isMobile()) { app.classList.remove("is-open"); }
  else { app.classList.toggle("is-collapsed"); }
});

$("#open-side").addEventListener("click", () => app.classList.add("is-open"));

document.addEventListener("click", (event) => {
  if (!app.classList.contains("is-open") || !isMobile()) return;
  if (!event.target.closest(".sidebar")) app.classList.remove("is-open");
});

/* ---------- command palette ---------- */
const openPalette = () => {
  palette.hidden = false;
  paletteInput.value = "";
  filterPalette("");
  requestAnimationFrame(() => paletteInput.focus());
};
const closePalette = () => { palette.hidden = true; };

$$("[data-open-palette]").forEach((el) => el.addEventListener("click", openPalette));
palette.addEventListener("click", (event) => { if (event.target === palette) closePalette(); });

function filterPalette(query) {
  const q = query.trim().toLowerCase();
  let shown = 0;
  $$(".panel-item", palette).forEach((item) => {
    const hit = !q || item.textContent.toLowerCase().includes(q);
    item.hidden = !hit;
    if (hit) shown += 1;
  });
  $$(".menu-label", palette).forEach((label) => { label.hidden = Boolean(q); });
  const existing = $(".panel-empty", palette);
  if (!shown && !existing) {
    const note = document.createElement("div");
    note.className = "panel-empty";
    note.textContent = `No results for “${query.trim()}”`;
    $("#palette-list").append(note);
  } else if (shown && existing) {
    existing.remove();
  } else if (!shown && existing) {
    existing.textContent = `No results for “${query.trim()}”`;
  }
}

paletteInput.addEventListener("input", (event) => filterPalette(event.target.value));

/* ---------- page menu ---------- */
const setMenu = (open) => {
  moreMenu.hidden = !open;
  moreBtn.setAttribute("aria-expanded", String(open));
};
moreBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  setMenu(moreMenu.hidden);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#more-menu") && !event.target.closest("#more")) setMenu(false);
});

/* ---------- keyboard ---------- */
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    palette.hidden ? openPalette() : closePalette();
    return;
  }
  if (event.key === "Escape") { closePalette(); setMenu(false); }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (palette.hidden) return;
    event.preventDefault();
    const items = $$(".panel-item", palette).filter((el) => !el.hidden);
    if (!items.length) return;
    const at = items.findIndex((el) => el.classList.contains("is-cursor"));
    const next = (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((el) => el.classList.remove("is-cursor"));
    items[next].classList.add("is-cursor");
  }
});

/* ---------- title autosize ---------- */
function autosize() {
  title.style.height = "auto";
  title.style.height = `${title.scrollHeight}px`;
}
title.addEventListener("input", autosize);
autosize();

/* ---------- scroll edge ---------- */
scroll.addEventListener("scroll", () => {
  topbar.classList.toggle("is-scrolled", scroll.scrollTop > 4);
}, { passive: true });

/* ---------- to-do toggles ---------- */
$$(".todo-box").forEach((box) => {
  box.addEventListener("click", () => box.closest(".todo").classList.toggle("is-done"));
});

/* ---------- favourite ---------- */
$("#fav").addEventListener("click", (event) => {
  const btn = event.currentTarget;
  const on = btn.classList.toggle("is-on");
  btn.querySelector("svg").setAttribute("fill", on ? "currentColor" : "none");
});

/* ---------- demo states via hash ---------- */
// #palette, #light, #empty — so screenshots never need demo chrome on screen.
function applyHash() {
  const hash = location.hash.replace("#", "");
  if (hash) document.documentElement.dataset.instant = "";
  if (hash === "palette") openPalette();
  if (hash === "light") applyTheme("light");
  if (hash === "dark") applyTheme("dark");
  if (hash === "empty") {
    $("#empty-view").hidden = false;
    $("#scroll").hidden = true;
  }
  if (hash === "sidebar") {
    app.classList.add("is-open");
    openPalette();
    closePalette();
  }
}
window.addEventListener("hashchange", applyHash);
applyHash();
