# Project Status

Last updated: 2026-04-13

## Summary

The extension is now working as a manual developer build in Chrome against a real logged-in X account.

Current user-facing behavior:

- Scans your following list and shows `No Follow-Back`, `Inactive`, and `All`
- Opens profile views in the current X tab
- Shows real inactivity durations in the sidebar when available
- Handles some X auth and content-script injection issues that blocked earlier test runs

## Where We Left Off

The project moved from "initial build" to "working manual test build."

Recent decisions:

- Kept `No Follow-Back` and `Inactive` as the main categories
- Removed the old `Both` category from the UI after manual testing showed it was confusing and not reliable enough yet
- Treated missing tweet/status data as "not enough evidence to mark inactive" instead of auto-flagging accounts as inactive
- Switched the `View` button to navigate the existing X tab instead of opening a new tab

## What Was Fixed Recently

- Added missing host permissions needed for X API access
- Added more reliable content-script startup behavior from the background worker
- Reworked auth so the extension captures the bearer token used by X's own web client instead of depending on a stale hardcoded token
- Read the logged-in user ID from the `twid` cookie first, with API fallback
- Requested follower IDs as strings to avoid large-number precision issues during follow-back matching
- Updated inactive badges to show real durations like `11mo ago` or `2y 3mo ago`

## Known Limitations

- No automated test suite yet
- No Chrome Web Store packaging or review prep yet beyond basic privacy/docs work
- Inactivity detection still depends on the account metadata returned by X for the following list
- Some edge cases may still exist for very large accounts or future X API changes

## Recommended Next Steps

1. Keep manually validating scan accuracy on a wider sample of accounts.
2. Check large-account behavior, especially around rate limits and long scans.
3. Decide whether to add export/history features or keep the product focused.
4. Add lightweight test coverage for the formatting and filtering logic in `sidebar.js` and the data-shaping logic in `content.js`.
5. If the project is meant for public release, finish Chrome Web Store listing materials and verify policy compliance.

## Manual Testing Notes

Things already manually observed in Chrome:

- Auth now works against a real logged-in account
- Some early false positives in follow-back detection were reduced after switching follower ID handling to strings
- Some early false positives in inactivity detection were reduced after stopping the app from treating missing status data as inactive
- The `Both` view was removed because it did not feel trustworthy enough in real use

## Important Files

- `content.js`: API access, auth handling, scan logic, inactivity evaluation
- `page-hook.js`: page-context bearer-token capture
- `background.js`: side panel behavior, message routing, content-script injection fallback
- `sidebar.js`: filtering, sorting, rendering, current-tab profile navigation
- `sidebar.html`: side panel structure and styles
- `README.md`: public-facing project overview

## Quick Restart Checklist

If picking this up in a future Codex session:

1. Read this file first.
2. Read `README.md`.
3. Inspect `git log --oneline -5`.
4. Reload the unpacked extension in Chrome before testing.
5. Test with a logged-in `x.com` tab already open.
