// The TV's gatekeeper for phone packets. The phone only ever reports hand position and swings;
// the TV decides hits and scores. Anything malformed, out of range or too frequent is dropped.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const MENU_KEYS = ["up", "down", "left", "right", "a", "b", "pause", "practice", "match", "rally", "menu", "restart"];

export function createPacketGate(opts = {}) {
  const now = opts.now || (() => performance.now());
  const posMaxPerSec = opts.posMaxPerSec ?? 90;
  const swingMinGap = opts.swingMinGap ?? 250;
  const stats = { accepted: 0, dropped: 0, reasons: {} };
  let posTokens = posMaxPerSec;
  let lastRefill = now();
  let lastSwing = -1e9;
  let lastMenu = -1e9;

  const drop = (why) => { stats.dropped++; stats.reasons[why] = (stats.reasons[why] || 0) + 1; return null; };
  const ok = (m) => { stats.accepted++; return m; };

  function accept(msg) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return drop("shape");
    if (typeof msg.t !== "string" || msg.t.length > 8) return drop("type");
    const t = now();
    switch (msg.t) {
      case "pos": {
        const elapsed = (t - lastRefill) / 1000;
        lastRefill = t;
        posTokens = Math.min(posMaxPerSec, posTokens + elapsed * posMaxPerSec);
        if (posTokens < 1) return drop("rate");
        posTokens -= 1;
        const x = num(msg.x);
        const y = num(msg.y);
        if (x === null) return drop("value");
        return ok({ t: "pos", x: clamp(x, -1, 1), y: y === null ? 0 : clamp(y, -1, 1), v: msg.v !== false });
      }
      case "swing": {
        const dir = num(msg.dir);
        const spd = num(msg.spd);
        if (dir === null || spd === null) return drop("value");
        if (t - lastSwing < swingMinGap) return drop("rate");
        lastSwing = t;
        return ok({ t: "swing", dir: clamp(dir, -1, 1), spd: clamp(spd, 0, 1) });
      }
      case "vis":
        if (typeof msg.v !== "boolean") return drop("value");
        return ok({ t: "vis", v: msg.v });
      case "cal": {
        const step = num(msg.step);
        if (step === null || step < 0 || step > 6) return drop("value");
        return ok({ t: "cal", step: Math.round(step) });
      }
      case "menu":
        if (typeof msg.k !== "string" || !MENU_KEYS.includes(msg.k)) return drop("value");
        if (t - lastMenu < 120) return drop("rate");
        lastMenu = t;
        return ok({ t: "menu", k: msg.k });
      case "mode":
        if (msg.m !== "motion" && msg.m !== "camera") return drop("value");
        return ok({ t: "mode", m: msg.m });
      case "hello":
      case "ping":
        return ok({ t: msg.t });
      default:
        return drop("type");
    }
  }

  return { accept, stats };
}
