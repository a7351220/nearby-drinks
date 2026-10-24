import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import ts from 'typescript';
const dir = mkdtempSync('.sites-runtime/options-card-');
try {
  const code = ts.transpileModule(readFileSync('components/drink-options.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  writeFileSync(`${dir}/card.mjs`, code);
  const { DrinkOptions } = await import(pathToFileURL(`${dir}/card.mjs`));
  const render = item => renderToStaticMarkup(createElement(DrinkOptions, { item }));
  const group = { id: 's', name: '甜度', min: 1, max: 1, options: [{ id: 'half', name: '半糖', price: 0 }, { id: 'honey', name: '<蜂蜜>', price: 10 }] };
  const html = render({ optionsLoaded: true, variations: [
    { id: 'm', name: '中杯', price: 40, groupsComplete: true, groups: [group] },
    { id: 'l', name: '大杯', price: 50, containerPrice: 2, groupsComplete: false, groups: [] },
  ] });
  for (const text of ['中杯', '大杯', 'NT$ 40', 'NT$ 50', '半糖', '&lt;蜂蜜&gt;', '+NT$ 10', '容器費', '部分選項未提供', '冰量／溫度：平台未提供']) assert(html.includes(text), text);
  assert(!html.includes('<蜂蜜>'));
  assert.match(render({ optionsLoaded: false }), /尚未提供/);
  assert.match(render({ optionsLoaded: true, variations: [] }), /未提供可顯示的規格/);
  assert.match(render({ optionsLoaded: true, fixedCustomization: { sugar: true, ice: true }, variations: [{ id: 'fixed', price: 40, groupsComplete: true, groups: [] }] }), /甜度：店家固定/);
  console.log('PASS: option card sizes, groups, surcharges, incomplete data, fixed choices and escaping');
} finally { rmSync(dir, { recursive: true }); }
