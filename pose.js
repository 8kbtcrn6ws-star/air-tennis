// Body tracking helpers for the phone camera (MediaPipe PoseLandmarker output). Pure JS, unit-tested in Node.
//  - personCheck / personFrom(landmarks, minVis, world): picks the joints we use, mirrors x (your right = screen right),
//    and rejects poses that are too unsure or too small (far-away people in the background).
//  - createPoseSwingDetector(): READY -> preparation -> forward swing -> forehand / backhand / overhead / serve.
//    One Euro smoothing, short gaps bridged from the elbow, no phantom swings after gaps, fires early and reports
//    how long ago the contact moment was (`ago`) so the TV can backdate the swing.
//  - createPoseTracker(): up to 2 people in one camera, stable IDs, left person = slot 0, locks onto the players after
//    setup so people walking past in the background can't take a slot.
// Landmarks are normalised image coords (0..1). Distances are in "body units" (≈ shoulder width) so it works the same
// near or far from the phone. Nothing here stores or sends images or landmarks.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const LM = { nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28 };
const vis = (p) => (p ? (p.visibility ?? 1) : 0);
export const MIN_UNIT = 0.03; // body unit (≈ shoulder width) below 3% of the frame = too far away / background

// Mirror and pick joints. Returns { person, why } where why = "none" | "lowconf" | "small" when rejected.
export function personCheck(lms, minVis = 0.5, world = null, opts = {}) {
  if (!Array.isArray(lms) || lms.length < 29) return { person: null, why: "none" };
  const minUnit = opts.minUnit ?? MIN_UNIT;
  const m = (i) => { const p = lms[i]; return p ? { x: 1 - p.x, y: p.y, z: p.z || 0, v: vis(p) } : null; };
  const j = {};
  for (const [k, i] of Object.entries(LM)) j[k] = m(i);
  // MediaPipe "left/right" is the person's own side. After mirroring, the person's right is on screen right.
  if (!j.lSh || !j.rSh || j.lSh.v < minVis || j.rSh.v < minVis) return { person: null, why: "lowconf" };
  const hipsOk = j.lHip.v >= minVis && j.rHip.v >= minVis;
  const sh = { x: (j.lSh.x + j.rSh.x) / 2, y: (j.lSh.y + j.rSh.y) / 2 };
  const hip = hipsOk ? { x: (j.lHip.x + j.rHip.x) / 2, y: (j.lHip.y + j.rHip.y) / 2 } : { x: sh.x, y: sh.y + 0.25 };
  const sw = Math.abs(j.rSh.x - j.lSh.x);
  const torso = Math.hypot(hip.x - sh.x, hip.y - sh.y);
  const unit = Math.max(sw, torso * 0.62, 0.005);
  if (unit < minUnit) return { person: null, why: "small" };
  const feet = j.lAn.v >= minVis && j.rAn.v >= minVis;
  const knees = j.lKn.v >= minVis && j.rKn.v >= minVis;
  const core = [j.lSh, j.rSh, j.lHip, j.rHip].map((p) => p.v);
  const conf = core.reduce((a, b) => a + b, 0) / core.length;
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of Object.values(j)) if (p.v >= 0.3) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const person = { j, sh, hip, unit, cx: hip.x, hipsOk, knees, feet, full: hipsOk && knees && feet, conf, torsoH: hipsOk ? torso : unit / 0.62, bbox: x1 > x0 ? { x0, y0, x1, y1 } : null, w: null };
  // Metric 3D landmarks (hip-centred, metres) when MediaPipe gives them: better depth than the 2D z.
  if (Array.isArray(world) && world.length >= 29) {
    const w = {};
    for (const [k, i] of Object.entries(LM)) { const p = world[i]; w[k] = p ? { x: -p.x, y: p.y, z: p.z || 0 } : null; }
    const swm = w.lSh && w.rSh ? Math.hypot(w.lSh.x - w.rSh.x, w.lSh.y - w.rSh.y, w.lSh.z - w.rSh.z) : 0;
    if (swm > 0.15 && swm < 1) { w.sw = swm; person.w = w; }
  }
  return { person, why: null };
}
export function personFrom(lms, minVis = 0.5, world = null, opts = {}) { return personCheck(lms, minVis, world, opts).person; }

