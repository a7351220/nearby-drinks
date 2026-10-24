type Entry<T = unknown> = { value: T; savedAt: number };
const STORAGE_KEY = "nearby-drinks:v1";
let entries: Record<string, Entry> | undefined;
function cache() {
  if (!entries) {
    try { entries = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}"); } catch { /* Storage is optional. */ }
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) entries = {};
  }
  return entries;
}
export function readCache<T>(key: string, maxAge = 120_000): Entry<T> | undefined {
  const entry = cache()[key];
  const age = entry ? Date.now() - entry.savedAt : Infinity;
  return age >= 0 && age < maxAge ? entry as Entry<T> : undefined;
}
export function writeCache(key: string, value: unknown) {
  const data = cache();
  delete data[key];
  data[key] = { value, savedAt: Date.now() };
  while (Object.keys(data).length > 8 || JSON.stringify(data).length > 500_000) delete data[Object.keys(data)[0]];
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* Keep the in-memory cache. */ }
}
