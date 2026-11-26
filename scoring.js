// Tennis scoring: real points (0, 15, 30, 40, deuce, advantage), first to N games.
export const POINT_NAMES = ["0", "15", "30", "40"];

export function newScore(gamesToWin = 3, firstServer = "P") {
  return { points: { P: 0, A: 0 }, games: { P: 0, A: 0 }, gamesToWin, server: firstServer, winner: null };
}

const other = (who) => (who === "P" ? "A" : "P");

// Returns { game: who|null, match: who|null }. Mutates score.
export function awardPoint(score, who) {
  if (score.winner) return { game: null, match: score.winner };
  if (who !== "P" && who !== "A") throw new Error("bad side");
  const opp = other(who);
  score.points[who] += 1;
  const a = score.points[who];
  const b = score.points[opp];
  if (a >= 4 && a - b >= 2) {
    score.games[who] += 1;
    score.points = { P: 0, A: 0 };
    score.server = other(score.server);
    if (score.games[who] >= score.gamesToWin) {
      score.winner = who;
      return { game: who, match: who };
    }
    return { game: who, match: null };
  }
  return { game: null, match: null };
}

// Labels for the scoreboard. Returns { P, A, call } where call is "Deuce", "Advantage You" etc.
export function pointLabels(score) {
  const p = score.points.P;
  const a = score.points.A;
  if (p >= 3 && a >= 3) {
    if (p === a) return { P: "40", A: "40", call: "Deuce" };
    return p > a ? { P: "AD", A: "40", call: "Advantage You" } : { P: "40", A: "AD", call: "Advantage CPU" };
  }
  return { P: POINT_NAMES[Math.min(p, 3)], A: POINT_NAMES[Math.min(a, 3)], call: "" };
}
