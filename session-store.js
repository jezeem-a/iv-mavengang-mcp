const sessions = new Map();

export async function getSession(keyHash) {
  return sessions.get(keyHash);
}

export async function saveSession(keyHash, entry) {
  sessions.set(keyHash, entry);
}

export async function deleteSession(keyHash) {
  sessions.delete(keyHash);
}

export async function hashKey(key) {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export function hasSESSIONS() {
  return typeof SESSIONS !== "undefined";
}

export async function getSessionKV(keyHash) {
  if (!hasSESSIONS()) return null;
  const value = await SESSIONS.get(`session:${keyHash}`);
  return value ? JSON.parse(value) : null;
}

export async function saveSessionKV(keyHash, entry) {
  if (!hasSESSIONS()) return;
  await SESSIONS.put(`session:${keyHash}`, JSON.stringify(entry), { expirationTtl: 30 * 24 * 60 * 60 });
}

export async function deleteSessionKV(keyHash) {
  if (!hasSESSIONS()) return;
  await SESSIONS.delete(`session:${keyHash}`);
}