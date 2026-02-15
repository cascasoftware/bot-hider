(() => {
  "use strict";

  /**********************
   * CONFIG
   **********************/
  const GITHUB_BLACKLIST_URL =
    "https://raw.githubusercontent.com/cascasoftware/bot-hider/main/blacklists/reddit.json";

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
   * REDDIT COLLAPSE
   **********************/
  function collapseOldReddit(el) {
    const btn = el.querySelector("a.expand");
    if (btn && !el.classList.contains("collapsed")) btn.click();
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

  function apply(el, authorLink, username) {
    if (!el || alreadyProcessed(el)) return;
    markProcessed(el);

    injectCss();
    el.classList.remove("rbh-flagged", "rbh-hidden");

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