export const POSE_THRESH = { easier: 3.8, normal: 4.5, harder: 6 }; // body units per second (v3: was 4.5 / 6 / 8)

// One Euro filter (Casiez et al. 2012): smooths jitter when still, follows fast moves with little lag. t in ms.
export function createOneEuro({ minCutoff = 1.5, beta = 0.5, dCutoff = 1.0 } = {}) {
  let x = null, dx = 0, tPrev = null;
  const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  return {
    filter(v, t) {
      if (x === null || tPrev === null || !(t > tPrev)) { x = v; dx = 0; tPrev = t; return v; }
      const dt = Math.min(0.5, (t - tPrev) / 1000);
      tPrev = t;
      dx += alpha(dCutoff, dt) * ((v - x) / dt - dx);
      x += alpha(minCutoff + beta * Math.abs(dx), dt) * (v - x);
      return x;
    },
    reset() { x = null; dx = 0; tPrev = null; },
    get value() { return x; }
  };
}

// Where the racket meets the ball, along the wrist path in body units (forehand / backhand); used for `ago`.
export const CONTACT_LX = { fh: 0.4, bh: -0.2 };

export function createPoseSwingDetector(opts = {}) {
  const cfg = {
    hand: opts.hand === "left" ? "left" : "right",
    threshold: opts.threshold ?? POSE_THRESH.normal,
    prepHold: opts.prepHold ?? 50,    // ms the wrist must sit in a preparation zone
    prepValid: opts.prepValid ?? 700, // ms a preparation stays "loaded" after leaving the zone
    cooldown: opts.cooldown ?? 450,
    maxGap: opts.maxGap ?? 300,       // longer than this without a usable arm (or body) resets everything
    histGap: opts.histGap ?? 80,      // a wrist sample after missed frames spanning longer than this starts a fresh velocity history
    fillMs: opts.fillMs ?? 600,       // a hidden wrist is bridged from the visible elbow for up to this long
    readyHold: opts.readyHold ?? 120, // ms of a calm arm in front of the body before a new wind-up counts
    minDisp: opts.minDisp ?? 0.35,    // body units the wrist must travel in the swing direction before firing
    zoneMul: opts.zoneMul ?? 1.0,     // a swing still inside its wind-up zone needs this much more speed
    fitMul: opts.fitMul ?? 0.5,        // the smoothed (3-sample fit) speed must reach this share of the threshold
    onset: opts.onset ?? true,        // fire on the first fast sample when the step before was already accelerating the same way
    ohMul: opts.ohMul ?? 1.5,         // overheads need this much more speed (lowering a raised arm is slow; a real overhead is fast)
    maxLead: opts.maxLead ?? 150,      // ms: report a contact still ahead as a negative `ago` (down to -maxLead)
    euro: opts.euro ?? { minCutoff: 1.5, beta: 0.5, dCutoff: 1.0 }
  };
  let serving = false;
  let enabled = true;
  let needReady = false;
  let calmSince = null;
  let hist = [];        // filtered wrist samples { t, x, y, real }
  let prep = null;      // { kind, last }
  let zoneSince = null; // { kind, t }
  let cand = null;      // forward swing being confirmed
  let lastSwing = -1e9;
  let lastT = -1e9;     // last frame with a body
  let lastSample = -1e9;
  let lastReal = -1e9;
  let missed = false;   // frames with a body but no usable wrist since the last sample
  let forearm = null;   // last seen wrist - elbow, body units
  let elbowPrev = null; // { t, x, y } last real elbow, for elbow speed when the wrist is hidden
  let elbowV = null;
  let top = null;       // { y, t } highest wrist point while wound up for an overhead (the contact moment)
  let noise = 0.03, noiseN = 0; // landmark noise estimate (body units, per sample) from the arm at rest; far / blurry players are noisier
  const fx = createOneEuro(cfg.euro), fy = createOneEuro(cfg.euro);
  const stats = { filled: 0, real: 0, dropped: 0, fast: [] }; // fast = times of frames with the arm moving at swing speed (tests)

  function clearMotion() { hist = []; cand = null; fx.reset(); fy.reset(); }
  function reset() { clearMotion(); noise = 0.03; noiseN = 0; prep = null; zoneSince = null; calmSince = null; forearm = null; elbowPrev = null; elbowV = null; top = null; }

  // The racket arm is picked by which side of the body its shoulder is on (in the mirrored view), not by
  // the detector's left/right label: pose models sometimes flip front/back and swap the labels.
  function racketArm(person) {
    const j = person.j;
    const side = cfg.hand === "right" ? 1 : -1;
    const chains = [{ S: j.lSh, E: j.lEl, W: j.lWr, k: "l" }, { S: j.rSh, E: j.rEl, W: j.rWr, k: "r" }];
    const bySide = chains.filter((c) => Math.sign(c.S.x - person.sh.x) === side);
    return { arm: bySide.length === 1 ? bySide[0] : chains[side > 0 ? 1 : 0], d: side };
  }
  const inFrame = (p) => p.x > -0.02 && p.x < 1.02 && p.y > -0.02 && p.y < 1.02;

  // Wrist (and elbow) in the body frame: x > 0 = out on the racket side, y > 0 = up from the shoulder line.
  function local(person, t) {
    const { arm, d } = racketArm(person);
    const { W, E, S } = arm;
    const j = person.j, u = person.unit;
    const L = (p) => ({ x: (d * (p.x - person.sh.x)) / u, y: (person.sh.y - p.y) / u });
    const eOk = E && E.v >= 0.5 && inFrame(E);
    const wOk = W && W.v >= 0.5 && inFrame(W);
    const e = eOk ? L(E) : null;
    let w = null, real = false;
    if (wOk) {
      w = L(W); real = true; lastReal = t;
      if (e) forearm = { x: w.x - e.x, y: w.y - e.y };
    } else if (e && forearm && t - lastReal <= cfg.fillMs) {
      w = { x: e.x + forearm.x, y: e.y + forearm.y }; // bridged: the forearm keeps its last shape
    }
    if (!w) return null;
    let dz = 0;
    if (person.w) {
      const k = arm.k === "l" ? ["lWr", "lSh"] : ["rWr", "rSh"];
      const ww = person.w[k[0]], ws = person.w[k[1]];
      if (ww && ws && real) dz = (ww.z - ws.z) / person.w.sw;
    } else if (real) dz = (W.z - S.z) / u;
    return { x: w.x, y: w.y, real, e, head: (person.sh.y - j.nose.y) / u, dz, elbowUp: eOk && E.y < S.y, d };
  }

  function zoneOf(p, x, y) {
    if (y > p.head + 0.15 && p.elbowUp) return "oh";
    if (x > 1.1 || (p.real && x > 0.6 && p.dz > 0.6)) return "fh"; // wound back on the racket side / behind the shoulder line
    if (x < -0.65) return "bh";                                    // across the body
    // Elbow across the chest while the wrist is hidden behind the body (or also well across): backhand wind-up.
    if (p.e && p.e.x < -0.1 && p.e.y < p.head && (!p.real || x < -0.3)) return "bh";
    return null;
  }

  // Least-squares velocity over the last 3 samples (body units / s), using real frame times.
  function velocity() {
    const n = hist.length;
    if (n < 2) return null;
    const s = hist.slice(Math.max(0, n - 3));
    if ((s.at(-1).t - s[0].t) <= 15) return null;
    const mt = s.reduce((a, q) => a + q.t, 0) / s.length;
    const mx = s.reduce((a, q) => a + q.x, 0) / s.length;
    const my = s.reduce((a, q) => a + q.y, 0) / s.length;
    let stt = 0, stx = 0, sty = 0;
    for (const q of s) { const dt = (q.t - mt) / 1000; stt += dt * dt; stx += dt * (q.x - mx); sty += dt * (q.y - my); }
    if (stt <= 0) return null;
    return { vx: stx / stt, vy: sty / stt };
  }

  function push(person, t) {
    if (!Number.isFinite(t)) return null;
    if (t < lastT) reset();
    if (!person) { reset(); lastT = t; return null; }
    if (t - lastT > cfg.maxGap) reset();
    lastT = t;
    const p = local(person, t);
    // No usable wrist this frame. If a fast forward swing was already under way, it blurred out: fire it.
    if (!p) {
      stats.dropped++;
      missed = true;
      if (cand && cand.disp >= cfg.minDisp * 0.6 && enabled && !needReady) return fire(t);
      if (t - lastSample > cfg.maxGap) { prep = null; zoneSince = null; }
      return null;
    }
    if (p.real) stats.real++; else stats.filled++;
    if (p.e) {
      elbowV = elbowPrev && t - elbowPrev.t > 10 && t - elbowPrev.t <= 140 ? { vx: ((p.e.x - elbowPrev.x) * 1000) / (t - elbowPrev.t), vy: ((p.e.y - elbowPrev.y) * 1000) / (t - elbowPrev.t) } : null;
      elbowPrev = { t, x: p.e.x, y: p.e.y };
    } else { elbowV = null; elbowPrev = null; }
    // After a gap (missed frames, or simply a long pause between frames): never measure speed across it.
    if ((missed && t - lastSample > cfg.histGap) || t - lastSample > 250) clearMotion();
    missed = false;
    lastSample = t;
    const x = fx.filter(p.x, t), y = fy.filter(p.y, t);
    hist.push({ t, x, y, rx: p.x, ry: p.y, real: p.real });
    if (hist.length > 6) hist.shift();
    const v = velocity();
    const speed = v ? Math.hypot(v.vx, v.vy) : 0;
    // Noise: second difference of the raw wrist while the arm is slow (a smooth movement has almost none).
    // Updated on every frame outside a swing (gated on speed it would only ever see the quiet frames of a noisy
    // player); slow and clamped, so the few frames of a real swing barely move it.
    if (hist.length >= 3 && !cand) {
      const [h0, h1, h2] = hist.slice(-3);
      if (h0.real && h1.real && h2.real) {
        const e = Math.hypot(h2.rx - 2 * h1.rx + h0.rx, h2.ry - 2 * h1.ry + h0.ry) / 3.06;
        noiseN++;
        noise += noiseN < 25 ? (e - noise) / noiseN : 0.04 * (Math.min(e, noise * 2.5) - noise); // plain mean to start
      }
    }
    if (speed >= cfg.threshold) { stats.fast.push(Math.round(t)); if (stats.fast.length > 400) stats.fast.shift(); }
    const z = zoneOf(p, x, y);
    // READY: after a swing (or setup) the arm must come back to a calm spot in front before a new wind-up counts.
    // This stops follow-throughs, arm flapping and "lowering a raised hand" from turning into swings.
    const calm = !z && y < p.head && v && speed < cfg.threshold * 0.5;
    if (calm) { calmSince ??= t; if (needReady && t - calmSince >= cfg.readyHold) needReady = false; }
    else calmSince = null;
    const armed = enabled && !needReady;
    // Preparation tracking.
    if (z && armed) {
      if (!zoneSince || zoneSince.kind !== z) zoneSince = { kind: z, t };
      if (t - zoneSince.t >= cfg.prepHold) prep = { kind: z, last: t };
    } else zoneSince = null;
    if (prep && (!armed || (!z && t - prep.last > cfg.prepValid))) prep = null;
    if (z === "oh" || (prep && prep.kind === "oh")) { if (!top || y >= top.y - 0.05) top = { y: Math.max(y, top?.y ?? y), t }; }
    else top = null;
    if (t - lastSwing < cfg.cooldown || !v || !prep) { cand = null; return null; }
    const k = prep.kind;
    const dirOf = (vx, vy, sp) => (k === "fh" ? -vx > 0.35 * sp : k === "bh" ? vx > 0.35 * sp : -vy > 0.4 * sp);
    const okDir = dirOf(v.vx, v.vy, speed);
    const thr = k === "oh" ? cfg.threshold * cfg.ohMul : cfg.threshold;
    // The latest step must itself be moving the right way (a single jump, e.g. tracking snapping back after a gap,
    // can't carry the fit or the smoothing filter on its own).
    const a = hist[hist.length - 2], b = hist[hist.length - 1];
    const sdt = a ? (b.t - a.t) / 1000 : 0;
    const svx = sdt > 0 ? (b.rx - a.rx) / sdt : 0, svy = sdt > 0 ? (b.ry - a.ry) / sdt : 0, ssp = Math.hypot(svx, svy);
    const stepOk = sdt > 0 && ssp >= thr * 0.5 && dirOf(svx, svy, ssp); // raw (unfiltered) step
    // Speed now: the 3-sample fit lags the start of a swing, so a clearly fast raw step (both samples real) counts too.
    // Raw steps are only trusted when the landmark noise is well below the step (not for far, noisy players).
    const rawOk = a?.real && b.real && sdt > 0 && ssp * sdt >= noise * 1.41 * 4;
    const fast = speed >= thr * (rawOk ? cfg.fitMul : 1) && (speed >= thr || (rawOk && ssp >= thr));
    const now = Math.max(speed, rawOk ? ssp : 0);
    if (fast && okDir && stepOk && (z !== k || now >= thr * cfg.zoneMul)) {
      if (!cand) {
        // A bridged (guessed) wrist may continue a swing but only starts one when the real elbow is clearly swinging too
        // (backhands: the wrist hides behind the chest while the elbow leads the swing out).
        const es = elbowV ? Math.hypot(elbowV.vx, elbowV.vy) : 0;
        if (!p.real && !(elbowV && es >= thr * 0.45 && dirOf(elbowV.vx, elbowV.vy, es))) return null;
        const from = hist.length >= 2 ? hist[hist.length - 2] : hist[0];
        const o = hist[Math.max(0, hist.length - 3)]; // raw origin: just before the movement started
        cand = { kind: k, t0: from.t, x0: from.x, y0: from.y, rx0: o.rx, ry0: o.ry, n: 0, svx: 0, svy: 0, peak: 0, real: 0, disp: 0, top: from.y, p, settled: hist.length >= 3 };
      }
      cand.n++; cand.svx += v.vx; cand.svy += v.vy; cand.p = p; cand.real += p.real ? 1 : 0;
      cand.peak = Math.max(cand.peak, speed, p.real && b.real ? ssp * 0.9 : 0); // raw step: the fit lags at low frame rates
      cand.top = Math.max(cand.top, y);
      const fd = k === "fh" ? cand.x0 - x : k === "bh" ? x - cand.x0 : cand.y0 - y;
      const rd = k === "fh" ? cand.rx0 - b.rx : k === "bh" ? b.rx - cand.rx0 : cand.ry0 - b.ry; // raw: no filter lag
      cand.disp = cfg.onset && rawOk ? Math.max(fd, rd - noise * 1.41 * 2) : fd;
      cand.x = x; cand.y = y; cand.vx = v.vx; cand.vy = v.vy; cand.t = t;
      cand.raw = cfg.onset && rawOk ? { x: b.rx, y: b.ry, vx: svx } : null; // contact estimate from the raw wrist (no filter lag)
      // 15 fps or slower: one frame is enough, unless the history only just restarted after a gap.
      const slowFrames = cand.settled && hist.length >= 2 && t - hist[hist.length - 2].t >= 60;
      // Onset: the step before this one was already moving the same way and the arm is accelerating.
      const c0 = hist.length >= 3 ? hist[hist.length - 3] : null;
      const pdt = c0 ? (a.t - c0.t) / 1000 : 0;
      const pvx = pdt > 0 ? (a.rx - c0.rx) / pdt : 0, pvy = pdt > 0 ? (a.ry - c0.ry) / pdt : 0, psp = Math.hypot(pvx, pvy);
      const onset = cfg.onset && rawOk && cand.settled && c0.real && pdt > 0 && psp >= thr * 0.3 && dirOf(pvx, pvy, psp) && ssp >= psp * 0.9;
      if (cand.disp >= Math.max(cfg.minDisp, noise * 1.41 * 3) && (cand.n >= 2 || slowFrames || onset)) return fire(t);
      return null;
    }
    cand = null;
    return null;
  }

  function fire(t) {
    const s = cand;
    cand = null;
    prep = null;
    zoneSince = null;
    needReady = true;
    calmSince = null;
    lastSwing = t;
    const topNow = top;
    top = null;
    let kind = s.kind;
    if (kind === "oh" && serving) kind = "sv";
    // Direction: the raw path from where the swing started (no filter lag) when it's clean, else the mean fitted velocity.
    const useRaw = s.raw && Math.hypot(s.raw.x - s.rx0, s.raw.y - s.ry0) > noise * 6;
    const mvx = useRaw ? s.raw.x - s.rx0 : s.svx / s.n, mvy = useRaw ? s.raw.y - s.ry0 : s.svy / s.n;
    const mag = Math.hypot(mvx, mvy) || 1;
    // Aim (TV left..right). Ground strokes: a flat, across-the-body swing goes cross-court; a more
    // low-to-high swing goes down the line. Overheads go the way the wrist travels sideways.
    // (The TV adds timing on top: early pulls cross-court, late pushes down the line, like Wii-style tennis.)
    const d = s.p.d;
    const across = Math.abs(mvx) / mag;                       // 0.5..1 for ground strokes
    const line = clamp(1 - (2 * (across - 0.5)) / 0.5, -1, 1); // +1 = down the line, -1 = cross-court
    const dir = kind === "fh" ? d * line : kind === "bh" ? -d * line : clamp(((d * mvx) / mag) * 1.5, -1, 1);
    const lift = kind === "oh" || kind === "sv" ? 0 : clamp((mvy / mag) * 1.6, -1, 1); // low-to-high = topspin
    // Fired early in the swing, the arm hasn't reached full speed yet: the peak seen so far is ~0.75-0.85 of the
    // stroke's real peak on synthetic swings (30/15/10 fps), so scale it up.
    const peak = s.peak * 1.25;
    const power = clamp(0.2 + (0.8 * (peak - cfg.threshold)) / 12, 0, 1); // fixed span: a lower threshold (sensitivity) shouldn't max out every swing
    // When was (or will be) the contact? Ground strokes: when the wrist crosses the contact line in front of the body.
    // Overheads/serves: at the top, i.e. when the downswing started. ago = ms since then (0 if it's still ahead).
    let tc;
    if (s.kind === "oh") tc = topNow && topNow.t <= s.t0 ? topNow.t : s.t0;
    else {
      const cx = CONTACT_LX[s.kind];
      const vx = s.raw ? s.raw.vx : s.vx || mvx;
      const x0 = s.raw ? s.raw.x : s.x ?? s.x0;
      tc = Math.abs(vx) > 0.1 ? (s.t ?? t) + ((cx - x0) / vx) * 1000 : t;
      tc = Math.max(tc, s.t0);
    }
    const ago = Math.round(clamp(t - tc, -cfg.maxLead, 250));
    const c = clamp(0.35 * clamp((peak / cfg.threshold - 1) / 0.8, 0, 1) + 0.35 * clamp(s.disp / (cfg.minDisp * 2), 0, 1) + 0.3 * (s.real / s.n), 0, 1);
    const r2 = (v) => Math.round(v * 100) / 100;
    // ang: swing direction in degrees in the body frame (0 = straight across toward the front, + = upward); tests only, not sent.
    const ang = Math.round((Math.atan2(mvy, kind === "fh" ? -mvx : kind === "bh" ? mvx : Math.abs(mvx)) * 180) / Math.PI);
    return { kind, dir: r2(dir), power: r2(power), lift: r2(lift), speed: r2(peak), t, ago, c: r2(c), ang };
  }

  return {
    push,
    reset,
    setServing(v) { serving = !!v; },
    setHand(h) { cfg.hand = h === "left" ? "left" : "right"; reset(); },
    setThreshold(v) { if (Number.isFinite(v) && v > 1 && v < 20) cfg.threshold = v; },
    // Setup: while disabled nothing is prepared or fired. Enabling requires a calm arm first (so the hand you
    // just raised for setup can come down without counting as an overhead).
    setEnabled(v) { v = !!v; if (v === enabled) return; enabled = v; prep = null; zoneSince = null; cand = null; if (v) { needReady = true; calmSince = null; } },
    get enabled() { return enabled; },
    get ready() { return enabled && !needReady; },
    get config() { return { ...cfg, serving }; },
    get prep() { return prep ? prep.kind : null; },
    get stats() { return { ...stats, noise: Math.round(noise * 1000) / 1000, fast: stats.fast.slice() }; }
  };
}

