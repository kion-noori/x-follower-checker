// Content script — runs on x.com
// Uses X's internal REST API (same calls the website makes) to fetch
// following list, followers list, and last tweet date for each account.

const INACTIVITY_MONTHS = 9;
const API_BASES = [
  "https://x.com/i/api/1.1",
  "https://api.x.com/1.1",
];
const BEARER_TOKEN_RE = /(?:Bearer\s+)?(AAAAA[A-Za-z0-9%_-]{20,})/;

let isScanning = false;
let bearerTokenPromise = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getCookie(name) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? match[2] : null;
}

function getTwidUserId() {
  const twid = getCookie("twid");
  if (!twid) return null;

  try {
    const decoded = decodeURIComponent(twid);
    const match = decoded.match(/u=(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function extractBearerToken(text) {
  if (!text) return null;
  const match = text.match(BEARER_TOKEN_RE);
  return match ? match[1] : null;
}

async function fetchScriptText(url) {
  try {
    const response = await fetch(url, {
      credentials: "include",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function discoverBearerToken() {
  const inlineScripts = Array.from(document.querySelectorAll("script"))
    .map((script) => script.textContent || "")
    .filter(Boolean);

  for (const scriptText of inlineScripts) {
    const token = extractBearerToken(scriptText);
    if (token) return token;
  }

  const currentHtml = await fetchScriptText(window.location.href);
  const pageToken = extractBearerToken(currentHtml);
  if (pageToken) return pageToken;

  const assetUrls = new Set(
    Array.from(document.querySelectorAll("script[src]"))
      .map((script) => script.src)
      .filter(Boolean)
  );

  document
    .querySelectorAll('link[href][rel="preload"], link[href][rel="modulepreload"]')
    .forEach((link) => {
      if (link.href) assetUrls.add(link.href);
    });

  performance.getEntriesByType("resource").forEach((entry) => {
    if (entry.name) assetUrls.add(entry.name);
  });

  const scriptUrls = Array.from(assetUrls)
    .filter((url) => /\.js($|\?)/.test(url))
    .filter((url) => /twimg\.com|x\.com|twitter\.com/.test(url));

  for (const url of scriptUrls.slice(0, 30)) {
    const scriptText = await fetchScriptText(url);
    const token = extractBearerToken(scriptText);
    if (token) return token;
  }

  throw new Error(
    `Could not find X's web client bearer token in the loaded page assets (${scriptUrls.length} JS assets checked).`
  );
}

async function getBearerToken() {
  const capturedToken = document.documentElement.dataset.xfcBearerToken;
  if (capturedToken) return capturedToken;

  if (!bearerTokenPromise) {
    bearerTokenPromise = discoverBearerToken().catch((error) => {
      bearerTokenPromise = null;
      throw error;
    });
  }
  return bearerTokenPromise;
}

async function getAuthHeaders() {
  const csrfToken = getCookie("ct0");
  if (!csrfToken) {
    throw new Error("Not logged in to X. Please log in and try again.");
  }

  const bearerToken = await getBearerToken();

  return {
    authorization: `Bearer ${bearerToken}`,
    "x-csrf-token": csrfToken,
    "content-type": "application/json",
    "x-twitter-active-user": "yes",
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-client-language": "en",
  };
}

function buildApiUrls(pathAndQuery) {
  return API_BASES.map((base) => `${base}${pathAndQuery}`);
}

async function apiFetch(pathAndQuery, retries = 3) {
  let lastError = null;

  for (const url of buildApiUrls(pathAndQuery)) {
    for (let attempt = 0; attempt < retries; attempt++) {
      const response = await fetch(url, {
        headers: await getAuthHeaders(),
        credentials: "include",
        signal: AbortSignal.timeout(20000),
      });

      if (response.status === 429) {
        const resetHeader = response.headers.get("x-rate-limit-reset");
        const waitMs = resetHeader
          ? Math.max(parseInt(resetHeader, 10) * 1000 - Date.now(), 1000)
          : 60000;
        sendProgress(0, null, "ratelimit", Math.ceil(waitMs / 1000));
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        const detail = bodyText
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180);

        lastError = new Error(
          `API error ${response.status} on ${new URL(url).hostname}${new URL(url).pathname}${
            detail ? ` - ${detail}` : ""
          }`
        );

        // Some endpoints only exist on one host, and auth behavior can differ
        // between hosts, so allow fallback for these statuses.
        if ([401, 403, 404].includes(response.status)) {
          break;
        }

        throw lastError;
      }

      try {
        return await response.json();
      } catch {
        throw new Error("Unexpected response from X API. Please try again.");
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("Too many retries. X may be rate-limiting this request.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendProgress(current, total, stage, extra) {
  chrome.runtime.sendMessage({
    type: "SCAN_PROGRESS",
    current,
    total,
    stage,
    extra,
  });
}

// ─── Get current user ID ─────────────────────────────────────────────────────

async function getMyUserId() {
  const twidUserId = getTwidUserId();
  if (twidUserId) return twidUserId;

  // Try to find the logged-in user's ID from script tags on the page.
  // We look for a pattern close to "id_str" + "screen_name" to avoid
  // matching tweet or other user IDs.
  const scripts = document.querySelectorAll("script");
  for (const s of scripts) {
    const match = s.textContent.match(/"id_str"\s*:\s*"(\d+)"[^}]{0,300}"screen_name"/);
    if (match) return match[1];
  }

  // Fallback: verify_credentials endpoint
  const data = await apiFetch(
    "/account/verify_credentials.json?include_entities=false&skip_status=true&include_email=false"
  );
  if (!data.id_str) throw new Error("Could not determine your user ID. Make sure you are logged in to X.");
  return data.id_str;
}

// ─── Fetch paginated following list ─────────────────────────────────────────

async function fetchFollowing(userId) {
  const following = [];
  let cursor = -1;

  while (true) {
    const url = `/friends/list.json?user_id=${userId}&count=200&skip_status=false&include_user_entities=false${
      cursor !== -1 ? `&cursor=${cursor}` : ""
    }`;

    const data = await apiFetch(url);
    const users = (data.users || []).filter(
      (u) => u && u.id_str && u.screen_name
    );
    following.push(...users);

    sendProgress(following.length, null, "following");

    if (!data.next_cursor || data.next_cursor === 0) break;
    cursor = data.next_cursor_str;
    await sleep(1000);
  }

  return following;
}

// ─── Fetch paginated followers list ─────────────────────────────────────────

async function fetchFollowers(userId) {
  const followers = new Set();
  let cursor = -1;

  while (true) {
    const url = `/followers/ids.json?user_id=${userId}&count=5000&stringify_ids=true${
      cursor !== -1 ? `&cursor=${cursor}` : ""
    }`;

    const data = await apiFetch(url);
    const ids = data.ids || data.ids_str || [];
    ids.forEach((id) => followers.add(String(id)));

    sendProgress(followers.size, null, "followers");

    if (!data.next_cursor || data.next_cursor === 0) break;
    cursor = data.next_cursor_str;
    await sleep(1000);
  }

  return followers;
}

// ─── Inactivity check using real calendar months ─────────────────────────────

function isInactive(lastTweetDate) {
  if (!lastTweetDate) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - INACTIVITY_MONTHS);
  return lastTweetDate < cutoff;
}

function getLastTweetDate(user) {
  if (user.status && user.status.created_at) {
    return new Date(user.status.created_at);
  }
  return null;
}

// ─── Main scan ───────────────────────────────────────────────────────────────

async function runScan() {
  if (isScanning) return;
  isScanning = true;

  // 10-minute hard timeout
  const timeoutId = setTimeout(() => {
    isScanning = false;
    chrome.runtime.sendMessage({
      type: "SCAN_ERROR",
      error: "Scan timed out after 10 minutes. Try again — large accounts may need multiple attempts due to rate limits.",
    });
  }, 10 * 60 * 1000);

  try {
    sendProgress(0, null, "init");

    const userId = await getMyUserId();

    sendProgress(0, null, "following");
    const following = await fetchFollowing(userId);

    sendProgress(0, null, "followers");
    const followerIds = await fetchFollowers(userId);

    sendProgress(0, following.length, "analyzing");

    const now = Date.now();

    const results = following.map((user, i) => {
      sendProgress(i + 1, following.length, "analyzing");

      const followsBack = followerIds.has(String(user.id_str));
      const lastTweetDate = getLastTweetDate(user);
      const inactive = isInactive(lastTweetDate);
      const daysSinceActive = lastTweetDate
        ? Math.floor((now - lastTweetDate.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        id: user.id_str,
        name: user.name,
        username: user.screen_name,
        profileImage: user.profile_image_url_https,
        followersCount: user.followers_count,
        followingCount: user.friends_count,
        followsBack,
        isInactive: inactive,
        daysSinceActive,
        lastTweetDate: lastTweetDate ? lastTweetDate.toISOString() : null,
        verified: user.verified || user.is_blue_verified || false,
      };
    });

    chrome.runtime.sendMessage({
      type: "ANALYSIS_DATA",
      results,
      scannedAt: new Date().toISOString(),
      myUserId: userId,
    });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: "SCAN_ERROR",
      error: err.message,
    });
  } finally {
    clearTimeout(timeoutId);
    isScanning = false;
  }
}

// ─── Listen for messages from background/sidebar ─────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "START_SCAN") {
    runScan().catch((err) => {
      chrome.runtime.sendMessage({
        type: "SCAN_ERROR",
        error: err.message,
      });
    });
    sendResponse({ ok: true });
  }
});
