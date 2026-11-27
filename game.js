// Air Tennis TV app: menus, input, phone link, game loop. The TV is the only judge of hits and score.
import { createSim, MODES, FLIGHT } from "./sim.js";
import { pointLabels, matchStatus } from "./scoring.js";
import { createPacketGate, createSlotMap } from "./packets.js";
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
const stats = loadJSON(STKEY, { bestRally: 0, matchWins: 0, matchesPlayed: 0, missedShots: 0, targetBest: 0, goodShots: 0, best2pRally: 0, bestTiming: 0 });
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
  sim.start(mode, { gamesToWin: settings.games, flight: settings.flight, humans: humansFor(mode) });
  $("timing").hidden = mode !== "training";
  $("timing-counts").textContent = "";
  $("timing-mark").className = "";
  hudCache = "";
  setScreen("game");
  setHint();
  host?.broadcast({ t: "state", screen: "game", mode, humans: humansFor(mode) });
  if (settings.music && settings.sound) setMusic(true);
}
// Who is a person in this mode: the mode's defaults plus, in Doubles, every player a phone has claimed.
function humansFor(mode) {
  const ids = MODES[mode].humans.slice();
  if (mode === "doubles") for (const c of slotMap.all()) for (const id of c.players) if (!ids.includes(id)) ids.push(id);
  return ids;
}
const TWO = (m = sim.mode) => !!MODES[m]?.two;
function playerName(id) {
  const p = sim.players[id];
  if (!p) return "";
  if (!p.human) return "CPU";
  return "Player " + (id + 1);
}
// Names per side for calls ("Advantage …") and results.
function sideNames() {
  if (sim.mode === "doubles") {
    const team = (a, b) => [a, b].map((i) => (sim.players[i].human ? "P" + (i + 1) : "CPU")).join(" / ");
    return { P: team(0, 2), A: team(1, 3) };
  }
  if (TWO()) return { P: "Player 1", A: "Player 2" };
  return { P: "You", A: "CPU" };
}
function toMenu() {
  clearTimeout(resultsTimer);
  sim.toMenu();
  paintStats();
  setScreen("menu");
}
function pause(reason, who = null) {
  if (screen !== "game") return;
  pauseReason = reason;
  const seeWho = who === null || !TWO() ? "you" : playerName(who);
  const titles = { user: ["Paused", ""], view: [`Can't see ${seeWho}`, "Step into view of the phone camera so it can see your whole body, head to feet. The game carries on by itself when you're back."], link: ["Phone disconnected", "The phone stopped sending. Check it's awake, propped up and on the Air Tennis page."] };
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
function staminaBar(id) {
  const p = sim.players[id];
  const w = Math.round((p?.stamina ?? 1) * 100);
  return `<span class="stam${w < 35 ? " low" : ""}" title="Stamina"><i style="width:${w}%"></i></span>`;
}
function scoreRow(side, L, sv, games, names) {
  const ids = sim.players.filter((p) => p.active && p.side === side).map((p) => p.id);
  const serving = sim.players[sim.serverId]?.side === side && sv;
  return `<div class="sb-row ${side === "P" ? "near" : "far"}"><span class="srv ${serving ? "on" : ""}"></span>`
    + `<span class="nm">${names[side] === "You" ? "Player 1" : names[side]}</span><span class="stams">${ids.map(staminaBar).join("")}</span>`
    + `<span class="gm">${games}</span><span class="pt">${L}</span></div>`;
}
const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
function paintHud() {
  const s = sim;
  let time;
  let html;
  let status = "";
  const names = sideNames();
  if (MODES[s.mode].scored) {
    time = fmtTime(s.matchTime);
    const L = pointLabels(s.score, names);
    const sv = s.phase === "serve" || s.phase === "rally" || s.phase === "pointOver" || s.phase === "countdown";
    html = scoreRow("P", L.P, sv, s.score.games.P, names) + scoreRow("A", L.A, sv, s.score.games.A, names);
    status = matchStatus(s.score, names) || (s.phase === "serve" ? `${playerName(s.serverId)} to serve` : `First to ${s.score.gamesToWin} games`);
  } else if (s.mode === "rally2") {
    time = fmtTime(s.time - (s.startedAt || 0));
    html = scoreRow("P", "", s.phase === "serve", "", names) + scoreRow("A", "", s.phase === "serve", "", names);
    status = s.phase === "serve" ? `${playerName(s.serverId)} to serve` : `Best rally ${Math.max(stats.best2pRally, s.longestRally)}`;
  } else if (s.mode === "target") {
    time = fmtTime(Math.ceil(s.timeLeft));
    html = kv("Score", s.targetScore) + kv("Best", stats.targetBest);
    status = "Land it in the rings";
  } else if (s.mode === "rally") {
    time = fmtTime(s.time - (s.startedAt || 0));
    html = kv("Rally", s.rally) + kv("Best", stats.bestRally);
    status = "One miss and it's over";
  } else if (s.mode === "training") {
    time = fmtTime(s.time - (s.startedAt || 0));
    const tr = s.training;
    html = kv("Ball", `${Math.min(s.session.feeds, 20)} / 20`) + kv("Perfect", tr.perfect) + kv("Hits", s.session.hits);
    status = tr.last ? `Last swing ${tr.last.verdict} (${tr.last.tc > 0 ? "+" : ""}${Math.round(tr.last.tc * 1000)} ms)` : "Swing as the ball reaches you";
  } else {
    time = fmtTime(s.time - (s.startedAt || 0));
    html = kv("Good shots", s.session.good) + kv("Hits", s.session.hits) + kv("Misses", s.session.misses);
    status = "Ball machine";
  }
  $("timer").textContent = time;
  const key = html + status + s.mode;
  if (key !== hudCache) {
    hudCache = key;
    $("bug-mode").textContent = MODES[s.mode].label;
    $("board").innerHTML = html;
    $("bug-status").textContent = status;
    $("bug-status").hidden = !status;
  }
  const rally = MODES[s.mode].machine ? s.session.good : s.shots;
  $("hud-rally").textContent = rally;
  $("hud-speed").textContent = s.lastSpeed ? s.lastSpeed : "–";
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
  $("hint").textContent = "Wind up and swing: your arm is the racket";
}

// ---------- sim events -> effects, sound, stats ----------
let maxSpeed = 0;
function showTiming(e) {
  const m = $("timing-mark");
  const x = Math.max(-1, Math.min(1, -e.tc / 0.3)); // early on the left, late on the right
  m.style.left = (50 + x * 45) + "%";
  m.className = "show " + e.verdict;
  const tr = sim.training;
  $("timing-counts").textContent = `Perfect ${tr.perfect} · Early ${tr.early} · Late ${tr.late}`;
  callout(e.verdict === "perfect" ? "Perfect timing" : e.verdict === "early" ? `Early ${Math.round(e.tc * 1000)} ms` : `Late ${Math.round(-e.tc * 1000)} ms`, e.verdict === "perfect" ? "perfect" : "miss");
}
function handleEvents() {
  for (const e of sim.drain()) {
    const quiet = fastForwarding;
    if ((e.type === "hit" || e.type === "serve") && e.kmh) maxSpeed = Math.max(maxSpeed, e.kmh);
    if (e.type === "phase" && e.phase === "countdown") maxSpeed = 0;
    switch (e.type) {
      case "phase":
        if (e.phase === "countdown" && !quiet) countdownFx();
        if (e.phase === "serve" && sim.players[sim.serverId]?.human && !quiet) callout(TWO() ? `${playerName(sim.serverId)}: swing to serve` : "Swing to serve");
        if (e.phase === "countdown") sim.startedAt = sim.time + 3;
        break;
      case "hit":
        if (!quiet) {
          scene?.burst(e.x, e.y, e.z, e.quality === "ai" ? scene.colors.PINK : scene.colors.LIME, e.quality === "perfect");
          if (e.quality !== "ai") {
            sfx.hit(e.power, e.quality === "perfect");
            const word = e.quality === "perfect" ? "Perfect!" : "Nice!";
            callout(TWO() ? `${playerName(e.id)} · ${word}` : word, e.quality === "perfect" ? "perfect" : "");
            host?.broadcast({ t: "buzz", k: "hit", p: e.id });
          } else sfx.aiHit();
        }
        break;
      case "swing": if (!quiet) sfx.swing(); break;
      case "bounce": if (!quiet) { sfx.bounce(); scene?.bounceMark(e.x, e.z); } break;
      case "net": if (!quiet) sfx.net(); break;
      case "feedback": if (!quiet) { callout(TWO() ? `${playerName(e.id)} · ${e.text}` : e.text, "miss"); sfx.miss(); } break;
      case "timing": if (!quiet) showTiming(e); break;
      case "trainingOver": {
        const acc = e.swings ? Math.round((e.perfect / e.swings) * 100) : 0;
        if (acc > stats.bestTiming) stats.bestTiming = acc;
        saveStats();
        if (!quiet) { sfx.win(); banner("Session done", "lime small", 1200); }
        laterResults(quiet ? 0 : 1300, "Training", `${e.perfect} perfect of ${e.swings}`, [["Perfect", e.perfect], ["Early", e.early], ["Late", e.late], ["Average error", `${Math.round(e.avg * 1000)} ms`], ["Balls hit", e.hits], ["Best perfect %", stats.bestTiming + "%"]]);
        break;
      }
      case "target":
        if (!quiet) { popup(`+${e.points}`, e.x, 0.3, e.z); if (e.ring) scene?.burst(e.x, 0.1, e.z, scene.colors.LIME, true); }
        break;
      case "point":
        if (sim.mode === "rally2" && e.shots > stats.best2pRally) { stats.best2pRally = e.shots; saveStats(); }
        if (e.playerMissed && !TWO()) { stats.missedShots++; saveStats(); }
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
        if (sim.mode !== "match") {
          const n = sideNames();
          const title = sim.mode === "doubles" ? `${n[e.winner]} win` : `${n[e.winner]} wins`;
          if (!quiet) { sfx.win(); sfx.cheer(true); banner(title, "lime", 1600); }
          laterResults(quiet ? 0 : 1800, "Match over", title, [["Games", `${e.games.P} – ${e.games.A}`], ["Match time", fmtTime(e.time)], ["Longest rally", sim.longestRally], ["Fastest ball", `${maxSpeed} km/h`]]);
          break;
        }
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
  if (sim.mode === "rally2") {
    banner(`Rally ${e.shots}`, "small", 1100);
    sfx.cheer(e.shots >= 6);
    scene?.cheer?.(e.shots >= 6);
    return;
  }
  if (sim.mode === "match2" || sim.mode === "doubles") {
    const n = sideNames();
    if (e.game && !e.match) banner(`Game ${n[e.game]}`, "lime small", 1500);
    else if (!e.match) banner(e.reason === "Winner" ? "Winner!" : e.reason, "small", 1000);
    sfx.cheer(e.game);
    scene?.cheer?.(!!e.game);
    return;
  }
  if (sim.mode === "match") scene?.cheer?.(e.winner === "P");
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
    if (TWO() && (k === "w" || k === "W") && !e.repeat) {
      const dir = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
      sim.swing(dir * 0.8, e.shiftKey ? 1 : 0.55, "kb", 1);
      return;
    }
    if ((k === " " || k === "j" || k === "J") && !e.repeat) {
      const two = TWO();
      const dir = (keys.has("arrowright") || (!two && keys.has("d")) ? 1 : 0) - (keys.has("arrowleft") || (!two && keys.has("a")) ? 1 : 0);
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
let kbX2 = 0;
function updateKeyboardInput(dt) {
  const two = TWO();
  if (two && performance.now() - (lastSlotPos[1] || -1e9) > 400) {
    const d2 = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
    if (d2) { kbX2 = Math.max(-1, Math.min(1, kbX2 + d2 * dt * 1.6)); sim.setInputX(kbX2, 1); }
  }
  if (inputMode === "phone" && performance.now() - lastPhonePos < 400) return;
  const dir = (keys.has("arrowright") || (!two && keys.has("d")) ? 1 : 0) - (keys.has("arrowleft") || (!two && keys.has("a")) ? 1 : 0);
  if (dir) { kbX = Math.max(-1, Math.min(1, kbX + dir * dt * 1.6)); sim.setInputX(kbX); }
  else if (performance.now() - mouse.lastMove < 1500) { kbX = mouse.x; sim.setInputX(mouse.x * 1.1); }
}

// ---------- phone link ----------
let host = null;
let inputMode = "kb";
let phoneKind = "body";
let phoneVisible = true;
let lastPhonePos = -1e9;
let lastPhoneMsg = -1e9;
let invisibleSince = null;
let calStep = 0;
const gate = createPacketGate();

const gates = new Map();   // one packet gate per phone connection
const slotMap = createSlotMap();
const lastSlotPos = {};    // player id -> last pos time
const seen = {};           // player id -> { visible, since }
const connKind = new Map(); // from -> "body"
function gateFor(from) {
  let g = gates.get(from);
  if (!g) { g = from === "local" ? gate : createPacketGate(); gates.set(from, g); }
  return g;
}
// Which player does this packet drive? Phones claim player slots when they say which mode they use.
function playerFor(from, s = 0) {
  if (!slotMap.get(from)) slotMap.assign(from, connKind.get(from) || "body", 1);
  return slotMap.player(from, s);
}
function sendTo(from, msg) {
  if (from === "local") { window.__airTennis.outbox.push(msg); return; }
  host?.sendTo?.(from, msg);
}
// Hit timing for body-camera swings. The phone reports `ago`: ms since the contact moment it saw on camera (it detects
// the swing a little after the arm passes the ball). Judge the swing as if it arrived then: rewind the ball along
// its flight by `ago` (clamped to 0..150 ms) while the timing window is checked, put the ball back, and schedule the
// hit for the real moment. No `ago` (keyboard, old phones, tests) = judged on arrival, as before.
const MAX_BACKDATE_S = 0.15;
function backdatedSwing(m, id) {
  const back = Math.min(MAX_BACKDATE_S, Math.max(0, (Number(m.ago) || 0) / 1000));
  const b = sim.ball;
  const swing = () => sim.swing(m.dir, m.spd, "phone", id, { kind: m.k, lift: m.lift });
  if (!back || !b || !b.live || sim.phase !== "rally" || sim.pending) return swing();
  const saved = { x: b.x, y: b.y, z: b.z, vy: b.vy };
  b.x -= b.vx * back;
  b.z -= b.vz * back;
  const y = b.y - b.vy * back - 0.5 * 9.8 * back * back; // ballistic rewind; skipped if it would cross a bounce
  if (y > 0.15 && b.y > 0.15) { b.y = y; b.vy += 9.8 * back; }
  let r;
  try { r = swing(); } finally { Object.assign(b, saved); }
  if (r?.result === "hit" && sim.pending) sim.pending.at = Math.max(sim.time, sim.pending.at - back);
  return r ? { ...r, backdated: Math.round(back * 1000) } : r;
}

function onPhoneMessage(raw, from = "local") {
  const m = gateFor(from).accept(raw);
  if (!m) return null;
  lastPhoneMsg = performance.now();
  switch (m.t) {
    case "hello":
      sendTo(from, { t: "cfg", sens: settings.sens });
      break;
    case "mode": {
      phoneKind = m.m;
      connKind.set(from, m.m);
      const a = slotMap.assign(from, m.m, m.m === "body" ? m.n : 1);
      sendTo(from, a.error ? { t: "slots", error: "full" } : { t: "slots", p: a.players, cam: a.cam });
      setHint();
      break;
    }
    case "pos": {
      const id = playerFor(from, m.s);
      if (id === null) break;
      lastSlotPos[id] = performance.now();
      if (id === 0) {
        lastPhonePos = performance.now();
        if (inputMode !== "phone" && calStep >= 5) { inputMode = "phone"; setHint(); }
        $("cal-dot").style.left = ((m.x + 1) * 50) + "%";
      }
      sim.setInputX(m.x, id);
      setVisible(from, id, m.v);
      break;
    }
    case "vis": {
      const id = playerFor(from, m.s);
      if (id !== null) setVisible(from, id, m.v);
      break;
    }
    case "swing": {
      const id = playerFor(from, m.s);
      if (id === null) break;
      if (screen === "game") {
        if (id === 0) inputMode = "phone";
        const r = backdatedSwing(m, id);
        window.__airTennis.lastSwing = { id, ...r };
      }
      if (screen === "cal") { $("cal-msg").textContent = m.k ? `${{ fh: "Forehand", bh: "Backhand", oh: "Overhead", sv: "Serve" }[m.k]} detected!` : "Swing detected!"; sfx.hit(0.6, true); }
      break;
    }
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
function setVisible(from, id, v) {
  const k = connKind.get(from);
  const cam = k === "camera" || k === "body";
  const st = seen[id] || (seen[id] = { visible: true, since: null });
  if (!cam) { st.visible = true; st.since = null; }
  else {
    st.visible = v;
    if (!v && st.since === null) st.since = performance.now();
    if (v) st.since = null;
  }
  phoneVisible = Object.values(seen).every((x) => x.visible);
  invisibleSince = Object.values(seen).reduce((a, x) => (x.since !== null && (a === null || x.since < a) ? x.since : a), null);
}
// A camera player who's in this game and has been out of view for > 0.7 s pauses the game.
function hiddenPlayer(now) {
  for (const [id, st] of Object.entries(seen)) {
    if (st.since !== null && now - st.since > 700 && sim.players[id]?.active && sim.players[id]?.human) return Number(id);
  }
  return null;
}
function setCal(step) {
  calStep = Math.max(calStep, step);
  if (step <= 1 && screen === "menu") setScreen("cal");
  document.querySelectorAll("#cal-steps li").forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle("is-done", n <= step);
    li.classList.toggle("is-now", n === step + 1);
  });
  const msgs = ["Waiting for your phone…", "Loading body tracking on the phone…", "Step back until the camera sees your whole body.", "Raise your racket hand above your head.", "Wind up and swing a forehand.", "All set! Pick a mode to play."];
  $("cal-msg").textContent = msgs[Math.min(step, 5)];
  if (step >= 5) {
    inputMode = "phone";
    setHint();
    sfx.ok();
    if (screen === "cal") setTimeout(() => { if (screen === "cal") toMenu(); }, 1500);
  }
}
function phoneMenu(k) {
  if (MODES[k]) return startMode(k);
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
    host.on("msg", ({ msg, from }) => onPhoneMessage(msg, from));
    host.on("join", ({ count }) => {
      st.dataset.state = "ok";
      st.textContent = count === 1 ? "Phone connected" : `${count} phones connected`;
      calStep = 0;
      setCal(1);
      host.broadcast({ t: "cfg", sens: settings.sens });
      host.broadcast({ t: "state", screen, mode: sim.mode });
    });
    host.on("leave", ({ count, from }) => {
      if (from) { slotMap.release(from); gates.delete(from); connKind.delete(from); }
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
    st.textContent = "Phone link offline. Check the internet connection, then reload this page.";
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
    const hid = hiddenPlayer(now);
    if (hid !== null) pause("view", hid);
    if (inputMode === "phone" && now - lastPhoneMsg > 4000 && host?.connectedCount()) pause("link");
  } else if (screen === "pause" && pauseReason === "view" && hiddenPlayer(now + 1e6) === null) {
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
  inject: (msg, from = "local") => onPhoneMessage(msg, from),
  outbox: [],
  slotMap,
  get maxSpeed() { return maxSpeed; },
  measureFps(ms = 2000) {
    return new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(Math.round((n * 1000) / (performance.now() - t0) * 10) / 10); }; requestAnimationFrame(f); });
  },
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
