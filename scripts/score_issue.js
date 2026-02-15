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

// ===== Rules runner (modular scoring) =====
const runRules = require("./rules");

// ===== Config =====
const SCORE_THRESHOLD = 50;
const BLACKLIST_PATH = "blacklists/reddit.json";
const MAX_RETRIES = 6;
const RETRY_BASE_MS = 450;

// ===== Utils =====
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function nowUtcIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeUserName(u) {
  return String(u || "").trim().replace(/^u\//i, "").toLowerCase();
}

function parseJsonFromIssueBody(body) {
  const trimmed = (body || "").trim();
  if (!trimmed) return null;

  // Prefer strict JSON body
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return JSON.parse(trimmed);

  // Fallback: try to extract first {...} block
  const first = (body || "").indexOf("{");
  const last = (body || "").lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse((body || "").slice(first, last + 1));

  return null;
}

function base64EncodeUtf8(str) {
  return Buffer.from(String(str), "utf8").toString("base64");
}

function base64DecodeUtf8(b64) {
  const clean = String(b64 || "").replace(/\n/g, "");
  return Buffer.from(clean, "base64").toString("utf8");
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ===== GitHub API =====
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
    const err = new Error(`GitHub API ${method} ${url} failed: ${res.status} ${res.statusText}\n${text}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }

  return res.status === 204 ? null : res.json();
}

// ===== Contents API helpers =====
async function getRepoFile(path) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const data = await ghRequest("GET", url);
  const text = base64DecodeUtf8(data.content);
  return { sha: data.sha, text, json: safeJsonParse(text) };
}

async function putRepoFile(path, sha, text, message) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const content = base64EncodeUtf8(text);
  return ghRequest("PUT", url, {
    message,
    content,
    sha: sha || undefined
  });
}

async function createRepoFileIfMissing(path, text, message) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  try {
    await ghRequest("GET", url);
    return false;
  } catch (e) {
    if (e?.status !== 404) throw e;
  }
  await putRepoFile(path, null, text, message);
  return true;
}

async function putRepoFileWithRetry(path, transformFn, messageFn) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const current = await getRepoFile(path);
      const newText = transformFn(current);
      const msg = messageFn(current);
      await putRepoFile(path, current.sha, newText, msg);
      return { ok: true, attempt };
    } catch (e) {
      const status = e?.status;
      const retryable =
        status === 409 ||
        status === 422 ||
        (typeof e?.message === "string" && e.message.toLowerCase().includes("sha"));

      if (!retryable || attempt === MAX_RETRIES) throw e;

      await sleep(RETRY_BASE_MS * attempt);
    }
  }
  return { ok: false };
}

// ===== Scoring =====
function scoreReport(r) {
  if (!r || r.type !== "bot_report" || r.platform !== "reddit") {
    return {
      score: 0,
      verdict: "invalid",
      reasons: ["Issue body JSON missing or not a bot_report/reddit payload."]
    };
  }

  const { score, reasons } = runRules(r);
  const capped = clamp(Number(score) || 0, 0, 100);

  let verdict = "low";
  if (capped >= 70) verdict = "high";
  else if (capped >= 40) verdict = "medium";

  return { score: capped, verdict, reasons: Array.isArray(reasons) ? reasons : [] };
}

function buildCommentMarkdown(payload, result) {
  const lines = [];
  lines.push("## Bot report score");
  lines.push("");
  lines.push(`**Verdict:** \`${result.verdict}\``);
  lines.push(`**Score:** **${result.score}/100**`);
  lines.push("");
  lines.push("### Inputs");
  lines.push("");
  lines.push(`- Reported user: \`${payload.reportedUser ?? "unknown"}\``);
  lines.push(`- Account age (days): \`${payload.reportedUserAgeDays ?? "unknown"}\``);
  lines.push(`- Post karma: \`${payload.postKarma ?? "unknown"}\``);
  lines.push(`- Comment karma: \`${payload.commentKarma ?? "unknown"}\``);
  lines.push(`- Permalink: ${payload.permalink ? payload.permalink : "`unknown`"}`);
  lines.push("");
  lines.push("### Reasons");
  lines.push("");
  if (result.reasons.length === 0) lines.push("- (none)");
  else for (const r of result.reasons) lines.push(`- ${r}`);
  lines.push("");
  lines.push(`_Auto-scored by Actions. Report opened by \`${issueAuthor}\`._`);
  return lines.join("\n");
}

// ===== Blacklist format helpers =====
function normalizeBlacklistUsersArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => {
      if (typeof x === "string") {
        const u = normalizeUserName(x);
        if (!u) return null;
        return { u, score: null, first_seen_utc: null, last_seen_utc: null, count: 1 };
      }
      if (x && typeof x === "object") {
        const u = normalizeUserName(x.u || x.user || x.username);
        if (!u) return null;
        const s = Number(x.score);
        return {
          u,
          score: Number.isFinite(s) ? Math.max(0, Math.min(100, Math.trunc(s))) : null,
          first_seen_utc: x.first_seen_utc || null,
          last_seen_utc: x.last_seen_utc || null,
          count: Number.isFinite(Number(x.count)) ? Number(x.count) : 1
        };
      }
      return null;
    })
    .filter(Boolean);
}

