const runRules = require("./rules");

function scoreReport(r) {
  if (!r || r.type !== "bot_report" || r.platform !== "reddit") {
    return {
      score: 0,
      verdict: "invalid",
      reasons: ["Issue body JSON missing or not a bot_report/reddit payload."]
    };
  }

  const { score, reasons } = runRules(r);

  const capped = Math.max(0, Math.min(100, score));
  let verdict = "low";
  if (capped >= 70) verdict = "high";
  else if (capped >= 40) verdict = "medium";

  return { score: capped, verdict, reasons };
}
