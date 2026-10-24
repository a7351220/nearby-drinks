import { AsyncLocalStorage } from "node:async_hooks";
import {
  asList, asNumber, asText, toStore, normalizeGraphqlMenu, normalizeProductDetail,
  compatibleVariation, TEMPERATURES, drawVariation, type Temperature, type Drink, type Store,
} from "./foodpanda-data";
export type { Option, Group, Variation, Drink, Store } from "./foodpanda-data";

type Payload<T = any> = { data: T; sourceUpdatedAt: string };
type Nearby = { stores: Store[]; complete: boolean; warnings: string[]; sourceUpdatedAt: string; source: string };
type StoreMenu = { store: Store; items: Drink[]; warnings: string[]; sourceUpdatedAt: string; source: string };
type Stage = "店家" | "菜單" | "糖冰選項";
type ListingPage = { rows: { code: string; active: boolean; store: Store | null }[]; rowCount: number; available?: number };

export class DrinkApiError extends Error {
  status: number; warnings: string[]; code?: string; upstreamStatus?: number;
  constructor(message: string, status = 502, warnings: string[] = []) {
    super(message); this.name = "DrinkApiError"; this.status = status; this.warnings = warnings;
  }
}
const SOURCE = "foodpanda";
const CONFIG = { cuisine: "181", language: "1", maxStores: 400, pageSize: 100, batch: 4 };
const NOTICE = "資料來自 foodpanda 平台；價格未套用優惠，營業與供應請以門市為準。";
const PRODUCT_QUERY_HASH = "22f7602de58c2f275e637f368379c9cddca7c80a3e921d1e06e492006cc29610";
const MENU_QUERY_HASH = "2f099c32bbbb7df71dfe835ac6023583b968d3d86be315de4cdc7fd659de1b28";
// Keep normalized data only, never raw vendor/product payloads or session fields.
const cache = new Map<string, { expires: number; value: Payload }>();
type RequestState = { inFlight: Map<string, Promise<Payload>>; queue: Promise<void>; lastStart: number; origin?: string };
const requestState = new AsyncLocalStorage<RequestState>();
export function runWithDrinkRequest<T>(run: () => T, origin?: string): T {
  return requestState.run({ inFlight: new Map(), queue: Promise.resolve(), lastStart: 0, origin }, run);
}
const blockedHosts = new Map<string, { until: number; status: number }>();
let trackingId: string | undefined; // Workers disallow random generation at module initialization.
function menuHeaders() {
  trackingId ??= `${Date.now()}.${Array.from(crypto.getRandomValues(new Uint8Array(18)), n => n % 10).join("")}.${crypto.randomUUID().slice(0, 6)}`;
  return { "perseus-client-id": trackingId, "perseus-session-id": trackingId };
}
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const unique = (values: string[]) => [...new Set(values)];
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase("zh-TW").replace(/\s+/gu, "");
const oldest = (a: string, b: string) => a < b ? a : b;
function upstreamRejection(status: number) {
  return Object.assign(new DrinkApiError(status === 429
    ? "資料來源限制查詢頻率，請稍後再試。"
    : "資料來源拒絕此網站的查詢，目前無法取得菜單。", 503),
  { code: status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_ACCESS_DENIED", upstreamStatus: status });
}
function rejectHost(host: string, status: number): never {
  blockedHosts.set(host, { until: Date.now() + 60000, status });
  throw upstreamRejection(status);
}
async function boundedText(response: Response): Promise<string> {
  const maxBytes = 4 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error("Upstream body exceeds size limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, result = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error("Upstream body exceeds size limit"); }
      result += decoder.decode(part.value, { stream: true });
    }
    return result + decoder.decode();
  } finally { reader.releaseLock(); }
}
async function readSource<T>(url: string, stage: Stage, ttl: number, parse: (body: string) => T,
  options: { headers?: Record<string, string>; body?: string; contextKey?: string } = {}): Promise<Payload<T>> {
  const key = `${options.body ? "POST" : "GET"} ${url}\n${options.body ?? ""}\n${options.contextKey ?? ""}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) { cache.delete(key); cache.set(key, hit); return hit.value; }
  if (hit) cache.delete(key);
  // Pending I/O must belong to this request: Workers cancel work when its owner ends.
  const state: RequestState = requestState.getStore() ?? { inFlight: new Map<string, Promise<Payload>>(), queue: Promise.resolve(), lastStart: 0 };
  const { inFlight } = state;
  if (inFlight.has(key)) return inFlight.get(key)!;
  const upstream = new URL(url);
  const task = state.queue.then(async () => {
    // Cache normalized source data, never random draws or request/session headers.
    const edge = state.origin && typeof caches !== "undefined" ? (caches as CacheStorage & { default?: Cache }).default : undefined;
    let edgeKey: Request | undefined;
    if (edge) {
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
      edgeKey = new Request(`${state.origin}/.cache/drinks/${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("")}`);
      const saved = await edge.match(edgeKey).catch(() => undefined);
      if (saved) { try { return await saved.json() as Payload<T>; } catch { /* Refetch corrupt cache entries. */ } }
    }
    const blocked = blockedHosts.get(upstream.hostname);
    if (blocked && Date.now() < blocked.until) throw upstreamRejection(blocked.status);
    await pause(Math.max(0, 500 - (Date.now() - state.lastStart)));
    state.lastStart = Date.now();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { method: options.body ? "POST" : "GET", body: options.body,
        signal: controller.signal, headers: { Accept: "application/json",
          "User-Agent": "NearbyDrink/0.2 (read-only menu lookup)", ...options.headers } });
      if (response.status === 403 || response.status === 429) {
        blockedHosts.set(upstream.hostname, { until: Date.now() + 60000, status: response.status });
        const body = await boundedText(response).catch(() => "");
        console.error(JSON.stringify({ event: "foodpanda_upstream_rejected", host: upstream.hostname,
          path: upstream.pathname, stage, status: response.status, contentType: response.headers.get("content-type"),
          challenge: /captcha|perimeterx|px-cdn|px-cloud|blockScript/i.test(body) }));
        throw upstreamRejection(response.status);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(new DrinkApiError(`目前無法讀取平台${stage}，請稍後再試。`, 502), { upstreamStatus: response.status });
      }
      const data = parse(await boundedText(response));
      const value = { data, sourceUpdatedAt: new Date().toISOString() };
      if (edge && edgeKey) await edge.put(edgeKey, new Response(JSON.stringify(value), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${Math.floor(ttl / 1000)}` },
      })).catch(() => undefined);
      return value;
    } catch (error) {
      if (error instanceof DrinkApiError) throw error;
      console.error(JSON.stringify({ event: "foodpanda_read_failed", host: upstream.hostname,
        path: upstream.pathname, stage, name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message.slice(0, 180) : "Unknown error" }));
      throw new DrinkApiError(controller.signal.aborted ? `平台${stage}查詢逾時，請再試一次。` : `平台${stage}目前無法讀取。`, 502);
    } finally { clearTimeout(timeout); }
  });
  state.queue = task.then(() => undefined, () => undefined);
  const shared = task.then(value => {
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.parse(value.sourceUpdatedAt) + ttl, value }); return value;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, shared); return shared;
}
function validateLocation(lat: number, lng: number, radius: number) {
  if (![lat, lng, radius].every(Number.isFinite) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || ![1, 3, 5].includes(radius))
    throw new DrinkApiError("請提供有效定位，距離請選 1、3 或 5 公里。", 400);
}
function queryText(q: string) {
  if (typeof q !== "string" || q.length > 80) throw new DrinkApiError("搜尋文字請在 80 字以內。", 400);
  return normalized(q.trim());
}
function distance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
function parseListing(body: string): ListingPage {
  const parsed = JSON.parse(body), status = Number(parsed?.status_code || 200);
  if (status === 403 || status === 429) rejectHost("disco.deliveryhero.io", status);
  if (status >= 400 || !Array.isArray(parsed?.data?.items)) throw new Error("Invalid listing response");
  return { rowCount: parsed.data.items.length, available: asNumber(parsed.data.available_count),
    rows: parsed.data.items.map((raw: any) => ({ code: asText(raw.code), active: raw.is_active !== false, store: toStore(raw) })) };
}
export async function getNearbyStores(lat: number, lng: number, radiusKm: number): Promise<Nearby> {
  validateLocation(lat, lng, radiusKm);
  const seen = new Map<string, ListingPage["rows"][number]>(), warnings = [NOTICE];
  let available: number | undefined, offset = 0, ended = false, sourceUpdatedAt = new Date().toISOString();
  while (offset < CONFIG.maxStores) {
    const params = new URLSearchParams({ latitude: String(lat), longitude: String(lng), country: "tw",
      language_id: CONFIG.language, vertical: "restaurants", cuisine: CONFIG.cuisine, customer_type: "regular",
      configuration: "Original", dynamic_pricing: "0", include: "characteristics", sort: "distance_asc",
      limit: String(Math.min(CONFIG.pageSize, CONFIG.maxStores - offset)), offset: String(offset) });
    const result = await readSource(`https://disco.deliveryhero.io/listing/api/v1/pandora/vendors?${params}`, "店家", 120000,
      parseListing, { headers: { "x-disco-client-id": "web" } });
    sourceUpdatedAt = oldest(sourceUpdatedAt, result.sourceUpdatedAt);
    available = result.data.available ?? available;
    const before = seen.size;
    for (const row of result.data.rows) if (row.code) seen.set(row.code, row);
    offset += result.data.rowCount;
    if (!result.data.rowCount || result.data.rowCount < CONFIG.pageSize) { ended = true; break; }
    if (available !== undefined && offset >= available) break;
    if (seen.size === before) break;
  }
  const complete = available !== undefined ? seen.size >= available : ended;
  if (!complete) warnings.push(`平台門市清單只取得 ${seen.size} 家，結果可能不完整。`);
  let missing = 0;
  const stores: Store[] = [];
  for (const row of seen.values()) {
    if (!row.active) continue; // Delivery suspension does not imply that the physical shop is closed.
    const store = row.store;
    if (!store) { missing++; continue; }
    const km = distance(lat, lng, store.latitude, store.longitude);
    if (km <= radiusKm) stores.push({ ...store, distanceKm: Math.round(km * 1000) / 1000 });
  }
  stores.sort((a, b) => a.distanceKm! - b.distanceKm! || a.code.localeCompare(b.code));
  if (stores.some(store => store.deliveryAvailable === false)) warnings.push("部分店家目前暫停平台外送；仍可查看菜單，門市營業請另確認。");
  if (missing) warnings.push(`${missing} 家門市缺少定位，未納入距離篩選。`);
  return { stores, complete: complete && !missing, warnings, sourceUpdatedAt, source: SOURCE };
}
async function readGraphql<T>(operation: "GetRestaurantDetailsPage" | "RestaurantProductQuery", variables: object,
  lat: number, lng: number, parse: (data: any) => T): Promise<Payload<T>> {
  const menu = operation === "GetRestaurantDetailsPage", stage = menu ? "菜單" : "糖冰選項";
  const body = JSON.stringify({ extensions: { persistedQuery: { sha256Hash: menu ? MENU_QUERY_HASH : PRODUCT_QUERY_HASH, version: 1 } }, variables });
  return readSource("https://tw.fd-api.com/graphql", stage, 900000, raw => {
    const response = JSON.parse(raw);
    if (asList(response.errors).length) {
      const codes = asList(response.errors).map(error => asText(error?.extensions?.code)).filter(Boolean);
      console.error(JSON.stringify({ event: "foodpanda_graphql_query_failed", operation, codes: codes.slice(0, 5) }));
      if (codes.some(code => /FORBIDDEN|UNAUTHENTICATED/i.test(code))) rejectHost("tw.fd-api.com", 403);
      if (codes.some(code => /RATE_LIMIT/i.test(code))) rejectHost("tw.fd-api.com", 429);
      throw Object.assign(new DrinkApiError(`平台目前無法提供完整${stage}，請稍後再試。`, 502), { code: "UPSTREAM_QUERY_FAILED" });
    }
    return parse(response?.data);
  }, { body, contextKey: `${lat},${lng}`, headers: { ...menuHeaders(), "Content-Type": "application/json",
    "Display-Context": menu ? "RESTAURANT_DETAIL_PAGE" : "ITEM_MODIFIER", platform: menu ? "web_frontend" : "web", "X-Language-ID": CONFIG.language, locale: "zh_TW",
    "Customer-Latitude": String(lat), "Customer-Longitude": String(lng),
    "apollographql-client-name": "web", "apollographql-client-version": "1", "x-apollo-operation-name": operation } });
}
export async function getStoreMenu(store: Store, lat: number, lng: number): Promise<StoreMenu> {
  if (!/^[a-z0-9-]{1,30}$/i.test(store.code)) throw new DrinkApiError("門市資料無效。", 400);
  const result = await readGraphql("GetRestaurantDetailsPage", {
    input: { code: store.code, expeditionType: "DELIVERY" }, restaurantMenuFilter: { expeditionType: "DELIVERY" },
    recommendationInput: { expeditionType: "DELIVERY", isMealForOne: false }, discountedPriceInput: { expeditionType: "DELIVERY" },
  }, lat, lng, data => normalizeGraphqlMenu(data?.restaurantDetailsPage, store.code));
  const warnings = [NOTICE];
  if (!result.data.items.length) warnings.push("這家店目前沒有可確認為獨立飲品的品項。");
  const verifiedStore = { ...store, ...result.data.store, address: result.data.store.address || store.address,
    distanceKm: Math.round(distance(lat, lng, result.data.store.latitude, result.data.store.longitude) * 1000) / 1000 };
  return { store: verifiedStore, items: result.data.items, warnings, sourceUpdatedAt: result.sourceUpdatedAt, source: SOURCE };
}
async function getDrinkDetails(store: Store, item: Drink, lat: number, lng: number): Promise<Payload<Drink>> {
  return readGraphql("RestaurantProductQuery", { isPreconfiguredToppingsEnabled: false,
    recommendedChoiceGroupsInput: { isMealForOne: false, expeditionType: "DELIVERY" },
    input: { productID: item.id, vendorCode: store.code, expeditionType: "DELIVERY", menuID: item.menuId },
    discountedPriceInput: { expeditionType: "DELIVERY" }, includeVendor: true,
  }, lat, lng, data => normalizeProductDetail(data?.restaurantProduct, item, store.code));
}
function matches(item: Drink, q: string) { return !q || normalized(`${item.name} ${item.category} ${item.description ?? ""}`).includes(q); }
export async function searchNearbyDrinks(lat: number, lng: number, radiusKm: number, q: string, offset = 0) {
  const needle = queryText(q);
  if (!Number.isInteger(offset) || offset < 0) throw new DrinkApiError("搜尋頁碼無效。", 400);
  const nearby = await getNearbyStores(lat, lng, radiusKm), batch = nearby.stores.slice(offset, offset + CONFIG.batch);
  const items: (Drink & { store: Store })[] = [], warnings = [...nearby.warnings];
  let sourceUpdatedAt = nearby.sourceUpdatedAt, failed = false;
  for (const store of batch) {
    try {
      const menu = await getStoreMenu(store, lat, lng);
      sourceUpdatedAt = oldest(sourceUpdatedAt, menu.sourceUpdatedAt); warnings.push(...menu.warnings);
      if (menu.store.distanceKm! <= radiusKm) items.push(...menu.items.filter(item => matches(item, needle)).map(item => ({ ...item, store: menu.store })));
    } catch (error) {
      if (error instanceof DrinkApiError && (error.status === 503 || error.code === "UPSTREAM_QUERY_FAILED")) throw error;
      failed = true; warnings.push(`${store.name} 菜單暫時無法讀取，已略過。`);
    }
  }
  const scannedStores = Math.min(offset + batch.length, nearby.stores.length), hasMore = scannedStores < nearby.stores.length;
  if (hasMore) warnings.push("還有門市未查詢，可載入更多結果。");
  return { items, totalStores: nearby.stores.length, scannedStores, scannedThisBatch: batch.length,
    nextOffset: hasMore ? scannedStores : null, hasMore, listingComplete: nearby.complete,
    complete: nearby.complete && offset === 0 && !hasMore && !failed,
    warnings: unique(warnings), sourceUpdatedAt, source: SOURCE };
}
function randomIndex(length: number) {
  const limit = Math.floor(0x100000000 / length) * length;
  let value: number; do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= limit);
  return value % length;
}
const pick = <T>(values: T[]): T => values[randomIndex(values.length)];
export async function randomNearbyDrink(lat: number, lng: number, radiusKm: number, q = "", temperature?: Temperature, withToppings = false) {
  const needle = queryText(q), nearby = await getNearbyStores(lat, lng, radiusKm);
  if (!nearby.stores.length) throw new DrinkApiError("這個範圍內沒有平台回傳的飲料店，請試較遠的距離。", 404, nearby.warnings);
  const remaining = [...nearby.stores], warnings = [...nearby.warnings];
  for (let attempt = 0; attempt < CONFIG.batch && remaining.length; attempt++) {
    const store = remaining.splice(randomIndex(remaining.length), 1)[0]; // Uniform shop first; never weighted by menu size.
    let menu: StoreMenu;
    try { menu = await getStoreMenu(store, lat, lng); }
    catch (error) {
      if (error instanceof DrinkApiError && (error.status === 503 || error.code === "UPSTREAM_QUERY_FAILED")) throw error;
      warnings.push(`${store.name} 菜單暫時無法讀取，已略過。`); continue;
    }
    warnings.push(...menu.warnings);
    if (menu.store.distanceKm! > radiusKm) { warnings.push(`${store.name} 的菜單座標超出範圍，已略過。`); continue; }
    const candidates = menu.items.filter(item => matches(item, needle));
    if (!candidates.length) continue;
    let details: Payload<Drink>;
    try { details = await getDrinkDetails(store, pick(candidates), lat, lng); }
    catch (error) {
      if (error instanceof DrinkApiError && (error.status === 503 || error.code === "UPSTREAM_QUERY_FAILED")) throw error;
      warnings.push(`${store.name} 的抽中品項暫時缺少完整糖冰選項，已略過。`); continue;
    }
    const item = details.data, variations = item.variations.filter(value => TEMPERATURES.some(mode => (!temperature || temperature === mode) && compatibleVariation(value, mode, item.name)));
    if (!variations.length) { warnings.push(`${store.name} 的抽中品項沒有可完整處理的必選項，已略過。`); continue; }
    const variation = pick(variations), { selectedOptions, totalPrice, temperature: selectedTemperature, toppingAdded } = drawVariation(variation, randomIndex, temperature, item.name, withToppings);
    if (withToppings && !toppingAdded) warnings.push("這杯沒有可隨機加入的額外加料，保留原本飲料組合。");
    const hasSugar = selectedOptions.some(option => /糖|甜|蜜|sugar|sweet/iu.test(option.groupName));
    const hasIce = selectedOptions.some(option => /冰|溫|熱|ice|temperature/iu.test(option.groupName));
    if (!hasSugar && !item.fixedCustomization.sugar) warnings.push("甜度選項未提供，請依店家規定。");
    if (!hasIce && !item.fixedCustomization.ice) warnings.push("冰量選項未提供，請依店家規定。");
    if (item.customizationHint) warnings.push(item.customizationHint);
    if ((variation.containerPrice ?? 0) > 0) warnings.push(`價格已包含平台列出的容器費 ${variation.containerPrice} 元。`);
    return { store: menu.store, item, variation, selectedOptions, totalPrice, temperature: selectedTemperature,
      sourceUpdatedAt: oldest(oldest(nearby.sourceUpdatedAt, menu.sourceUpdatedAt), details.sourceUpdatedAt),
      warnings: unique(warnings), source: SOURCE };
  }
  throw new DrinkApiError("本次抽查未找到選項完整的符合飲料，可先搜尋或再抽一次。", 422, unique(warnings));
}

export async function getNearbyStoreMenu(lat: number, lng: number, radiusKm: number, code: string) {
  const nearby = await getNearbyStores(lat, lng, radiusKm);
  const store = nearby.stores.find(store => store.code === code);
  if (!store) throw new DrinkApiError("這個範圍內找不到指定分店，請重新查詢。", 404);
  const menu = await getStoreMenu(store, lat, lng);
  if (menu.store.distanceKm! > radiusKm) throw new DrinkApiError("分店菜單位置超出所選範圍，請重新查詢。", 422);
  return menu;
}

export async function getNearbyDrinkDetails(lat: number, lng: number, radiusKm: number, code: string, id: string) {
  const menu = await getNearbyStoreMenu(lat, lng, radiusKm, code);
  const item = menu.items.find(item => item.id === id);
  if (!item) throw new DrinkApiError("這家分店目前沒有這個飲品，請重新查看菜單。", 404);
  return (await getDrinkDetails(menu.store, item, lat, lng)).data;
}
