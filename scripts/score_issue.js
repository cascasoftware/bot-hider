console.log("RBH: score_issue.js starting");
console.log("RBH: cwd=", process.cwd());
console.log("RBH: node=", process.version);

console.log("RBH: loading rules...");
const runRules = require("./rules");
console.log("RBH: rules loaded");

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
