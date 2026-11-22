import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "arena_admin_session";
const MAX_AGE = 60 * 60 * 24 * 7;

function sign(value) {
  return createHmac("sha256", process.env.ADMIN_SESSION_SECRET || "")
    .update(value).digest("base64url");
}
function validSession(req) {
  const raw = (req.headers.cookie || "").split(";").map(v => v.trim())
    .find(v => v.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  if (!raw || !process.env.ADMIN_SESSION_SECRET) return false;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.email === process.env.ADMIN_EMAIL &&
      Number.isFinite(data.exp) && data.exp > Date.now();
  } catch { return false; }
}
function send(res, status, body, extra = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
  res.end(JSON.stringify(body));
}
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    const authenticated = validSession(req);
    return send(res, 200, { authenticated, email: authenticated ? process.env.ADMIN_EMAIL : null });
  }
  if (req.method === "DELETE") {
    return send(res, 200, { authenticated: false }, {
      "Set-Cookie": `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
    });
  }
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !process.env.ADMIN_SESSION_SECRET) {
    return send(res, 503, { error: "Admin login is not configured yet. Set ADMIN_PASSWORD in Vercel." });
  }
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const expectedEmail = process.env.ADMIN_EMAIL.toLowerCase();
  const validEmail = email === expectedEmail;
  const validPassword = password.length === process.env.ADMIN_PASSWORD.length &&
    timingSafeEqual(Buffer.from(password), Buffer.from(process.env.ADMIN_PASSWORD));
  if (!validEmail || !validPassword) return send(res, 401, { error: "Incorrect username or password." });
  const payload = Buffer.from(JSON.stringify({
    email: process.env.ADMIN_EMAIL, exp: Date.now() + MAX_AGE * 1000
  })).toString("base64url");
  const token = payload + "." + sign(payload);
  return send(res, 200, { authenticated: true, email: process.env.ADMIN_EMAIL }, {
    "Set-Cookie": `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`
  });
}
