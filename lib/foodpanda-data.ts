/** Pure normalization for foodpanda's public page and product-detail response. */
export type Option = { id: string; name: string; price: number };
export type Group = { id: string; name: string; min: number; max: number; options: Option[] };
export type Variation = { id: string; name?: string; price: number; containerPrice?: number; groups: Group[]; groupsComplete: boolean };
export type Drink = {
  id: string; menuId: string; name: string; description?: string; price: number; category: string;
  variations: Variation[]; optionsLoaded: boolean;
  fixedCustomization: { sugar: boolean; ice: boolean }; customizationHint?: string;
};
export type Store = {
  code: string; name: string; latitude: number; longitude: number;
  address?: string; distanceKm?: number; deliveryAvailable?: boolean; url: string;
};

export const asList = (value: unknown): any[] => Array.isArray(value) ? value : [];
export const asText = (value: unknown): string => typeof value === "string" ? value.trim() : "";
export const asNumber = (value: unknown): number | undefined => value == null || value === "" || !Number.isFinite(Number(value)) ? undefined : Number(value);
const asId = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : "";
const own = (object: any, key: string): any => object && Object.hasOwn(object, key) ? object[key] : undefined;
const resolve = (entities: Record<string, any>, value: any): any => typeof value?.__ref === "string" ? own(entities, value.__ref) : value;

export function toStore(value: any): Store | null {
  const code = asText(value?.code), name = asText(value?.name);
  const latitude = asNumber(value?.latitude), longitude = asNumber(value?.longitude);
  if (!/^[a-z0-9-]{1,30}$/i.test(code) || !name || latitude === undefined || longitude === undefined
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  let url = `https://www.foodpanda.com.tw/restaurant/${encodeURIComponent(code)}`;
  try {
    const candidate = new URL(value.web_path || value.redirection_url);
    if (candidate.protocol === "https:" && ["foodpanda.com.tw", "www.foodpanda.com.tw"].includes(candidate.hostname)
        && !candidate.username && !candidate.password && !candidate.port
        && (candidate.pathname === `/restaurant/${code}` || candidate.pathname.startsWith(`/restaurant/${code}/`))) {
      candidate.hostname = "www.foodpanda.com.tw";
      candidate.search = ""; candidate.hash = ""; url = candidate.href;
    }
  } catch { /* The code-based public page is the fallback. */ }
  const address = asText(value.address) || asText(value.address?.addressLine1) || asText(value.address?.street) || asText(value.location?.addressLine1);
  return { code, name, latitude, longitude, url, ...(address ? { address: address.replace(/^[（(][^）)]{1,5}[）)]\s*/u, "") } : {}),
    ...(typeof value.metadata?.is_delivery_available === "boolean" ? { deliveryAvailable: value.metadata.is_delivery_available } : {}) };
}

const BAD_CATEGORY = /加購|加料|配料|單獨購買|周邊|其他商品|餐具|塑膠袋|點心|輕食|甜點|早餐|便當|套餐|組合|團訂|多杯/iu;
const BAD_NAME = /提袋|紙袋|吸管|環保杯|隨行杯|造型瓶|杯套|瓶套|不可食用|冰塊|加購|買[一二三四1234]送|[二三四五六七八九十2-9]\s*杯|套餐|組合|麵包|吐司|三明治|鬆餅|漢堡|雞塊|沙拉|蛋糕|披薩|可頌|薯條/iu;
const BEVERAGE = /茶|奶|拿鐵|咖啡|果汁|水果水|檸檬|檸香|飲|冰沙|冰菓|冰鑽|氣泡|可可|阿華田|歐蕾|多多|冬瓜|普洱|烏龍|紅玉|伯爵|金萱|洛神|現榨|萃|草本|漢方|espresso|coffee|latte|tea|juice|smoothie/iu;

export function customization(name: string, description: string) {
  const value = `${name} ${description}`;
  const sugar = /(?:甜度|糖度|糖量|糖冰)[^。\n；]{0,8}(?:固定|無法調整|不可調整|不能調整)|固定甜度/iu.test(value);
  const ice = /(?:冰量|冰度|糖冰|冰溫)[^。\n；]{0,8}(?:固定|無法調整|不可調整|不能調整)|固定冰量/iu.test(value);
  return { fixedCustomization: { sugar, ice }, ...(sugar || ice ? {
    customizationHint: sugar && ice ? "糖冰固定，依店家配方。" : sugar ? "甜度固定，依店家配方。" : "冰量固定，依店家配方。",
  } : {}) };
}

