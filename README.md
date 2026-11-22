# DSA Contest Arena

A contest-first practice dashboard for Codeforces, CodeChef and LeetCode.

## Features
- Separate contest archive for all three platforms.
- Codeforces division filters (Div. 1–4 and combined rounds where identified).
- Search, bookmarks and local solved-problem tracking.
- Codeforces problem index with tags and ratings.
- Browser notification permission prompt for upcoming contests.
- Daily GitHub Actions sync at 01:17 UTC, plus manual workflow dispatch.

## Run locally
```bash
npm install
npm run dev
```

## Data synchronization
```bash
node scripts/sync.mjs
```
The sync job uses public platform endpoints. Codeforces provides the most complete structured problem metadata. CodeChef and LeetCode endpoints can change or restrict automated access; failures are recorded in `public/data/contests.json` rather than inventing contest records. Check workflow runs and source warnings after each sync.

## Deploy
Import this repository into Vercel. Framework: Vite; build command: `npm run build`; output directory: `dist`. No environment variables are required for the initial static build.

## Notes
Solved status and bookmarks are stored in browser local storage and are device/browser-specific. Desktop notifications require browser permission and an open site session. Push notifications while the site is closed require a service worker and push-subscription backend, not included in this initial version.
