import { mkdir, writeFile } from 'node:fs/promises';

const MIN_START_SECONDS = Math.floor(Date.parse('2026-08-01T00:00:00Z') / 1000);
const MIN_START_ISO = '2026-08-01T00:00:00Z';
const nowSeconds = Math.floor(Date.now() / 1000);
const lastSynced = new Date().toISOString();

const contests = [];
const problems = [];
const sourceErrors = [];

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DSA-Contest-Arena/1.0)',
      Accept: 'application/json, text/plain, */*',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function addContest(contest) {
  if (!contest.startTimeSeconds || contest.startTimeSeconds < MIN_START_SECONDS) return;
  contests.push(contest);
}

function phaseFromTimes(start, duration) {
  if (start > nowSeconds) return 'BEFORE';
  if (start + (duration || 0) > nowSeconds) return 'CODING';
  return 'FINISHED';
}

function cfDivision(name = '') {
  const normalized = name.replace(/\s+/g, ' ');
  if (/Div\.?\s*1\s*\+\s*Div\.?\s*2/i.test(normalized)) return 'Div. 1 + Div. 2';
  const matches = [...normalized.matchAll(/Div\.?\s*([1-4])/gi)];
  if (matches.length) return 'Div. ' + matches[matches.length - 1][1];
  return '';
}

async function syncCodeforces() {
  try {
    const data = await requestJson('https://codeforces.com/api/contest.list?gym=false');
    if (data.status !== 'OK') throw new Error(data.comment || 'Codeforces contest API error');

    const eligibleIds = new Set();
    for (const c of data.result) {
      if (!c.startTimeSeconds || c.startTimeSeconds < MIN_START_SECONDS) continue;
      eligibleIds.add(String(c.id));
      addContest({
        id: String(c.id),
        platform: 'Codeforces',
        name: c.name,
        startTimeSeconds: c.startTimeSeconds,
        phase: c.phase,
        durationSeconds: c.durationSeconds,
        division: cfDivision(c.name),
        url: `https://codeforces.com/contest/${c.id}`,
      });
    }

    const problemData = await requestJson('https://codeforces.com/api/problemset.problems');
    if (problemData.status !== 'OK') throw new Error(problemData.comment || 'Codeforces problemset API error');

    for (const p of problemData.result.problems) {
      if (!eligibleIds.has(String(p.contestId))) continue;
      problems.push({
        id: `cf-${p.contestId}-${p.index}-${(p.name || '').slice(0, 30)}`,
        platform: 'Codeforces',
        contestId: String(p.contestId),
        name: p.name,
        index: p.index,
        rating: p.rating || null,
        tags: p.tags || [],
        url: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`,
      });
    }
  } catch (error) {
    sourceErrors.push('Codeforces: ' + error.message);
  }
}

function addCodeChefContest(c) {
  const start = Date.parse(c.contest_start_date_iso || c.contest_start_date || '');
  if (!Number.isFinite(start)) return;
  const startSeconds = Math.floor(start / 1000);
  const durationSeconds = Number(c.contest_duration || 0) * 60;
  const code = c.contest_code || c.code;
  if (!code) return;

  addContest({
    id: 'cc-' + code,
    platform: 'CodeChef',
    name: c.contest_name || code,
    startTimeSeconds: startSeconds,
    phase: phaseFromTimes(startSeconds, durationSeconds),
    durationSeconds,
    division: '',
    url: 'https://www.codechef.com/' + code,
  });
}

async function syncCodeChef() {
  try {
    const liveAndFuture = await requestJson('https://www.codechef.com/api/list/contests/all');
    for (const c of [
      ...(liveAndFuture.present_contests || []),
      ...(liveAndFuture.future_contests || []),
    ]) addCodeChefContest(c);

    // The past endpoint is paginated in batches of 20. Read newest-first
    // until the last row on a page is older than the requested start date.
    let reachedStartDate = false;
    for (let offset = 0; offset <= 400 && !reachedStartDate; offset += 20) {
      const url = `https://www.codechef.com/api/list/contests/past?sort_by=START&sorting_order=desc&offset=${offset}&mode=all`;
      const page = await requestJson(url);
      const rows = page.contests || [];
      if (!rows.length) break;

      for (const c of rows) addCodeChefContest(c);

      const last = rows[rows.length - 1];
      const lastStart = Date.parse(last.contest_start_date_iso || last.contest_start_date || '');
      if (Number.isFinite(lastStart) && lastStart < Date.parse(MIN_START_ISO)) {
        reachedStartDate = true;
      }
      if (rows.length < 20) break;
    }
    if (!reachedStartDate) {
      sourceErrors.push('CodeChef: archive pagination ended before reaching 1 August 2026; verify historical coverage.');
    }
  } catch (error) {
    sourceErrors.push('CodeChef: ' + error.message);
  }
}

async function syncLeetCode() {
  const query = 'query { allContests { title titleSlug startTime duration } }';
  let data;

  try {
    data = await requestJson('https://leetcode.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://leetcode.com/contest/',
      },
      body: JSON.stringify({ query }),
    });
  } catch (postError) {
    // GET fallback helps when an environment blocks POST requests to GraphQL.
    try {
      const url = 'https://leetcode.com/graphql?query=' + encodeURIComponent(query);
      data = await requestJson(url, { headers: { Referer: 'https://leetcode.com/contest/' } });
    } catch (getError) {
      throw new Error(`GraphQL POST failed (${postError.message}); GET fallback failed (${getError.message})`);
    }
  }

  const list = data?.data?.allContests;
  if (!Array.isArray(list)) {
    const detail = data?.errors?.map(e => e.message).join('; ');
    throw new Error(detail || 'GraphQL response did not contain data.allContests');
  }

  for (const c of list) {
    const start = Number(c.startTime);
    const duration = Number(c.duration || 0);
    if (!start || !c.titleSlug) continue;
    addContest({
      id: 'lc-' + c.titleSlug,
      platform: 'LeetCode',
      name: c.title,
      startTimeSeconds: start,
      phase: phaseFromTimes(start, duration),
      durationSeconds: duration,
      division: '',
      url: 'https://leetcode.com/contest/' + c.titleSlug + '/',
    });
  }
}

await Promise.all([
  syncCodeforces(),
  syncCodeChef(),
  syncLeetCode().catch(error => sourceErrors.push('LeetCode: ' + error.message)),
]);

// Deduplicate by platform + URL, keeping the most complete/latest record.
const unique = new Map();
for (const c of contests) {
  const key = c.platform + '|' + c.url;
  const existing = unique.get(key);
  if (!existing || (c.durationSeconds && !existing.durationSeconds)) unique.set(key, c);
}
const finalContests = [...unique.values()].sort((a, b) => b.startTimeSeconds - a.startTimeSeconds);

await mkdir('public/data', { recursive: true });
await writeFile('public/data/contests.json', JSON.stringify({
  lastSynced,
  rangeStart: MIN_START_ISO,
  contests: finalContests,
  sourceCounts: finalContests.reduce((counts, c) => {
    counts[c.platform] = (counts[c.platform] || 0) + 1;
    return counts;
  }, {}),
  sourceErrors,
}, null, 2));

await writeFile('public/data/problems.json', JSON.stringify({
  lastSynced,
  rangeStart: MIN_START_ISO,
  problems,
}, null, 2));

console.log(`Synced ${finalContests.length} contests since 2026-08-01 and ${problems.length} Codeforces problems.`);
console.log('Platform counts:', finalContests.reduce((counts, c) => {
  counts[c.platform] = (counts[c.platform] || 0) + 1;
  return counts;
}, {}));
console.log('Source warnings:', sourceErrors);
