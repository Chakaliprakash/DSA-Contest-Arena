import { mkdir, writeFile } from 'node:fs/promises';

const MIN_START_SECONDS = Math.floor(Date.parse('2026-08-01T00:00:00Z') / 1000);
const MIN_START_ISO = '2026-08-01T00:00:00Z';
const nowSeconds = Math.floor(Date.now() / 1000);
const lastSynced = new Date().toISOString();

const contests = [];
const problems = [];
const sourceErrors = [];

async function requestJson(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DSA-Contest-Arena/1.0)',
          Accept: 'application/json, text/plain, */*',
          ...(options.headers || {}),
        },
      });
      if (!response.ok) {
        const error = new Error(`${url} returned HTTP ${response.status}`);
        if (response.status < 500 && response.status !== 429) throw error;
        lastError = error;
      } else {
        return await response.json();
      }
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1500));
  }
  throw new Error(`Request failed after 3 attempts: ${lastError?.message || 'unknown error'}`);
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


async function syncCodeChefProblems() {
  const limit = 1000;
  const first = await requestJson('https://www.codechef.com/api/list/problems?limit=' + limit + '&page=1');
  if (first.status !== 'success' || !Array.isArray(first.data)) {
    throw new Error('CodeChef problem API returned an unexpected response');
  }
  const total = Number(first.count || 0);
  const rows = [...first.data];
  const pages = Math.ceil(total / limit);
  for (let page = 2; page <= pages; page++) {
    await new Promise(resolve => setTimeout(resolve, 300));
    const result = await requestJson('https://www.codechef.com/api/list/problems?limit=' + limit + '&page=' + page);
    if (result.status !== 'success' || !Array.isArray(result.data) || !result.data.length) {
      throw new Error('CodeChef problem page ' + page + ' was empty or invalid');
    }
    rows.push(...result.data);
  }
  if (total && rows.length !== total) {
    throw new Error('CodeChef problem pagination incomplete: expected ' + total + ', received ' + rows.length);
  }
  for (const p of rows) {
    if (!p.code || !p.name) continue;
    const contestCode = p.contest_code || '';
    const rating = Number(p.difficulty_rating);
    problems.push({
      id: 'cc-' + p.code,
      platform: 'CodeChef',
      contestId: contestCode ? 'cc-' + contestCode : null,
      name: p.name,
      index: p.code,
      rating: Number.isFinite(rating) && rating > 0 ? rating : null,
      tags: [],
      url: 'https://www.codechef.com/problems/' + p.code,
    });
  }
  if (!rows.length) throw new Error('CodeChef problem index is empty');
}

async function syncLeetCodeProblems() {
  const limit = 100;
  const query = 'query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {' +
    ' problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {' +
    ' total: totalNum questions: data { questionFrontendId title titleSlug difficulty topicTags { name } } } }';
  let expectedTotal = null;
  let fetched = 0;
  for (let skip = 0; ; skip += limit) {
    const variables = JSON.stringify({ categorySlug: '', skip, limit, filters: {} });
    const url = 'https://leetcode.com/graphql?query=' + encodeURIComponent(query) +
      '&variables=' + encodeURIComponent(variables);
    const data = await requestJson(url, { headers: { Referer: 'https://leetcode.com/problemset/all/' } });
    const result = data && data.data && data.data.problemsetQuestionList;
    if (!result || !Array.isArray(result.questions)) {
      const detail = data && data.errors ? data.errors.map(e => e.message).join('; ') : '';
      throw new Error(detail || 'LeetCode problemset response was invalid');
    }
    if (expectedTotal === null) expectedTotal = Number(result.total || 0);
    const questions = result.questions;
    for (const q of questions) {
      if (!q.titleSlug || !q.title) continue;
      problems.push({
        id: 'lc-' + q.titleSlug,
        platform: 'LeetCode',
        contestId: null,
        name: q.title,
        index: String(q.questionFrontendId || ''),
        rating: null,
        difficulty: q.difficulty || null,
        tags: (q.topicTags || []).map(t => t.name).filter(Boolean),
        url: 'https://leetcode.com/problems/' + q.titleSlug + '/',
      });
    }
    fetched += questions.length;
    if (!questions.length || fetched >= expectedTotal) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!expectedTotal || fetched !== expectedTotal) {
    throw new Error('LeetCode problem pagination incomplete: expected ' + expectedTotal + ', received ' + fetched);
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
  syncCodeChefProblems().catch(error => sourceErrors.push('CodeChef problems: ' + error.message)),
  syncLeetCode().catch(error => sourceErrors.push('LeetCode contests: ' + error.message)),
  syncLeetCodeProblems().catch(error => sourceErrors.push('LeetCode problems: ' + error.message)),
]);

// Never replace a known-good archive with partial results from a failed provider.
if (sourceErrors.length) {
  throw new Error('Sync aborted; existing datasets were preserved. ' + sourceErrors.join(' | '));
}

// Require a non-empty result from every configured contest provider.
const countsBeforeDedup = contests.reduce((counts, contest) => {
  counts[contest.platform] = (counts[contest.platform] || 0) + 1;
  return counts;
}, {});
for (const platform of ['Codeforces', 'CodeChef', 'LeetCode']) {
  if (!countsBeforeDedup[platform]) {
    throw new Error(`Sync aborted: ${platform} returned zero contests; existing datasets were preserved.`);
  }
}
if (!problems.length) {
  throw new Error('Sync aborted: problem index is empty; existing datasets were preserved.');
}
for (const platform of ['Codeforces', 'CodeChef', 'LeetCode']) {
  if (!problems.some(problem => problem.platform === platform)) {
    throw new Error('Sync aborted: ' + platform + ' problem index is empty; existing datasets were preserved.');
  }
}
const uniqueProblems = new Map();
for (const problem of problems) {
  const key = problem.platform + '|' + problem.id;
  if (!uniqueProblems.has(key)) uniqueProblems.set(key, problem);
}
const finalProblems = [...uniqueProblems.values()].sort((a, b) =>
  a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name)
);

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
  problems: finalProblems,
  sourceCounts: finalProblems.reduce((counts, p) => {
    counts[p.platform] = (counts[p.platform] || 0) + 1;
    return counts;
  }, {}),
}, null, 2));

console.log('Synced ' + finalContests.length + ' contests since 2026-08-01 and ' + finalProblems.length + ' problems.');
console.log('Platform counts:', finalContests.reduce((counts, c) => {
  counts[c.platform] = (counts[c.platform] || 0) + 1;
  return counts;
}, {}));
console.log('Source warnings:', sourceErrors);
