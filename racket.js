// Phone-as-racket swing detector. Pure logic (no DOM), shared by phone.js and the Node tests.
// Feed it DeviceMotion samples: { t: ms, rr: {alpha, beta, gamma} deg/s, a: {x,y,z} m/s^2 without gravity,
// g: {x,y,z} m/s^2 including gravity }. Device axes (W3C): x = right of the screen, y = top of the screen,
// z = out of the screen; rotationRate.beta is about x, gamma about y, alpha about z.
//
// A swing = the phone rotating fast (peak angular speed over a threshold) with a real acceleration peak,
// sweeping a decent angle. Twitches, walking and picking the phone up don't get there.
// Stroke type comes from the rotation axis at the peak, measured against "up" (gravity just before the swing):
//   mostly about the vertical axis  -> forehand / backhand (sign of the spin, set by a practice forehand)
//   mostly about a horizontal axis  -> overhead, or serve if the top of the phone pointed down at the start
//                                      (racket dropped behind the back)
// Power = peak angular speed. Timing = the moment of the peak (sent as `ago`, ms before the packet leaves).

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const r2 = (v) => Math.round(v * 100) / 100;
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const len = (p) => Math.hypot(p[0], p[1], p[2]);

// rate: deg/s to start a swing; accel: m/s^2 the linear acceleration must reach; full: deg/s for full power.
export const RACKET_SENS = {
  easier: { rate: 220, accel: 6, full: 900 },
  normal: { rate: 300, accel: 8, full: 1100 },
  harder: { rate: 420, accel: 11, full: 1400 }
};

export function createRacketDetector(opts = {}) {
  const cfg = {
    sens: RACKET_SENS[opts.sens] ? opts.sens : "normal",
    cooldown: opts.cooldown ?? 350,   // ms between swings
    minSweep: opts.minSweep ?? 30,    // degrees the phone must turn during the swing
    minDur: opts.minDur ?? 30,        // ms above the start threshold
    maxHold: opts.maxHold ?? 220,     // ms after the start before a decision is forced
    maxGap: opts.maxGap ?? 250        // ms without samples resets everything
  };
  let hand = opts.hand === -1 ? -1 : 1; // +1: a forehand spins positive about "up" (right-handed, usual grip)
  let up = [0, 1, 0];                    // gravity direction in device axes (EMA while calm)
  let gSmooth = null;
  let lastT = null;
  let lastSwing = -1e9;
  let arm = null;
  let enabled = opts.enabled ?? true;
  // accelerationIncludingGravity points "up" on Android/Chrome but the other way on iOS Safari. The hold-still
  // step (phone upright, top up) sets this from the reading; until then iOS is assumed from the user agent.
  let gSign = opts.gSign === -1 ? -1 : 1;

  function sample(s) {
    const w = [num(s.rr?.beta), num(s.rr?.gamma), num(s.rr?.alpha)];
    const a = s.a ? [num(s.a.x), num(s.a.y), num(s.a.z)] : null;
    const g = s.g ? [gSign * num(s.g.x), gSign * num(s.g.y), gSign * num(s.g.z)] : null;
    return { t: s.t, w, rate: len(w), a, acc: a ? len(a) : 0, g };
  }

  function trackUp(m) {
    if (!m.g || len(m.g) < 4) return;
    // Only learn "up" while the phone is fairly calm, so a swing's own centripetal pull doesn't bend it.
    if (m.rate > 90 || (m.a && m.acc > 3)) return;
    gSmooth = gSmooth ? gSmooth.map((v, i) => v + (m.g[i] - v) * 0.2) : m.g.slice();
    const n = len(gSmooth);
    if (n > 4) up = gSmooth.map((v) => v / n);
  }

  function decide(t) {
    const A = arm;
    arm = null;
    const th = RACKET_SENS[cfg.sens];
    if (A.above < cfg.minDur || A.sweep < cfg.minSweep || A.maxAcc < th.accel) return null;
    lastSwing = t;
    const p = A.peak;
    const u = A.up;
    const wv = dot(p.w, u);
    const fv = Math.abs(wv) / Math.max(1, p.rate); // 1 = pure vertical-axis spin (ground stroke)
    let kind;
    if (fv >= 0.6) kind = Math.sign(wv) === hand ? "fh" : "bh";
    else kind = A.topUp < -0.2 ? "sv" : "oh";
    const power = clamp(0.2 + 0.8 * (p.rate - th.rate) / Math.max(1, th.full - th.rate), 0.15, 1);
    // Topspin: the racket rising through the swing (linear acceleration along "up"), slice: falling.
    const lift = A.nA ? clamp(A.upAcc / A.nA / 5, -1, 1) : 0.3;
    const purity = Math.abs(fv - 0.6) / 0.4;
    const c = clamp(0.45 + 0.3 * Math.min(1, (p.rate / th.rate - 1) / 1.5) + 0.25 * Math.min(1, purity), 0, 1);
    return {
      kind, power: r2(power), dir: 0, lift: r2(kind === "oh" || kind === "sv" ? 0 : lift), c: r2(c),
      peakT: p.t, t, rate: Math.round(p.rate), sweep: Math.round(A.sweep), yaw: Math.sign(wv) || 1, fv: r2(fv)
    };
  }

  function push(raw) {
    if (!raw || !Number.isFinite(raw.t)) return null;
    const m = sample(raw);
    if (lastT !== null && (m.t < lastT || m.t - lastT > cfg.maxGap)) arm = null;
    const dt = lastT === null ? 0 : Math.min(cfg.maxGap, Math.max(0, m.t - lastT)) / 1000;
    lastT = m.t;
    const th = RACKET_SENS[cfg.sens];
    if (!arm) trackUp(m);
    if (!enabled) { arm = null; return null; }
    if (m.t - lastSwing < cfg.cooldown) { arm = null; return null; }
    if (!arm) {
      if (m.rate < th.rate) return null;
      const topUp = gSmooth ? gSmooth[1] / Math.max(1, len(gSmooth)) : 1;
      arm = { since: m.t, peak: m, sweep: m.rate * dt, above: 0, maxAcc: m.acc, up: up.slice(), topUp, upAcc: 0, nA: 0, lastAbove: m.t };
      if (m.a) { arm.upAcc += dot(m.a, arm.up); arm.nA++; }
      return null;
    }
    arm.sweep += m.rate * dt;
    if (m.rate >= th.rate) { arm.above += m.t - arm.lastAbove; arm.lastAbove = m.t; }
    arm.maxAcc = Math.max(arm.maxAcc, m.acc);
    if (m.a) { arm.upAcc += dot(m.a, arm.up); arm.nA++; }
    if (m.rate > arm.peak.rate) arm.peak = m;
    // Decide once the spin has clearly dropped off its peak (the contact moment is behind us), or after maxHold.
    if (m.rate < arm.peak.rate * 0.55 || m.t - arm.since >= cfg.maxHold) return decide(m.t);
    return null;
  }

  return {
    push,
    setSens(v) { if (RACKET_SENS[v]) cfg.sens = v; },
    setEnabled(v) { enabled = !!v; if (!enabled) arm = null; },
    setGravitySign(v) { if (v === 1 || v === -1) { gSign = v; gSmooth = null; up = [0, 1, 0]; } },
    get gravitySign() { return gSign; },
    setHand(h) { hand = h === -1 ? -1 : 1; },
    // A practice forehand tells us which way a forehand spins for this person and grip (handedness included).
    calibrateForehand(sw) { if (sw && (sw.yaw === 1 || sw.yaw === -1)) hand = sw.yaw; return hand; },
    reset() { arm = null; lastT = null; },
    get hand() { return hand; },
    get up() { return up.slice(); },
    get config() { return { ...cfg }; }
  };
}

