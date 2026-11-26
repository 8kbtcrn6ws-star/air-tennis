// Air Tennis TV app: menus, input, phone link, game loop. The TV is the only judge of hits and score.
import { createSim, MODES, FLIGHT } from "./sim.js";
import { pointLabels } from "./scoring.js";
import { createPacketGate } from "./packets.js";
import { TvHost } from "./net.js";
import { sfx, unlockAudio, audio, setMusic } from "./audio.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SKEY = "airtennis.settings.v1";
const STKEY = "airtennis.stats.v1";

// ---------- settings + stats ----------
const DEFAULTS = { games: 3, flight: "medium", sens: "normal", assist: true, gfx: "high", sound: true, music: false };
function loadJSON(k, d) { try { return { ...d, ...(JSON.parse(localStorage.getItem(k)) || {}) }; } catch { return { ...d }; } }
const settings = loadJSON(SKEY, DEFAULTS);
const q = params.get("quality") || params.get("q");
if (q === "low" || q === "basic") settings.gfx = "basic";
if (q === "high") settings.gfx = "high";
const saveSettings = () => { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch { /* private mode */ } };
const stats = loadJSON(STKEY, { bestRally: 0, matchWins: 0, matchesPlayed: 0, missedShots: 0, targetBest: 0, goodShots: 0 });
const saveStats = () => { try { localStorage.setItem(STKEY, JSON.stringify(stats)); } catch { /* private mode */ } };
audio.muted = !settings.sound;

// ---------- scene + sim ----------
let scene = null;
const sim = createSim({ gamesToWin: settings.games, flight: settings.flight, assist: settings.assist ? 0.45 : 0 });
let screen = "loading";
let pauseReason = null;
let fastForwarding = false;

function setScreen(s) {
  screen = s;
  document.body.dataset.screen = s;
  $("menu").hidden = s !== "menu";
  $("cal").hidden = s !== "cal";
  $("pause").hidden = s !== "pause";
  $("results").hidden = s !== "results";
  $("hud").hidden = !(s === "game" || s === "pause");
  focusFirst();
  host?.broadcast({ t: "state", screen: s, mode: sim.mode });
}

// ---------- focus navigation (keyboard, mouse, phone menu keys) ----------
let focusEl = null;
function navItems() {
  const root = { menu: $("menu"), cal: $("cal"), pause: $("pause"), results: $("results") }[screen];
  return root ? [...root.querySelectorAll("[data-nav]")].filter((e) => !e.hidden && e.offsetParent !== null) : [];
}
function setFocus(el) {
  focusEl?.classList.remove("is-focus");
  focusEl = el || null;
  focusEl?.classList.add("is-focus");
  focusEl?.focus?.({ preventScroll: true });
}
function focusFirst() { const it = navItems(); setFocus(it[0]); }
function moveFocus(delta) {
  const it = navItems();
  if (!it.length) return;
  const i = Math.max(0, it.indexOf(focusEl));
  setFocus(it[(i + delta + it.length) % it.length]);
  sfx.ui();
}
function activate(el) {
  if (!el) return;
  unlockAudio();
  if (el.dataset.mode) return startMode(el.dataset.mode);
  if (el.dataset.set) return toggleSetting(el.dataset.set);
  if (el.dataset.act) return doAction(el.dataset.act);
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-nav]");
  if (el) { setFocus(el); activate(el); }
});
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest("[data-nav]");
  if (el && el !== focusEl) setFocus(el);
});

function back() {
  if (screen === "game") return pause("user");
  if (screen === "pause") return resume();
  if (screen === "cal" || screen === "results") return toMenu();
}

