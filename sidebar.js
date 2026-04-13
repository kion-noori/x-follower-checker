// Sidebar panel logic

let allResults = [];
let activeTab = "nofollow";
let searchQuery = "";
let sortMode = "priority";
let searchDebounceTimer = null;

// ─── DOM refs ────────────────────────────────────────────────────────────────

const scanBtn = document.getElementById("scanBtn");
const progressWrap = document.getElementById("progressWrap");
const progressLabel = document.getElementById("progressLabel");
const progressFill = document.getElementById("progressFill");
const errorBox = document.getElementById("errorBox");
const welcome = document.getElementById("welcome");
const statsBar = document.getElementById("statsBar");
const scannedAt = document.getElementById("scannedAt");
const tabs = document.getElementById("tabs");
const filterBar = document.getElementById("filterBar");
const searchInput = document.getElementById("searchInput");
const sortSelect = document.getElementById("sortSelect");

const statTotal = document.getElementById("statTotal");
const statNoFollow = document.getElementById("statNoFollow");
const statInactive = document.getElementById("statInactive");

const countNoFollow = document.getElementById("countNoFollow");
const countInactive = document.getElementById("countInactive");
const countAll = document.getElementById("countAll");

// ─── Scan button ─────────────────────────────────────────────────────────────

scanBtn.addEventListener("click", () => {
  startScan();
});

function startScan() {
  if (scanBtn.disabled) return;
  scanBtn.disabled = true;
  scanBtn.textContent = "Scanning…";
  showError(null);
  showProgress("Starting scan…", 0);

  // Guard: if the sidebar loses the response (e.g. closed/reopened), re-enable after 15min
  const scanGuardTimer = setTimeout(() => {
    resetScanBtn();
    hideProgress();
  }, 15 * 60 * 1000);

  chrome.runtime.sendMessage({ type: "START_SCAN" }, (response) => {
    if (chrome.runtime.lastError || (response && response.error)) {
      clearTimeout(scanGuardTimer);
      const msg =
        (response && response.error) ||
        chrome.runtime.lastError?.message ||
        "Unknown error";
      showError(msg);
      resetScanBtn();
      hideProgress();
    }
  });
}

// ─── Message listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SCAN_PROGRESS") {
    handleProgress(message);
  }
  if (message.type === "ANALYSIS_DATA") {
    handleResults(message);
  }
  if (message.type === "SCAN_ERROR") {
    showError(message.error);
    resetScanBtn();
    hideProgress();
  }
});

// Also check for data that arrived before the sidebar was open
chrome.runtime.sendMessage({ type: "GET_PENDING_DATA" }, (data) => {
  if (data && data.results) {
    handleResults(data);
  }
});

// ─── Progress handling ───────────────────────────────────────────────────────

function handleProgress({ current, total, stage, extra }) {
  const stageLabels = {
    init: "Initializing…",
    following: `Fetching following list… (${current} loaded)`,
    followers: `Fetching your followers… (${current} loaded)`,
    analyzing: `Analyzing accounts… (${current} / ${total})`,
    ratelimit: `Rate limited by X — waiting ${extra}s…`,
  };
  const label = stageLabels[stage] || "Working…";
  const pct =
    stage === "analyzing" && total > 0
      ? Math.round((current / total) * 100)
      : stage === "following" || stage === "followers" || stage === "ratelimit"
      ? null
      : 0;

  showProgress(label, pct);
}

function showProgress(label, pct) {
  progressWrap.classList.add("visible");
  progressLabel.textContent = label;
  if (pct !== null) {
    progressFill.style.width = `${pct}%`;
  } else {
    // Indeterminate — animate back and forth via width pulse
    progressFill.style.width = "40%";
  }
}

function hideProgress() {
  progressWrap.classList.remove("visible");
}

// ─── Results handling ────────────────────────────────────────────────────────

function handleResults({ results, scannedAt: ts }) {
  allResults = results;
  renderAll(ts);
  resetScanBtn();
  hideProgress();
}

function renderAll(ts) {
  // Update stats
  const noFollow = allResults.filter((u) => !u.followsBack);
  const inactive = allResults.filter((u) => u.isInactive);

  statTotal.textContent = allResults.length;
  statNoFollow.textContent = noFollow.length;
  statInactive.textContent = inactive.length;

  countNoFollow.textContent = noFollow.length;
  countInactive.textContent = inactive.length;
  countAll.textContent = allResults.length;

  if (ts) {
    scannedAt.textContent = `Last scanned: ${new Date(ts).toLocaleString()}`;
    scannedAt.classList.add("visible");
  }

  // Show UI elements
  welcome.style.display = "none";
  statsBar.classList.add("visible");
  tabs.classList.add("visible");
  filterBar.classList.add("visible");

  renderCurrentTab();
}

// ─── Tab switching ────────────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    activeTab = tab.dataset.tab;
    document.getElementById(`panel-${activeTab}`).classList.add("active");
    renderCurrentTab();
  });
});

// ─── Search & sort ────────────────────────────────────────────────────────────

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchQuery = searchInput.value.toLowerCase().trim();
    renderCurrentTab();
  }, 200);
});

sortSelect.addEventListener("change", () => {
  sortMode = sortSelect.value;
  renderCurrentTab();
});

