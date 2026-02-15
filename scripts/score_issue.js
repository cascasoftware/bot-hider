/* eslint-disable no-console */

const token = process.env.GITHUB_TOKEN;
const repoFull = process.env.GITHUB_REPOSITORY; // owner/repo
const issueNumber = Number(process.env.ISSUE_NUMBER || "0");
const issueBodyRaw = process.env.ISSUE_BODY || "";
const issueAuthor = process.env.ISSUE_AUTHOR || "unknown";

if (!token) throw new Error("Missing GITHUB_TOKEN");
if (!repoFull) throw new Error("Missing GITHUB_REPOSITORY");
if (!issueNumber) throw new Error("Missing ISSUE_NUMBER");

const [owner, repo] = repoFull.split("/");

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toIntOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseJsonFromIssueBody(body) {
  const trimmed = body.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return JSON.parse(trimmed);

  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(body.slice(first, last + 1));

  return null;
}

function scoreReport(r) {
  const reasons = [];
  let score = 0;

  if (!r || r.type !== "bot_report" || r.platform !== "reddit") {
    return {
      score: 0,
      verdict: "invalid",
      reasons: ["Issue body JSON missing or not a bot_report/reddit payload."]
    };
  }

  const ageDays = toIntOrNull(r.reportedUserAgeDays);
  const postKarma = toIntOrNull(r.postKarma);
  const commentKarma = toIntOrNull(r.commentKarma);

  if (ageDays === null) {
    score += 10; reasons.push("Account age unknown (+10).");
  } else if (ageDays < 7) {
    score += 35; reasons.push(`Account age < 7 days (${ageDays}) (+35).`);
  } else if (ageDays < 30) {
    score += 25; reasons.push(`Account age < 30 days (${ageDays}) (+25).`);
  } else if (ageDays < 90) {
    score += 15; reasons.push(`Account age < 90 days (${ageDays}) (+15).`);
  } else if (ageDays < 365) {
    score += 5; reasons.push(`Account age < 1 year (${ageDays}) (+5).`);
  } else {
    reasons.push(`Account age >= 1 year (${ageDays}) (+0).`);
  }

  const totalKarma = (postKarma ?? 0) + (commentKarma ?? 0);

  if (postKarma === null || commentKarma === null) {
    score += 10; reasons.push("Karma unknown (+10).");
  } else if (totalKarma < 10) {
    score += 25; reasons.push(`Total karma < 10 (${totalKarma}) (+25).`);
  } else if (totalKarma < 50) {
    score += 15; reasons.push(`Total karma < 50 (${totalKarma}) (+15).`);
  } else if (totalKarma < 200) {
    score += 7; reasons.push(`Total karma < 200 (${totalKarma}) (+7).`);
  } else {
    reasons.push(`Total karma >= 200 (${totalKarma}) (+0).`);
  }

  const snippet = String(r.snippet || "");
  const len = snippet.trim().length;
  if (len > 0 && len < 20) {
    score += 5; reasons.push("Very short comment snippet (+5).");
  }

  score = clamp(score, 0, 100);

  let verdict = "low";
  if (score >= 70) verdict = "high";
  else if (score >= 40) verdict = "medium";

  return { score, verdict, reasons };
}

async function ghRequest(method, url, bodyObj) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API ${method} ${url} failed: ${res.status} ${res.statusText}\n${text}`);
  }
  return res.status === 204 ? null : res.json();
}

function buildCommentMarkdown(payload, result) {
  return [
    "## Bot report score",
    "",
    `**Verdict:** \`${result.verdict}\``,
    `**Score:** **${result.score}/100**`,
    "",
    "### Inputs",
    "",
    `- Reported user: \`${payload.reportedUser ?? "unknown"}\``,
    `- Account age (days): \`${payload.reportedUserAgeDays ?? "unknown"}\``,
    `- Post karma: \`${payload.postKarma ?? "unknown"}\``,
    `- Comment karma: \`${payload.commentKarma ?? "unknown"}\``,
    `- Permalink: ${payload.permalink ? payload.permalink : "`unknown`"}`,
    "",
    "### Reasons",
    "",
    ...result.reasons.map((r) => `- ${r}`),
    "",
    `"_Auto-scored by Actions. Report opened by \`${issueAuthor}\`._"`
  ].join("\n");
}

(async () => {
  let payload = null;
  try { payload = parseJsonFromIssueBody(issueBodyRaw); } catch { payload = null; }

  const result = scoreReport(payload);
  const commentBody = buildCommentMarkdown(payload || {}, result);

  const commentsUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
  await ghRequest("POST", commentsUrl, { body: commentBody });

  const labels = [];
  if (result.verdict === "invalid") labels.push("status:invalid");
  else labels.push("status:pending");

  if (result.verdict === "high") labels.push("score:high");
  else if (result.verdict === "medium") labels.push("score:medium");
  else labels.push("score:low");

  const labelsUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`;
  await ghRequest("POST", labelsUrl, { labels });

  console.log(`Scored issue #${issueNumber}: ${result.score}/100 (${result.verdict})`);
})();