// ---------- settings UI ----------
const GAMES_OPTS = [1, 2, 3, 5];
const FLIGHT_LABEL = { light: "Light", medium: "Medium", realistic: "Realistic" };
const SENS_LABEL = { easier: "Easier", normal: "Normal", harder: "Harder" };
function paintSettings() {
  $("set-games").textContent = `first to ${settings.games} game${settings.games > 1 ? "s" : ""}`;
  $("set-flight").textContent = FLIGHT_LABEL[settings.flight];
  $("set-sens").textContent = SENS_LABEL[settings.sens];
  $("set-assist").textContent = settings.assist ? "On" : "Off";
  $("set-gfx").textContent = settings.gfx === "basic" ? "Basic" : "High";
  $("set-sound").textContent = settings.sound ? "On" : "Off";
  $("set-music").textContent = settings.music ? "On" : "Off";
}
function cycle(list, v) { return list[(list.indexOf(v) + 1) % list.length]; }
function toggleSetting(k) {
  if (k === "games") settings.games = cycle(GAMES_OPTS, settings.games);
  if (k === "flight") settings.flight = cycle(Object.keys(FLIGHT), settings.flight);
  if (k === "sens") { settings.sens = cycle(Object.keys(SENS_LABEL), settings.sens); host?.broadcast({ t: "cfg", sens: settings.sens }); }
  if (k === "assist") settings.assist = !settings.assist;
  if (k === "sound") { settings.sound = !settings.sound; audio.muted = !settings.sound; }
  if (k === "music") { settings.music = !settings.music; setMusic(settings.music && settings.sound); }
  if (k === "gfx") {
    settings.gfx = settings.gfx === "basic" ? "high" : "basic";
    saveSettings();
    const u = new URL(location.href);
    u.searchParams.set("quality", settings.gfx === "basic" ? "low" : "high");
    location.replace(u.href); // renderer options are fixed at start, so reload
    return;
  }
  sim.gamesToWin = settings.games;
  sim.flight = settings.flight;
  sim.assist = settings.assist ? 0.45 : 0;
  saveSettings();
  paintSettings();
  sfx.ok();
}

function paintStats() {
  $("st-rally").textContent = stats.bestRally;
  $("st-target").textContent = stats.targetBest;
  $("st-wins").textContent = stats.matchWins;
  $("st-missed").textContent = stats.missedShots;
}

// ---------- game flow ----------
let lastMode = "practice";
function startMode(mode) {
  if (!MODES[mode]) return;
  lastMode = mode;
  clearTimeout(resultsTimer);
  countdownTimers.forEach(clearTimeout);
  $("banner").className = "banner";
  sim.start(mode, { gamesToWin: settings.games, flight: settings.flight });
  hudCache = "";
  setScreen("game");
  setHint();
  if (settings.music && settings.sound) setMusic(true);
}
function toMenu() {
  clearTimeout(resultsTimer);
  sim.toMenu();
  paintStats();
  setScreen("menu");
}
function pause(reason) {
  if (screen !== "game") return;
  pauseReason = reason;
  const titles = { user: ["Paused", ""], view: ["Can't see you", "Step back in front of your phone so the camera can see you and your hand. The game carries on by itself when you're back."], link: ["Phone disconnected", "The phone stopped sending. Check it's awake and on the Air Tennis page, or carry on with the keyboard."] };
  const [t, m] = titles[reason] || titles.user;
  $("pause-title").textContent = t;
  $("pause-msg").textContent = m;
  $("pause-msg").hidden = !m;
  setScreen("pause");
}
function resume() {
  if (screen !== "pause") return;
  pauseReason = null;
  setScreen("game");
}
function doAction(a) {
  if (a === "resume") resume();
  if (a === "restart") startMode(lastMode);
  if (a === "menu") toMenu();
  if (a === "cal-done" || a === "cal-skip") {
    if (a === "cal-skip") inputMode = "kb";
    toMenu();
  }
}

let resultsTimer = 0;
function laterResults(ms, ...args) {
  clearTimeout(resultsTimer);
  if (!ms) return showResults(...args);
  resultsTimer = setTimeout(() => showResults(...args), ms);
}
function showResults(eyebrow, title, rows) {
  $("res-eyebrow").textContent = eyebrow;
  $("res-title").textContent = title;
  $("res-stats").replaceChildren(...rows.map(([k, v]) => {
    const d = document.createElement("div");
    d.innerHTML = `<dt></dt><dd></dd>`;
    d.querySelector("dt").textContent = k;
    d.querySelector("dd").textContent = v;
    return d;
  }));
  setScreen("results");
}

