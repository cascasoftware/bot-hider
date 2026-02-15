module.exports = function smartTypographyRule(r) {
  const s = String(r?.snippet || "");
  const reasons = [];
  let points = 0;

  const patterns = [
    { name: "smart double quotes", re: /[“”]/g },
    { name: "smart single quotes / apostrophes", re: /[‘’]/g },
    { name: "em/en dashes", re: /[—–]/g },
    { name: "ellipsis", re: /[…]/g },
    { name: "non-breaking space", re: /\u00A0/g },
    { name: "bullet", re: /[•]/g }
  ];

  let totalHits = 0;
  let categories = 0;
  const details = [];

  for (const p of patterns) {
    const hits = (s.match(p.re) || []).length;
    if (hits > 0) {
      totalHits += hits;
      categories += 1;
      details.push(`${p.name}: ${hits}`);
    }
  }

  if (totalHits === 0) return { points: 0, reasons: [] };

  if (categories === 1 && totalHits <= 2) points = 4;
  else if (categories === 1 && totalHits <= 5) points = 8;
  else if (categories >= 2 && totalHits <= 6) points = 12;
  else points = 18;

  const length = s.trim().length;
  if (length > 0 && length < 30) points = Math.max(0, points - 4);

  reasons.push(`Smart typography detected (+${points}). (${details.join(", ")})`);
  return { points, reasons };
};