/** Follow actual menu -> category -> product refs, never the recommended-product list. */
export function normalizePublicMenu(page: { vendor: any; entities: Record<string, any> }, expectedCode: string) {
  const store = toStore(page.vendor);
  if (!store || store.code !== expectedCode) throw new Error("Public menu vendor mismatch");
  const entities = page.entities, selectedMenus = new Map<string, any>();
  for (const [field, pageRef] of Object.entries(own(entities, "ROOT_QUERY") ?? {})) {
    if (!field.startsWith("restaurantDetailsPage(")) continue;
    const pageData = resolve(entities, pageRef), vendorData = resolve(entities, pageData?.vendorData);
    if (vendorData?.code !== expectedCode || vendorData?.expeditionType !== "DELIVERY") continue;
    for (const [menuField, menuRef] of Object.entries(vendorData)) {
      if (!menuField.startsWith("menu(")) continue;
      const menu = resolve(entities, menuRef);
      if (menu?.__typename === "RestaurantMenu" && menu.vendorCode === expectedCode
          && menu.expeditionType === "DELIVERY" && asId(menu.id)) selectedMenus.set(asId(menu.id), menu);
    }
  }
  if (selectedMenus.size !== 1) throw new Error("Public delivery menu is missing or ambiguous");
  return normalizeMenu([...selectedMenus.values()][0], entities, store);
}

/** The normal web GraphQL menu returns the same data as nested objects. */
export function normalizeGraphqlMenu(page: any, expectedCode: string) {
  const vendor = page?.vendorData, menu = vendor?.menu;
  const store = toStore({ ...vendor, latitude: vendor?.location?.latitude, longitude: vendor?.location?.longitude });
  if (!store || store.code !== expectedCode || vendor?.expeditionType !== "DELIVERY") throw new Error("Menu vendor mismatch");
  if (menu?.__typename !== "RestaurantMenu" || menu.vendorCode !== expectedCode
      || menu.expeditionType !== "DELIVERY" || !asId(menu.id)) throw new Error("Delivery menu is missing or mismatched");
  return normalizeMenu(menu, {}, store);
}

function normalizeMenu(menu: any, entities: Record<string, any>, store: Store) {
  const items = new Map<string, Drink>();
  if (!Array.isArray(menu.categories)) throw new Error("Menu categories are missing");
  for (const categoryRef of menu.categories) {
    const category = resolve(entities, categoryRef), categoryName = asText(category?.title);
    if (!category || !categoryName || !Array.isArray(category.products)) throw new Error("Menu category reference is incomplete");
    if (BAD_CATEGORY.test(categoryName)) continue;
    for (const reference of asList(category.products)) {
      const product = resolve(entities, reference), name = asText(product?.title), description = asText(product?.description);
      if (!product || !asId(product.id) || !name) throw new Error("Menu product reference is incomplete");
      const id = asId(product?.id);
      if (!id || !name || product.isSoldOut || product.isBundle || product.isAlcoholicItem
          || BAD_NAME.test(name) || !BEVERAGE.test(`${name} ${categoryName}`)) continue;
      if (!Array.isArray(product.variations)) throw new Error("Product variations are missing");
      const resolvedVariations: any[] = product.variations.map((ref: any) => resolve(entities, ref));
      if (resolvedVariations.some((value: any) => !value || !asId(value.id))) throw new Error("Menu variation reference is incomplete");
      const variations: Variation[] = resolvedVariations
        .filter(value => value && asId(value.id) && (asNumber(value.price) ?? 0) > 0 && !value.isSoldOut)
        .map(value => ({ id: asId(value.id), price: Number(value.price), groups: [], groupsComplete: false }));
      if (!variations.length || items.has(id)) continue;
      items.set(id, { id, menuId: asId(menu.id), name, ...(description ? { description } : {}), category: categoryName,
        price: Math.min(...variations.map(value => value.price)), variations, optionsLoaded: false, ...customization(name, description) });
    }
  }
  return { store, items: [...items.values()] };
}

function choiceGroups(variation: any): Pick<Variation, "groups" | "groupsComplete"> {
  if (!Array.isArray(variation.choiceGroups)) return { groups: [], groupsComplete: false };
  const groups: Group[] = [];
  let groupsComplete = true;
  for (const raw of variation.choiceGroups) {
    const id = asId(raw?.id), min = asNumber(raw?.quantityMinimum), max = asNumber(raw?.quantityMaximum);
    if (!id || min === undefined || max === undefined || !Number.isInteger(min) || !Number.isInteger(max)
        || min < 0 || max < min || !Array.isArray(raw?.choices)) { groupsComplete = false; continue; }
    const options: Option[] = raw.choices.filter((option: any) => asId(option?.id) && asText(option?.title)
      && !option.isSoldOut && !option.isAlcoholicItem && option.product == null
      && asNumber(option.price) !== undefined && Number(option.price) >= 0
      && (asNumber(option.quantityMaximum) ?? 1) >= 1)
      .map((option: any) => ({ id: asId(option.id), name: asText(option.title), price: Number(option.price) }));
    groups.push({ id, name: asText(raw.title), min, max, options });
    if (min > 0 && options.length < min) groupsComplete = false;
  }
  return { groups, groupsComplete };
}