// ---------- HUD ----------
let hudCache = "";
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function paintHud() {
  const s = sim;
  let time;
  let html;
  let label = "Score";
  if (s.mode === "match") {
    time = fmtTime(s.matchTime);
    const L = pointLabels(s.score);
    const sv = s.score.server;
    html = `<div class="sb-line you"><span class="serve-dot ${sv === "P" ? "on" : ""}"></span><span class="who">You</span><span class="g">${s.score.games.P}</span><span class="pts">${L.P}</span></div>`
      + `<div class="sb-line"><span class="serve-dot ${sv === "A" ? "on" : ""}"></span><span class="who">CPU</span><span class="g">${s.score.games.A}</span><span class="pts">${L.A}</span></div>`
      + (L.call ? `<div class="sb-call">${L.call}</div>` : `<div class="sb-call">Games to win: ${s.score.gamesToWin}</div>`);
  } else if (s.mode === "target") {
    time = fmtTime(Math.ceil(s.timeLeft));
    html = `<div class="sb-big">${s.targetScore}</div><div class="sb-sub">Best ${stats.targetBest}</div>`;
  } else if (s.mode === "rally") {
    time = fmtTime(s.time - (s.startedAt || 0));
    label = "Rally";
    html = `<div class="sb-big">${s.rally}</div><div class="sb-sub">Best ${stats.bestRally}</div>`;
  } else {
    time = fmtTime(s.time - (s.startedAt || 0));
    label = "Good shots";
    html = `<div class="sb-big">${s.session.good}</div><div class="sb-sub">Hits ${s.session.hits} · Misses ${s.session.misses}</div>`;
  }
  $("timer").textContent = time;
  const key = label + html;
  if (key !== hudCache) {
    hudCache = key;
    $("score-label").textContent = label;
    $("board").innerHTML = html;
  }
}
let bannerTimer = 0;
function banner(text, kind = "", ms = 1100) {
  const b = $("banner");
  b.textContent = text;
  b.className = "banner show " + kind;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.className = "banner"; }, ms);
}
let calloutTimer = 0;
function callout(text, kind = "") {
  const c = $("callout");
  c.textContent = text;
  c.className = "callout show " + kind;
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => { c.className = "callout " + kind; }, 700);
}
function popup(text, x, y, z) {
  if (!scene || fastForwarding) return;
  const p = scene.project(x, y, z);
  const el = document.createElement("div");
  el.className = "popup";
  el.textContent = text;
  el.style.left = p.x + "px";
  el.style.top = p.y + "px";
  $("hud").appendChild(el);
  setTimeout(() => el.remove(), 950);
}
function setHint() {
  const phone = inputMode === "phone";
  const how = phone ? (phoneKind === "motion" ? "Swing your phone like a racket" : "Swing your hand at the phone") : "← → move · Space swing · hold Shift for power · or use the mouse";
  $("hint").textContent = `${how} · Esc pause`;
  const chip = $("input-chip");
  chip.dataset.state = phone ? "ok" : "kb";
  chip.textContent = phone ? (phoneKind === "motion" ? "Phone racket" : "Phone camera") : "Keyboard / mouse";
}

