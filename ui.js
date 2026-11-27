// Air Tennis UI layer (v3). Presentation only: menu panels, focus hand-off, records, player slots, HUD polish on the
// TV, and the step dots / ready card on the phone. It never touches game rules, tracking, packets or the phone link;
// it only reads state that game.js / phone.js already expose and reacts to the DOM they update.
const $ = (id) => document.getElementById(id);

if ($("v-join")) phoneUI();
else if ($("menu")) tvUI();

// ---------------------------------------------------------------- TV
function tvUI() {
  const menu = $("menu");
  const FAMILIES = {
    match: { title: "Match", eyebrow: "Choose a match" },
    rally: { title: "Rally", eyebrow: "Two players" },
    doubles: { title: "Doubles", eyebrow: "2 v 2" },
    practice: { title: "Practice", eyebrow: "Choose a drill" }
  };
  let panel = "home";
  let family = "match";

  // game.js owns focus (setFocus on mouseover/click). Handing focus over with a synthetic mouseover keeps game.js
  // the single owner of the focused element, so arrow keys and Enter carry on working from it.
  const focusEl = (el) => el && el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  const visibleNav = (root) => [...root.querySelectorAll("[data-nav]")].filter((e) => e.offsetParent !== null);

  function showPanel(name, fam) {
    panel = name;
    if (fam) family = fam;
    menu.dataset.panel = name;
    for (const p of menu.querySelectorAll("[data-panel-id]")) p.hidden = p.dataset.panelId !== name;
    if (name === "setup") {
      const f = FAMILIES[family];
      $("setup-title").textContent = f.title;
      $("setup-eyebrow").textContent = f.eyebrow;
      for (const v of menu.querySelectorAll(".variant")) v.hidden = v.dataset.family !== family;
      for (const o of menu.querySelectorAll(".opt[data-for]")) o.hidden = !o.dataset.for.split(" ").includes(family);
    }
    const root = menu.querySelector(`[data-panel-id="${name}"]`);
    const target = name === "home" ? root.querySelector(`[data-open="${family}"]`) || visibleNav(root)[0] : visibleNav(root)[0];
    focusEl(target);
  }
  function goHome() {
    const from = panel;
    showPanel("home");
    if (from === "settings") focusEl(menu.querySelector('[data-open="settings"]'));
  }
  function act(el) {
    if (!el || document.body.dataset.screen !== "menu") return false;
    if (el.dataset.open) { el.dataset.open === "settings" ? showPanel("settings") : showPanel("setup", el.dataset.open); return true; }
    if (el.hasAttribute("data-back")) { goHome(); return true; }
    return false;
  }
  document.addEventListener("click", (e) => act(e.target.closest("[data-open], [data-back]")));
  window.addEventListener("keydown", (e) => {
    if (document.body.dataset.screen !== "menu") return;
    if (e.key === "Enter" || e.key === " ") act(menu.querySelector(".is-focus"));
    else if ((e.key === "Escape" || e.key === "Backspace") && panel !== "home") { e.preventDefault(); goHome(); }
  });

  // Back on the menu after a game, results or setup: start from the mode cards.
  let lastScreen = document.body.dataset.screen;
  new MutationObserver(() => {
    const s = document.body.dataset.screen;
    if (s === lastScreen) return;
    const prev = lastScreen;
    lastScreen = s;
    if (s === "menu") showPanel("home");
    if (s === "game" && prev !== "pause") showHint();
    if (s === "pause") $("pause-eyebrow").textContent = $("bug-mode").textContent || "Game paused";
  }).observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });

  // Records: only show the ones that aren't zero (and nothing at all on a fresh TV).
  const recs = $("records");
  function paintRecords() {
    let any = false;
    for (const d of recs.querySelectorAll("[data-rec]")) {
      const v = d.querySelector("dd").textContent.trim();
      const show = v !== "" && v !== "0";
      d.hidden = !show;
      any ||= show;
    }
    recs.hidden = !any;
  }
  new MutationObserver(paintRecords).observe(recs, { subtree: true, childList: true, characterData: true });
  paintRecords();

  // Player slots P1-P4 light up as camera phones claim players.
  function paintSlots() {
    const map = window.__airTennis?.slotMap;
    const on = new Set(map ? map.all().flatMap((c) => c.players) : []);
    for (const li of $("slots").children) li.classList.toggle("on", on.has(Number(li.dataset.p)));
  }
  setInterval(() => { if (document.body.dataset.screen === "menu" || document.body.dataset.screen === "cal") paintSlots(); }, 400);

  // HUD: the rally/speed readout only while a rally is on (and a moment after it ends).
  const hud = $("hud");
  let rallyUntil = 0;
  function hudTick(now) {
    const A = window.__airTennis;
    if (A && document.body.dataset.screen === "game") {
      if (A.sim.phase === "rally") rallyUntil = now + 1800;
      hud.classList.toggle("rallying", now < rallyUntil && !A.sim.mode.startsWith?.("target"));
    } else hud.classList.remove("rallying");
    requestAnimationFrame(hudTick);
  }
  requestAnimationFrame(hudTick);

  // Scoreboard status strip: big calls (game/break/match point, deuce, advantage) slide in as a highlighted banner.
  const status = $("bug-status");
  let lastCall = "";
  new MutationObserver(() => {
    const t = status.textContent;
    const call = /point|deuce|advantage/i.test(t);
    if (call && t !== lastCall) { status.classList.remove("is-call"); void status.offsetWidth; }
    status.classList.toggle("is-call", call);
    lastCall = call ? t : "";
  }).observe(status, { childList: true, characterData: true, subtree: true });

  // Coaching tip: a lower-third that fades after a few seconds.
  const hint = $("hint");
  let hintTimer = 0;
  function showHint() {
    hint.classList.remove("is-faded");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.add("is-faded"), 6000);
  }
}