// "Hold still" step of the setup: the phone must be calm for `ms` (no spin, no shaking, gravity present).
export function createStillCheck(opts = {}) {
  const ms = opts.ms ?? 800;
  let since = null;
  let gy = 0, n = 0;
  return {
    // Sign of the gravity reading along the phone's long axis while held still, top up: +1 Android, -1 iOS.
    get gravitySign() { return n && Math.abs(gy / n) > 3 ? Math.sign(gy) : 0; },
    push(raw) {
      const w = Math.hypot(num(raw.rr?.alpha), num(raw.rr?.beta), num(raw.rr?.gamma));
      const a = raw.a ? Math.hypot(num(raw.a.x), num(raw.a.y), num(raw.a.z)) : 0;
      const calm = w < 25 && a < 1.2;
      if (!calm) { since = null; gy = 0; n = 0; return false; }
      since ??= raw.t;
      if (raw.g && Number.isFinite(raw.g.y)) { gy += raw.g.y; n++; }
      return raw.t - since >= ms;
    },
    reset() { since = null; gy = 0; n = 0; }
  };
}

// DeviceMotionEvent -> sample. Event times share performance.now()'s clock in current browsers.
export function sampleFromEvent(e, t = e.timeStamp || performance.now()) {
  const rr = e.rotationRate || {};
  const a = e.acceleration;
  const g = e.accelerationIncludingGravity;
  return {
    t,
    rr: { alpha: rr.alpha, beta: rr.beta, gamma: rr.gamma },
    a: a && a.x !== null && a.x !== undefined ? { x: a.x, y: a.y, z: a.z } : null,
    g: g && g.x !== null && g.x !== undefined ? { x: g.x, y: g.y, z: g.z } : null
  };
}
