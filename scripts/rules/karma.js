function toIntOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

module.exports = function karmaRule(r) {
  const reasons = [];
  let points = 0;

  const postKarma = toIntOrNull(r?.postKarma);
  const commentKarma = toIntOrNull(r?.commentKarma);

  if (postKarma === null || commentKarma === null) {
    points += 10;
    reasons.push("Karma unknown (+10).");
    return { points, reasons };
  }

  const total = postKarma + commentKarma;

  if (total < 10) {
    points += 25;
    reasons.push(`Total karma < 10 (${total}) (+25).`);
  } else if (total < 50) {
    points += 15;
    reasons.push(`Total karma < 50 (${total}) (+15).`);
  } else if (total < 200) {
    points += 7;
    reasons.push(`Total karma < 200 (${total}) (+7).`);
  } else {
    reasons.push(`Total karma >= 200 (${total}) (+0).`);
  }

  return { points, reasons };
};