// ---------- sim events -> effects, sound, stats ----------
function handleEvents() {
  for (const e of sim.drain()) {
    const quiet = fastForwarding;
    switch (e.type) {
      case "phase":
        if (e.phase === "countdown" && !quiet) countdownFx();
        if (e.phase === "serve" && sim.score.server === "P" && !quiet) callout("Swing to serve");
        if (e.phase === "countdown") sim.startedAt = sim.time + 3;
        break;
      case "hit":
        if (!quiet) {
          scene?.burst(e.x, e.y, e.z, e.who === "P" ? scene.colors.LIME : scene.colors.PINK, e.quality === "perfect");
          if (e.who === "P") {
            sfx.hit(e.power, e.quality === "perfect");
            callout(e.quality === "perfect" ? "Perfect!" : "Nice!", e.quality === "perfect" ? "perfect" : "");
            host?.broadcast({ t: "buzz", k: "hit" });
          } else sfx.aiHit();
        }
        break;
      case "swing": if (!quiet) sfx.swing(); break;
      case "bounce": if (!quiet) { sfx.bounce(); scene?.bounceMark(e.x, e.z); } break;
      case "net": if (!quiet) sfx.net(); break;
      case "feedback": if (!quiet) { callout(e.text, "miss"); sfx.miss(); } break;
      case "target":
        if (!quiet) { popup(`+${e.points}`, e.x, 0.3, e.z); if (e.ring) scene?.burst(e.x, 0.1, e.z, scene.colors.LIME, true); }
        break;
      case "point":
        if (e.playerMissed) { stats.missedShots++; saveStats(); }
        if (!quiet) pointFx(e);
        break;
      case "rallyOver":
        if (e.rally > stats.bestRally) { stats.bestRally = e.rally; }
        saveStats();
        if (!quiet) sfx.groan();
        laterResults(quiet ? 0 : 1200, "Rally Challenge", `${e.rally} hit${e.rally === 1 ? "" : "s"}`, [["This rally", e.rally], ["Best rally", stats.bestRally], ["Perfect hits", sim.session.perfect], ["Missed shots", sim.session.misses]]);
        break;
      case "targetOver":
        if (e.score > stats.targetBest) stats.targetBest = e.score;
        saveStats();
        if (!quiet) { sfx.win(); banner("Time!", "lime"); }
        laterResults(quiet ? 0 : 1300, "Target Practice", `${e.score} points`, [["Score", e.score], ["Best", stats.targetBest], ["Shots in", e.good], ["Swings that hit", e.hits]]);
        break;
      case "matchOver": {
        stats.matchesPlayed++;
        if (e.winner === "P") stats.matchWins++;
        if (sim.longestRally > stats.bestRally) stats.bestRally = sim.longestRally;
        saveStats();
        if (!quiet) { e.winner === "P" ? (sfx.win(), sfx.cheer(true)) : sfx.groan(); banner(e.winner === "P" ? "You win!" : "CPU wins", "lime", 1600); }
        laterResults(quiet ? 0 : 1800, "Match over", e.winner === "P" ? "You win!" : "CPU wins", [["Games", `${e.games.P} – ${e.games.A}`], ["Match time", fmtTime(e.time)], ["Longest rally", sim.longestRally], ["Missed shots", sim.session.misses]]);
        break;
      }
      default: break;
    }
  }
}
let countdownTimers = [];
function countdownFx() {
  countdownTimers.forEach(clearTimeout);
  countdownTimers = [];
  [3, 2, 1].forEach((n, i) => countdownTimers.push(setTimeout(() => { if (screen === "game" || screen === "pause") { banner(String(n), "", 800); sfx.beep(false); } }, i * 1000)));
  countdownTimers.push(setTimeout(() => { if (screen === "game") { banner("Play!", "lime", 700); sfx.beep(true); } }, 3000));
}
function pointFx(e) {
  if (sim.mode === "match") {
    if (e.game && !e.match) { banner(e.game === "P" ? "Game You" : "Game CPU", "lime small", 1500); }
    else if (!e.match) banner(e.reason === "Winner" ? "Winner!" : e.reason, e.winner === "P" ? "lime small" : "small", 1000);
    e.winner === "P" ? sfx.cheer(false) : sfx.groan();
  } else if (sim.mode === "practice" || sim.mode === "target") {
    if (e.winner !== "P") callout(e.reason === "Missed" ? "Missed" : e.reason, "miss");
  } else if (sim.mode === "rally" && e.winner === "P") {
    banner(e.reason, "small", 900);
  }
}

