// The TV's gatekeeper for phone packets. The phone only ever reports positions, visibility and swings;
// the TV decides hits and scores. Anything malformed, out of range or too frequent is dropped.
// One gate per phone connection. A body-camera phone can drive 2 players, so pos/swing/vis carry an
// optional slot `s` (0 or 1) and each slot has its own rate limits.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const MENU_KEYS = ["up", "down", "left", "right", "a", "b", "pause", "practice", "match", "rally", "menu", "restart", "match2", "rally2", "doubles", "training", "target"];
export const SWING_KINDS = ["fh", "bh", "oh", "sv"];
export const PHONE_MODES = ["body"];

export function createPacketGate(opts = {}) {
  const now = opts.now || (() => performance.now());
  const posMaxPerSec = opts.posMaxPerSec ?? 90;
  const swingMinGap = opts.swingMinGap ?? 250;
  const stats = { accepted: 0, dropped: 0, reasons: {} };
  const slots = [0, 1].map(() => ({ tokens: posMaxPerSec, refill: now(), lastSwing: -1e9 }));
  let lastMenu = -1e9;

  const drop = (why) => { stats.dropped++; stats.reasons[why] = (stats.reasons[why] || 0) + 1; return null; };
  const ok = (m) => { stats.accepted++; return m; };
  const withSlot = (out, msg, s) => (msg.s === undefined ? out : { ...out, s });
  const slotOf = (msg) => {
    if (msg.s === undefined) return 0;
    return msg.s === 0 || msg.s === 1 ? msg.s : null;
  };

  function accept(msg) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return drop("shape");
    if (typeof msg.t !== "string" || msg.t.length > 8) return drop("type");
    const t = now();
    switch (msg.t) {
      case "pos": {
        const s = slotOf(msg);
        if (s === null) return drop("value");
        const sl = slots[s];
        const elapsed = (t - sl.refill) / 1000;
        sl.refill = t;
        sl.tokens = Math.min(posMaxPerSec, sl.tokens + elapsed * posMaxPerSec);
        if (sl.tokens < 1) return drop("rate");
        sl.tokens -= 1;
        const x = num(msg.x);
        const y = num(msg.y);
        if (x === null) return drop("value");
        return ok(withSlot({ t: "pos", x: clamp(x, -1, 1), y: y === null ? 0 : clamp(y, -1, 1), v: msg.v !== false }, msg, s));
      }
      case "swing": {
        const s = slotOf(msg);
        const dir = num(msg.dir);
        const spd = num(msg.spd);
        if (s === null || dir === null || spd === null) return drop("value");
        if (msg.k !== undefined && !SWING_KINDS.includes(msg.k)) return drop("value");
        const sl = slots[s];
        if (t - sl.lastSwing < swingMinGap) return drop("rate");
        sl.lastSwing = t;
        const out = withSlot({ t: "swing", dir: clamp(dir, -1, 1), spd: clamp(spd, 0, 1) }, msg, s);
        if (msg.k) out.k = msg.k;
        const lift = num(msg.lift);
        if (lift !== null) out.lift = clamp(lift, -1, 1);
        // Body-camera extras (all optional): ago = ms since the estimated contact (the TV backdates the swing by it),
        // c = detector confidence 0..1, n = per-slot swing counter.
        const ago = num(msg.ago);
        if (ago !== null) out.ago = Math.round(clamp(ago, 0, 300));
        const c = num(msg.c);
        if (c !== null) out.c = clamp(c, 0, 1);
        const n = num(msg.n);
        if (n !== null && n >= 0) out.n = Math.floor(Math.min(n, 1e9));
        return ok(out);
      }
      case "vis": {
        const s = slotOf(msg);
        if (s === null || typeof msg.v !== "boolean") return drop("value");
        return ok(withSlot({ t: "vis", v: msg.v }, msg, s));
      }
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
      case "mode": {
        if (!PHONE_MODES.includes(msg.m)) return drop("value");
        const out = { t: "mode", m: msg.m };
        if (msg.m === "body") out.n = msg.n === 2 ? 2 : 1; // people this camera tracks
        return ok(out);
      }
      case "hello":
      case "ping":
        return ok({ t: msg.t });
      default:
        return drop("type");
    }
  }

  return { accept, stats };
}

// Player slot map: each phone connection gets player ids. Body cameras with 2 people take 2 ids,
// everything else takes 1. Lowest free ids first, so camera 1 = Players 1+2 and camera 2 = Players 3+4.
// At most 2 camera phones at once.
export function createSlotMap(maxPlayers = 4, maxCameras = 2) {
  const conns = new Map(); // from -> { kind, players: [ids], cam }
  function used() { return new Set([...conns.values()].flatMap((c) => c.players)); }
  function assign(from, kind, n = 1) {
    const prev = conns.get(from);
    if (prev && prev.kind === kind && prev.players.length === n) return prev;
    conns.delete(from);
    const isCam = kind === "body" || kind === "camera";
    const cams = [...conns.values()].filter((c) => c.cam).map((c) => c.cam);
    if (isCam && cams.length >= maxCameras) return { error: "full", players: [] };
    const u = used();
    const free = [];
    for (let i = 0; i < maxPlayers && free.length < n; i++) if (!u.has(i)) free.push(i);
    if (free.length < n) return { error: "full", players: [] };
    const cam = isCam ? [1, 2].find((c) => !cams.includes(c)) : 0;
    const entry = { kind, players: free, cam };
    conns.set(from, entry);
    return entry;
  }
  return {
    assign,
    get: (from) => conns.get(from) || null,
    player: (from, s = 0) => conns.get(from)?.players[s] ?? null,
    release: (from) => conns.delete(from),
    all: () => [...conns.entries()].map(([from, c]) => ({ from, ...c })),
    clear: () => conns.clear()
  };
}