// ---------------------------------------------------------------- phone
function phoneUI() {
  const label = $("step-label");
  const dots = $("step-dots");
  const body = document.body;
  // phone.js writes "Setup · step N of 5" or "Ready" into #step-label. Mirror it as step dots + a ready card.
  function paint() {
    const t = label.textContent;
    const m = t.match(/step (\d) of 5/i);
    const ready = /ready/i.test(t) && /ready/i.test($("step-title").textContent); // "Lost the TV" etc. stay visible
    const n = ready ? 5 : m ? Number(m[1]) - 1 : 0;
    body.dataset.step = String(n);
    body.toggleAttribute("data-ready", ready);
    if (dots) [...dots.children].forEach((d, i) => { d.classList.toggle("done", n > i + 2 || ready); d.classList.toggle("now", !ready && n === i + 2); });
    if (ready) paintReady();
  }
  function paintReady() {
    const P = window.__phone;
    const n = P?.body?.n || 1;
    const players = P?.body?.players || [];
    const ids = Array.from({ length: n }, (_, s) => (players[s] !== undefined ? players[s] : s));
    const wrap = $("ready-players");
    wrap.replaceChildren(...ids.map((id, s) => {
      const b = document.createElement("span");
      b.className = "badge";
      b.dataset.slot = String(s);
      b.innerHTML = `<b></b><small></small>`;
      b.querySelector("b").textContent = "P" + (id + 1);
      b.querySelector("small").textContent = n === 2 ? (s === 0 ? "Left" : "Right") : "Player " + (id + 1);
      return b;
    }));
    $("ready-sub").textContent = n === 2 ? `Player ${ids[0] + 1} on the left, Player ${ids[1] + 1} on the right.` : `You're Player ${ids[0] + 1}. Wind up and swing to hit.`;
  }
  new MutationObserver(paint).observe(label, { childList: true, characterData: true, subtree: true });
  new MutationObserver(paint).observe($("step-title"), { childList: true, characterData: true, subtree: true });
  const slotLine = $("slot-line");
  if (slotLine) new MutationObserver(() => { if (body.hasAttribute("data-ready")) paintReady(); }).observe(slotLine, { childList: true, subtree: true, characterData: true });
  paint();

  // Remote drawer + "Choose a mode" primary action on the ready card.
  const more = $("remote-more");
  const modes = $("modes-sheet");
  const openBtn = $("open-modes");
  openBtn?.addEventListener("click", () => {
    modes.open = !modes.open;
    openBtn.textContent = modes.open ? "Hide modes" : "Choose a mode";
    openBtn.classList.toggle("ghost-btn", modes.open);
    if (modes.open) modes.scrollIntoView({ behavior: "smooth", block: "end" });
  });
  more?.addEventListener("toggle", () => { if (more.open) more.scrollIntoView({ behavior: "smooth", block: "end" }); });
}
