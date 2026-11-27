// Air Tennis game simulation. Pure JS, no rendering, so it runs in Node tests and in fast-forward.
// Coordinates: metres. x = left/right (as seen on the TV), y = up, z = toward the near end.
// Two sides: "P" (near, z > 0) and "A" (far, z < 0). Up to four players: even ids on P, odd ids on A.
//   singles: 0 = Player 1 (near), 1 = CPU or Player 2 (far)
//   doubles: 0 + 2 = near team (left, right), 1 + 3 = far team (left, right)
import { newScore, awardPoint } from "./scoring.js";

export const COURT = { halfW: 4.115, halfWD: 5.485, halfL: 11.885, netH: 0.914, serviceZ: 6.4 };
export const G = 9.8;
export const BALL_R = 0.1;
export const SWING_COOLDOWN = 0.4;
export const EARLY_WINDOW = 0.22; // a swing up to this long before contact still connects
export const LATE_WINDOW = 0.13;  // a swing up to this long after the ball passed still connects
export const PERFECT_WINDOW = 0.07;
export const REACH = 1.7;         // lateral reach from the player's centre, metres
export const PLAYER_X_LIMIT = 5.4;
export const MAGNUS_K = 0.2;      // simplified Magnus: vertical accel = K * spin * horizontal speed
export const GROUND_MAX_Y = 2.3;  // forehand/backhand can't reach above this (use an overhead)
export const OVERHEAD_MIN_Y = 1.35;
export const TRAINING_BALLS = 20;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const other = (w) => (w === "P" ? "A" : "P");
const sgn = (side) => (side === "P" ? 1 : -1);

// One physics step for a ball. Returns "net" | "bounce" | null. Pure apart from mutating b.
// Gravity, sideways curve (ax), Magnus lift/dip from spin (ay), net, bounce with energy loss and spin kick.
export function stepBall(b, dt) {
  const pz = b.z;
  b.vx += (b.ax || 0) * dt;
  b.vy += ((b.ay || 0) - G) * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  let ev = null;
  if (!b.netDone && Math.sign(pz) !== Math.sign(b.z) && pz !== 0 && Math.abs(b.x) <= COURT.halfWD + 0.9 && b.y < COURT.netH + BALL_R) {
    b.netDone = true;
    b.z = pz > 0 ? 0.12 : -0.12;
    b.vz = -b.vz * 0.12;
    b.vx *= 0.3;
    b.ax = 0;
    b.ay = 0;
    ev = "net";
  }
  if (b.y < BALL_R && b.vy < 0) {
    const sp = b.spin || 0;
    b.y = BALL_R;
    b.vy = -b.vy * 0.72;
    b.vx *= 0.84;
    b.vz *= 0.84 + 0.08 * sp; // topspin kicks forward, backspin grips and slows
    b.ax = 0;
    b.ay = 0;
    b.spin = sp * 0.4;
    if (Math.abs(b.vy) < 0.6) b.vy = 0;
    ev = ev || "bounce";
  }
  return ev;
}

// Launch velocities so the ball lands exactly at (tx, tz) after T seconds with sideways curve ax
// and spin (-1 backspin .. +1 topspin). Topspin dips (extra downward accel), backspin floats.
export function launch(from, tx, tz, T, ax = 0, spin = 0) {
  let t = T;
  let v;
  const s = clamp(spin || 0, -1, 1);
  for (let i = 0; i < 24; i++) {
    const vh = Math.hypot(tx - from.x, tz - from.z) / t;
    const am = MAGNUS_K * s * vh; // + = pushes the ball down
    const g = G + am;
    v = {
      vx: (tx - from.x - 0.5 * ax * t * t) / t,
      vy: (BALL_R - from.y + 0.5 * g * t * t) / t,
      vz: (tz - from.z) / t,
      ax,
      ay: -am,
      spin: s
    };
    // Net clearance check where the path crosses z = 0.
    if (Math.sign(from.z) !== Math.sign(tz) && v.vz !== 0) {
      const tn = -from.z / v.vz;
      const yn = from.y + v.vy * tn - 0.5 * g * tn * tn;
      if (yn < COURT.netH + 0.3) { t += 0.05; continue; }
    }
    break;
  }
  return { ...v, T: t };
}