// ---------- keyboard + mouse ----------
const keys = new Set();
let kbX = 0;
let mouse = { x: 0, lastMove: -1e9, hist: [] };
window.addEventListener("keydown", (e) => {
  unlockAudio();
  const k = e.key;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(k)) e.preventDefault();
  if (screen === "game") {
    keys.add(k.toLowerCase());
    if (k === "Escape" || k === "p" || k === "P") pause("user");
    if ((k === " " || k === "j" || k === "J") && !e.repeat) {
      const dir = (keys.has("arrowright") || keys.has("d") ? 1 : 0) - (keys.has("arrowleft") || keys.has("a") ? 1 : 0);
      sim.swing(dir * 0.8, e.shiftKey ? 1 : 0.55, "kb");
      inputMode = inputMode === "phone" ? "phone" : "kb";
    }
    return;
  }
  if (k === "ArrowDown" || k === "ArrowRight") moveFocus(1);
  else if (k === "ArrowUp" || k === "ArrowLeft") moveFocus(-1);
  else if (k === "Enter" || k === " ") { e.preventDefault(); activate(focusEl); } // no native click on top
  else if (k === "Escape" || k === "Backspace") back();
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("pointermove", (e) => {
  if (screen !== "game") return;
  const now = performance.now();
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.lastMove = now;
  mouse.hist.push({ x: mouse.x, t: now });
  while (mouse.hist.length > 2 && now - mouse.hist[0].t > 120) mouse.hist.shift();
});
window.addEventListener("pointerdown", (e) => {
  if (screen !== "game" || e.target.closest("[data-nav]")) return;
  unlockAudio();
  const h = mouse.hist;
  let v = 0;
  if (h.length > 1) v = (h[h.length - 1].x - h[0].x) / Math.max(0.03, (h[h.length - 1].t - h[0].t) / 1000);
  sim.swing(Math.max(-1, Math.min(1, v / 3)), Math.min(1, 0.45 + Math.abs(v) / 8), "mouse");
});
function updateKeyboardInput(dt) {
  if (inputMode === "phone" && performance.now() - lastPhonePos < 400) return;
  const dir = (keys.has("arrowright") || keys.has("d") ? 1 : 0) - (keys.has("arrowleft") || keys.has("a") ? 1 : 0);
  if (dir) { kbX = Math.max(-1, Math.min(1, kbX + dir * dt * 1.6)); sim.setInputX(kbX); }
  else if (performance.now() - mouse.lastMove < 1500) { kbX = mouse.x; sim.setInputX(mouse.x * 1.1); }
}

// ---------- phone link ----------
let host = null;
let inputMode = "kb";
let phoneKind = "motion";
let phoneVisible = true;
let lastPhonePos = -1e9;
let lastPhoneMsg = -1e9;
let invisibleSince = null;
let calStep = 0;
const gate = createPacketGate();

function onPhoneMessage(raw) {
  const m = gate.accept(raw);
  if (!m) return null;
  lastPhoneMsg = performance.now();
  switch (m.t) {
    case "hello":
      host?.broadcast({ t: "cfg", sens: settings.sens });
      break;
    case "mode":
      phoneKind = m.m;
      document.body.classList.toggle("is-motion", phoneKind === "motion");
      setHint();
      break;
    case "pos":
      lastPhonePos = performance.now();
      if (inputMode !== "phone" && calStep >= 5) { inputMode = "phone"; setHint(); }
      sim.setInputX(m.x);
      $("cal-dot").style.left = ((m.x + 1) * 50) + "%";
      setVisible(m.v);
      break;
    case "vis":
      setVisible(m.v);
      break;
    case "swing":
      if (screen === "game") { inputMode = "phone"; sim.swing(m.dir, m.spd, "phone"); }
      if (screen === "cal") { $("cal-msg").textContent = "Swing detected!"; sfx.hit(0.6, true); }
      break;
    case "cal":
      setCal(m.step);
      break;
    case "menu":
      phoneMenu(m.k);
      break;
    default: break;
  }
  return m;
}
function setVisible(v) {
  if (phoneKind !== "camera") { phoneVisible = true; invisibleSince = null; return; }
  phoneVisible = v;
  if (!v && invisibleSince === null) invisibleSince = performance.now();
  if (v) invisibleSince = null;
}
function setCal(step) {
  calStep = Math.max(calStep, step);
  if (step <= 1 && screen === "menu") setScreen("cal");
  document.querySelectorAll("#cal-steps li").forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle("is-done", n <= step);
    li.classList.toggle("is-now", n === step + 1);
  });
  const msgs = ["Waiting for your phone…", "Connected. Starting sensors on the phone…", phoneKind === "motion" ? "Hold the phone like a racket handle." : "Raise your racket hand so the camera sees it.", phoneKind === "motion" ? "Tilt the phone left, then right." : "Move your hand left, then right.", "Now swing a forehand.", "All set! Pick a mode to play."];
  $("cal-msg").textContent = msgs[Math.min(step, 5)];
  if (step >= 5) {
    inputMode = "phone";
    setHint();
    sfx.ok();
    if (screen === "cal") setTimeout(() => { if (screen === "cal") toMenu(); }, 1500);
  }
}
function phoneMenu(k) {
  if (["practice", "match", "rally", "target"].includes(k)) return startMode(k);
  if (k === "pause") return screen === "game" ? pause("user") : resume();
  if (k === "restart") return startMode(lastMode);
  if (k === "menu") return toMenu();
  if (screen === "game") return;
  if (k === "down" || k === "right") moveFocus(1);
  if (k === "up" || k === "left") moveFocus(-1);
  if (k === "a") activate(focusEl);
  if (k === "b") back();
}

