/* eslint-disable no-console */

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// If the model adds extra text, grab last {...} block
function extractLastJsonBlock(text) {
  const t = String(text || "");
  const first = t.lastIndexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) return t.slice(first, last + 1);
  return t;
}

async function groqBotCheck(payload, {
  apiKey,
  model = "llama-3.1-8b-instant",
  timeoutMs = 9000
} = {}) {
  if (!apiKey) return { ok: false, error: "Missing LLM_API_KEY" };

  // Keep the input small and structured
  const input = {
    platform: payload.platform,
    reportedUser: payload.reportedUser,
    reportedUserAgeDays: payload.reportedUserAgeDays,
    postKarma: payload.postKarma,
    commentKarma: payload.commentKarma,
    permalink: payload.permalink,
    pageUrl: payload.pageUrl,
    snippet: payload.snippet
  };

  const prompt = [
    "You are a strict classifier.",
    "Goal: estimate whether a Reddit account looks automated or LLM-assisted from limited metadata + one comment snippet.",
    "Return ONLY strict JSON with exactly these keys:",
    '  {"bot_likelihood": number 0..1, "confidence": number 0..1, "reasons": string[]}',
    "No markdown. No extra keys. No surrounding text.",
    "",
    "Guidance:",
    "- Do NOT claim certainty from one snippet; use confidence accordingly.",
    "- Consider: account age vs karma, genericness/templating, unnatural phrasing, political talking-point style, etc.",
    "",
    "INPUT:",
    JSON.stringify(input)
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = data ? JSON.stringify(data) : `${res.status} ${res.statusText}`;
      return { ok: false, error: `Groq error: ${res.status} ${msg}` };
    }

    const content = data?.choices?.[0]?.message?.content || "";
    const parsed = safeJsonParse(extractLastJsonBlock(content));
    if (!parsed) return { ok: false, error: "Groq returned non-JSON" };

    const bot = clamp(Number(parsed.bot_likelihood), 0, 1);
    const conf = clamp(Number(parsed.confidence), 0, 1);
    const reasons = Array.isArray(parsed.reasons)
      ? parsed.reasons.map((x) => String(x)).slice(0, 6)
      : [];

    return { ok: true, bot_likelihood: bot, confidence: conf, reasons };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function groqDeltaScore(llm, maxDelta = 20) {
  if (!llm?.ok) return 0;
  // Additive only: 0..maxDelta
  const d = llm.bot_likelihood * llm.confidence * maxDelta;
  return Math.max(0, Math.min(maxDelta, Math.round(d)));
}

module.exports = { groqBotCheck, groqDeltaScore };
