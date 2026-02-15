function toIntOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

module.exports = function accountAgeRule(r) {
  const reasons = [];
  let points = 0;

  const ageDays = toIntOrNull(r?.reportedUserAgeDays);

  if (ageDays === null) {
    points += 10;
    reasons.push("Account age unknown (+10).");
  } else if (ageDays < 7) {
    points += 35;
    reasons.push(`Account age < 7 days (${ageDays}) (+35).`);
  } else if (ageDays < 30) {
    points += 25;
    reasons.push(`Account age < 30 days (${ageDays}) (+25).`);
  } else if (ageDays < 90) {
    points += 15;
    reasons.push(`Account age < 90 days (${ageDays}) (+15).`);
  } else if (ageDays < 365) {
    points += 5;
    reasons.push(`Account age < 1 year (${ageDays}) (+5).`);
  } else {
    reasons.push(`Account age >= 1 year (${ageDays}) (+0).`);
  }

  return { points, reasons };
};