export function normalizeProductDetail(raw: any, summary: Drink, storeCode: string): Drink {
  if (!raw || asId(raw.id) !== summary.id || raw.vendorCode !== storeCode || raw.vendor?.code !== storeCode)
    throw new Error("Product detail vendor or product mismatch");
  if (raw.isSoldOut || raw.isBundle || raw.isAlcoholicItem) return { ...summary, variations: [], optionsLoaded: true };
  const name = asText(raw.title), description = asText(raw.description);
  if (!name) throw new Error("Product title is missing");
  const summaryIds = new Set(summary.variations.map(value => value.id));
  const variations: Variation[] = asList(raw.variations)
    .filter(value => value && summaryIds.has(asId(value.id)) && (asNumber(value.price) ?? 0) > 0 && !value.isSoldOut)
    .map(value => ({ id: asId(value.id), ...(asText(value.title) ? { name: asText(value.title) } : {}), price: Number(value.price),
      ...(asNumber(value.containerPrice) !== undefined ? { containerPrice: Number(value.containerPrice) } : {}),
      ...choiceGroups(value) }));
  return { ...summary, name, description, variations, optionsLoaded: true,
    price: variations.length ? Math.min(...variations.map(value => value.price)) : summary.price, ...customization(name, description) };
}

export function randomizable(value: Variation): boolean {
  return value.groupsComplete && (value.containerPrice === undefined || value.containerPrice >= 0)
    && value.groups.every(group => group.min === 0 || (group.min === 1 && group.max === 1 && group.options.length > 0));
}

export type Temperature = "cold" | "ambient" | "hot";
export const TEMPERATURES: Temperature[] = ["cold", "ambient", "hot"];
export const temperatureLabel = (mode: Temperature) => ({ cold: "冰飲", ambient: "常溫", hot: "熱飲" })[mode];

export function optionTemperature(name: string): Temperature | undefined {
  if (/常溫|室溫|room\s*temp|ambient/iu.test(name)) return "ambient";
  if (/熱|微溫|溫飲|溫的|溫水|溫熱|^溫$|hot|warm/iu.test(name)) return "hot";
  // 去冰 / 無冰 is still a cold drink, never proof of room temperature.
  if (/冰|冷|ice|cold/iu.test(name)) return "cold";
}
const toppingGroup = (group: Group) => /加料|配料|加點|topping|add.?on/iu.test(group.name)
  && !/甜度|糖度|冰量|溫度|尺寸|容量|杯型/iu.test(group.name);
const thermalGroup = (group: Group) => !toppingGroup(group) && (/冰|溫|熱|temperature|ice/iu.test(group.name)
  || group.options.some(option => optionTemperature(option.name)));

export function compatibleVariation(value: Variation, mode: Temperature, itemName = ""): Variation | null {
  if (!randomizable(value)) return null;
  const label = `${itemName} ${value.name ?? ""}`.replace(/冰糖/gu, "");
  const fixed = /冰.*熱|熱.*冰|冷.*熱|熱.*冷/u.test(label) ? undefined : optionTemperature(label);
  if (fixed && fixed !== mode) return null;
  let confirmed = fixed === mode;
  const groups = value.groups.map(group => {
    if (!thermalGroup(group)) return group;
    const options = group.options.filter(option => optionTemperature(option.name) === mode);
    if (group.min > 0 && options.length) confirmed = true;
    return { ...group, options };
  });
  // Unknown temperatures are not assigned an invented mode.
  if (!confirmed || groups.some(group => group.min > group.options.length)) return null;
  return { ...value, groups };
}

export function toppingOptions(value: Variation) {
  return value.groups.filter(group => group.min === 0 && group.max >= 1 && toppingGroup(group))
    .flatMap(group => group.options.filter(option => !/^(?:不加|不需要|不要|不選)|^(?:無|無加料|無配料|none|no toppings?)$|吸管|餐具|塑膠袋|紙袋|提袋|杯套|環保杯/iu.test(option.name))
      .map(option => ({ groupId: group.id, groupName: group.name, ...option })));
}
export function drawableTemperatures(value: Variation, requested?: Temperature, itemName = "", withToppings = false) {
  return TEMPERATURES.filter(mode => {
    const compatible = (!requested || requested === mode) && compatibleVariation(value, mode, itemName);
    return compatible && (!withToppings || toppingOptions(compatible).length > 0);
  });
}

export function drawVariation(value: Variation, chooseIndex: (length: number) => number, requested?: Temperature, itemName = "", withToppings = false) {
  const modes = drawableTemperatures(value, requested, itemName, withToppings);
  if (!modes.length) throw new Error("No compatible temperature choices");
  const temperature = modes[chooseIndex(modes.length)];
  const compatible = compatibleVariation(value, temperature, itemName)!;
  const selectedOptions = compatible.groups.filter(group => group.min === 1 && group.max === 1).map(group => ({
    groupId: group.id, groupName: group.name, ...group.options[chooseIndex(group.options.length)],
  }));
  const toppings = withToppings ? toppingOptions(compatible) : [];
  if (toppings.length) selectedOptions.push(toppings[chooseIndex(toppings.length)]);
  return { temperature, selectedOptions, toppingAdded: toppings.length > 0, totalPrice: Math.round((value.price + (value.containerPrice ?? 0)
    + selectedOptions.reduce((sum, option) => sum + option.price, 0)) * 100) / 100 };
}