export function inCourt(x, z, side, doubles = false) {
  const m = 0.05;
  if (Math.abs(x) > (doubles ? COURT.halfWD : COURT.halfW) + m) return false;
  if (side === "P") return z >= 0 && z <= COURT.halfL + m;
  return z <= 0 && z >= -COURT.halfL - m;
}

// Predict the ball path. Returns samples [{t,x,y,z,bounces,net}] at step dt.
export function predict(ball, maxT = 2.5, dt = 1 / 120) {
  const b = { ...ball };
  const out = [];
  let bounces = ball.bounces || 0;
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
  const sign = sgn(side);
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

// humans: which player ids take input by default (the TV can add camera players in doubles).
export const MODES = {
  match: { label: "1P vs CPU", humans: [0], scored: true },
  match2: { label: "2P Match", humans: [0, 1], scored: true, two: true },
  rally2: { label: "2P Rally", humans: [0, 1], two: true },
  doubles: { label: "Doubles", humans: [0, 1], scored: true, doubles: true, two: true },
  practice: { label: "Ball Machine", humans: [0], machine: true },
  training: { label: "Training", humans: [0], machine: true },
  target: { label: "Target Practice", humans: [0], machine: true },
  rally: { label: "Rally Challenge", humans: [0] }
};
// Ball flight: scales every shot's flight time. Light = slow floaty balls, Realistic = quick.
export const FLIGHT = { light: 1.3, medium: 1.0, realistic: 0.8 };
export const TARGET_TIME = 60;

function mkPlayer(id) {
  const side = id % 2 === 0 ? "P" : "A";
  return { id, side, x: 0, z: sgn(side) * 12.6, tx: 0, homeX: 0, human: id === 0, active: id < 2, swingAt: -9, swingDir: 0, swingKind: "fh", cooldownUntil: 0, autoZ: 12.6, stamina: 1, moved: 0 };
}

export function createSim(opts = {}) {
  const rand = opts.random || Math.random;
  const players = [0, 1, 2, 3].map(mkPlayer);
  const sim = {
    mode: "practice",
    phase: "idle",
    time: 0,
    phaseT: 0,
    matchTime: 0,
    ball: { x: 0, y: 1, z: -11, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, spin: 0, live: false, hitter: null, hitterId: null, bounces: 0, netDone: false, valid: false },
    players,
    player: players[0],
    ai: players[1],
    score: newScore(opts.gamesToWin || 3, "P"),
    gamesToWin: opts.gamesToWin || 3,
    flight: FLIGHT[opts.flight] ? opts.flight : "medium",
    targets: [],
    targetScore: 0,
    timeLeft: 0,
    assist: opts.assist ?? 0.45,
    rally: 0,          // Rally Challenge / match: your good shots this point
    shots: 0,          // every shot that landed in this point (the broadcast rally counter)
    longestRally: 0,
    lastSpeed: 0,      // km/h of the last shot
    serverId: 0,
    serveTurn: { P: 0, A: 0 },
    session: { hits: 0, good: 0, misses: 0, feeds: 0, perfect: 0 },
    training: { swings: 0, perfect: 0, early: 0, late: 0, hits: 0, sumAbs: 0, last: null },
    pending: null,
    events: [],
    autoplay: null,
    intercepts: { P: null, A: null },
    responder: { P: 0, A: 1 },
    playerIntercept: null,
    lastFeedback: null
  };
  sim.ai.target = null;
  sim.ai.reactAt = 0;

  const emit = (type, data = {}) => sim.events.push({ type, t: sim.time, ...data });
  const doubles = () => !!MODES[sim.mode]?.doubles;
  const activePlayers = () => players.filter((p) => p.active);
  const sidePlayers = (side) => players.filter((p) => p.active && p.side === side);

  function setPhase(p) {
    sim.phase = p;
    sim.phaseT = 0;
    emit("phase", { phase: p });
  }

  function placeHome() {
    const d = doubles();
    for (const p of players) {
      p.active = d || p.id < 2;
      p.homeX = d ? (p.id < 2 ? -2.4 : 2.4) : 0;
      p.x = p.homeX; p.tx = p.homeX; p.z = sgn(p.side) * 12.6;
      p.stamina = 1; p.swingAt = -9; p.cooldownUntil = 0;
    }
  }

  function resetBall(holder) {
    const b = sim.ball;
    Object.assign(b, { vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, spin: 0, live: false, hitter: null, hitterId: null, bounces: 0, netDone: false, valid: false });
    if (holder === "P" || holder === "A") {
      const s = players[sim.serverId];
      Object.assign(b, { x: s.x + 0.3 * sgn(s.side), y: 1.1, z: s.z - 0.3 * sgn(s.side) });
    } else Object.assign(b, { x: 0, y: 1.0, z: -11.2 });
    sim.pending = null;
    sim.intercepts = { P: null, A: null };
    sim.playerIntercept = null;
    sim.ai.target = null;
  }

  function pickResponder(side, ic) {
    const list = sidePlayers(side);
    if (!ic || list.length === 1) return list[0]?.id ?? null;
    return list.reduce((best, p) => (Math.abs(p.x - ic.x) < Math.abs(best.x - ic.x) ? p : best)).id;
  }

  function hitBall(who, tx, tz, T, ax, spin = 0, hitterId = null) {
    const b = sim.ball;
    const v = launch(b, tx, tz, T * FLIGHT[sim.flight], ax, spin);
    Object.assign(b, { vx: v.vx, vy: v.vy, vz: v.vz, ax: v.ax, ay: v.ay, spin: v.spin, live: true, hitter: who, hitterId, bounces: 0, netDone: false, valid: false });
    sim.intercepts = { P: who === "P" ? null : interceptFor(b, "P"), A: who === "A" ? null : interceptFor(b, "A") };
    sim.responder = { P: pickResponder("P", sim.intercepts.P), A: pickResponder("A", sim.intercepts.A) };
    sim.playerIntercept = sim.intercepts.P;
    sim.ai.target = sim.intercepts.A;
    sim.ai.reactAt = sim.time + 0.18;
    for (const p of players) p.reactAt = sim.time + 0.18;
    sim.lastSpeed = Math.round(Math.hypot(v.vx, v.vy, v.vz) * 3.6);
    return sim.lastSpeed;
  }

  sim.setHumans = function setHumans(ids) {
    for (const p of players) p.human = ids.includes(p.id);
  };

  sim.start = function start(mode, o = {}) {
    sim.mode = MODES[mode] ? mode : "practice";
    if (o.gamesToWin) sim.gamesToWin = o.gamesToWin;
    if (FLIGHT[o.flight]) sim.flight = o.flight;
    sim.setHumans(o.humans || MODES[sim.mode].humans);
    sim.targetScore = 0;
    sim.timeLeft = sim.mode === "target" ? TARGET_TIME : 0;
    sim.targets = [];
    if (sim.mode === "target") for (let i = 0; i < 3; i++) sim.targets.push(newTarget());
    sim.score = newScore(sim.gamesToWin, "P");
    sim.serveTurn = { P: 0, A: 0 };
    sim.serverId = 0;
    sim.rally = 0;
    sim.shots = 0;
    sim.longestRally = 0;
    sim.lastSpeed = 0;
    sim.matchTime = 0;
    sim.session = { hits: 0, good: 0, misses: 0, feeds: 0, perfect: 0 };
    sim.training = { swings: 0, perfect: 0, early: 0, late: 0, hits: 0, sumAbs: 0, last: null };
    placeHome();
    resetBall(MODES[sim.mode].machine || sim.mode === "rally" ? "M" : "P");
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

  // Who serves: the serving side's players take turns (doubles); singles = the one player on that side.
  function chooseServer() {
    const side = sim.score.server;
    const list = sidePlayers(side);
    sim.serverId = list[sim.serveTurn[side] % list.length].id;
  }

  function nextServe() {
    sim.rally = 0;
    sim.shots = 0;
    for (const p of players) p.stamina = Math.min(1, p.stamina + 0.25);
    const m = MODES[sim.mode];
    if (sim.mode === "training" && sim.session.feeds >= TRAINING_BALLS) {
      const tr = sim.training;
      emit("trainingOver", { ...tr, avg: tr.swings ? tr.sumAbs / tr.swings : 0 });
      setPhase("over");
      return;
    }
    if (m.scored || sim.mode === "rally2") {
      chooseServer();
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
    if (sim.mode !== "match" && sim.mode !== "rally" && sim.shots > sim.longestRally) sim.longestRally = sim.shots;
    const playerMissed = winner !== "P" && (b.hitter !== "P");
    if (playerMissed) sim.session.misses++;
    const ev = { winner, reason, rally: sim.rally, shots: sim.shots, playerMissed, hitterId: b.hitterId };
    if (MODES[sim.mode].scored) {
      const before = sim.score.server;
      const r = awardPoint(sim.score, winner);
      ev.game = r.game;
      ev.match = r.match;
      if (r.game) sim.serveTurn[before]++;
    }
    if (sim.mode === "rally2") { sim.serveTurn[sim.score.server]++; sim.score.server = other(sim.score.server); }
    emit("point", ev);
    if (sim.mode === "rally" && winner !== "P") {
      emit("rallyOver", { rally: sim.rally });
      setPhase("over");
      return;
    }
    if (MODES[sim.mode].scored && sim.score.winner) {
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
      if (side === receiver && inCourt(b.x, b.z, side, doubles())) {
        b.valid = true;
        sim.shots++;
        emit("shotIn", { n: sim.shots, side: hitter });
        if (hitter === "P") {
          sim.session.good++;
          if (sim.mode === "match" || sim.mode === "rally") { sim.rally++; emit("rally", { n: sim.rally }); }
          if (sim.mode === "target") scoreTarget(b.x, b.z);
          if (sim.mode === "practice" || sim.mode === "target" || sim.mode === "training") endPoint("P", "Good shot");
        }
      } else {
        endPoint(receiver, side === receiver ? "Out" : "Net");
      }
    } else if (b.bounces >= 2) {
      endPoint(hitter, hitter === "P" ? "Winner" : "Missed");
    }
  }

  // A human shot. p.timing: seconds, + early, - late. power 0..1, dir -1..1 (TV left..right), lift -1..1 (spin).
  function playerHit(pl, p) {
    const b = sim.ball;
    if (!b.live || b.hitter === pl.side || b.bounces >= 2) return false;
    const s = sgn(pl.side);
    const timing = p.timing;
    const quality = Math.abs(timing) <= PERFECT_WINDOW ? "perfect" : "good";
    const dir = clamp(p.dir, -1, 1);
    const pull = clamp(timing / EARLY_WINDOW, -1, 1) * 0.9; // early pulls cross-court, late pushes it wide
    // Accuracy: the further from perfect timing, the more the shot scatters (sideways and long).
    const off = quality === "perfect" ? 0 : Math.min(1, Math.abs(timing) / (timing > 0 ? EARLY_WINDOW : LATE_WINDOW));
    const stam = 0.85 + 0.15 * pl.stamina;
    let power = clamp(p.power, 0, 1) * stam + (quality === "perfect" ? 0.12 : 0);
    power = clamp(power, 0, 1);
    const w = doubles() ? 4.9 : 3.7;
    const ps = p.kind === "bh" ? -1 : 1; // early backhands pull the other way
    const tx = clamp(dir * (w - 0.5) - s * pull * ps + (rand() * 2 - 1) * 1.1 * off * (0.4 + power * 0.6), -w - 0.8, w + 0.8);
    const tz = -s * (7.2 + 3.6 * power + rand() * 1.6 * off * power);
    const T = lerp(1.6, 0.98, power);
    const spin = p.kind === "oh" || p.kind === "sv" ? 0 : clamp(p.lift ?? 0.3, -1, 1);
    const kmh = hitBall(pl.side, tx, tz, T, -dir * 1.1, spin, pl.id);
    pl.swingAt = sim.time;
    pl.stamina = Math.max(0, pl.stamina - (0.02 + 0.03 * power));
    if (pl.id === 0) {
      sim.session.hits++;
      if (quality === "perfect") sim.session.perfect++;
    }
    emit("hit", { who: pl.side, id: pl.id, quality, power, dir, spin, kind: p.kind || "", kmh, x: b.x, y: b.y, z: b.z });
    return true;
  }

  // CPU shot (the far-side opponent in 1P modes, or a CPU partner in doubles).
  function cpuHit(pl) {
    const b = sim.ball;
    const s = sgn(pl.side);
    let tx, tz, T;
    const rally = sim.mode === "rally";
    const ic = sim.intercepts[pl.side];
    const stretch = ic ? Math.hypot(ic.x - pl.x, ic.z - pl.z) : 0;
    const errChance = rally ? 0 : clamp(0.1 + stretch * 0.12 + sim.rally * 0.015, 0, 0.45);
    const w = doubles() ? 4.6 : 3.2;
    if (rand() < errChance) {
      const k = rand();
      if (k < 0.5) { tx = (rand() < 0.5 ? -1 : 1) * ((doubles() ? COURT.halfWD : COURT.halfW) + 0.6 + rand()); tz = -s * (6 + rand() * 4); }
      else { tx = (rand() * 2 - 1) * 2.5; tz = -s * (COURT.halfL + 0.8 + rand() * 1.5); }
      T = lerp(1.1, 1.4, rand());
    } else if (rally) {
      tx = clamp(sim.player.x * 0.3 + (rand() * 2 - 1) * 1.4, -2.6, 2.6);
      tz = -s * (7.5 + rand() * 2.5);
      T = 1.55 + rand() * 0.2;
    } else {
      tx = (rand() * 2 - 1) * w;
      tz = -s * (6.5 + rand() * 4);
      T = lerp(1.15, 1.55, rand());
    }
    hitBall(pl.side, tx, tz, T, (rand() * 2 - 1) * 0.6, rally ? 0.2 : (rand() * 1.4 - 0.4), pl.id);
    pl.swingAt = sim.time;
    pl.swingKind = b.x * s < pl.x * s ? "bh" : "fh";
    pl.stamina = Math.max(0, pl.stamina - 0.03);
    emit("hit", { who: pl.side, id: pl.id, quality: "ai", kmh: sim.lastSpeed, x: b.x, y: b.y, z: b.z });
  }

  function serve(id, dir = 0, power = 0.5) {
    const b = sim.ball;
    const pl = players[id];
    const s = sgn(pl.side);
    Object.assign(b, { x: pl.x + 0.3 * s, y: 2.55, z: pl.z - 0.2 * s });
    if (pl.human) hitBall(pl.side, clamp(dir * 2.6, -3.4, 3.4), -s * (3.2 + 2.6 * clamp(power, 0, 1)), lerp(1.2, 1.0, power), 0, 0, id);
    else hitBall(pl.side, (rand() * 2 - 1) * 2.6, -s * (3.2 + rand() * 2.6), 1.15 + rand() * 0.15, 0, 0, id);
    pl.swingAt = sim.time;
    pl.swingKind = "sv";
    emit("serve", { who: pl.side, id, kmh: sim.lastSpeed });
    setPhase("rally");
  }

  function feed() {
    const b = sim.ball;
    Object.assign(b, { x: (rand() * 2 - 1) * 0.6, y: 1.0, z: -11.4 });
    const easy = sim.mode === "rally";
    hitBall("M", (rand() * 2 - 1) * (easy ? 1.8 : 2.6), 6 + rand() * 3, easy ? 1.55 : 1.3 + rand() * 0.25, 0, easy ? 0 : rand() * 0.6 - 0.1);
    if (sim.mode === "rally") b.hitter = "A"; // the rally opener counts as the CPU's shot
    sim.session.feeds++;
    emit("feed", {});
    setPhase("rally");
  }

  // When will the ball reach this player's hitting plane? Returns {tc, lat, y} or a reason.
  function contactFor(pl = sim.player) {
    const b = sim.ball;
    const s = sgn(pl.side);
    const planeZ = s * pl.z - 0.35; // local coords: toward the player is +
    const zz = s * b.z, vzz = s * b.vz;
    if (!b.live || b.hitter === pl.side || b.bounces >= 2) return { reason: "none" };
    if (vzz > 0 && zz >= planeZ) {
      const tc = -(zz - planeZ) / Math.max(vzz, 0.1);
      return { tc, lat: Math.abs(b.x - pl.x), y: b.y };
    }
    if (vzz <= 0) return { reason: "none" };
    const path = predict(b, 2.2);
    for (const q of path) {
      if (q.bounces >= 2 || q.net) return { reason: "none" };
      if (s * q.z >= planeZ) return { tc: q.t, lat: Math.abs(q.x - pl.x), y: q.y };
    }
    return { reason: "none" };
  }

  function feedback(pl, text, result) {
    emit("feedback", { text, kind: "miss", id: pl.id, result });
  }

  // A swing from keyboard, mouse, phone or camera. dir -1..1 (TV left..right), power 0..1.
  // o: { kind: "fh"|"bh"|"oh"|"sv"|undefined, lift: -1..1 }
  sim.swing = function swing(dir = 0, power = 0.6, source = "kb", id = 0, o = {}) {
    const pl = players[id];
    if (!pl || !pl.active) return { result: "inactive" };
    if (sim.time < pl.cooldownUntil) return { result: "cooldown" };
    pl.cooldownUntil = sim.time + SWING_COOLDOWN;
    pl.swingAt = sim.time;
    pl.swingDir = dir;
    let kind = o.kind;
    const serving = sim.phase === "serve" && sim.serverId === id;
    if (kind === "oh" && serving) kind = "sv";
    pl.swingKind = kind || (serving ? "sv" : dir < -0.2 ? "bh" : "fh");
    emit("swing", { source, dir, power, id, kind: pl.swingKind });
    if (serving) {
      serve(id, dir, power);
      return { result: "serve", kind: "sv" };
    }
    if (kind === "sv") kind = "oh";
    if (sim.phase !== "rally" || sim.pending) return { result: "whiff" };
    const c = contactFor(pl);
    if (c.reason) return { result: "whiff" };
    if (sim.mode === "training" && c.tc < 0.9 && c.tc > -0.6) {
      const tr = sim.training;
      const verdict = Math.abs(c.tc) <= PERFECT_WINDOW ? "perfect" : c.tc > 0 ? "early" : "late";
      tr.swings++; tr[verdict]++; tr.sumAbs += Math.abs(c.tc);
      tr.last = { tc: c.tc, verdict };
      emit("timing", { tc: c.tc, verdict });
    }
    if (c.tc > EARLY_WINDOW) {
      if (c.tc < 0.9) { feedback(pl, "Too early!", "early"); return { result: "early", tc: c.tc }; }
      return { result: "whiff" };
    }
    if (c.tc < -LATE_WINDOW) { feedback(pl, "Too late!", "late"); return { result: "late", tc: c.tc }; }
    if (c.lat > REACH || c.y > 2.9) { feedback(pl, "Out of reach!", "reach"); return { result: "reach", lat: c.lat }; }
    if ((kind === "fh" || kind === "bh") && c.y > GROUND_MAX_Y) { feedback(pl, "Too high, use an overhead!", "height"); return { result: "height", y: c.y }; }
    if (kind === "oh" && c.y < OVERHEAD_MIN_Y) { feedback(pl, "Too low for an overhead!", "height"); return { result: "height", y: c.y }; }
    sim.pending = { at: sim.time + Math.max(0, c.tc), dir, power, timing: c.tc, id, kind, lift: o.lift };
    if (sim.mode === "training") sim.training.hits++;
    return { result: "hit", tc: c.tc };
  };

  sim.contact = contactFor;

  // x: -1..1 from the input device. Singles: the whole width. Doubles: your half (with overlap).
  sim.setInputX = function setInputX(x, id = 0) {
    const pl = players[id];
    if (!pl || !Number.isFinite(x)) return;
    if (doubles()) pl.tx = clamp(pl.homeX + clamp(x, -1, 1) * 3.3, -6, 6);
    else pl.tx = clamp(x, -1, 1) * PLAYER_X_LIMIT;
  };

  function moveHuman(pl, dt) {
    const s = sgn(pl.side);
    let target = pl.tx;
    const ic = sim.intercepts[pl.side];
    const mine = ic && sim.ball.live && sim.ball.hitter !== pl.side && sim.responder[pl.side] === pl.id;
    if (mine) target = lerp(pl.tx, ic.x - 0.2 * s, sim.assist);
    const sp = 9 * (0.75 + 0.25 * pl.stamina);
    const dx = clamp(target - pl.x, -sp * dt, sp * dt);
    const lim = doubles() ? 6 : PLAYER_X_LIMIT;
    pl.x = clamp(pl.x + dx, -lim, lim);
    const zz = mine ? clamp(s * ic.z + 0.35, 8.5, 14.5) : 12.6;
    pl.z += clamp(s * zz - pl.z, -6 * dt, 6 * dt);
    track(pl, Math.abs(dx), dt);
  }

  function track(pl, moved, dt) {
    pl.stamina = clamp(pl.stamina - moved * 0.005 + (moved < 2 * dt ? 0.08 * dt : 0), 0, 1);
  }

  function moveCpu(pl, dt) {
    const s = sgn(pl.side);
    const b = sim.ball;
    const ic = sim.intercepts[pl.side];
    let tx = pl.homeX, zz = 12.6;
    if (sim.phase === "serve" && sim.serverId === pl.id) tx = pl.homeX + 0.6 * -s;
    else if (b.live && b.hitter !== pl.side && ic && sim.responder[pl.side] === pl.id && sim.time >= (pl.reactAt || 0)) { tx = ic.x - 0.25 * s; zz = s * ic.z + 0.35; }
    else if (b.live && b.hitter === pl.side && !doubles()) tx = b.x * 0.3;
    const sp = (sim.mode === "rally" ? 7.5 : 6.2) * (0.8 + 0.2 * pl.stamina);
    const dx = clamp(tx - pl.x, -sp * dt, sp * dt);
    pl.x = clamp(pl.x + dx, -6, 6);
    pl.z += clamp(s * zz - pl.z, -sp * dt, sp * dt);
    track(pl, Math.abs(dx), dt);
    // Hit when the ball (after a valid bounce on this side) comes within reach.
    if (b.live && b.hitter !== pl.side && b.hitter !== "M" && b.valid && b.bounces === 1 && s * b.z > 0) {
      const d = Math.hypot(b.x - pl.x, b.z - pl.z);
      if (d < 1.25 && b.y < 2.6) cpuHit(pl);
    }
  }

  function updateAutoplay() {
    const ap = sim.autoplay;
    if (!ap) return;
    const b = sim.ball;
    for (const pl of players) {
      if (!pl.active || !pl.human || (pl.id !== 0 && !ap.all)) continue;
      if (sim.phase === "serve" && sim.serverId === pl.id && sim.phaseT > 0.6) {
        sim.swing((rand() * 2 - 1) * 0.8, 0.5, "auto", pl.id, ap.kind ? { kind: "oh" } : {});
        continue;
      }
      if (sim.phase !== "rally" || !b.live || b.hitter === pl.side || sim.pending) continue;
      if (sim.responder[pl.side] !== pl.id) continue;
      const ic = sim.intercepts[pl.side];
      if (ic) pl.tx = ic.x - 0.2 * sgn(pl.side);
      const c = contactFor(pl);
      if (c.reason || ap.skipBall === b) continue;
      if (c.tc <= (ap.lead ?? 0.04)) {
        if (rand() > (ap.accuracy ?? 1)) { ap.skipBall = b; ap.skipUntil = sim.time + 2; continue; }
        const kind = ap.kind ? (c.y > GROUND_MAX_Y ? "oh" : "fh") : undefined;
        sim.swing((rand() * 2 - 1) * (ap.aim ?? 0.7), ap.power ?? (0.3 + rand() * 0.5), "auto", pl.id, kind ? { kind, lift: 0.4 } : {});
      }
    }
  }

  sim.step = function step(dt) {
    sim.time += dt;
    sim.phaseT += dt;
    if (MODES[sim.mode].scored && ["serve", "rally", "pointOver"].includes(sim.phase)) sim.matchTime += dt;
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
      case "serve": {
        const sv = players[sim.serverId];
        const s = sgn(sv.side);
        if (!sv.human && sim.phaseT >= 1.1) serve(sv.id);
        else if (sv.human) Object.assign(sim.ball, { x: sv.x + 0.3 * s, y: 1.1 + Math.abs(Math.sin(sim.time * 3)) * 0.5, z: sv.z - 0.3 * s });
        break;
      }
      case "feed":
        if (sim.phaseT >= 1.0) feed();
        break;
      case "pointOver":
        if (sim.phaseT >= (MODES[sim.mode].machine ? 0.5 : 1.7)) nextServe();
        break;
      default:
        break;
    }
    updateAutoplay();
    if (sim.pending && sim.time >= sim.pending.at) {
      const p = sim.pending;
      sim.pending = null;
      playerHit(players[p.id], p);
    }
    const b = sim.ball;
    if (b.live) {
      const ev = stepBall(b, dt);
      if (ev === "net") { emit("net", { x: b.x }); endPoint(other(b.hitter === "M" ? "A" : b.hitter), "Net"); }
      else if (ev === "bounce") onBounce();
      if (b.live && (Math.abs(b.z) > 32 || Math.abs(b.x) > 20)) endPoint(b.valid ? b.hitter === "M" ? "A" : b.hitter : other(b.hitter), "Out");
    }
    for (const pl of activePlayers()) (pl.human ? moveHuman : moveCpu)(pl, dt);
  };

  sim.drain = function drain() {
    const e = sim.events;
    sim.events = [];
    return e;
  };

  return sim;
}
