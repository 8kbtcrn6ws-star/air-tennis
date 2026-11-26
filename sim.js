// Air Tennis game simulation. Pure JS, no rendering, so it runs in Node tests and in fast-forward.
// Coordinates: metres. x = left/right, y = up, z = toward the player's end (player side z > 0).
import { newScore, awardPoint } from "./scoring.js";

export const COURT = { halfW: 4.115, halfL: 11.885, netH: 0.914, serviceZ: 6.4 };
export const G = 9.8;
export const BALL_R = 0.1;
export const SWING_COOLDOWN = 0.4;
export const EARLY_WINDOW = 0.22; // a swing up to this long before contact still connects
export const LATE_WINDOW = 0.13;  // a swing up to this long after the ball passed still connects
export const PERFECT_WINDOW = 0.07;
export const REACH = 1.7;         // lateral reach from the player's centre, metres
export const PLAYER_X_LIMIT = 5.4;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const other = (w) => (w === "P" ? "A" : "P");

// One physics step for a ball. Returns "net" | "bounce" | null. Pure apart from mutating b.
export function stepBall(b, dt) {
  const pz = b.z;
  b.vx += b.ax * dt;
  b.vy -= G * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  let ev = null;
  if (!b.netDone && Math.sign(pz) !== Math.sign(b.z) && pz !== 0 && Math.abs(b.x) <= COURT.halfW + 1.0 && b.y < COURT.netH + BALL_R) {
    b.netDone = true;
    b.z = pz > 0 ? 0.12 : -0.12;
    b.vz = -b.vz * 0.12;
    b.vx *= 0.3;
    b.ax = 0;
    ev = "net";
  }
  if (b.y < BALL_R && b.vy < 0) {
    b.y = BALL_R;
    b.vy = -b.vy * 0.72;
    b.vx *= 0.84;
    b.vz *= 0.84;
    b.ax = 0;
    if (Math.abs(b.vy) < 0.6) b.vy = 0;
    ev = ev || "bounce";
  }
  return ev;
}

// Launch velocities so the ball lands exactly at (tx, tz) after T seconds with sideways curve ax.
export function launch(from, tx, tz, T, ax = 0) {
  let t = T;
  let v;
  for (let i = 0; i < 20; i++) {
    v = {
      vx: (tx - from.x - 0.5 * ax * t * t) / t,
      vy: (BALL_R - from.y + 0.5 * G * t * t) / t,
      vz: (tz - from.z) / t,
      ax
    };
    // Net clearance check where the path crosses z = 0.
    if (Math.sign(from.z) !== Math.sign(tz) && v.vz !== 0) {
      const tn = -from.z / v.vz;
      const yn = from.y + v.vy * tn - 0.5 * G * tn * tn;
      if (yn < COURT.netH + 0.3) { t += 0.05; continue; }
    }
    break;
  }
  return { ...v, T: t };
}

function inCourt(x, z, side) {
  const m = 0.05;
  if (Math.abs(x) > COURT.halfW + m) return false;
  if (side === "P") return z >= 0 && z <= COURT.halfL + m;
  return z <= 0 && z >= -COURT.halfL - m;
}

// Predict the ball path. Returns samples [{t,x,y,z,bounces,net}] at step dt.
export function predict(ball, maxT = 2.5, dt = 1 / 120) {
  const b = { ...ball };
  const out = [];
  let bounces = ball.bounces;
  let net = false;
  for (let t = dt; t <= maxT; t += dt) {
    const ev = stepBall(b, dt);
    if (ev === "bounce") bounces++;
    if (ev === "net") net = true;
    out.push({ t, x: b.x, y: b.y, z: b.z, vz: b.vz, bounces, net, bounceSide: ev === "bounce" ? (b.z > 0 ? "P" : "A") : null });
    if (bounces >= 2 || net) break;
  }
  return out;
}