async function startLink() {
  const st = $("link-status");
  try {
    host = new TvHost();
    host.on("msg", ({ msg }) => onPhoneMessage(msg));
    host.on("join", ({ count }) => {
      st.dataset.state = "ok";
      st.textContent = count === 1 ? "Phone connected" : `${count} phones connected`;
      calStep = 0;
      setCal(1);
      host.broadcast({ t: "cfg", sens: settings.sens });
      host.broadcast({ t: "state", screen, mode: sim.mode });
    });
    host.on("leave", ({ count }) => {
      st.dataset.state = count ? "ok" : "wait";
      st.textContent = count ? `${count} phone connected` : "Waiting for a phone";
      if (!count) { inputMode = "kb"; calStep = 0; setHint(); if (screen === "game") pause("link"); }
    });
    const { code } = await host.open();
    $("code").textContent = code;
    st.dataset.state = "wait";
    st.textContent = "Waiting for a phone";
    const url = new URL("phone.html", location.href);
    url.hash = "code=" + code;
    $("phone-url").textContent = url.host + url.pathname.replace(/phone\.html$/, "") + "phone.html";
    await drawQr(url.href);
    window.__airTennis.code = code;
  } catch (err) {
    st.dataset.state = "bad";
    st.textContent = "Phone link offline. Keyboard and mouse still work.";
    window.__airTennis.linkError = err?.message || String(err);
  }
}
async function drawQr(text) {
  const el = $("qr");
  try {
    const qrcode = (await import("qrcode-generator")).default;
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    el.classList.remove("is-empty");
  } catch { /* keep the placeholder; the code still works */ }
}

// ---------- loop ----------
const DT = 1 / 120;
let acc = 0;
let last = performance.now();
let t = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  t += dt;
  if (screen === "game") {
    updateKeyboardInput(dt);
    acc += dt;
    while (acc >= DT) { sim.step(DT); acc -= DT; }
    handleEvents();
    paintHud();
    if (inputMode === "phone" && phoneKind === "camera" && invisibleSince !== null && now - invisibleSince > 700) pause("view");
    if (inputMode === "phone" && now - lastPhoneMsg > 4000 && host?.connectedCount()) pause("link");
  } else if (screen === "pause" && pauseReason === "view" && phoneVisible) {
    resume();
  } else if (screen === "menu") {
    sim.step(dt * 0.5); // let the idle court breathe behind the menu
    sim.drain();
  } else {
    handleEvents();
  }
  scene?.update({ sim, t, menu: screen === "menu" || screen === "cal" || screen === "loading" }, dt);
  requestAnimationFrame(frame);
}

// ---------- test + debug hooks (used by the headless tests) ----------
window.__airTennis = {
  sim, settings, stats, gate,
  get screen() { return screen; },
  get inputMode() { return inputMode; },
  get phoneKind() { return phoneKind; },
  get pauseReason() { return pauseReason; },
  inject: (msg) => onPhoneMessage(msg),
  start: (m) => startMode(m),
  menu: () => toMenu(),
  fastForward(seconds) {
    fastForwarding = true;
    for (let i = 0; i < seconds / DT && screen === "game"; i++) { sim.step(DT); handleEvents(); }
    fastForwarding = false;
    paintHud();
  },
  setAutoplay(o) { sim.autoplay = o ? { accuracy: 0.9, ...o } : null; },
  get host() { return host; }
};

async function boot() {
  paintSettings();
  paintStats();
  setHint();
  try {
    const { createScene } = await import("./scene.js");
    scene = createScene($("gl"), settings.gfx === "basic" ? "low" : "high");
    window.__airTennis.scene = scene;
  } catch (err) {
    console.error("3D failed to start", err);
    window.__airTennis.sceneError = String(err?.message || err);
  }
  sim.ball.live = false;
  setScreen("menu");
  if (params.get("autoplay") === "1") window.__airTennis.setAutoplay({});
  requestAnimationFrame(frame);
  if (params.get("nolink") !== "1") startLink();
}
boot();
