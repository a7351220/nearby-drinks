import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const dir = mkdtempSync('.sites-runtime/topping-retry-');
for (const name of ['foodpanda-data', 'foodpanda']) {
  const source = readFileSync(`lib/${name}.ts`, 'utf8').replace('"./foodpanda-data"', '"./foodpanda-data.mjs"');
  writeFileSync(`${dir}/${name}.mjs`, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
}
const vendor = { code: 'test', name: '測試茶店', latitude: 23.56, longitude: 120.47, expeditionType: 'DELIVERY', location: { latitude: 23.56, longitude: 120.47 } };
const products = ['1', '2', '3'].map(id => ({ id, title: `紅茶${id}`, variations: [{ id: `v${id}`, price: 50 }] }));
let calls = 0, addFrom = 2;
const choice = (id, title, price = 0) => ({ id, title, price, quantityMaximum: 1 });
globalThis.fetch = async (url, init) => {
  let payload;
  if (url.includes('/listing/')) payload = { data: { items: [vendor], available_count: 1 } };
  else {
    const input = JSON.parse(init.body).variables.input;
    if (!input.productID) payload = { data: { restaurantDetailsPage: { vendorData: { ...vendor, menu: { __typename: 'RestaurantMenu', id: 'menu', vendorCode: 'test', expeditionType: 'DELIVERY', categories: [{ title: '茶飲', products }] } } } } };
    else {
      calls++;
      const groups = [{ id: 'temp', title: '溫度', quantityMinimum: 1, quantityMaximum: 1, choices: [choice('cold', '正常冰')] }];
      if (calls >= addFrom) groups.push({ id: 'top', title: '加料選擇', quantityMinimum: 0, quantityMaximum: 1, choices: [choice('pearl', '珍珠', 10)] });
      payload = { data: { restaurantProduct: { id: input.productID, vendorCode: 'test', vendor: { code: 'test' }, title: '紅茶', variations: [{ id: `v${input.productID}`, price: 50, choiceGroups: groups }] } } };
    }
  }
  return new Response(JSON.stringify(payload));
};
try {
  const load = version => import(`${pathToFileURL(`${dir}/foodpanda.mjs`)}?${version}`);
  const service = await load('retry');
  const result = await service.runWithDrinkRequest(() => service.randomNearbyDrink(23.56, 120.47, 1, '', 'cold', true));
  assert.equal(calls, 2, 'retry another product in the same store');
  assert(result.selectedOptions.some(option => option.name === '珍珠'));
  assert.equal(result.totalPrice, 60);
  calls = 0; addFrom = Infinity;
  const empty = await load('empty');
  await assert.rejects(empty.runWithDrinkRequest(() => empty.randomNearbyDrink(23.56, 120.47, 1, '', 'cold', true)), error => error.status === 422);
  assert.equal(calls, 3, 'stop after three distinct products in one store');
  calls = 0;
  const plain = await load('plain');
  const original = await plain.runWithDrinkRequest(() => plain.randomNearbyDrink(23.56, 120.47, 1, '', 'cold', false));
  assert.equal(calls, 1);
  assert.equal(original.totalPrice, 50);
  console.log('PASS: retry without replacement, require topping, bounded exhaustion and original mode');
} finally { rmSync(dir, { recursive: true }); }
