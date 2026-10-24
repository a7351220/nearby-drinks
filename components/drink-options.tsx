import type { Drink } from "@/lib/foodpanda-data";

const money = (value: number) => `NT$ ${value.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
export function DrinkOptions({ item }: { item: Partial<Drink> }) {
  if (!item.optionsLoaded) return <p className="drink-help">平台尚未提供這杯的完整選項。</p>;
  if (!item.variations?.length) return <p className="drink-help">平台目前未提供可顯示的規格。</p>;
  return <div className="drink-all-options">
    {item.customizationHint && <p className="drink-help">{item.customizationHint}</p>}
    {item.variations.map((variation, index) => <div className="drink-option-variation" key={variation.id}>
      <h3>{variation.name || (item.variations!.length > 1 ? `規格 ${index + 1}（尺寸未標示）` : "尺寸／規格未標示")} <span>{money(variation.price)}</span></h3>
      {(variation.containerPrice ?? 0) > 0 && <p className="drink-help">另計容器費 {money(variation.containerPrice!)}</p>}
      {!variation.groupsComplete && <p className="drink-help">部分選項未提供，請以店家說明為準。</p>}
      <dl>{variation.groups.map(group => <div className="drink-option-group" key={group.id}>
        <dt>{group.name || "其他選項"}<small>{group.min > 0 ? `至少選 ${group.min} 項` : "可不選"} · 最多 {group.max} 項</small></dt>
        <dd>{group.options.length ? group.options.map(option => <span className="drink-option-tag" key={option.id}>{option.name}{option.price > 0 ? ` +${money(option.price)}` : ""}</span>) : "目前沒有可選項目"}</dd>
      </div>)}</dl>
      {!variation.groups.some(group => /糖|甜|sugar|sweet/iu.test(group.name)) && <p className="drink-help">甜度：{item.fixedCustomization?.sugar ? "店家固定" : "平台未提供"}</p>}
      {!variation.groups.some(group => /冰|溫|熱|ice|temperature/iu.test(group.name)) && <p className="drink-help">冰量／溫度：{item.fixedCustomization?.ice ? "店家固定" : "平台未提供"}</p>}
    </div>)}
    <p className="drink-help">各規格的選項分開列示；價格與供應以店家為準。</p>
  </div>;
}