// Where a side should stand to hit the incoming ball: a comfortable height after its first bounce.
export function interceptFor(ball, side) {
  const path = predict(ball, 3);
  const sign = side === "P" ? 1 : -1;
  let first = null;
  for (const s of path) {
    if (s.net) return null;
    if (s.bounceSide && !first) {
      if (s.bounceSide !== side) return null;
      first = s;
      continue;
    }
    if (first) {
      const since = s.t - first.t;
      if ((since >= 0.28 && s.y >= 0.45 && s.y <= 1.5) || Math.abs(s.z) >= COURT.halfL + 1.6 || since > 0.7) {
        return { x: s.x, z: clamp(s.z, sign > 0 ? 3 : -15, sign > 0 ? 15 : -3), t: s.t, firstBounce: first };
      }
    }
  }
  return null;
}

export const MODES = {
  match: { label: "Rally vs CPU" },
  practice: { label: "Ball Machine" },
  target: { label: "Target Practice" },
  rally: { label: "Rally Challenge" }
};
// Ball flight: scales every shot's flight time. Light = slow floaty balls, Realistic = quick.
export const FLIGHT = { light: 1.3, medium: 1.0, realistic: 0.8 };
export const TARGET_TIME = 60;

export function createSim(opts = {}) {
  const rand = opts.random || Math.random;
  const sim = {
    mode: "practice",
    phase: "idle",
    time: 0,
    phaseT: 0,
    matchTime: 0,
    ball: { x: 0, y: 1, z: -11, vx: 0, vy: 0, vz: 0, ax: 0, live: false, hitter: null, bounces: 0, netDone: false, valid: false },
    player: { x: 0, z: 12.6, tx: 0, swingAt: -9, swingDir: 0, cooldownUntil: 0, autoZ: 12.6 },
    ai: { x: 0, z: -12.6, swingAt: -9, target: null, reactAt: 0 },
    score: newScore(opts.gamesToWin || 3, "P"),
    gamesToWin: opts.gamesToWin || 3,
    flight: FLIGHT[opts.flight] ? opts.flight : "medium",
    targets: [],
    targetScore: 0,
    timeLeft: 0,
    assist: opts.assist ?? 0.45,
    rally: 0,
    longestRally: 0,
    session: { hits: 0, good: 0, misses: 0, feeds: 0, perfect: 0 },
    pending: null,
    events: [],
    autoplay: null,
    playerIntercept: null,
    lastFeedback: null
  };

  const emit = (type, data = {}) => sim.events.push({ type, t: sim.time, ...data });

  function setPhase(p) {
    sim.phase = p;
    sim.phaseT = 0;
    emit("phase", { phase: p });
  }

  function resetBall(holder) {
    const b = sim.ball;
    Object.assign(b, { vx: 0, vy: 0, vz: 0, ax: 0, live: false, hitter: null, bounces: 0, netDone: false, valid: false });
    if (holder === "P") Object.assign(b, { x: sim.player.x + 0.3, y: 1.1, z: sim.player.z - 0.3 });
    else if (holder === "A") Object.assign(b, { x: sim.ai.x - 0.3, y: 1.1, z: sim.ai.z + 0.3 });
    else Object.assign(b, { x: 0, y: 1.0, z: -11.2 });
    sim.pending = null;
    sim.playerIntercept = null;
    sim.ai.target = null;
  }

  function hitBall(who, tx, tz, T, ax) {
    const b = sim.ball;
    const v = launch(b, tx, tz, T * FLIGHT[sim.flight], ax);
    Object.assign(b, { vx: v.vx, vy: v.vy, vz: v.vz, ax: v.ax, live: true, hitter: who, bounces: 0, netDone: false, valid: false });
    sim.playerIntercept = who === "P" ? null : interceptFor(b, "P");
    sim.ai.target = who === "A" ? null : interceptFor(b, "A");
    sim.ai.reactAt = sim.time + 0.18;
  }

  sim.start = function start(mode, o = {}) {
    sim.mode = MODES[mode] ? mode : "practice";
    if (o.gamesToWin) sim.gamesToWin = o.gamesToWin;
    if (FLIGHT[o.flight]) sim.flight = o.flight;
    sim.targetScore = 0;
    sim.timeLeft = sim.mode === "target" ? TARGET_TIME : 0;
    sim.targets = [];
    if (sim.mode === "target") for (let i = 0; i < 3; i++) sim.targets.push(newTarget());
    sim.score = newScore(sim.gamesToWin, "P");
    sim.rally = 0;
    sim.longestRally = 0;
    sim.matchTime = 0;
    sim.session = { hits: 0, good: 0, misses: 0, feeds: 0, perfect: 0 };
    sim.player.x = 0; sim.player.tx = 0; sim.player.z = 12.6;
    sim.ai.x = 0; sim.ai.z = -12.6;
    resetBall(sim.mode === "match" ? "P" : "M");
    setPhase("countdown");
  };

  sim.toMenu = function toMenu() {
    resetBall("M");
    setPhase("idle");
  };

  function newTarget() {
    for (let k = 0; k < 20; k++) {
      const t = { x: (rand() * 2 - 1) * 3.0, z: -(3 + rand() * 7.8), r: 0.75 + rand() * 0.45, id: Math.floor(rand() * 1e9) };
      if (!sim.targets.some((o) => Math.hypot(o.x - t.x, o.z - t.z) < o.r + t.r + 0.4)) return t;
    }
    return { x: 0, z: -7, r: 1, id: Math.floor(rand() * 1e9) };
  }

  function scoreTarget(x, z) {
    let pts = 10;
    let hit = null;
    for (let i = 0; i < sim.targets.length; i++) {
      const t = sim.targets[i];
      const d = Math.hypot(x - t.x, z - t.z);
      if (d <= t.r) { hit = i; pts = d <= t.r * 0.4 ? 100 : 50; break; }
    }
    sim.targetScore += pts;
    emit("target", { points: pts, x, z, ring: hit !== null });
    if (hit !== null) sim.targets[hit] = newTarget();
  }

  function nextServe() {
    sim.rally = 0;
    if (sim.mode === "match") {
      resetBall(sim.score.server);
      setPhase("serve");
    } else {
      resetBall("M");
      setPhase("feed");
    }
  }

  function endPoint(winner, reason) {
    const b = sim.ball;
    b.live = false;
    sim.pending = null;
    if (sim.rally > sim.longestRally) sim.longestRally = sim.rally;
    const playerMissed = winner !== "P" && (b.hitter !== "P");
    if (playerMissed) sim.session.misses++;
    const ev = { winner, reason, rally: sim.rally, playerMissed };
    if (sim.mode === "match") {
      const r = awardPoint(sim.score, winner);
      ev.game = r.game;
      ev.match = r.match;
    }
    emit("point", ev);
    if (sim.mode === "rally" && winner !== "P") {
      emit("rallyOver", { rally: sim.rally });
      setPhase("over");
      return;
    }
    if (sim.mode === "match" && sim.score.winner) {
      emit("matchOver", { winner: sim.score.winner, games: { ...sim.score.games }, time: sim.matchTime });
      setPhase("over");
      return;
    }
    setPhase("pointOver");
  }

  function onBounce() {
    const b = sim.ball;
    if (!b.live) return;
    b.bounces++;
    const side = b.z > 0 ? "P" : "A";
    emit("bounce", { x: b.x, z: b.z, side, n: b.bounces });
    const hitter = b.hitter;
    if (hitter === "M") {
      // Ball machine feed: lands on the player's side; a second bounce is a miss.
      if (b.bounces >= 2) endPoint("A", "Missed");
      else b.valid = true;
      return;
    }
    const receiver = other(hitter);
    if (b.bounces === 1) {
      if (side === receiver && inCourt(b.x, b.z, side)) {
        b.valid = true;
        if (hitter === "P") {
          sim.session.good++;
          if (sim.mode === "match" || sim.mode === "rally") { sim.rally++; emit("rally", { n: sim.rally }); }
          if (sim.mode === "target") scoreTarget(b.x, b.z);
          if (sim.mode === "practice" || sim.mode === "target") endPoint("P", "Good shot");
        }
      } else {
        endPoint(receiver, side === receiver ? "Out" : "Net");
      }
    } else if (b.bounces >= 2) {
      endPoint(hitter, hitter === "P" ? "Winner" : "Missed");
    }
  }

  function playerHit(p) {
    const b = sim.ball;
    if (!b.live || b.hitter === "P" || b.bounces >= 2) return false;
    const timing = p.timing; // seconds, + early, - late
    const quality = Math.abs(timing) <= PERFECT_WINDOW ? "perfect" : "good";
    const dir = clamp(p.dir, -1, 1);
    const pull = clamp(timing / EARLY_WINDOW, -1, 1) * 0.9; // early pulls left, late pushes right
    const tx = clamp(dir * 3.2 - pull, -3.7, 3.7);
    let power = clamp(p.power, 0, 1) + (quality === "perfect" ? 0.12 : 0);
    power = clamp(power, 0, 1);
    const tz = -(7.2 + 3.6 * power);
    const T = lerp(1.6, 0.98, power);
    hitBall("P", tx, tz, T, -dir * 1.1);
    sim.player.swingAt = sim.time;
    sim.session.hits++;
    if (quality === "perfect") sim.session.perfect++;
    emit("hit", { who: "P", quality, power, dir, x: b.x, y: b.y, z: b.z });
    return true;
  }

  function aiHit() {
    const b = sim.ball;
    const ai = sim.ai;
    let tx, tz, T;
    const rally = sim.mode === "rally";
    const stretch = ai.target ? Math.hypot(ai.target.x - ai.x, ai.target.z - ai.z) : 0;
    const errChance = rally ? 0 : clamp(0.1 + stretch * 0.12 + sim.rally * 0.015, 0, 0.45);
    if (rand() < errChance) {
      const k = rand();
      if (k < 0.5) { tx = (rand() < 0.5 ? -1 : 1) * (COURT.halfW + 0.6 + rand()); tz = 6 + rand() * 4; }
      else { tx = (rand() * 2 - 1) * 2.5; tz = COURT.halfL + 0.8 + rand() * 1.5; }
      T = lerp(1.1, 1.4, rand());
    } else if (rally) {
      tx = clamp(sim.player.x * 0.3 + (rand() * 2 - 1) * 1.4, -2.6, 2.6);
      tz = 7.5 + rand() * 2.5;
      T = 1.55 + rand() * 0.2;
    } else {
      tx = (rand() * 2 - 1) * 3.2;
      tz = 6.5 + rand() * 4;
      T = lerp(1.15, 1.55, rand());
    }
    hitBall("A", tx, tz, T, (rand() * 2 - 1) * 0.6);
    ai.swingAt = sim.time;
    emit("hit", { who: "A", quality: "ai", x: b.x, y: b.y, z: b.z });
  }

  function serve(who, dir = 0, power = 0.5) {
    const b = sim.ball;
    if (who === "P") {
      Object.assign(b, { x: sim.player.x + 0.3, y: 2.55, z: sim.player.z - 0.2 });
      hitBall("P", clamp(dir * 2.6, -3.4, 3.4), -(3.2 + 2.6 * clamp(power, 0, 1)), lerp(1.2, 1.0, power), 0);
      sim.player.swingAt = sim.time;
    } else {
      Object.assign(b, { x: sim.ai.x - 0.3, y: 2.55, z: sim.ai.z + 0.2 });
      hitBall("A", (rand() * 2 - 1) * 2.6, 3.2 + rand() * 2.6, 1.15 + rand() * 0.15, 0);
      sim.ai.swingAt = sim.time;
    }
    emit("serve", { who });
    setPhase("rally");
  }

  function feed() {
    const b = sim.ball;
    Object.assign(b, { x: (rand() * 2 - 1) * 0.6, y: 1.0, z: -11.4 });
    const easy = sim.mode === "rally";
    hitBall("M", (rand() * 2 - 1) * (easy ? 1.8 : 2.6), 6 + rand() * 3, easy ? 1.55 : 1.3 + rand() * 0.25, 0);
    if (sim.mode === "rally") b.hitter = "A"; // the rally opener counts as the CPU's shot
    sim.session.feeds++;
    emit("feed", {});
    setPhase("rally");
  }

  // When will the ball reach the player's hitting plane? Returns {tc, lat} or a reason.
  function contactFor() {
    const b = sim.ball;
    const pl = sim.player;
    const planeZ = pl.z - 0.35;
    if (!b.live || b.hitter === "P" || b.bounces >= 2) return { reason: "none" };
    if (b.vz > 0 && b.z >= planeZ) {
      const tc = -(b.z - planeZ) / Math.max(b.vz, 0.1);
      return { tc, lat: Math.abs(b.x - pl.x), y: b.y };
    }
    if (b.vz <= 0) return { reason: "none" };
    const path = predict(b, 2.2);
    for (const s of path) {
      if (s.bounces >= 2 || s.net) return { reason: "none" };
      if (s.z >= planeZ) return { tc: s.t, lat: Math.abs(s.x - pl.x), y: s.y };
    }
    return { reason: "none" };
  }

  // A swing from keyboard, mouse or phone. dir -1..1 (left..right), power 0..1.
  sim.swing = function swing(dir = 0, power = 0.6, source = "kb") {
    const pl = sim.player;
    if (sim.time < pl.cooldownUntil) return { result: "cooldown" };
    pl.cooldownUntil = sim.time + SWING_COOLDOWN;
    pl.swingAt = sim.time;
    pl.swingDir = dir;
    emit("swing", { source, dir, power });
    if (sim.phase === "serve" && sim.score.server === "P" && sim.mode === "match") {
      serve("P", dir, power);
      return { result: "serve" };
    }
    if (sim.phase !== "rally" || sim.pending) return { result: "whiff" };
    const c = contactFor();
    if (c.reason) return { result: "whiff" };
    if (c.tc > EARLY_WINDOW) {
      if (c.tc < 0.9) { emit("feedback", { text: "Too early!", kind: "miss" }); return { result: "early", tc: c.tc }; }
      return { result: "whiff" };
    }
    if (c.tc < -LATE_WINDOW) { emit("feedback", { text: "Too late!", kind: "miss" }); return { result: "late", tc: c.tc }; }
    if (c.lat > REACH || c.y > 2.9) { emit("feedback", { text: "Out of reach!", kind: "miss" }); return { result: "reach", lat: c.lat }; }
    sim.pending = { at: sim.time + Math.max(0, c.tc), dir, power, timing: c.tc };
    return { result: "hit", tc: c.tc };
  };

  sim.contact = contactFor;

  sim.setInputX = function setInputX(x) {
    if (Number.isFinite(x)) sim.player.tx = clamp(x, -1, 1) * PLAYER_X_LIMIT;
  };

  function updatePlayer(dt) {
    const pl = sim.player;
    let target = pl.tx;
    const ic = sim.playerIntercept;
    if (ic && sim.ball.live && sim.ball.hitter !== "P") target = lerp(pl.tx, ic.x - 0.2, sim.assist);
    const dx = clamp(target - pl.x, -9 * dt, 9 * dt);
    pl.x = clamp(pl.x + dx, -PLAYER_X_LIMIT, PLAYER_X_LIMIT);
    const tz = ic && sim.ball.live && sim.ball.hitter !== "P" ? clamp(ic.z + 0.35, 8.5, 14.5) : 12.6;
    pl.z += clamp(tz - pl.z, -6 * dt, 6 * dt);
  }

  function updateAi(dt) {
    const ai = sim.ai;
    const b = sim.ball;
    let tx = 0, tz = -12.6;
    if (sim.phase === "serve" && sim.score.server === "A") { tx = 0.6; }
    else if (b.live && b.hitter !== "A" && ai.target && sim.time >= ai.reactAt) { tx = ai.target.x + 0.25; tz = ai.target.z - 0.35; }
    else if (b.live && b.hitter === "A") { tx = b.x * 0.3; }
    const sp = sim.mode === "rally" ? 7.5 : 6.2;
    ai.x += clamp(tx - ai.x, -sp * dt, sp * dt);
    ai.z += clamp(tz - ai.z, -sp * dt, sp * dt);
    ai.x = clamp(ai.x, -6, 6);
    // Hit when the ball (after a valid bounce on the CPU side) comes within reach.
    if (b.live && b.hitter !== "A" && b.hitter !== "M" && b.valid && b.bounces === 1 && b.z < 0) {
      const d = Math.hypot(b.x - ai.x, b.z - ai.z);
      if (d < 1.25 && b.y < 2.6) aiHit();
    }
  }

  function updateAutoplay() {
    const ap = sim.autoplay;
    if (!ap) return;
    const b = sim.ball;
    if (sim.phase === "serve" && sim.score.server === "P" && sim.phaseT > 0.6) {
      sim.swing((rand() * 2 - 1) * 0.8, 0.5, "auto");
      return;
    }
    if (sim.phase !== "rally" || !b.live || b.hitter === "P" || sim.pending) return;
    const ic = sim.playerIntercept;
    if (ic) sim.player.tx = ic.x - 0.2;
    const c = contactFor();
    if (c.reason || ap.skipBall === b) return;
    if (c.tc <= (ap.lead ?? 0.04)) {
      if (rand() > (ap.accuracy ?? 1)) { ap.skipBall = b; ap.skipUntil = sim.time + 2; return; }
      sim.swing((rand() * 2 - 1) * (ap.aim ?? 0.7), ap.power ?? (0.3 + rand() * 0.5), "auto");
    }
  }

  sim.step = function step(dt) {
    sim.time += dt;
    sim.phaseT += dt;
    if (sim.mode === "match" && ["serve", "rally", "pointOver"].includes(sim.phase)) sim.matchTime += dt;
    if (sim.mode === "target" && ["feed", "rally", "pointOver"].includes(sim.phase)) {
      sim.timeLeft = Math.max(0, sim.timeLeft - dt);
      if (sim.timeLeft <= 0 && sim.phase !== "rally") {
        emit("targetOver", { score: sim.targetScore, hits: sim.session.hits, good: sim.session.good });
        setPhase("over");
        return;
      }
    }
    if (sim.autoplay && sim.autoplay.skipUntil && sim.time > sim.autoplay.skipUntil) { sim.autoplay.skipBall = null; sim.autoplay.skipUntil = 0; }
    switch (sim.phase) {
      case "countdown":
        if (sim.phaseT >= 3) nextServe();
        break;
      case "serve":
        if (sim.score.server === "A" && sim.phaseT >= 1.1) serve("A");
        else if (sim.score.server === "P") Object.assign(sim.ball, { x: sim.player.x + 0.3, y: 1.1 + Math.abs(Math.sin(sim.time * 3)) * 0.5, z: sim.player.z - 0.3 });
        break;
      case "feed":
        if (sim.phaseT >= 1.0) feed();
        break;
      case "pointOver":
        if (sim.phaseT >= (sim.mode === "match" || sim.mode === "rally" ? 1.7 : 0.5)) nextServe();
        break;
      default:
        break;
    }
    updateAutoplay();
    if (sim.pending && sim.time >= sim.pending.at) {
      const p = sim.pending;
      sim.pending = null;
      playerHit(p);
    }
    const b = sim.ball;
    if (b.live) {
      const ev = stepBall(b, dt);
      if (ev === "net") { emit("net", { x: b.x }); endPoint(other(b.hitter === "M" ? "A" : b.hitter), "Net"); }
      else if (ev === "bounce") onBounce();
      if (b.live && (Math.abs(b.z) > 32 || Math.abs(b.x) > 20)) endPoint(b.valid ? b.hitter === "M" ? "A" : b.hitter : other(b.hitter), "Out");
    }
    updatePlayer(dt);
    updateAi(dt);
  };

  sim.drain = function drain() {
    const e = sim.events;
    sim.events = [];
    return e;
  };

  return sim;
}
