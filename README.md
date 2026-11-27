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
- Unified problem index across Codeforces, CodeChef and LeetCode, with platform filters, tags and available difficulty/rating metadata.
- Browser notifications for newly detected upcoming contests (requires permission and an open site session).
- Automated GitHub Actions sync: primary run at **07:32 IST**, with hourly fallback attempts at **08:32, 09:32 and 10:32 IST**. The workflow skips later attempts after one successful sync for the current India calendar day.
- Admin-only manual sync is available from the dashboard. It requires `GITHUB_ACTIONS_TOKEN` in Vercel Production, with GitHub Actions write permission for this repository.

## Data synchronization
Run locally:
```bash
npm install
node scripts/sync.mjs
```

The sync job uses:
- Codeforces `contest.list` and `problemset.problems` APIs.
- CodeChef contest feeds plus the paginated public `api/list/problems` catalogue.
- LeetCode GraphQL contest feed and paginated public problemset query (cached into the static dataset once per sync).

The generated `public/data/contests.json` and `public/data/problems.json` include matching sync timestamps and per-platform counts. A sync is rejected unless all three contest feeds and all three problem feeds are non-empty and fully paginated; existing known-good datasets are preserved on provider failure.

## Deploy
Import this repository into Vercel. Framework: Vite; build command: `npm run build`; output directory: `dist`. No environment variables are required for the static frontend.

## Notes
Solved status and bookmarks are stored in browser local storage and are device/browser-specific. Desktop notifications require browser permission and an open site session. Push notifications while the site is closed require a service worker and push-subscription backend, not included in this version.
