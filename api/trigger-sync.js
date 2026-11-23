import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "arena_admin_session";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(body));
}

function validSession(req) {
  const raw = (req.headers.cookie || "").split(";").map(v => v.trim())
    .find(v => v.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  if (!raw || !process.env.ADMIN_SESSION_SECRET || !process.env.ADMIN_EMAIL) return false;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return false;
  const expected = createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(payload).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.email === process.env.ADMIN_EMAIL && Number.isFinite(data.exp) && data.exp > Date.now();
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Method not allowed" }); }
  if (!validSession(req)) return send(res, 401, { error: "Admin login required." });
  if (!process.env.GITHUB_ACTIONS_TOKEN) return send(res, 503, { error: "Manual sync is not configured yet. Add GITHUB_ACTIONS_TOKEN to Vercel environment variables." });
  const host = req.headers.host;
  const origin = req.headers.origin;
  if (origin && host && new URL(origin).host !== host) return send(res, 403, { error: "Request origin is not allowed." });
  try {
    const response = await fetch("https://api.github.com/repos/Chakaliprakash/DSA-Contest-Arena/actions/workflows/daily-sync.yml/dispatches", {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + process.env.GITHUB_ACTIONS_TOKEN, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "DSA-Contest-Arena" },
      body: JSON.stringify({ ref: "main" }),
      signal: AbortSignal.timeout(10000)
    });
    if (response.status !== 204) { const detail = await response.text(); return send(res, 502, { error: detail.slice(0, 300) || "GitHub did not accept the workflow dispatch." }); }
    return send(res, 202, { queued: true, message: "Manual contest sync queued.", workflowUrl: "https://github.com/Chakaliprakash/DSA-Contest-Arena/actions/workflows/daily-sync.yml" });
  } catch { return send(res, 502, { error: "Could not reach GitHub Actions. Please retry." }); }
}
