import { createHmac, timingSafeEqual } from "node:crypto";

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decode(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function signatureFor(unsignedToken, secret) {
  return createHmac("sha256", secret).update(unsignedToken).digest("base64url");
}

export function createToken(user, secret, lifetimeSeconds = 60 * 60 * 12) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "HS256", typ: "KXT" });
  const payload = encode({
    sub: user.id,
    fullName: user.fullName,
    role: user.role,
    iat: now,
    exp: now + lifetimeSeconds,
  });
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${signatureFor(unsigned, secret)}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, providedSignature] = parts;
  const unsigned = `${header}.${payload}`;
  const expected = Buffer.from(signatureFor(unsigned, secret));
  const provided = Buffer.from(providedSignature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  try {
    const parsed = decode(payload);
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (!parsed.sub || !["admin", "viewer"].includes(parsed.role)) return null;
    return { id: parsed.sub, fullName: parsed.fullName, role: parsed.role };
  } catch {
    return null;
  }
}

export function authenticateRequest(request, secret) {
  const header = request.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? verifyToken(match[1], secret) : null;
}
