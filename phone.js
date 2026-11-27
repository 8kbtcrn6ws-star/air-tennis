// Air Tennis phone page: the phone is a body-tracking camera. Stand it up 2-3 m from the players (1 or 2 people);
// MediaPipe PoseLandmarker runs on the phone and only small packets go to the TV:
// {t:"pos"} ~30 Hz per player and {t:"swing"} events. Video never leaves the phone.
import { PhoneClient, normalizeCode } from "./net.js";
import { personFrom, createPoseSwingDetector, createPoseTracker, raisedHand, slotX, POSE_THRESH } from "./pose.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TEST = params.get("test") === "1"; // headless tests only: no PeerJS, packets go to window.__phone.sent
const MP_VER = "0.10.14";
// Tests only: the headless box runs pose tracking at ~3 fps, so the fake camera clip is played in slow motion
// and the pose code runs on matching slowed-down time (slowmo=6 -> 1 real second = 1/6 s of movement).
const SLOWMO = TEST ? Math.min(20, Math.max(1, Number(params.get("slowmo")) || 1)) : 1;
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`;
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const NOCAM = TEST && params.get("nocam") === "1"; // tests: feed synthetic poses through __phone.feedPoses

const client = new PhoneClient();
const sent = [];
const state = { view: "join", mode: null, step: 0, connected: false, sens: "normal", camReady: false, error: null, loading: "" };
let video = null;
let ctx2d = null;
let lastVideoTime = -1;
const round = (v) => Math.round(v * 1000) / 1000;

function send(msg) {
  if (TEST) { sent.push({ ...msg, at: performance.now() }); if (sent.length > 2000) sent.shift(); return; }
  if (state.connected) client.send(msg);
}

function chip(id, st, text) { const c = $(id); c.dataset.state = st; if (text) c.textContent = text; }
function show(view) {
  state.view = view;
  document.body.dataset.view = view;
  for (const v of ["join", "start", "play"]) $("v-" + v).hidden = v !== view;
}
function buzz(ms) { try { navigator.vibrate?.(ms); } catch { /* iPhone: no vibration API, skip */ } }

// ---------- join ----------
function codeFromLocation() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  return normalizeCode(h.get("code") || params.get("code") || "");
}
async function join(code) {
  $("join-err").textContent = "";
  chip("chip-link", "wait", "Connecting");
  try {
    if (!TEST) await client.connect(code);
    state.connected = true;
    chip("chip-link", "ok", "TV " + normalizeCode(code));
    show("start"); // iPhone Safari needs a tap before the camera can start
  } catch (err) {
    chip("chip-link", "bad", "TV");
    $("join-err").textContent = err?.message || "Couldn't reach the TV. Check the code.";
  }
}
$("join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const code = normalizeCode($("code").value);
  if (code.length !== 4) { $("join-err").textContent = "The code is 4 letters, shown on the TV."; return; }
  join(code);
});
client.on("message", (m) => {
  if (m.t === "cfg" && ["easier", "normal", "harder"].includes(m.sens)) setSens(m.sens);
  if (m.t === "buzz" && (m.p === undefined || !body.players.length || body.players.includes(m.p))) buzz(m.k === "hit" ? 25 : 12);
  if (m.t === "slots") onSlots(m);
});
client.on("close", () => {
  state.connected = false;
  chip("chip-link", "bad", "TV lost");
  setStep(state.step, "Lost the TV", "Reload this page and enter the code again.");
});

// ---------- setup steps (match the TV's checklist) ----------
function setStep(n, title, help) {
  state.step = n;
  $("step-label").textContent = n >= 5 ? "Ready" : `Setup · step ${Math.min(n + 1, 5)} of 5`;
  $("step-title").textContent = title;
  $("step-help").textContent = help || "";
  send({ t: "cal", step: n });
}
function setSens(v) {
  state.sens = v;
  $("sens").value = v;
  for (const d of body.dets) d.setThreshold(POSE_THRESH[v]);
}
$("sens").addEventListener("change", (e) => setSens(e.target.value));
document.querySelectorAll("[data-menu]").forEach((b) => b.addEventListener("click", () => send({ t: "menu", k: b.dataset.menu })));
$("recal").addEventListener("click", () => { if (state.mode === "body") beginBodyCal(); });
function paintMeter(x) { $("meter-dot").style.left = ((x + 1) * 50) + "%"; }

// ---------- camera errors, in words a person can act on ----------
function cameraError(err) {
  const n = err?.name || "";
  if (n === "NotAllowedError" || n === "SecurityError") return "Camera access is blocked. On iPhone: open Settings > Safari > Camera and choose Allow (or tap aA in Safari's address bar > Website Settings > Camera > Allow). Then reload this page.";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "No camera found on this device.";
  if (n === "NotReadableError" || n === "AbortError") return "The camera is busy. Close other apps that use it (FaceTime, Camera), then tap Start camera again.";
  if (!window.isSecureContext) return "The camera only works on the https:// address of Air Tennis.";
  return err?.message || String(err);
}

// ---------- the body camera (MediaPipe PoseLandmarker, 1 or 2 people, detected automatically) ----------
const body = { n: 2, fixedN: 0, tracker: null, dets: [], lastSeen: [0, 0], visible: [false, false], cal: null, calSince: 0, countSince: 0, countN: 0, raiseSince: [0, 0], calDone: [false, false], swingDone: [false, false], lastPos: [0, 0], swingN: [0, 0], players: [], facing: "user", landmarker: null, people: 0, slots: [], lastSwings: [] };
const SLOT_COL = ["#d9ef4a", "#7fd0ff"];

// n = people in front of this phone. Until setup has counted them, track up to 2.
function setPeople(n) {
  body.n = n;
  body.tracker = createPoseTracker({ slots: n });
  body.dets = Array.from({ length: n }, () => createPoseSwingDetector({ threshold: POSE_THRESH[state.sens] }));
  body.visible = [false, false];
  $("hand-1").hidden = n < 2;
  send({ t: "mode", m: "body", n });
  paintHands();
}

// Must run from the Start camera tap: iPhone Safari only shows the camera prompt from a user gesture.
async function startBody(forceN) {
  $("start-err").textContent = "";
  $("start-btn").disabled = true;
  try {
    if (!NOCAM) {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("This browser can't use the camera. Open the page in Safari or Chrome."), { name: window.isSecureContext ? "Unsupported" : "SecurityError" });
      await openCamera(); // first await in the tap handler -> the permission prompt
    }
    body.fixedN = forceN === 1 || forceN === 2 ? forceN : 0;
    state.mode = "body";
    setPeople(body.fixedN || 2);
    show("play");
    keepAwake();
    chip("chip-cam", "ok", "Camera");
    if (!NOCAM) {
      $("cam-msg").hidden = false; $("cam-msg").className = "cam-msg"; $("cam-msg").textContent = "Loading body tracking…";
      setStep(1, "Loading body tracking…", "Starting the tracking engine. The first time takes a few seconds.");
      const vision = await import(MP_URL);
      const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM);
      const model = await fetchWithProgress(POSE_MODEL, (pct) => {
        state.loading = `${pct}%`;
        $("cam-msg").textContent = `Loading body tracking… ${pct}%`;
        setStep(1, `Loading body tracking… ${pct}%`, "Downloading the pose model (about 5 MB, only the first time).");
      });
      const make = (delegate) => vision.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: model, delegate }, runningMode: "VIDEO", numPoses: 2, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
      try { body.landmarker = await make("GPU"); state.delegate = "GPU"; } catch { body.landmarker = await make("CPU"); state.delegate = "CPU"; }
      ctx2d = $("overlay").getContext("2d");
    }
    state.camReady = true;
    beginBodyCal();
    if (!NOCAM) nextPoseFrame();
  } catch (err) {
    state.error = cameraError(err);
    chip("chip-cam", "bad", "No camera");
    $("start-err").textContent = state.error;
    $("start-btn").disabled = false;
    $("start-btn").textContent = "Try again";
    show("start");
  }
}
async function fetchWithProgress(url, onPct) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download body tracking (${res.status}). Check the internet connection and tap Try again.`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) { onPct(50); const b = new Uint8Array(await res.arrayBuffer()); onPct(100); return b; }
  const reader = res.body.getReader();
  const parts = [];
  let got = 0, last = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    const pct = Math.min(100, Math.round((got / total) * 100));
    if (pct !== last) { last = pct; onPct(pct); }
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const v of parts) { out.set(v, o); o += v.length; }
  return out;
}
async function openCamera() {
  video = $("video");
  video.setAttribute("playsinline", ""); video.muted = true; video.autoplay = true;
  video.srcObject?.getTracks?.().forEach((t) => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: body.facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } });
  video.srcObject = stream;
  await video.play().catch(() => { /* autoplay+muted+playsinline normally plays; frames still arrive */ });
  // The front camera is shown mirrored (like a mirror); the back camera isn't.
  $("cam-wrap").classList.toggle("is-back", body.facing === "environment");
}
function beginBodyCal() {
  body.cal = "view"; body.calSince = 0; body.countSince = 0; body.countN = 0; body.calDone = [false, false]; body.swingDone = [false, false];
  if (!body.fixedN && body.n !== 2) setPeople(2);
  setStep(2, "Step into view", "Prop the phone up about 2-3 m away, facing you. 1 or 2 players stand side by side, whole body in the picture (head to feet). Left person = Player 1.");
}
function slotName(s) { return body.players[s] !== undefined ? body.players[s] + 1 : s + 1; }
function onSlots(m) {
  if (m.error) { setStep(state.step, "TV is full", "This TV already has 2 camera phones connected."); return; }
  body.players = m.p || [];
  const line = $("slot-line");
  if (state.mode === "body") {
    line.hidden = false;
    line.innerHTML = body.n === 2 ? `Left: <b>Player ${slotName(0)}</b> · Right: <b>Player ${slotName(1)}</b>${m.cam ? ` · camera ${m.cam}` : ""}` : `You are <b>Player ${slotName(0)}</b>${m.cam ? ` · camera ${m.cam}` : ""}`;
  }
  paintHands();
}
function paintHands() {
  for (let s = 0; s < 2; s++) $("hand-" + s).textContent = `P${slotName(s)}: ${(body.dets[s]?.config.hand || "right")}-handed`;
}
// Next camera frame: requestVideoFrameCallback where the browser has it (one call per real camera frame, with its
// capture time), otherwise requestAnimationFrame.
function nextPoseFrame() {
  if (video && typeof video.requestVideoFrameCallback === "function") video.requestVideoFrameCallback((_, meta) => poseLoop(meta));
  else requestAnimationFrame(() => poseLoop(null));
}
let lastFrameT = 0;
function poseLoop(meta) {
  if (!body.landmarker || !video || state.mode !== "body") return;
  const now = performance.now();
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    // Swing speeds and `ago` use when the frame was captured, not when we got round to processing it.
    let ft = meta?.captureTime > 0 && meta.captureTime <= now && now - meta.captureTime < 500 ? meta.captureTime : now;
    ft = Math.max(ft, lastFrameT + 1);
    lastFrameT = ft;
    let res = null;
    try { res = body.landmarker.detectForVideo(video, now); } catch (e) { state.error = String(e?.message || e); }
    handlePoses(res?.landmarks || [], ft / SLOWMO, res?.worldLandmarks, (performance.now() - ft) / SLOWMO);
  }
  nextPoseFrame();
}
// One frame of poses -> slots -> swings, positions, visibility, setup steps. Also used by the tests.
// worlds = MediaPipe worldLandmarks (metres) per pose; procMs = time from frame capture to now (added to `ago`).
function handlePoses(list, now, worlds, procMs = 0) {
  const persons = list.map((lm, i) => { const p = personFrom(lm, 0.5, worlds?.[i]); if (p) p.raw = lm; return p; }).filter(Boolean);
  body.people = persons.length;
  // Setup counts the people in front of the phone (1 or 2) once the count has been steady for a moment.
  if (body.cal === "view" && !body.fixedN) {
    // Only count people about as big as the biggest one: someone small in the background isn't a player.
    const big = Math.max(0, ...persons.map((p) => p.unit));
    const c = Math.min(2, persons.filter((p) => p.unit >= big * 0.55).length);
    if (c !== body.countN) { body.countN = c; body.countSince = now; }
    else if (c >= 1 && c !== body.n && now - body.countSince > 800) { setPeople(c); body.calSince = 0; }
  }
  // After setup the tracker locks onto the players (passers-by can't take a slot); re-running setup unlocks it.
  if ((body.cal === "done") !== !!body.tracker.locked) { if (body.cal === "done") body.tracker.lock(); else body.tracker.unlock(); }
  // Swings are off until the swing step of setup. Turning them on waits for a calm arm, so lowering the hand
  // raised in the "raise your racket hand" step is never read as an overhead.
  for (const d of body.dets) d.setEnabled(body.cal === "swing" || body.cal === "done");
  const slots = body.tracker.update(persons, now);
  body.slots = slots.map((s) => ({ slot: s.slot, id: s.id, seen: !!s.person, cx: s.person ? round(s.person.cx) : null, full: !!s.person?.full }));
  for (const { slot: s, person: p } of slots) {
    const sw = body.dets[s].push(p, now);
    if (p) body.lastSeen[s] = now;
    const v = now - body.lastSeen[s] < 500;
    if (v !== body.visible[s]) { body.visible[s] = v; if (body.cal === "done") send({ t: "vis", v, s }); }
    if (body.cal === "raise" && p && !body.calDone[s]) {
      const h = raisedHand(p);
      if (h) { body.raiseSince[s] ||= now; if (now - body.raiseSince[s] > 300) { body.dets[s].setHand(h); body.calDone[s] = true; paintHands(); } }
      else body.raiseSince[s] = 0;
    }
    if (sw) {
      body.lastSwings.push({ s, ...sw });
      if (body.lastSwings.length > 50) body.lastSwings.shift();
      if (body.cal === "swing" && (sw.kind === "fh" || sw.kind === "bh")) body.swingDone[s] = true;
      if (body.cal === "done") {
        body.swingN[s] = (body.swingN[s] || 0) + 1;
        send({ t: "swing", s, dir: sw.dir, spd: sw.power, k: sw.kind, lift: sw.lift, ago: Math.min(300, Math.round(sw.ago + procMs)), c: sw.c, n: body.swingN[s] });
        $("swing-read").textContent = `P${slotName(s)}: ${{ fh: "forehand", bh: "backhand", oh: "overhead", sv: "serve" }[sw.kind]} · power ${Math.round(sw.power * 100)}%`;
        buzz(15);
      } else $("swing-read").textContent = `${{ fh: "Forehand", bh: "Backhand", oh: "Overhead", sv: "Serve" }[sw.kind]} detected`;
    }
    if (body.cal === "done" && p && now - body.lastPos[s] > 33) {
      body.lastPos[s] = now;
      const x = slotX(p.cx, s, body.n);
      if (s === 0) paintMeter(x);
      send({ t: "pos", s, x: round(x), y: 0, v: true });
    }
  }
  const all = slots.every((x) => x.person);
  if (body.cal === "view") {
    if (all) { body.calSince ||= now; if (now - body.calSince > (body.fixedN ? 600 : 1500)) { body.cal = "raise"; setStep(3, "Raise your racket hand", body.n === 2 ? "Each player: hold your racket hand up above your head." : "Hold your racket hand up above your head for a moment."); } }
    else body.calSince = 0;
  } else if (body.cal === "raise" && body.calDone.slice(0, body.n).every(Boolean)) {
    body.cal = "swing";
    setStep(4, "Wind up and swing", "Take your racket arm back, then swing a forehand through. " + (body.n === 2 ? "Both players." : ""));
  } else if (body.cal === "swing" && body.swingDone.slice(0, body.n).every(Boolean)) {
    finishBodyCal();
  }
  // Messages over the camera view.
  const msg = $("cam-msg");
  const missing = slots.filter((x) => !x.person).map((x) => x.slot);
  if (!persons.length) { msg.hidden = false; msg.className = "cam-msg"; msg.textContent = "Step into view"; }
  else if (missing.length) { msg.hidden = false; msg.className = "cam-msg"; msg.textContent = `Player ${slotName(missing[0])}: step into view (${missing[0] === 0 ? "left" : "right"} side)`; }
  else if (slots.some((x) => !x.person.full)) { msg.hidden = false; msg.className = "cam-msg soft"; msg.textContent = "Step back a little so your feet are in the picture"; }
  else msg.hidden = true;
  const anyV = body.visible.slice(0, body.n).some(Boolean);
  chip("chip-view", anyV ? "ok" : "bad", anyV ? (body.n === 2 ? `${body.visible.filter(Boolean).length}/2 in view` : "In view") : "Not in view");
  if (ctx2d) drawPoses(slots);
}
function finishBodyCal() {
  body.cal = "done";
  body.visible = [false, false];
  setStep(5, "You're ready!", "Wind up and swing to hit: forehand, backhand, or overhead (racket hand above your head). Step left and right to move.");
}
const BODY_LINKS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
function drawPoses(slots) {
  const c = $("overlay");
  if (c.width !== (video?.videoWidth || 640)) { c.width = video?.videoWidth || 640; c.height = video?.videoHeight || 480; }
  ctx2d.clearRect(0, 0, c.width, c.height);
  for (const { slot, person } of slots) {
    if (!person) continue;
    const lm = person.raw;
    ctx2d.strokeStyle = SLOT_COL[slot];
    ctx2d.lineWidth = 5;
    ctx2d.beginPath();
    for (const [a, b] of BODY_LINKS) { if ((lm[a].visibility ?? 1) < 0.4 || (lm[b].visibility ?? 1) < 0.4) continue; ctx2d.moveTo(lm[a].x * c.width, lm[a].y * c.height); ctx2d.lineTo(lm[b].x * c.width, lm[b].y * c.height); }
    ctx2d.stroke();
    ctx2d.fillStyle = "#ffffff";
    for (const i of [0, 15, 16, 27, 28]) { if ((lm[i].visibility ?? 1) < 0.4) continue; ctx2d.beginPath(); ctx2d.arc(lm[i].x * c.width, lm[i].y * c.height, i === 15 || i === 16 ? 9 : 6, 0, Math.PI * 2); ctx2d.fill(); }
    // Label (the canvas is mirrored by CSS, so flip the text back).
    const x = lm[0].x * c.width, y = Math.max(24, lm[0].y * c.height - 40);
    ctx2d.save();
    ctx2d.translate(x, y);
    if (!$("cam-wrap").classList.contains("is-back")) ctx2d.scale(-1, 1);
    ctx2d.font = "700 26px system-ui, sans-serif";
    ctx2d.textAlign = "center";
    ctx2d.fillStyle = SLOT_COL[slot];
    ctx2d.fillText("P" + slotName(slot), 0, 0);
    ctx2d.restore();
  }
}
$("skip-cal").addEventListener("click", () => { if (state.mode === "body") finishBodyCal(); });
$("flip-cam").addEventListener("click", async () => { if (state.mode !== "body" || NOCAM) return; body.facing = body.facing === "user" ? "environment" : "user"; try { await openCamera(); } catch (e) { state.error = String(e?.message || e); } });
for (const s of [0, 1]) $("hand-" + s).addEventListener("click", () => { const d = body.dets[s]; if (!d) return; d.setHand(d.config.hand === "right" ? "left" : "right"); paintHands(); });

// ---------- misc ----------
let wakeLock = null;
async function keepAwake() { try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* optional */ } }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.mode) keepAwake(); });
$("start-btn").addEventListener("click", () => startBody());

// Hidden test hook (not shown anywhere on the page).
window.__phone = { state, sent, join, body, startBody, feedPoses: (list, t, worlds) => handlePoses(list, t ?? performance.now(), worlds), onMessage: (m) => client.emit("message", m) };

const initial = codeFromLocation();
if (initial) { $("code").value = initial; join(initial); }
else show("join");
