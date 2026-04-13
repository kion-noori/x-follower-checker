// Background service worker
// Opens the side panel when the extension icon is clicked

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// ─── Validate incoming ANALYSIS_DATA messages ─────────────────────────────────

function isValidAnalysisData(message) {
  return (
    message &&
    message.type === "ANALYSIS_DATA" &&
    Array.isArray(message.results) &&
    typeof message.scannedAt === "string" &&
    typeof message.myUserId === "string"
  );
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message,
        });
        return;
      }

      resolve({ ok: true, response });
    });
  });
}

function injectContentScript(tabId) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["content.js"],
      },
      () => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }

        resolve({ ok: true });
      }
    );
  });
}

async function startScanInTab(tabId) {
  let result = await sendMessageToTab(tabId, { type: "START_SCAN" });
  if (result.ok) {
    return result.response || { ok: true };
  }

  const missingReceiver =
    result.error &&
    (result.error.includes("Receiving end does not exist") ||
      result.error.includes("Could not establish connection"));

  if (!missingReceiver) {
    return {
      error: result.error || "Could not contact the X page.",
    };
  }

  const injectResult = await injectContentScript(tabId);
  if (!injectResult.ok) {
    return {
      error: `Could not inject scanner into the X tab: ${injectResult.error}`,
    };
  }

  result = await sendMessageToTab(tabId, { type: "START_SCAN" });
  if (result.ok) {
    return result.response || { ok: true };
  }

  return {
    error: result.error || "No response from content script after injection.",
  };
}

// ─── Message routing ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ANALYSIS_DATA") {
    if (!isValidAnalysisData(message)) {
      console.error("Invalid ANALYSIS_DATA message rejected");
      sendResponse({ error: "Invalid data format" });
      return;
    }
    chrome.runtime.sendMessage(message).catch(() => {
      // Sidebar may not be open yet — store it
      chrome.storage.local.set({ pendingData: message });
    });
    sendResponse({ ok: true });
  }

  if (message.type === "GET_PENDING_DATA") {
    chrome.storage.local.get("pendingData", (result) => {
      sendResponse(result.pendingData || null);
      chrome.storage.local.remove("pendingData");
    });
    return true; // keep channel open for async response
  }

  if (message.type === "CLEAR_DATA") {
    chrome.storage.local.remove("pendingData");
    sendResponse({ ok: true });
  }

  if (message.type === "START_SCAN") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const xTab = tabs.find(
        (t) => t.url && (t.url.includes("x.com") || t.url.includes("twitter.com"))
      );
      if (xTab) {
        startScanInTab(xTab.id)
          .then((response) => {
            sendResponse(response);
          })
          .catch((error) => {
            sendResponse({
              error: error?.message || "Failed to start the scan.",
            });
          });
      } else {
        sendResponse({ error: "No X tab found. Please open x.com first." });
      }
    });
    return true;
  }

  if (message.type === "SCAN_PROGRESS" || message.type === "SCAN_ERROR") {
    chrome.runtime.sendMessage(message).catch(() => {});
    sendResponse({ ok: true });
  }
});