// ─── Render ───────────────────────────────────────────────────────────────────

function getTabData() {
  switch (activeTab) {
    case "nofollow":
      return allResults.filter((u) => !u.followsBack);
    case "inactive":
      return allResults.filter((u) => u.isInactive);
    case "all":
    default:
      return allResults;
  }
}

function applySearchAndSort(data) {
  // Search
  if (searchQuery) {
    data = data.filter(
      (u) =>
        u.name.toLowerCase().includes(searchQuery) ||
        u.username.toLowerCase().includes(searchQuery)
    );
  }

  // Sort
  switch (sortMode) {
    case "priority":
      data = data.sort((a, b) => {
        const scoreA = (!a.followsBack ? 2 : 0) + (a.isInactive ? 1 : 0);
        const scoreB = (!b.followsBack ? 2 : 0) + (b.isInactive ? 1 : 0);
        if (scoreB !== scoreA) return scoreB - scoreA;
        // Secondary: most inactive days
        return (b.daysSinceActive || 9999) - (a.daysSinceActive || 9999);
      });
      break;
    case "inactive_days":
      data = data.sort(
        (a, b) => (b.daysSinceActive || 9999) - (a.daysSinceActive || 9999)
      );
      break;
    case "followers_asc":
      data = data.sort((a, b) => a.followersCount - b.followersCount);
      break;
    case "followers_desc":
      data = data.sort((a, b) => b.followersCount - a.followersCount);
      break;
    case "alpha":
      data = data.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }

  return data;
}

function renderCurrentTab() {
  const panel = document.getElementById(`panel-${activeTab}`);
  const data = applySearchAndSort(getTabData());

  if (data.length === 0) {
    panel.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${activeTab === "all" ? "👋" : "🔍"}</div>
        <h3>${
          activeTab === "all" && !searchQuery
            ? "Nothing here yet"
            : "No results"
        }</h3>
        <p>${
          activeTab === "all" && !searchQuery
            ? "Run a scan to start reviewing your following list."
            : searchQuery
            ? "No accounts match your search."
            : "Nothing to show in this category."
        }</p>
      </div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  data.forEach((user) => {
    const item = document.createElement("div");
    item.className = "user-item";

    // Avatar — use DOM to avoid inline onerror handler
    const img = document.createElement("img");
    img.className = "avatar";
    img.src = user.profileImage || "";
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => {
      img.src =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='20' fill='%231a1a1a'/%3E%3C/svg%3E";
    });

    // User info
    const userInfo = document.createElement("div");
    userInfo.className = "user-info";

    const nameDiv = document.createElement("div");
    nameDiv.className = "user-name";
    nameDiv.textContent = user.name;

    const handleDiv = document.createElement("div");
    handleDiv.className = "user-handle";
    handleDiv.textContent = `@${user.username}`;

    // Badges
    const badgesDiv = document.createElement("div");
    badgesDiv.className = "badges";
    if (!user.followsBack) {
      const b = document.createElement("span");
      b.className = "badge badge-no-follow";
      b.textContent = "No follow-back";
      badgesDiv.appendChild(b);
    }
    if (user.isInactive) {
      const b = document.createElement("span");
      b.className = "badge badge-inactive";
      b.textContent = "Inactive 9mo+";
      badgesDiv.appendChild(b);
    }

    const lastActive =
      user.daysSinceActive !== null
        ? user.daysSinceActive >= 365
          ? `${Math.floor(user.daysSinceActive / 365)}y ${Math.floor((user.daysSinceActive % 365) / 30)}mo ago`
          : `${Math.floor(user.daysSinceActive / 30)}mo ago`
        : "Never tweeted";

    const metaDiv = document.createElement("div");
    metaDiv.className = "user-meta";
    metaDiv.textContent = `${formatCount(user.followersCount)} followers · Last active: ${lastActive}`;

    userInfo.appendChild(nameDiv);
    userInfo.appendChild(handleDiv);
    userInfo.appendChild(badgesDiv);
    userInfo.appendChild(metaDiv);

    // View link
    const link = document.createElement("a");
    link.className = "action-btn";
    link.href = "#";
    link.textContent = "View";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openProfileInCurrentTab(user.username);
    });

    item.appendChild(img);
    item.appendChild(userInfo);
    item.appendChild(link);

    fragment.appendChild(item);
  });

  panel.innerHTML = "";
  panel.appendChild(fragment);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function resetScanBtn() {
  scanBtn.disabled = false;
  scanBtn.textContent = allResults.length > 0 ? "Re-scan" : "Scan Now";
}

function showError(msg) {
  if (!msg) {
    errorBox.classList.remove("visible");
    errorBox.textContent = "";
    return;
  }
  errorBox.classList.add("visible");
  errorBox.textContent = "Error: " + msg;
}

function openProfileInCurrentTab(username) {
  const profileUrl = `https://x.com/${encodeURIComponent(username)}`;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];

    if (!activeTab?.id) {
      window.open(profileUrl, "_blank", "noopener,noreferrer");
      return;
    }

    chrome.tabs.update(activeTab.id, { url: profileUrl }, () => {
      if (chrome.runtime.lastError) {
        window.open(profileUrl, "_blank", "noopener,noreferrer");
      }
    });
  });
}

function formatCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
