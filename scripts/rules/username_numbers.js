function normalizeUserName(u) {
  return String(u || "").trim().replace(/^u\//i, "").toLowerCase();
}

function toIntOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

module.exports = function usernameNumbersRule(r) {
  const reasons = [];
  let points = 0;

  const user = normalizeUserName(r?.reportedUser);
  if (!user) return { points: 0, reasons: [] };

  // OPTIONAL guardrail: ignore numeric suffix suspicion on old accounts
  const ageDays = toIntOrNull(r?.reportedUserAgeDays);
  if (ageDays !== null && ageDays > 365 * 5) {
    return { points: 0, reasons: [] };
  }

  const m = user.match(/(\d{3,6})$/);
  if (!m) return { points: 0, reasons: [] };

  const digits = m[1];
  const stem = user.slice(0, user.length - digits.length);

  const genericStem = /(user|reddit|news|comment|reply|prompt|auto|bot)$/;

  if (genericStem.test(stem)) {
    points = 10;
    reasons.push("Generic username with numeric suffix (+10).");
  } else {
    points = 4;
    reasons.push("Username ends with numeric suffix (+4).");
  }

  return { points, reasons };
};
