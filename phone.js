// Air Tennis phone page. Two ways to play:
//  - "Swing your phone": DeviceMotion sensors detect swings, sideways tilt aims.
//  - "Phone on table": front camera + MediaPipe hand tracking, all on the phone.
// Either way the phone only sends small packets: {t:"pos"} ~30 Hz and {t:"swing"} events.
import { PhoneClient, normalizeCode } from "./net.js";
import { createMotionSwingDetector, createTiltAim } from "./motion.js";
import { createSwingDetector, mapX } from "./swing.js";
import { personFrom, createPoseSwingDetector, createPoseTracker, raisedHand, slotX, POSE_THRESH } from "./pose.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TEST = params.get("test") === "1"; // headless tests: no PeerJS, packets go to window.__phone.sent
const MP_VER = "0.10.14";
// Tests only: the headless box runs pose tracking at ~3 fps, so the fake camera clip is played in slow motion
// and the pose code runs on matching slowed-down time (slowmo=6 -> 1 real second = 1/6 s of movement).
const SLOWMO = TEST ? Math.min(20, Math.max(1, Number(params.get("slowmo")) || 1)) : 1;
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`;
const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const CAM_THRESH = { easier: 1.1, normal: 1.5, harder: 2.1 };
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const NOCAM = TEST && params.get("nocam") === "1"; // tests: feed synthetic poses through __phone.feedPoses

const client = new PhoneClient();
const sent = [];
const state = { view: "join", mode: null, step: 0, connected: false, sens: "normal", lastSwing: null, handSeen: false, camReady: false, error: null };
const motion = createMotionSwingDetector({ sensitivity: state.sens });
const tilt = createTiltAim();
const camSwing = createSwingDetector({ threshold: CAM_THRESH.normal });
let range = { min: 0.25, max: 0.75 };

function send(msg) {
  if (TEST) { sent.push({ ...msg, at: performance.now() }); if (sent.length > 2000) sent.shift(); return; }
  if (state.connected) client.send(msg);
}

function chip(id, st, text) { const c = $(id); c.dataset.state = st; if (text) c.textContent = text; }
function show(view) {
  state.view = view;
  document.body.dataset.view = view;
  for (const v of ["join", "choose", "play"]) $("v-" + v).hidden = v !== view;
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
    show("choose");
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
  if (m.t === "cfg" && ["easier", "normal", "harder"].includes(m.sens)) setSens(m.sens, false);
  if (m.t === "buzz" && (m.p === undefined || !body.players.length || body.players.includes(m.p))) buzz(m.k === "hit" ? 25 : 12);
  if (m.t === "slots") onSlots(m);
});
client.on("close", () => {
  state.connected = false;
  chip("chip-link", "bad", "TV lost");
  setStep(state.step, "Lost the TV", "Reload this page and enter the code again.");
});

// ---------- shared setup steps (match the TV's checklist) ----------
function setStep(n, title, help) {
  state.step = n;
  $("step-label").textContent = n >= 5 ? "Ready" : `Setup · step ${Math.min(n + 1, 5)} of 5`;
  $("step-title").textContent = title;
  $("step-help").textContent = help || "";
  send({ t: "cal", step: n });
}
function setSens(v, tellTv = true) {
  state.sens = v;
  $("sens").value = v;
  motion.setSensitivity(v);
  camSwing.setThreshold(CAM_THRESH[v]);
  for (const d of body.dets) d.setThreshold(POSE_THRESH[v]);
  if (tellTv) { /* the phone's own choice; the TV just follows the swings */ }
}
$("sens").addEventListener("change", (e) => setSens(e.target.value));
document.querySelectorAll("[data-menu]").forEach((b) => b.addEventListener("click", () => send({ t: "menu", k: b.dataset.menu })));
$("recal").addEventListener("click", () => (state.mode === "motion" ? beginMotionCal() : state.mode === "body" ? beginBodyCal() : beginCameraCal()));

function onSwing(dir, power, extra = "") {
  state.lastSwing = { dir, power, at: performance.now() };
  send({ t: "swing", dir, spd: power, ts: Date.now() });
  const side = dir < -0.33 ? "left" : dir > 0.33 ? "right" : "centre";
  $("swing-read").textContent = `Swing! power ${Math.round(power * 100)}% · aim ${side}${extra}`;
  buzz(15);
}
function paintMeter(x) { $("meter-dot").style.left = ((x + 1) * 50) + "%"; }

// ---------- mode 1: swing your phone ----------
let calPhase = null;
let calStillSince = null;
let sawLeft = false, sawRight = false;
let lastPosSend = 0;
function onMotion(e) {
  const t = performance.now();
  const s = {
    t,
    rotationRate: e.rotationRate ? { alpha: e.rotationRate.alpha, beta: e.rotationRate.beta, gamma: e.rotationRate.gamma } : null,
    acceleration: e.acceleration ? { x: e.acceleration.x, y: e.acceleration.y, z: e.acceleration.z } : null
  };
  const g = e.accelerationIncludingGravity;
  const x = tilt.push(g ? g.x : NaN);
  state.sensorOk = true;
  chip("chip-sensor", "ok", "Sensors");
  const sw = motion.push(s);
  paintMeter(x);
  if (calPhase === "still") {
    const rate = s.rotationRate ? Math.hypot(s.rotationRate.alpha || 0, s.rotationRate.beta || 0, s.rotationRate.gamma || 0) : 0;
    if (rate < 40) { calStillSince ??= t; if (t - calStillSince > 900) { tilt.centreNow(); calPhase = "tilt"; setStep(3, "Tilt left, then right", "Tilt the phone sideways to move your player. Left first, then right."); } }
    else calStillSince = null;
  } else if (calPhase === "tilt") {
    if (x < -0.5) sawLeft = true;
    if (x > 0.5 && sawLeft) sawRight = true;
    if (sawLeft && sawRight) { calPhase = "swing"; setStep(4, "Swing a forehand", "Swing the phone like a forehand shot. Keep a tight grip (use a wrist strap if you have one)."); }
  } else if (calPhase === "swing" && sw) {
    motion.calibrateForehand(sw.vec);
    calPhase = "done";
    setStep(5, "You're ready!", "Swing to hit. Tilt to move. Pick a mode below or on the TV.");
    $("swing-read").textContent = `Forehand saved · power ${Math.round(sw.power * 100)}%`;
    buzz(30);
    return;
  }
  if (calPhase === "done") {
    if (sw) onSwing(clampDir(x * 0.7 + sw.side * 0.35), sw.power, sw.side > 0.3 ? " · forehand" : sw.side < -0.3 ? " · backhand" : "");
    if (t - lastPosSend > 33) { lastPosSend = t; send({ t: "pos", x: round(x), y: 0, v: true }); }
  }
}
const clampDir = (v) => Math.max(-1, Math.min(1, round(v)));
const round = (v) => Math.round(v * 1000) / 1000;

async function startMotion() {
  $("choose-err").textContent = "";
  try {
    const DME = window.DeviceMotionEvent;
    if (!DME) throw new Error("This phone doesn't report motion. Try “Phone on table”.");
    if (typeof DME.requestPermission === "function") {
      const r = await DME.requestPermission(); // iPhone: must be called from this tap
      if (r !== "granted") throw new Error("Motion access was declined. On iPhone: reload the page and tap Allow.");
    }
    window.addEventListener("devicemotion", onMotion);
    state.mode = "motion";
    send({ t: "mode", m: "motion" });
    $("cam-wrap").hidden = true;
    $("chip-view").hidden = true;
    show("play");
    keepAwake();
    beginMotionCal();
    setTimeout(() => { if (!state.sensorOk) { chip("chip-sensor", "bad", "No sensors"); setStep(1, "No motion data", "This browser isn't sending motion data. Try Safari or Chrome over https, or use “Phone on table”."); } }, 2500);
  } catch (err) {
    $("choose-err").textContent = err?.message || String(err);
  }
}
function beginMotionCal() {
  calPhase = "still"; calStillSince = null; sawLeft = sawRight = false;
  setStep(2, "Hold it like a racket", "Grip the phone like a racket handle, screen facing sideways, and hold still for a second.");
}

// ---------- mode 2: phone on table (camera) ----------
let landmarker = null;
let video = null;
let ctx2d = null;
let lastSeen = 0;
let visible = false;
let camCal = null;
let camCalStart = 0;
let lastVideoTime = -1;

async function startCamera() {
  $("choose-err").textContent = "";
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera needs Safari or Chrome on an https page.");
    video = $("video");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } });
    video.srcObject = stream;
    await video.play();
    state.mode = "camera";
    send({ t: "mode", m: "camera" });
    $("cam-wrap").hidden = false;
    $("chip-view").hidden = false;
    chip("chip-sensor", "wait", "Camera");
    show("play");
    keepAwake();
    setStep(1, "Loading hand tracking…", "First time takes a few seconds.");
    const vision = await import(MP_URL);
    const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM);
    const make = (delegate) => vision.HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: HAND_MODEL, delegate }, runningMode: "VIDEO", numHands: 1, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    try { landmarker = await make("GPU"); } catch { landmarker = await make("CPU"); }
    state.camReady = true;
    chip("chip-sensor", "ok", "Camera");
    ctx2d = $("overlay").getContext("2d");
    beginCameraCal();
    requestAnimationFrame(camLoop);
  } catch (err) {
    state.error = err?.message || String(err);
    $("choose-err").textContent = err?.name === "NotAllowedError" ? "Camera access was declined. Allow the camera in Safari settings, then reload." : state.error;
    show("choose");
  }
}
function beginCameraCal() {
  camCal = "hand"; range = { min: 1, max: 0 }; camCalStart = performance.now();
  setStep(2, "Raise your racket hand", "Stand about 2 m back so the camera sees your hand. Open your hand toward the phone.");
}
const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
function drawHand(lms) {
  const c = $("overlay");
  if (c.width !== video.videoWidth) { c.width = video.videoWidth || 640; c.height = video.videoHeight || 480; }
  ctx2d.clearRect(0, 0, c.width, c.height);
  if (!lms) return;
  ctx2d.strokeStyle = "#3ee8ff";
  ctx2d.lineWidth = 4;
  ctx2d.beginPath();
  for (const [a, b] of HAND_LINKS) { ctx2d.moveTo(lms[a].x * c.width, lms[a].y * c.height); ctx2d.lineTo(lms[b].x * c.width, lms[b].y * c.height); }
  ctx2d.stroke();
  ctx2d.fillStyle = "#dcff3d";
  for (const p of lms) { ctx2d.beginPath(); ctx2d.arc(p.x * c.width, p.y * c.height, 5, 0, Math.PI * 2); ctx2d.fill(); }
}
function camLoop() {
  if (!landmarker || !video) return;
  const now = performance.now();
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    let res = null;
    try { res = landmarker.detectForVideo(video, now); } catch (e) { state.error = String(e?.message || e); }
    const lms = res?.landmarks?.[0];
    drawHand(lms);
    if (lms) {
      lastSeen = now;
      state.handSeen = true;
      // Mirror x so moving your hand to your right moves the player right.
      const wrist = { x: 1 - lms[0].x, y: lms[0].y };
      const palm = { x: 1 - (lms[0].x + lms[5].x + lms[17].x) / 3, y: (lms[0].y + lms[5].y + lms[17].y) / 3 };
      handleHand(wrist, palm, now);
    }
    const v = now - lastSeen < 500;
    if (v !== visible) { visible = v; send({ t: "vis", v }); chip("chip-view", v ? "ok" : "bad", v ? "In view" : "Not in view"); }
  }
  requestAnimationFrame(camLoop);
}
const trace = [];
function handleHand(wrist, palm, now) {
  trace.push([Math.round(now), round(wrist.x), round(wrist.y)]);
  if (trace.length > 300) trace.shift();
  const sw = camSwing.push(wrist.x, wrist.y, now);
  if (camCal === "hand") {
    if (now - camCalStart > 400) { camCal = "range"; range = { min: palm.x, max: palm.x }; setStep(3, "Move left, then right", "Slide your hand all the way to your left, then all the way to your right."); }
  } else if (camCal === "range") {
    range.min = Math.min(range.min, palm.x);
    range.max = Math.max(range.max, palm.x);
    paintMeter(palm.x * 2 - 1);
    if (range.max - range.min > 0.3) { camCal = "swing"; setStep(4, "Swing to confirm", "Swing your hand fast, like a forehand."); }
  } else if (camCal === "swing" && sw) {
    camCal = "done";
    setStep(5, "You're ready!", "Swing your hand to hit. Move it left and right to move your player.");
    $("swing-read").textContent = `Swing detected · power ${Math.round(sw.power * 100)}%`;
  } else if (camCal === "done") {
    const x = mapX(palm.x, range);
    paintMeter(x);
    if (sw) onSwing(sw.dir, sw.power);
    if (now - lastPosSend > 33) { lastPosSend = now; send({ t: "pos", x: round(x), y: round(palm.y * 2 - 1), v: true }); }
  }
}

// ---------- mode 3: body camera (MediaPipe PoseLandmarker, 1 or 2 people) ----------
const body = { n: 1, tracker: null, dets: [], lastSeen: [0, 0], visible: [false, false], cal: null, calSince: 0, raiseSince: [0, 0], calDone: [false, false], swingDone: [false, false], lastPos: [0, 0], players: [], facing: "user", landmarker: null, people: 0, slots: [], lastSwings: [] };
const SLOT_COL = ["#d9ef4a", "#7fd0ff"];

async function startBody(n) {
  $("choose-err").textContent = "";
  try {
    body.n = n;
    body.tracker = createPoseTracker({ slots: n });
    body.dets = Array.from({ length: n }, () => createPoseSwingDetector({ threshold: POSE_THRESH[state.sens] }));
    body.calDone = [false, false]; body.swingDone = [false, false];
    state.mode = "body";
    send({ t: "mode", m: "body", n });
    $("cam-wrap").hidden = false;
    $("chip-view").hidden = false;
    $("body-row").hidden = false;
    $("hand-1").hidden = n < 2;
    show("play");
    keepAwake();
    if (!NOCAM) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera needs Safari or Chrome on an https page.");
      await openCamera();
      setStep(1, "Loading body tracking…", "First time downloads about 15 MB. After that it's cached.");
      const vision = await import(MP_URL);
      const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM);
      const make = (delegate) => vision.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: POSE_MODEL, delegate }, runningMode: "VIDEO", numPoses: n, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
      try { body.landmarker = await make("GPU"); state.delegate = "GPU"; } catch { body.landmarker = await make("CPU"); state.delegate = "CPU"; }
      ctx2d = $("overlay").getContext("2d");
    }
    state.camReady = true;
    chip("chip-sensor", "ok", "Camera");
    beginBodyCal();
    if (!NOCAM) requestAnimationFrame(poseLoop);
  } catch (err) {
    state.error = err?.message || String(err);
    $("choose-err").textContent = err?.name === "NotAllowedError" ? "Camera access was declined. Allow the camera in Safari settings, then reload." : state.error;
    show("choose");
  }
}
async function openCamera() {
  video = $("video");
  video.srcObject?.getTracks?.().forEach((t) => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: body.facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } });
  video.srcObject = stream;
  await video.play();
  // The front camera is shown mirrored; the back camera isn't.
  $("cam-wrap").classList.toggle("is-back", body.facing === "environment");
}
function beginBodyCal() {
  body.cal = "view"; body.calSince = 0; body.calDone = [false, false]; body.swingDone = [false, false];
  setStep(2, body.n === 2 ? "Both players: step into view" : "Step into view", body.n === 2 ? "Stand side by side about 3 m from the phone, whole body in the picture. Left person = Player " + slotName(0) + "." : "Stand about 3 m from the phone so it sees you from head to feet.");
}
function slotName(s) { return body.players[s] !== undefined ? body.players[s] + 1 : s + 1; }
function onSlots(m) {
  if (m.error) { $("choose-err").textContent = "This TV already has 2 camera phones."; setStep(state.step, "TV is full", "This TV already has 2 camera phones connected."); return; }
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
function poseLoop() {
  if (!body.landmarker || !video || state.mode !== "body") return;
  const now = performance.now();
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    let res = null;
    try { res = body.landmarker.detectForVideo(video, now); } catch (e) { state.error = String(e?.message || e); }
    handlePoses(res?.landmarks || [], now / SLOWMO);
  }
  requestAnimationFrame(poseLoop);
}
// One frame of poses -> slots -> swings, positions, visibility, setup steps. Also used by the tests.
function handlePoses(list, now) {
  const persons = list.map((lm) => { const p = personFrom(lm); if (p) p.raw = lm; return p; }).filter(Boolean);
  body.people = persons.length;
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
        send({ t: "swing", s, dir: sw.dir, spd: sw.power, k: sw.kind, lift: sw.lift, ts: Date.now() });
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
    if (all) { body.calSince ||= now; if (now - body.calSince > 600) { body.cal = "raise"; setStep(3, "Raise your racket hand", body.n === 2 ? "Each player: hold your racket hand up above your head." : "Hold your racket hand up above your head for a moment."); } }
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
  if (!persons.length) { msg.hidden = false; msg.className = "cam-msg"; msg.textContent = body.n === 2 ? "Step into view (both players)" : "Step into view"; }
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
$("pick-motion").addEventListener("click", startMotion);
$("pick-camera").addEventListener("click", startCamera);
$("pick-body1").addEventListener("click", () => startBody(1));
$("pick-body2").addEventListener("click", () => startBody(2));

window.__phone = { state, sent, trace, motion, tilt, camSwing, get range() { return range; }, join, body, startBody, feedPoses: (list, t) => handlePoses(list, t ?? performance.now()), onMessage: (m) => client.emit("message", m) };

const initial = codeFromLocation();
if (initial) { $("code").value = initial; join(initial); }
else show("join");
