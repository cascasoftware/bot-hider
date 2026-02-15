const accountAge = require("./account_age");
const karma = require("./karma");
const snippetLength = require("./snippet_length");
const smartTypography = require("./smart_typography");
const usernameNumbers = require("./username_numbers");

const RULES = [
  accountAge,
  karma,
  snippetLength,
  smartTypography,
  usernameNumbers
];

module.exports = function runRules(payload) {
  const reasons = [];
  let score = 0;

  for (const rule of RULES) {
    const out = rule(payload) || {};
    const pts = Number(out.points) || 0;
    score += pts;

    if (Array.isArray(out.reasons)) reasons.push(...out.reasons);
    else if (typeof out.reason === "string") reasons.push(out.reason);
  }

  return { score, reasons };
};