function upsertBlacklistEntry(users, username, score) {
  const u = normalizeUserName(username);
  if (!u) return users;

  const ts = nowUtcIso();
  const existing = users.find((e) => e.u === u);

  if (existing) {
    existing.count = (existing.count || 0) + 1;
    existing.last_seen_utc = ts;
    existing.score = existing.score === null ? score : Math.max(existing.score, score);
    if (!existing.first_seen_utc) existing.first_seen_utc = ts;
  } else {
    users.push({
      u,
      score,
      first_seen_utc: ts,
      last_seen_utc: ts,
      count: 1
    });
  }

  users.sort((a, b) => a.u.localeCompare(b.u));
  return users;
}

// ===== Main =====
(async () => {
  // 1) Parse payload
  let payload = null;
  try {
    payload = parseJsonFromIssueBody(issueBodyRaw);
  } catch {
    payload = null;
  }

  // 2) Score
  const result = scoreReport(payload);

  // 3) Comment on issue
  const commentBody = buildCommentMarkdown(payload || {}, result);
  const commentsUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
  await ghRequest("POST", commentsUrl, { body: commentBody });

  // 4) Labels (labels must exist in repo)
  const labels = [];
  if (result.verdict === "invalid") labels.push("status:invalid");
  else labels.push("status:pending");

  if (result.verdict === "high") labels.push("score:high");
  else if (result.verdict === "medium") labels.push("score:medium");
  else labels.push("score:low");

  const labelsUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`;
  await ghRequest("POST", labelsUrl, { labels });

  // 5) Update blacklist if valid + score >= threshold
  if (result.verdict !== "invalid" && result.score >= SCORE_THRESHOLD) {
    const reportedUser = normalizeUserName(payload?.reportedUser);

    if (reportedUser) {
      // Ensure file exists
      await createRepoFileIfMissing(
        BLACKLIST_PATH,
        JSON.stringify(
          {
            version: 2,
            platform: "reddit",
            updated_utc: nowUtcIso(),
            users: []
          },
          null,
          2
        ),
        "Create reddit blacklist"
      );

      await putRepoFileWithRetry(
        BLACKLIST_PATH,
        (current) => {
          const json = current.json && typeof current.json === "object" ? current.json : {};

          json.version = Math.max(Number(json.version || 1), 2);
          json.platform = json.platform || "reddit";
          json.updated_utc = nowUtcIso();

          const users = normalizeBlacklistUsersArray(json.users);
          json.users = upsertBlacklistEntry(users, reportedUser, result.score);

          return JSON.stringify(json, null, 2);
        },
        () => `Update reddit blacklist: u/${reportedUser} (score ${result.score})`
      );
    }
  }

  console.log(`OK: issue #${issueNumber} scored ${result.score}/100 (${result.verdict})`);
})();
