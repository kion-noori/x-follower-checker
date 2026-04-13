# X Follower Checker

A Chrome extension that scans your X (Twitter) following list and surfaces accounts that:

- **Don't follow you back**
- **Have been inactive for 9+ months**

No external servers. No API keys. Everything runs locally in your browser using the same session X uses for its own web app.

## Features

- Side panel UI — stays open while you browse X
- Progress bar with live stage labels (fetching following → followers → analyzing)
- Automatic rate-limit handling — waits and retries if X throttles the request
- 3 tabs: No Follow-Back / Inactive / All
- Search by name or @handle
- Sort by: priority first, most inactive, follower count, A–Z
- One-click "View" button to open a profile in your current X tab

## Current Status

This is a working developer build for manual testing in Chrome. It is not published in the Chrome Web Store yet.

## Installation (Developer / Unpacked)

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked** and select this folder
5. Open [x.com](https://x.com) and make sure you're logged in
6. Click the extension icon → side panel opens
7. Click **Scan Now**

> Scanning a large following list (10k+) can take several minutes due to X's rate limits. The extension handles this automatically.

## How It Works

The extension uses X's own internal REST API endpoints — the same ones the x.com website calls in your browser. It authenticates using your existing session cookie (`ct0` CSRF token + the web client bearer token embedded in X's public JS bundle). No credentials are ever sent to any third-party server.

**Endpoints used:**
- `GET /1.1/friends/list.json` — paginated following list (200 per page)
- `GET /1.1/followers/ids.json` — paginated follower ID list (5000 per page)
- `GET /1.1/account/verify_credentials.json` — fallback to get your user ID

All data stays in your browser. Nothing is stored except a temporary cache in `chrome.storage.local` to hand off results from the content script to the side panel.

## Privacy

This extension does not collect, transmit, or store any data outside of your local browser. No analytics, no external requests, no servers. See [PRIVACY.md](PRIVACY.md) for the full policy (required for Chrome Web Store listing).

## Chrome Web Store

Not yet published. Planned for a future release.

## Development

The extension is plain HTML/CSS/JS — no build step required.

```
x-follower-checker/
├── manifest.json      # Extension config (Manifest V3)
├── background.js      # Service worker — message routing
├── content.js         # Runs on x.com — makes API calls
├── sidebar.html       # Side panel UI + styles
├── sidebar.js         # Side panel logic
└── icons/             # Extension icons (16, 48, 128px)
```

To reload changes: go to `chrome://extensions` and click the refresh icon on the extension card.

## License

MIT
