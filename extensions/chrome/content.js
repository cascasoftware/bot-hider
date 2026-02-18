(() => {
  "use strict";

  /**********************
   * CONFIG
   **********************/
  const GITHUB_BLACKLIST_URL =
    "https://raw.githubusercontent.com/cascasoftware/bot-hider/main/blacklists/reddit.json";

  // GitHub repo'nda issue açılacak adres (repo'na göre değiştir)
  // Örn: https://github.com/<owner>/<repo>/issues/new
  const GITHUB_ISSUES_NEW_URL =
    "https://github.com/cascasoftware/bot-hider/issues/new";

  const REFRESH_HOURS = 6;

  const PERMANENT_BOTS = new Set(["binspin63"]);

  const SETTINGS_DEFAULTS = {
    minimise: true,
    red: true,
    remove: false
  };

  const BOT_LABEL_TEXT = " [BOT ACCOUNT]";
  const BOT_LABEL_CLASS = "rbh-bot-label";

  /**********************
   * STATE
   **********************/
  let settings = { ...SETTINGS_DEFAULTS };
  let blacklist = new Set();
  let rulesVersion = 1;

  /**********************
   * CSS
   **********************/
  function injectCss() {
    if (document.getElementById("rbh-style")) return;

    const style = document.createElement("style");
    style.id = "rbh-style";
    style.textContent = `
      .rbh-flagged {
        background: rgba(255, 0, 0, 0.07) !important;
        outline: 1px solid rgba(255, 0, 0, 0.25) !important;
        border-radius: 8px !important;
      }
      .rbh-hidden {
        display: none !important;
      }
      .${BOT_LABEL_CLASS} {
        color: #c00 !important;
        font-weight: 700 !important;
        margin-left: 6px !important;
        font-size: 0.95em !important;
      }

      /* Old reddit collapse: don't click javascript: links (CSP blocks them). */
      .rbh-old-collapsed .child,
      .rbh-old-collapsed .usertext-body {
        display: none !important;
      }

      /* Manual report button */
      .rbh-report-btn {
        margin-left: 8px !important;
        padding: 2px 8px !important;
        border-radius: 999px !important;
        border: 1px solid rgba(0,0,0,0.25) !important;
        background: rgba(255,255,255,0.7) !important;
        font-size: 12px !important;
        line-height: 18px !important;
        cursor: pointer !important;
        user-select: none !important;
      }
      .rbh-report-btn:hover {
        background: rgba(255,255,255,0.95) !important;
      }
      .rbh-report-btn[aria-disabled="true"] {
        opacity: 0.6 !important;
        cursor: not-allowed !important;
      }
    `;
    document.head.appendChild(style);
  }

  /**********************
   * UTILS
   **********************/
  function normalizeUser(u) {
    return (u || "").trim().replace(/^u\//i, "").toLowerCase();
  }

  function isBot(username) {
    if (!username) return false;
    const u = normalizeUser(username);
    return PERMANENT_BOTS.has(u) || blacklist.has(u);
  }

  function refreshIntervalMs() {
    return Math.max(5000, REFRESH_HOURS * 60 * 60 * 1000);
  }

  function alreadyProcessed(el) {
    return el.getAttribute("data-rbh-run") === String(rulesVersion);
  }

  function markProcessed(el) {
    el.setAttribute("data-rbh-run", String(rulesVersion));
  }

  const userAboutCache = new Map(); // username -> { createdUtc, commentKarma, postKarma } | null

  function safeText(s, max = 280) {
    const t = (s || "").replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max) + "…" : t;
  }

  function findPermalink(el) {
    // Old reddit
    const a1 = el.querySelector('a[data-event-action="permalink"]');
    if (a1?.href) return a1.href;

    const a2 = el.querySelector("a.bylink");
    if (a2?.href) return a2.href;

    const a3 = el.querySelector("time a");
    if (a3?.href) return a3.href;

    // New reddit
    const a4 =
      el.querySelector('a[data-testid="comment_timestamp"]') ||
      el.querySelector('a[href*="/comments/"][href*="/"]');

    if (a4?.href) return a4.href;

    return location.href;
  }

  function extractCommentIdFromLink(url) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      // common: /r/sub/comments/<postId>/<slug>/<commentId>/
      const last = parts[parts.length - 1];
      if (last && /^[a-z0-9]+$/i.test(last)) return last;
      return null;
    } catch {
      return null;
    }
  }

  function getCommentText(el) {
    // Old reddit
    const old = el.querySelector(".usertext-body");
    if (old) return safeText(old.innerText, 500);

    // New reddit / shreddit
    const newTxt =
      el.querySelector('[data-testid="comment"]') ||
      el.querySelector("shreddit-comment") ||
      el;

    return safeText(newTxt.innerText, 500);
  }

  async function fetchUserAbout(username) {
    const u = normalizeUser(username);
    if (!u) return null;
    if (userAboutCache.has(u)) return userAboutCache.get(u);

    const url = `${location.origin}/user/${encodeURIComponent(u)}/about.json?raw_json=1`;

    try {
      const res = await fetch(url, {
        cache: "no-store",
        credentials: "include"
      });

      if (!res.ok) {
        userAboutCache.set(u, null);
        return null;
      }

      const j = await res.json();
      const data = j?.data;

      const about = data
        ? {
            createdUtc: data.created_utc ?? null,
            commentKarma: data.comment_karma ?? null,
            postKarma: data.link_karma ?? null
          }
        : null;

      userAboutCache.set(u, about);
      return about;
    } catch {
      userAboutCache.set(u, null);
      return null;
    }
  }

  function buildIssueUrl({ title, bodyObj }) {
    const body = JSON.stringify(bodyObj, null, 2);
    return (
      `${GITHUB_ISSUES_NEW_URL}` +
      `?title=${encodeURIComponent(title)}` +
      `&body=${encodeURIComponent(body)}`
    );
  }

  /**********************
   * SETTINGS
   **********************/
  async function loadSettings() {
    const stored = await chrome.storage.sync.get(SETTINGS_DEFAULTS);
    settings = { ...SETTINGS_DEFAULTS, ...stored };

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      let changed = false;

      for (const k of Object.keys(SETTINGS_DEFAULTS)) {
        if (changes[k]) {
          settings[k] = changes[k].newValue;
          changed = true;
        }
      }

      if (changed) {
        rulesVersion++;
        scanPage();
      }
    });
  }

  /**********************
   * BLACKLIST
   **********************/
  const CACHE_KEY = "rbh_blacklist_cache_v1";

  async function loadBlacklistCache() {
    const data = await chrome.storage.local.get(CACHE_KEY);
    if (data[CACHE_KEY]?.users) {
      blacklist = new Set(data[CACHE_KEY].users);
    }
  }

  async function fetchBlacklist() {
    const res = await fetch(`${GITHUB_BLACKLIST_URL}?t=${Date.now()}`, {
      cache: "no-store"
    });
    if (!res.ok) return;

    const json = await res.json();
    const users = (json.users || []).map(normalizeUser);
    const newSet = new Set(users);

    let changed = false;
    if (newSet.size !== blacklist.size) changed = true;
    else for (const u of newSet) if (!blacklist.has(u)) changed = true;

    if (changed) {
      blacklist = newSet;
      await chrome.storage.local.set({
        [CACHE_KEY]: { users }
      });
      rulesVersion++;
      scanPage();
    }
  }

  /**********************
   * OLD REDDIT TOGGLE (CSP-SAFE)
   **********************/
  function ensureOldRedditToggle(el) {
    const btn = el.querySelector("a.expand");
    if (!btn) return;

    if (btn.getAttribute("data-rbh-toggle") === "1") return;
    btn.setAttribute("data-rbh-toggle", "1");

    // Prevent old reddit javascript:... execution
    btn.setAttribute("href", "#");
    btn.style.cursor = "pointer";

    const updateText = () => {
      btn.textContent = el.classList.contains("rbh-old-collapsed") ? "[+]" : "[-]";
    };

    updateText();

    btn.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopPropagation();

        el.classList.toggle("rbh-old-collapsed");
        el.classList.toggle("collapsed"); // optional reddit styling
        el.setAttribute(
          "data-rbh-collapsed",
          el.classList.contains("rbh-old-collapsed") ? "1" : ""
        );

        updateText();
      },
      true
    );
  }

  /**********************
   * REDDIT COLLAPSE
   **********************/
  function collapseOldReddit(el) {
    ensureOldRedditToggle(el);

    // If already collapsed by us, don't re-collapse
    if (el.classList.contains("rbh-old-collapsed")) return;

    el.classList.add("rbh-old-collapsed");
    el.classList.add("collapsed"); // optional
    el.setAttribute("data-rbh-collapsed", "1");

    const btn = el.querySelector("a.expand");
    if (btn) btn.textContent = "[+]";
  }

  function collapseNewReddit(el) {
    if (el.getAttribute("data-rbh-collapsed")) return;

    const btn =
      el.querySelector('button[aria-label*="Collapse"]') ||
      el.querySelector('button[aria-label*="collapse"]');

    if (btn) {
      btn.click();
      el.setAttribute("data-rbh-collapsed", "1");
    }
  }

  function collapse(el) {
    if (location.hostname.startsWith("old.")) collapseOldReddit(el);
    else collapseNewReddit(el);
  }

  /**********************
   * APPLY LOGIC
   **********************/
  function ensureLabel(link, enable) {
    if (!link) return;
    const existing = link.parentElement?.querySelector(`.${BOT_LABEL_CLASS}`);

    if (enable && !existing) {
      const span = document.createElement("span");
      span.className = BOT_LABEL_CLASS;
      span.textContent = BOT_LABEL_TEXT;
      link.after(span);
    } else if (!enable && existing) {
      existing.remove();
    }
  }

  function ensureReportButton(el, authorLink, username) {
    if (!authorLink) return;

    const existing = authorLink.parentElement?.querySelector(".rbh-report-btn");
    if (existing) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rbh-report-btn";
    btn.textContent = "Report bot";
    btn.title = "GitHub issue aç (comment + user sinyalleriyle)";

    btn.addEventListener(
      "click",
      async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (btn.getAttribute("aria-disabled") === "true") return;

        btn.setAttribute("aria-disabled", "true");
        const oldText = btn.textContent;
        btn.textContent = "Loading…";

        try {
          const permalink = findPermalink(el);
          const commentId = extractCommentIdFromLink(permalink);
          const author = normalizeUser(username);

          const about = await fetchUserAbout(author);

          const nowIso = new Date().toISOString();
          const ageDays =
            about?.createdUtc
              ? Math.floor((Date.now() / 1000 - about.createdUtc) / 86400)
              : null;

          const bodyObj = {
            type: "bot_report",
            platform: "reddit",
            collectedAtUtc: nowIso,
            pageUrl: location.href,
            permalink,
            commentId,
            reportedUser: author || null,
            reportedUserAgeDays: ageDays,
            postKarma: about?.postKarma ?? null,
            commentKarma: about?.commentKarma ?? null,
            snippet: getCommentText(el)
          };

          const title = `Bot report: u/${author || "unknown"} (${commentId || "no-comment-id"})`;
          const issueUrl = buildIssueUrl({ title, bodyObj });

          window.open(issueUrl, "_blank", "noopener,noreferrer");
        } finally {
          btn.textContent = oldText;
          btn.setAttribute("aria-disabled", "false");
        }
      },
      true
    );

    authorLink.after(btn);
  }

  function apply(el, authorLink, username) {
    if (!el || alreadyProcessed(el)) return;
    markProcessed(el);

    injectCss();
    el.classList.remove("rbh-flagged", "rbh-hidden");

    // Make sure old reddit toggle always works (even for non-bots)
    if (location.hostname.startsWith("old.")) ensureOldRedditToggle(el);

    // Always allow manual reporting (istiyorsan sadece botlarda yap: if (isBot(username)) ...)
    ensureReportButton(el, authorLink, username);

    if (!isBot(username)) {
      ensureLabel(authorLink, false);
      return;
    }

    if (settings.remove) {
      el.classList.add("rbh-hidden");
      return;
    }

    if (settings.red) {
      el.classList.add("rbh-flagged");
      ensureLabel(authorLink, true);
    } else {
      ensureLabel(authorLink, false);
    }

    if (settings.minimise) collapse(el);
  }

  /**********************
   * SCANNING
   **********************/
  function handleComment(el) {
    const link =
      el.querySelector('a[href^="/user/"]') ||
      el.querySelector("a.author");

    if (!link) return;

    const username =
      link.textContent ||
      link.getAttribute("href")?.split("/user/")[1];

    apply(el, link, username);
  }

  function scanPage() {
    if (location.hostname.startsWith("old.")) {
      document.querySelectorAll(".comment").forEach(handleComment);
    } else {
      document
        .querySelectorAll("shreddit-comment, div[data-testid='comment']")
        .forEach(handleComment);
    }
  }

  function observe() {
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n instanceof HTMLElement) scanPage();
        }
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  /**********************
   * START
   **********************/
  (async () => {
    await loadSettings();
    await loadBlacklistCache();
    await fetchBlacklist();

    scanPage();
    observe();

    setInterval(fetchBlacklist, refreshIntervalMs());
  })();
})();
