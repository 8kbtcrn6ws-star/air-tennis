// Body tracking helpers for the phone camera (MediaPipe PoseLandmarker output). Pure JS, unit-tested in Node.
//  - personFrom(landmarks): picks the joints we use and mirrors x (so your right is the screen's right).
//  - createPoseSwingDetector(): preparation -> forward swing -> forehand / backhand / overhead / serve.
//  - createPoseTracker(): up to 2 people in one camera, stable IDs, left person = slot 0.
// Landmarks are normalised image coords (0..1). Distances are measured in "body units" (≈ shoulder width)
// so it works the same near or far from the phone.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const LM = { nose: 0, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lHip: 23, rHip: 24, lKn: 25, rKn: 26, lAn: 27, rAn: 28 };
const vis = (p) => (p ? (p.visibility ?? 1) : 0);

// Mirror and pick joints. Returns null when the upper body isn't visible.
export function personFrom(lms, minVis = 0.5) {
  if (!Array.isArray(lms) || lms.length < 29) return null;
  const m = (i) => { const p = lms[i]; return p ? { x: 1 - p.x, y: p.y, z: p.z || 0, v: vis(p) } : null; };
  const j = {};
  for (const [k, i] of Object.entries(LM)) j[k] = m(i);
  // MediaPipe "left/right" is the person's own side. After mirroring, the person's right is on screen right.
  if (j.lSh.v < minVis || j.rSh.v < minVis) return null;
  const hipsOk = j.lHip.v >= minVis && j.rHip.v >= minVis;
  const sh = { x: (j.lSh.x + j.rSh.x) / 2, y: (j.lSh.y + j.rSh.y) / 2 };
  const hip = hipsOk ? { x: (j.lHip.x + j.rHip.x) / 2, y: (j.lHip.y + j.rHip.y) / 2 } : { x: sh.x, y: sh.y + 0.25 };
  const sw = Math.abs(j.rSh.x - j.lSh.x);
  const torso = Math.hypot(hip.x - sh.x, hip.y - sh.y);
  const unit = Math.max(sw, torso * 0.62, 0.02);
  const feet = j.lAn.v >= minVis && j.rAn.v >= minVis;
  const knees = j.lKn.v >= minVis && j.rKn.v >= minVis;
  return { j, sh, hip, unit, cx: hip.x, hipsOk, knees, feet, full: hipsOk && knees && feet };
}

export const POSE_THRESH = { easier: 4.5, normal: 6, harder: 8 }; // body units per second

