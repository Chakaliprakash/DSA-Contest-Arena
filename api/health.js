export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Cache the shared GitHub status response at Vercel's edge to avoid
  // every visitor consuming the repository's unauthenticated API quota.
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
  try {
    const response = await fetch(
      'https://api.github.com/repos/Chakaliprakash/DSA-Contest-Arena/actions/runs?per_page=10',
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'DSA-Contest-Arena',
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) {
      return res.status(502).json({ error: 'GitHub Actions status is temporarily unavailable.' });
    }
    const data = await response.json();
    const runs = (data.workflow_runs || [])
      .filter(run => run.name === 'Daily contest sync')
      .slice(0, 5)
      .map(run => ({
        id: run.id,
        status: run.status,
        conclusion: run.conclusion,
        created_at: run.created_at,
        html_url: run.html_url,
        head_commit: run.head_commit?.message || '',
      }));
    return res.status(200).json({ runs });
  } catch {
    return res.status(502).json({ error: 'Could not reach GitHub Actions. Please retry shortly.' });
  }
}
