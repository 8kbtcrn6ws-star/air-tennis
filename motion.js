// Motion-sensor racket for "Swing your phone" mode. Feed it DeviceMotion samples and it reports
// discrete swings plus a tilt-based aim. Pure logic; phone.js wires it to the real sensors.
// Units follow the DeviceMotion spec: rotationRate in deg/s, acceleration in m/s^2.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const SENSITIVITY = {
  easier: { rate: 230, accel: 9 },
  normal: { rate: 360, accel: 13 },
  harder: { rate: 560, accel: 20 }
};

export function createMotionSwingDetector(opts = {}) {
  let sens = SENSITIVITY[opts.sensitivity] ? opts.sensitivity : "normal";
  const cooldown = opts.cooldown ?? 400;
  const peakHold = opts.peakHold ?? 80;
  let forehand = null; // unit rotation vector of a calibrated forehand swing
  let lastSwing = -1e9;
  let arming = null;
  let lastT = null;

  function score(s) {
    const th = SENSITIVITY[sens];
    const r = s.rotationRate || {};
    const a = s.acceleration || {};
    const w = { a: num(r.alpha), b: num(r.beta), g: num(r.gamma) };
    const rate = Math.hypot(w.a, w.b, w.g);
    const acc = Math.hypot(num(a.x), num(a.y), num(a.z));
    return { w, rate, acc, k: Math.max(rate / th.rate, acc / th.accel) };
  }

  function push(s) {
    if (!s || !Number.isFinite(s.t)) return null;
    if (lastT !== null && s.t < lastT) { arming = null; }
    lastT = s.t;
    const m = score(s);
    if (!Number.isFinite(m.k)) return null;
    if (s.t - lastSwing < cooldown) { arming = null; return null; }
    if (!arming) {
      if (m.k >= 1) arming = { since: s.t, peak: m };
      return null;
    }
    if (m.k > arming.peak.k) arming.peak = m;
    if (m.k < arming.peak.k * 0.8 || s.t - arming.since >= peakHold) {
      const p = arming.peak;
      arming = null;
      lastSwing = s.t;
      let side = 0;
      if (forehand && p.rate > 1) {
        side = clamp((p.w.a * forehand.a + p.w.b * forehand.b + p.w.g * forehand.g) / p.rate, -1, 1);
      }
      const power = clamp(0.2 + 0.8 * (p.k - 1) / 2.5, 0, 1);
      return { side: round(side), power: round(power), rate: Math.round(p.rate), t: s.t, vec: { a: p.w.a, b: p.w.b, g: p.w.g } };
    }
    return null;
  }

  return {
    push,
    setSensitivity(v) { if (SENSITIVITY[v]) sens = v; },
    get sensitivity() { return sens; },
    // Remember which way a forehand rotates the phone, from a calibration swing.
    calibrateForehand(vec) {
      const n = Math.hypot(vec.a, vec.b, vec.g);
      if (n > 1) forehand = { a: vec.a / n, b: vec.b / n, g: vec.g / n };
      return !!forehand;
    },
    get calibrated() { return !!forehand; }
  };
}

// Aim from how far the phone is tilted sideways, using the gravity vector (accelerationIncludingGravity).
// Low-passed so swings don't jerk the player; centre is captured during calibration.
export function createTiltAim(opts = {}) {
  const range = opts.range ?? 5.6; // m/s^2 of sideways gravity for full left/right (about 35 degrees)
  let centre = 0;
  let smooth = null;
  return {
    push(gx) {
      if (!Number.isFinite(gx)) return smooth === null ? 0 : value();
      smooth = smooth === null ? gx : smooth + (gx - smooth) * 0.25;
      return value();
    },
    centreNow() { if (smooth !== null) centre = smooth; },
    get raw() { return smooth; },
    get x() { return value(); }
  };
  function value() { return clamp(((smooth ?? centre) - centre) / range, -1, 1); }
}

function num(v) { return typeof v === "number" && Number.isFinite(v) ? v : 0; }
function round(v) { return Math.round(v * 100) / 100; }
