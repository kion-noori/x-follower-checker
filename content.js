// Content script — runs on x.com
// Uses X's internal REST API (same calls the website makes) to fetch
// following list, followers list, and last tweet date for each account.

const INACTIVITY_MONTHS = 9;

let isScanning = false;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getCookie(name) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? match[2] : null;
}

function getAuthHeaders() {
  const csrfToken = getCookie("ct0");
  if (!csrfToken) {
    throw new Error("Not logged in to X. Please log in and try again.");
  }

  // This is X's own web client bearer token — the same one used by x.com itself.
  // It is not a private credential; it is embedded in X's public JS bundle and
  // is required to authenticate the same way the website does.
  const bearerToken =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I7ssbG44SNs%3DEUifiRBkKG5E2XSoUoDSM0sDd3W2G0Whh4z3GHBEeVmDVJQHOVr";

  return {
    authorization: `Bearer ${bearerToken}`,
    "x-csrf-token": csrfToken,
    "content-type": "application/json",
    "x-twitter-active-user": "yes",
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-client-language": "en",
  };
}

async function apiFetch(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(url, {
      headers: getAuthHeaders(),
      credentials: "include",
      signal: AbortSignal.timeout(20000),
    });

    if (response.status === 429) {
      const resetHeader = response.headers.get("x-rate-limit-reset");
      const waitMs = resetHeader
        ? Math.max(parseInt(resetHeader) * 1000 - Date.now(), 1000)
        : 60000;
      sendProgress(0, null, "ratelimit", Math.ceil(waitMs / 1000));
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    try {
      return await response.json();
    } catch {
      throw new Error("Unexpected response from X API. Please try again.");
    }
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
    "https://api.x.com/1.1/account/verify_credentials.json?include_entities=false&skip_status=true&include_email=false"
  );
  if (!data.id_str) throw new Error("Could not determine your user ID. Make sure you are logged in to X.");
  return data.id_str;
}

// ─── Fetch paginated following list ─────────────────────────────────────────

async function fetchFollowing(userId) {
  const following = [];
  let cursor = -1;

  while (true) {
    const url = `https://api.x.com/1.1/friends/list.json?user_id=${userId}&count=200&skip_status=false&include_user_entities=false${
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
    const url = `https://api.x.com/1.1/followers/ids.json?user_id=${userId}&count=5000${
      cursor !== -1 ? `&cursor=${cursor}` : ""
    }`;

    const data = await apiFetch(url);
    const ids = data.ids || [];
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
  if (!lastTweetDate) return true;
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