// Which hand is raised above the head? Used in setup to learn each player's racket hand.
export function raisedHand(person) {
  if (!person) return null;
  const { j, unit, sh } = person;
  const headUp = (sh.y - j.nose.y) / unit + 0.25;
  const up = [[j.lSh, j.lWr], [j.rSh, j.rWr]].filter(([S, W]) => W && W.v >= 0.5 && (sh.y - W.y) / unit > headUp);
  if (up.length !== 1) return null;
  // Report the side of the body (mirrored view) so it matches the swing detector's racket arm.
  return Math.sign(up[0][0].x - sh.x) >= 0 ? "right" : "left";
}

function iou(a, b) {
  if (!a || !b) return 0;
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const i = ix * iy;
  const u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i;
  return u > 0 ? i / u : 0;
}
const sizeOf = (p) => p.torsoH ?? p.unit ?? null;

// Split people in one camera into slots. Slot 0 = the person on the left, slot 1 = on the right,
// then each slot follows its person (predicted hip position, body size and box overlap) so IDs don't swap when the
// detector reorders them and a passer-by can't take over. lock() (after setup) keeps each slot for its player:
// a lost slot only takes back someone of the same size near where the player was, or, after lostMs, someone
// who stays in that player's half of the picture for acquireMs.
export function createPoseTracker(opts = {}) {
  const slots = opts.slots ?? 2;
  const lostMs = opts.lostMs ?? 1000;
  const maxJump = opts.maxJump ?? 0.3;
  const acquireMs = opts.acquireMs ?? 500;
  const minSizeRatio = opts.minSizeRatio ?? 0.55; // smaller than this vs the biggest person = background
  let nextId = 1;
  let locked = false;
  const tracks = Array.from({ length: slots }, () => null); // { id, cx, vx, size, bbox, last, ghost }
  const pend = Array.from({ length: slots }, () => null);   // locked re-acquire candidates { cx, since }

  function cost(tr, p, t) {
    const dtS = Math.min(0.3, Math.max(0, (t - tr.last) / 1000));
    const pred = tr.cx + (tr.vx || 0) * dtS;
    const d = Math.abs(p.cx - pred);
    // Locked: a hidden player can only have moved so far (≈ walking pace), so a different person nearby isn't them.
    const reach = tr.ghost || locked ? Math.min(maxJump, 0.15, 0.05 + 0.35 * dtS) : maxJump;
    if (d > reach) return null;
    let c = d;
    const s = sizeOf(p);
    if (s && tr.size) {
      const r = s / tr.size;
      if (r < 0.65 || r > 1.55) return null;
      c += Math.abs(Math.log(r)) * 0.3;
    }
    if (p.bbox && tr.bbox) c += (1 - iou(p.bbox, tr.bbox)) * 0.1;
    return c;
  }
  function claim(s, p, t) {
    const tr = tracks[s];
    const dt = Math.max(1, t - tr.last);
    const vx = clamp((p.cx - tr.cx) / (dt / 1000), -3, 3);
    tr.vx = tr.ghost ? 0 : (tr.vx || 0) * 0.5 + vx * 0.5;
    tr.cx = p.cx; tr.last = t; tr.ghost = false;
    const sz = sizeOf(p);
    if (sz) tr.size = tr.size ? tr.size * 0.8 + sz * 0.2 : sz;
    if (p.bbox) tr.bbox = p.bbox;
  }
  const fresh = (p, t) => ({ id: nextId++, cx: p.cx, vx: 0, size: sizeOf(p), bbox: p.bbox || null, last: t, ghost: false });

  function update(people, t) {
    let list = (people || []).filter(Boolean);
    const big = Math.max(0, ...list.map((p) => sizeOf(p) || 0));
    if (big > 0) list = list.filter((p) => !sizeOf(p) || sizeOf(p) >= big * minSizeRatio);
    for (let s = 0; s < slots; s++) {
      const tr = tracks[s];
      if (tr && t - tr.last > lostMs) {
        if (locked) tr.ghost = true; // keep the player's slot, size and last place
        else tracks[s] = null;
      }
    }
    const out = Array.from({ length: slots }, (_, s) => ({ slot: s, id: tracks[s]?.id ?? null, person: null }));
    const used = new Set();
    // 1) Keep existing tracks: try every assignment and take the cheapest that keeps the most people.
    const live = tracks.map((tr, s) => (tr && !tr.ghost ? s : -1)).filter((s) => s >= 0);
    let best = { cost: Infinity, pairs: [] };
    const walk = (k, pairs, cost0) => {
      if (k === live.length) {
        const c = cost0 - pairs.length * 10;
        if (c < best.cost) best = { cost: c, pairs: [...pairs] };
        return;
      }
      const s = live[k];
      walk(k + 1, pairs, cost0);
      list.forEach((p, pi) => {
        if (used.has(pi)) return;
        const c = cost(tracks[s], p, t);
        if (c === null) return;
        used.add(pi); pairs.push([s, pi]);
        walk(k + 1, pairs, cost0 + c);
        used.delete(pi); pairs.pop();
      });
    };
    walk(0, [], 0);
    used.clear();
    for (const [s, pi] of best.pairs) {
      claim(s, list[pi], t);
      out[s] = { slot: s, id: tracks[s].id, person: list[pi] };
      used.add(pi);
    }
    const rest = list.map((_, i) => i).filter((i) => !used.has(i));
    if (locked) {
      // 2a) Locked: a lost slot takes back only a matching person (near the ghost) or, after a steady
      // acquireMs in that slot's half of the picture, someone of a similar size.
      for (let s = 0; s < slots; s++) {
        const tr = tracks[s];
        if (!tr || out[s].person) continue;
        const half = (p) => slots === 1 || (s === 0 ? p.cx < 0.5 : p.cx >= 0.5);
        let pick = null;
        for (const pi of rest) {
          if (used.has(pi)) continue;
          const p = list[pi];
          if (!half(p)) continue;
          const c = cost({ ...tr, ghost: true, vx: 0 }, p, t);
          if (c !== null && t - tr.last <= lostMs * 3) { pick = pi; break; }
          const sz = sizeOf(p);
          if (t - tr.last > lostMs && (!sz || !tr.size || sz >= tr.size * 0.7)) {
            if (pend[s] && Math.abs(pend[s].cx - p.cx) < 0.1) { if (t - pend[s].since >= acquireMs) { pick = pi; break; } pend[s].cx = p.cx; }
            else pend[s] = { cx: p.cx, since: t };
          }
        }
        if (pick !== null) {
          claim(s, list[pick], t);
          pend[s] = null;
          used.add(pick);
          out[s] = { slot: s, id: tr.id, person: list[pick] };
        }
      }
      return out;
    }
    // 2b) Setup (unlocked): new people take free slots, biggest first, then left to right.
    const freshIdx = rest.sort((a, b) => (sizeOf(list[b]) || 0) - (sizeOf(list[a]) || 0));
    const free = tracks.map((tr, s) => (tr ? -1 : s)).filter((s) => s >= 0);
    const take = freshIdx.slice(0, free.length).sort((a, b) => list[a].cx - list[b].cx);
    if (slots === 2 && take.length === 1 && free.length === 2) {
      const s = list[take[0]].cx < 0.5 ? 0 : 1;
      tracks[s] = fresh(list[take[0]], t);
      out[s] = { slot: s, id: tracks[s].id, person: list[take[0]] };
    } else {
      take.forEach((pi, k) => {
        const s = free[k];
        if (s === undefined) return;
        tracks[s] = fresh(list[pi], t);
        out[s] = { slot: s, id: tracks[s].id, person: list[pi] };
      });
    }
    return out;
  }
  return {
    update,
    lock() { locked = true; },
    unlock() { locked = false; },
    get locked() { return locked; },
    get tracks() { return tracks.map((t) => (t ? { ...t } : null)); },
    reset() { tracks.fill(null); pend.fill(null); locked = false; }
  };
}

// Map a person's hip x (0..1, mirrored) to -1..1 for their slot. 1 player: most of the frame. 2 players: own half.
export function slotX(cx, slot, slots) {
  const [lo, hi] = slots === 1 ? [0.15, 0.85] : slot === 0 ? [0.05, 0.47] : [0.53, 0.95];
  return clamp(((cx - lo) / (hi - lo)) * 2 - 1, -1, 1);
}