export function createPoseSwingDetector(opts = {}) {
  const cfg = {
    hand: opts.hand === "left" ? "left" : "right",
    threshold: opts.threshold ?? POSE_THRESH.normal,
    window: opts.window ?? 100,     // ms used for wrist velocity
    prepHold: opts.prepHold ?? 50,  // ms the wrist must sit in a preparation zone
    prepValid: opts.prepValid ?? 700, // ms a preparation stays "loaded" after leaving the zone
    peakHold: opts.peakHold ?? 90,
    cooldown: opts.cooldown ?? 450,
    maxGap: opts.maxGap ?? 300
  };
  let serving = false;
  let hist = [];
  let prep = null;      // { kind, since, last }
  let zoneSince = null; // { kind, t }
  let arming = null;
  let lastSwing = -1e9;
  let lastT = -1e9;

  function reset() { hist = []; prep = null; zoneSince = null; arming = null; }

  // The racket arm is picked by which side of the body its shoulder is on (in the mirrored view), not by
  // the detector's left/right label: pose models sometimes flip front/back and swap the labels.
  // Players face the phone, so a right-hander's racket shoulder is on the right of the mirrored picture.
  function racketArm(person) {
    const j = person.j;
    const side = cfg.hand === "right" ? 1 : -1;
    const chains = [{ S: j.lSh, E: j.lEl, W: j.lWr }, { S: j.rSh, E: j.rEl, W: j.rWr }];
    const bySide = chains.filter((c) => Math.sign(c.S.x - person.sh.x) === side);
    return { arm: bySide.length === 1 ? bySide[0] : chains[side > 0 ? 1 : 0], d: side };
  }

  // Wrist position in the body frame: lx > 0 = out on the racket side, ly > 0 = up.
  function local(person) {
    const { arm, d } = racketArm(person);
    const { W, E, S } = arm;
    const j = person.j;
    if (!W || !E || W.v < 0.5 || E.v < 0.5) return null;
    const u = person.unit;
    return {
      lx: (d * (W.x - person.sh.x)) / u,
      ly: (person.sh.y - W.y) / u,
      head: (person.sh.y - j.nose.y) / u,
      dz: (W.z - S.z) / u,
      elbowUp: E.y < S.y,
      fx: W.x - E.x, fy: W.y - E.y, d
    };
  }

  function zoneOf(p) {
    if (p.ly > p.head + 0.15 && p.elbowUp) return "oh";
    if (p.lx > 1.1 || (p.lx > 0.6 && p.dz > 0.6)) return "fh"; // wound back on the racket side / behind the shoulder line
    if (p.lx < -0.85) return "bh";                              // across the body past the other shoulder
    return null;
  }

  function push(person, t) {
    if (!Number.isFinite(t)) return null;
    if (!person) { reset(); lastT = t; return null; }
    const p = local(person);
    // A blurry frame (fast swings blur!) lowers the wrist's confidence: skip it but keep the wind-up.
    // No body, or no usable wrist for longer than maxGap, resets everything.
    // If the wrist blurs out right after a fast forward swing started, the swing is done: fire with what we saw.
    if (!p) {
      if (arming) return fire(t);
      if (t - lastT > cfg.maxGap) reset();
      return null;
    }
    if (t - lastT > cfg.maxGap || t < lastT) reset();
    lastT = t;
    // Preparation tracking.
    const z = zoneOf(p);
    if (z) {
      if (!zoneSince || zoneSince.kind !== z) zoneSince = { kind: z, t };
      if (t - zoneSince.t >= cfg.prepHold) prep = { kind: z, last: t };
    } else zoneSince = null;
    if (prep && !z && t - prep.last > cfg.prepValid) prep = null;
    // Velocity in body units / second.
    hist.push({ lx: p.lx, ly: p.ly, t, p });
    while (hist.length > 2 && t - hist[0].t > cfg.window) hist.shift();
    if (hist.length < 2) return null;
    const a = hist[0], b = hist[hist.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0.015) return null;
    const vx = (b.lx - a.lx) / dt, vy = (b.ly - a.ly) / dt;
    const speed = Math.hypot(vx, vy);
    if (t - lastSwing < cfg.cooldown) { arming = null; return null; }
    if (!arming) {
      if (speed < cfg.threshold || !prep) return null;
      // The forward swing must come out of the preparation, in the right direction.
      const k = prep.kind;
      const okDir = k === "fh" ? -vx > 0.35 * speed : k === "bh" ? vx > 0.35 * speed : -vy > 0.4 * speed;
      if (!okDir || z === k) return null;
      arming = { since: t, peak: speed, vx, vy, kind: k, p };
      return null;
    }
    if (speed > arming.peak) Object.assign(arming, { peak: speed, vx, vy, p });
    if (speed < arming.peak * 0.85 || t - arming.since >= cfg.peakHold) return fire(t);
    return null;
  }

  function fire(t) {
    const s = arming;
    arming = null;
    prep = null;
    zoneSince = null;
    lastSwing = t;
    let kind = s.kind;
    if (kind === "oh" && serving) kind = "sv";
    // Aim (TV left..right). Ground strokes: a flat, across-the-body swing goes cross-court; a more
    // low-to-high swing goes down the line. Overheads go the way the wrist travels sideways.
    // (The TV adds timing on top: early pulls cross-court, late pushes down the line, like Wii-style tennis.)
    const d = s.p.d;
    const across = Math.abs(s.vx) / s.peak;                  // 0.5..1 for ground strokes
    const line = clamp(1 - (2 * (across - 0.5)) / 0.5, -1, 1); // +1 = down the line, -1 = cross-court
    const dir = kind === "fh" ? d * line : kind === "bh" ? -d * line : clamp(((d * s.vx) / s.peak) * 1.5, -1, 1);
    const lift = kind === "oh" || kind === "sv" ? 0 : clamp((s.vy / s.peak) * 1.6, -1, 1); // low-to-high = topspin
    const power = clamp(0.2 + (0.8 * (s.peak - cfg.threshold)) / (cfg.threshold * 1.5), 0, 1);
    const r2 = (v) => Math.round(v * 100) / 100;
    return { kind, dir: r2(dir), power: r2(power), lift: r2(lift), speed: r2(s.peak), t };
  }

  return {
    push,
    reset,
    setServing(v) { serving = !!v; },
    setHand(h) { cfg.hand = h === "left" ? "left" : "right"; reset(); },
    setThreshold(v) { if (Number.isFinite(v) && v > 1 && v < 20) cfg.threshold = v; },
    get config() { return { ...cfg, serving }; },
    get prep() { return prep ? prep.kind : null; }
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

// Split people in one camera into slots. Slot 0 = the person on the left, slot 1 = on the right,
// then each slot follows its person (nearest match) so IDs don't swap when the detector reorders them.
export function createPoseTracker(opts = {}) {
  const slots = opts.slots ?? 2;
  const lostMs = opts.lostMs ?? 1000;
  const maxJump = opts.maxJump ?? 0.3;
  let nextId = 1;
  const tracks = Array.from({ length: slots }, () => null); // { id, cx, last }

  function update(people, t) {
    const list = (people || []).filter(Boolean).slice(0, slots);
    for (let s = 0; s < slots; s++) if (tracks[s] && t - tracks[s].last > lostMs) tracks[s] = null;
    const out = Array.from({ length: slots }, (_, s) => ({ slot: s, id: tracks[s]?.id ?? null, person: null }));
    const used = new Set();
    // 1) Keep existing tracks: try every assignment (at most 2x2) and take the cheapest.
    const live = tracks.map((tr, s) => (tr ? s : -1)).filter((s) => s >= 0);
    let best = { cost: Infinity, pairs: [] };
    // Each live track picks an unused person or nobody; keep the cheapest combination.
    const walk = (k, usedSet, pairs, cost) => {
      if (k === live.length) {
        const c = cost - pairs.length * 10; // prefer keeping more people matched
        if (c < best.cost) best = { cost: c, pairs: [...pairs] };
        return;
      }
      const s = live[k];
      walk(k + 1, usedSet, pairs, cost);
      list.forEach((p, pi) => {
        if (usedSet.has(pi)) return;
        const d = Math.abs(p.cx - tracks[s].cx);
        if (d > maxJump) return;
        usedSet.add(pi); pairs.push([s, pi]);
        walk(k + 1, usedSet, pairs, cost + d);
        usedSet.delete(pi); pairs.pop();
      });
    };
    walk(0, new Set(), [], 0);
    const idx = list.map((_, i) => i);
    for (const [s, pi] of best.pairs) {
      tracks[s].cx = list[pi].cx; tracks[s].last = t;
      out[s] = { slot: s, id: tracks[s].id, person: list[pi] };
      used.add(pi);
    }
    // 2) New people take free slots, left to right.
    const fresh = idx.filter((i) => !used.has(i)).sort((a, b) => list[a].cx - list[b].cx);
    const free = tracks.map((tr, s) => (tr ? -1 : s)).filter((s) => s >= 0);
    if (slots === 2 && fresh.length === 1 && free.length === 2) {
      const s = list[fresh[0]].cx < 0.5 ? 0 : 1;
      tracks[s] = { id: nextId++, cx: list[fresh[0]].cx, last: t };
      out[s] = { slot: s, id: tracks[s].id, person: list[fresh[0]] };
    } else {
      fresh.forEach((pi, k) => {
        const s = free[k];
        if (s === undefined) return;
        tracks[s] = { id: nextId++, cx: list[pi].cx, last: t };
        out[s] = { slot: s, id: tracks[s].id, person: list[pi] };
      });
    }
    return out;
  }
  return { update, get tracks() { return tracks.map((t) => (t ? { ...t } : null)); }, reset() { tracks.fill(null); } };
}

// Map a person's hip x (0..1, mirrored) to -1..1 for their slot. 1 player: most of the frame. 2 players: own half.
export function slotX(cx, slot, slots) {
  const [lo, hi] = slots === 1 ? [0.15, 0.85] : slot === 0 ? [0.05, 0.47] : [0.53, 0.95];
  return clamp(((cx - lo) / (hi - lo)) * 2 - 1, -1, 1);
}
