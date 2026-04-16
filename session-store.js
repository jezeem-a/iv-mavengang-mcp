// Session store — Cloudflare KV backed
// All functions take `kv` (the SESSIONS KV binding) as first param

const TTL = 30 * 24 * 60 * 60; // 30 days in seconds

export async function hashKey(key) {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function getSession(kv, keyHash) {
  const value = await kv.get(`session:${keyHash}`);
  return value ? JSON.parse(value) : null;
}

export async function saveSession(kv, keyHash, entry) {
  await kv.put(`session:${keyHash}`, JSON.stringify(entry), { expirationTtl: TTL });
}

export async function deleteSession(kv, keyHash) {
  await kv.delete(`session:${keyHash}`);
}
