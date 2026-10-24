import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import ts from 'typescript';
const dir = mkdtempSync(`${tmpdir()}/drink-cache-`);
for (const name of ['browser-cache', 'foodpanda-data', 'foodpanda']) {
  const source = readFileSync(`lib/${name}.ts`, 'utf8').replace('"./foodpanda-data"', '"./foodpanda-data.mjs"');
  writeFileSync(`${dir}/${name}.mjs`, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
}
try {
  let stored = '';
  globalThis.sessionStorage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  const { readCache, writeCache } = await import(`file://${dir}/browser-cache.mjs`);
  writeCache('location-a', { stores: [1] });
  assert.deepEqual(readCache('location-a').value, { stores: [1] });
  assert.equal(readCache('location-b'), undefined);
  assert.equal(readCache('location-a', 0), undefined);
  for (let i = 0; i < 12; i++) writeCache(`menu-${i}`, i);
  assert.equal(readCache('location-a'), undefined);
  assert(Object.keys(JSON.parse(stored)).length <= 8);
  globalThis.sessionStorage.setItem = () => { throw Error('storage denied'); };
  writeCache('optional-storage', true);
  assert.equal(readCache('optional-storage').value, true);

  const { runWithDrinkRequest, getNearbyStores } = await import(`file://${dir}/foodpanda.mjs`);
  let release, started, calls = 0;
  const began = new Promise(resolve => { started = resolve; });
  const edgeEntries = new Map();
  globalThis.caches = { default: {
    match: async key => edgeEntries.get(key.url)?.clone(),
    put: async (key, response) => { edgeEntries.set(key.url, response.clone()); },
  } };
  globalThis.fetch = async () => {
    if (++calls === 1) { started(); await new Promise(resolve => { release = resolve; }); }
    return new Response(JSON.stringify({ data: { items: [], available_count: 0 } }));
  };
  const first = runWithDrinkRequest(() => getNearbyStores(23.56, 120.47, 1), 'https://example.test');
  await began;
  let timeout;
  try {
    await Promise.race([
      runWithDrinkRequest(() => getNearbyStores(23.56, 120.47, 1), 'https://example.test'),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('requests share pending I/O')), 1000); }),
    ]);
  } finally { clearTimeout(timeout); release(); await first; }
  assert.equal(calls, 2);
  assert.equal(edgeEntries.size, 1);
  // A new module models a fresh isolate with no in-memory cache.
  const fresh = await import(`file://${dir}/foodpanda.mjs?fresh`);
  await fresh.runWithDrinkRequest(() => fresh.getNearbyStores(23.56, 120.47, 1), 'https://example.test');
  assert.equal(calls, 2, 'a new isolate should reuse normalized edge data');
  console.log('PASS: cache expiry, scope, bounds, optional storage, request isolation and edge reuse');
} finally { rmSync(dir, { recursive: true }); }
