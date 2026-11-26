// Swing detector for the phone. Feed it the wrist position from the camera (0..1, mirrored so
// x grows toward the player's right on screen) and it reports discrete swings.
// A swing = the wrist moving faster than a threshold. Direction = how sideways the sweep was,
// power = how fast. Shared by phone.js and the Node tests.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createSwingDetector(opts = {}) {
  const cfg = {
    threshold: opts.threshold ?? 1.5,   // frame widths per second
    window: opts.window ?? 110,         // ms of history used for velocity
    peakHold: opts.peakHold ?? 60,      // ms to wait for the peak after crossing
    cooldown: opts.cooldown ?? 400,     // ms between swings
    maxGap: opts.maxGap ?? 350          // ms gap that resets history (lost tracking)
  };
  let hist = [];
  let lastSwing = -1e9;
  let arming = null; // { since, peak, vx, vy }

  function velocity() {
    if (hist.length < 2) return null;
    const a = hist[0];
    const b = hist[hist.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0.015) return null;
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }

  function push(x, y, t) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) return null;
    const last = hist[hist.length - 1];
    if (last && (t - last.t > cfg.maxGap || t < last.t)) { hist = []; arming = null; }
    hist.push({ x, y, t });
    while (hist.length > 2 && t - hist[0].t > cfg.window) hist.shift();
    const v = velocity();
    if (!v) return null;
    const speed = Math.hypot(v.vx, v.vy);
    if (t - lastSwing < cfg.cooldown) { arming = null; return null; }
    if (!arming) {
      if (speed >= cfg.threshold) arming = { since: t, peak: speed, vx: v.vx, vy: v.vy };
      return null;
    }
    if (speed > arming.peak) Object.assign(arming, { peak: speed, vx: v.vx, vy: v.vy });
    const falling = speed < arming.peak * 0.85;
    if (falling || t - arming.since >= cfg.peakHold) {
      const a = arming;
      arming = null;
      lastSwing = t;
      const dir = clamp((a.vx / a.peak) * 1.25, -1, 1);
      const power = clamp(0.2 + 0.8 * (a.peak - cfg.threshold) / (cfg.threshold * 2), 0, 1);
      return { dir: Math.round(dir * 100) / 100, power: Math.round(power * 100) / 100, speed: Math.round(a.peak * 100) / 100, t };
    }
    return null;
  }

  return {
    push,
    reset() { hist = []; arming = null; },
    setThreshold(v) { if (Number.isFinite(v) && v > 0.3 && v < 6) cfg.threshold = v; },
    get config() { return { ...cfg }; }
  };
}

// Maps raw hand x (0..1) to racket position -1..1 using the calibrated left/right range.
export function mapX(x, range = { min: 0.2, max: 0.8 }) {
  const span = Math.max(0.1, range.max - range.min);
  return clamp(((x - range.min) / span) * 2 - 1, -1, 1);
}
