# DSA Contest Arena

A contest-first practice dashboard for Codeforces, CodeChef and LeetCode.

## Archive window
- Includes contests starting on or after **1 August 2026**.
- Excludes every contest before 1 August 2026.
- Keeps upcoming contests too, so the upcoming tab and new-contest alerts continue to work.
- The same date boundary is applied on every daily synchronization.

## Features
- Separate contest archive for Codeforces, CodeChef and LeetCode.
- Codeforces division filters (Div. 1–4 and combined rounds where identified).
- Search, bookmarks and local solved-problem tracking.
- Codeforces problem index filtered to contests in the archive window, with tags and ratings.
- Browser notifications for newly detected upcoming contests (requires permission and an open site session).
- Daily GitHub Actions sync at 01:17 UTC, plus manual workflow dispatch.

## Data synchronization
Run locally:
```bash
npm install
node scripts/sync.mjs
```

The sync job uses:
- Codeforces `contest.list` and `problemset.problems` APIs.
- CodeChef's live/upcoming contest endpoint and paginated `api/list/contests/past` endpoint.
- LeetCode GraphQL `allContests` query, with a GET fallback if POST is blocked.

The generated `public/data/contests.json` includes the sync timestamp, archive start date, per-platform counts and source warnings. The workflow does not fabricate contest records; inspect `sourceErrors` if a provider is unavailable.

## Deploy
Import this repository into Vercel. Framework: Vite; build command: `npm run build`; output directory: `dist`. No environment variables are required for the static frontend.

## Notes
Solved status and bookmarks are stored in browser local storage and are device/browser-specific. Desktop notifications require browser permission and an open site session. Push notifications while the site is closed require a service worker and push-subscription backend, not included in this version.
