import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const { outputText } = ts.transpileModule(readFileSync(new URL('../lib/foodpanda-data.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { drawVariation, compatibleVariation, toStore, normalizeGraphqlMenu } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const group = (name, names, min = 1) => ({ id: name, name, min, max: 1, options: names.map(name => ({ id: name, name, price: name === '熱' ? 5 : 0 })) });
const variation = { id: 'v', price: 50, containerPrice: 1, groupsComplete: true, groups: [group('溫度', ['冰', '常溫', '熱']), group('冰量', ['正常冰', '去冰', '常溫', '熱']), group('甜度', ['無糖', '半糖'])] };
for (const mode of ['cold', 'ambient', 'hot']) {
  for (let i = 0; i < 30; i++) {
    const result = drawVariation(variation, n => i % n, mode);
    assert.equal(result.temperature, mode);
    const names = result.selectedOptions.slice(0, 2).map(x => x.name);
    if (mode === 'hot') assert.deepEqual(names, ['熱', '熱']);
    if (mode === 'ambient') assert.deepEqual(names, ['常溫', '常溫']);
    if (mode === 'cold') assert(names.every(x => ['冰', '正常冰', '去冰'].includes(x)));
    assert.equal(result.totalPrice, mode === 'hot' ? 61 : 51);
  }
}
assert.equal(compatibleVariation({ ...variation, groups: [group('冰量', ['去冰'])] }, 'ambient'), null);
assert.equal(compatibleVariation({ ...variation, groups: [group('甜度', ['無糖'])] }, 'hot'), null);
assert.equal(compatibleVariation(variation, 'cold', '熱奶茶'), null);
assert(compatibleVariation(variation, 'hot', '冰糖桂圓茶'));
assert.equal(compatibleVariation({ ...variation, groups: [group('溫度', ['熱']), group('冰量', ['正常冰'])] }, 'hot'), null);
assert.throws(() => drawVariation({ ...variation, groupsComplete: false }, () => 0));
const store = toStore({ code: 'test', name: '分店甲', latitude: 23.5, longitude: 120.4, address: '(O)嘉義縣民雄鄉神農二街9號' });
assert.equal(store.address, '嘉義縣民雄鄉神農二街9號');
assert.equal(toStore({ ...store, latitude: NaN }), null);
const page = { vendorData: { code: 'test', name: '分店甲', expeditionType: 'DELIVERY', location: { latitude: 23.55, longitude: 120.47, addressLine1: '(O)嘉義縣民雄鄉神農二街9號' }, menu: { __typename: 'RestaurantMenu', vendorCode: 'test', expeditionType: 'DELIVERY', id: 'm', categories: [] } } };
assert.equal(normalizeGraphqlMenu(page, 'test').store.address, store.address);
assert.throws(() => normalizeGraphqlMenu(page, 'other'));
const toppings = { id: 't', name: '加料選擇', min: 0, max: 3, options: [
  { id: 'pearl', name: '珍珠', price: 10 }, { id: 'icecream', name: '冰淇淋', price: 20 },
  { id: 'none', name: '不加料', price: 0 }, { id: 'straw', name: '吸管', price: 0 },
] };
const topped = { ...variation, groups: [...variation.groups, toppings] };
const last = n => n - 1;
const plain = drawVariation(topped, last, 'hot');
assert.equal(plain.toppingAdded, false);
assert.equal(plain.selectedOptions.length, 3);
assert.equal(plain.totalPrice, 61);
const extra = drawVariation(topped, last, 'hot', '', true);
assert.equal(extra.toppingAdded, true);
assert.equal(extra.selectedOptions.at(-1).name, '冰淇淋');
assert.equal(extra.totalPrice, 81);
assert.equal(extra.selectedOptions.filter(x => x.groupId === 't').length, 1);
assert(compatibleVariation(topped, 'hot'), 'toppings containing 冰 must not become temperature controls');
for (const max of [1, 3]) {
  const result = drawVariation({ ...variation, groups: [...variation.groups, { ...toppings, max }] }, () => 0, 'cold', '', true);
  assert.equal(result.selectedOptions.filter(x => x.groupId === 't').length, max ? 1 : 0);
}
assert.throws(() => drawVariation({ ...variation, groups: [...variation.groups, { ...toppings, options: toppings.options.slice(2) }] }, last, 'hot', '', true));
assert.throws(() => drawVariation({ ...variation, groups: [...variation.groups, { ...toppings, max: 0 }] }, last, 'hot', '', true));
const required = drawVariation({ ...variation, groups: [...variation.groups, { ...toppings, min: 1, max: 1, options: toppings.options.slice(0, 1) }] }, last, 'hot');
assert.equal(required.selectedOptions.filter(x => x.groupId === 't').length, 1);
assert.equal(required.totalPrice, 71);
console.log('PASS: temperatures, pricing, branch identity and optional topping limits / exclusion / totals');
