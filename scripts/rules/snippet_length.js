module.exports = function snippetLengthRule(r) {
  const reasons = [];
  let points = 0;

  const snippet = String(r?.snippet || "");
  const len = snippet.trim().length;

  if (len > 0 && len < 20) {
    points += 5;
    reasons.push("Very short comment snippet (+5).");
  }

  return { points, reasons };
};
