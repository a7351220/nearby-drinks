"use client";

import { useEffect, useRef, useState } from "react";
import { readCache, writeCache } from "@/lib/browser-cache";
import type { Drink as SourceDrink } from "@/lib/foodpanda-data";
import { DrinkOptions } from "@/components/drink-options";


type Price = number | string | null;
type Store = {
  code: string;
  name: string;
  distanceKm?: number | null;
  deliveryAvailable?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  address?: string;
  url?: string;
};
type Drink = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  price?: Price;
  optionsLoaded?: boolean;
  variations?: SourceDrink["variations"];
  fixedCustomization?: SourceDrink["fixedCustomization"];
  customizationHint?: string;
  store: Store;
};
type StoreResponse = {
  stores: Store[];
  complete: boolean;
  warnings?: string[];
};
type SearchResponse = {
  items: Drink[];
  totalStores: number;
  scannedStores: number;
  nextOffset: number | null;
  hasMore: boolean;
  warnings?: string[];
};
type RandomResponse = {
  store: Store;
  item: Partial<SourceDrink> & { name: string; price?: Price };
  variation?: { name?: string; price?: Price };
  selectedOptions?: { groupName: string; name: string; price?: Price }[];
  temperature?: "cold" | "ambient" | "hot";
  totalPrice?: Price;
  warnings?: string[];
};
type MenuResponse = { store: Store; items: Drink[]; warnings?: string[] };
type Task = "search" | "more" | "random" | "menu";
type View = "stores" | "search" | "random" | "menu" | null;

// Presets verified against official postal coordinates and OpenStreetMap station buildings.
const LOCATION_PRESETS: { id: string; label: string; latitude: number | null; longitude: number | null }[] = [
  { id: "ccu", label: "嘉義中正大學", latitude: 23.560948, longitude: 120.472143 },
  { id: "chiayi-station", label: "嘉義火車站", latitude: 23.47916, longitude: 120.44118 },
  { id: "minxiong-station", label: "民雄火車站", latitude: 23.55495, longitude: 120.43162 },
];
const DEFAULT_LOCATION = LOCATION_PRESETS[0];

function priceNumber(value: Price | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: Price | undefined): string {
  const parsed = priceNumber(value);
  return parsed === null
    ? "價格未提供"
    : `NT$ ${parsed.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
}

function distance(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "距離未提供";
  return value < 1
    ? `約 ${Math.round(value * 1000)} 公尺`
    : `約 ${value.toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 公里`;
}

function WarningList({ warnings }: { warnings?: string[] }) {
  const messages = [...new Set((warnings ?? []).filter((entry) => typeof entry === "string" && entry.trim()))];
  if (!messages.length) return null;
  return (
    <div className="drink-notice" role="status">
      {messages.map((message) => <p key={message}>{message}</p>)}
    </div>
  );
}

async function requestApi<T>(path: string, signal: AbortSignal, refresh = false): Promise<T> {
  const cacheable = !path.startsWith("/api/drinks/random");
  const cached = cacheable && !refresh ? readCache<T>(path) : undefined;
  if (cached) return cached.value;
  let response: Response;
  const deadline = AbortSignal.timeout(25000);
  const requestSignal = AbortSignal.any([signal, deadline]);
  try {
    response = await fetch(path, { signal: requestSignal, cache: "no-store", headers: { Accept: "application/json" } });
  } catch (error) {
    if (signal.aborted) throw error;
    if (deadline.aborted) throw new Error("查詢超過 25 秒，請重試或縮小範圍。");
    throw new Error("暫時連不上服務，請檢查網路後再試。");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("暫時無法讀取菜單，請稍後再試。");
  }
  if (!response.ok) {
    const data = body as { error?: string | { message?: string }; message?: string } | null;
    const detail = typeof data?.error === "string" ? data.error : data?.error?.message ?? data?.message;
    const fallback = response.status === 429
      ? "查詢有點頻繁，請稍等一下再試。"
      : response.status === 404
        ? "沒有找到符合條件的飲料，試著換個關鍵字或放大範圍。"
        : "暫時無法取得平台菜單，請稍後再試。";
    throw new Error(detail && /[\u3400-\u9fff]/.test(detail) ? detail : fallback);
  }
  if (cacheable) writeCache(path, body);
  return body as T;
}

function MenuDrinkOptions({ item, params }: { item: Partial<SourceDrink>; params: string }) {
  const [detail, setDetail] = useState<Partial<SourceDrink> | null>(item.optionsLoaded ? item : null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function load() {
    if (detail || controller.current) return;
    const active = new AbortController();
    controller.current = active;
    setLoading(true); setError("");
    try {
      const result = await requestApi<SourceDrink>(`/api/drinks/options?${params}&id=${encodeURIComponent(item.id!)}`, active.signal);
      if (!result.optionsLoaded || !Array.isArray(result.variations)) throw new Error("選項資料不完整，請再試一次。");
      if (!active.signal.aborted) setDetail(result);
    } catch (failure) {
      if (!active.signal.aborted) setError(failure instanceof Error ? failure.message : "暫時無法讀取選項。");
    } finally {
      if (!active.signal.aborted) setLoading(false);
      controller.current = null;
    }
  }
  return <details className="drink-menu-options" onToggle={event => { if (event.currentTarget.open) void load(); }}>
    <summary>查看糖冰、尺寸與加料</summary>
    {loading && <p role="status">正在讀取這杯飲料的選項…</p>}
    {error && <p role="alert">{error} <button type="button" className="drink-text-button" onClick={() => void load()}>重試</button></p>}
    {detail && <DrinkOptions item={detail} />}
  </details>;
}

export default function DrinkPage() {
  const [latitude, setLatitude] = useState(DEFAULT_LOCATION.latitude === null ? "" : String(DEFAULT_LOCATION.latitude));
  const [longitude, setLongitude] = useState(DEFAULT_LOCATION.longitude === null ? "" : String(DEFAULT_LOCATION.longitude));
  const [locationLabel, setLocationLabel] = useState(DEFAULT_LOCATION.label);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(DEFAULT_LOCATION.id);
  const [locationRevision, setLocationRevision] = useState(0);
  const [manualLocation, setManualLocation] = useState(false);
  const [locating, setLocating] = useState(false);
  const [radius, setRadius] = useState(1);
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [temperature, setTemperature] = useState("any");
  const [withToppings, setWithToppings] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<Task | null>(null);
  const [view, setView] = useState<View>("stores");
  const [ready, setReady] = useState(false);
  const [loadingStores, setLoadingStores] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [stores, setStores] = useState<StoreResponse | null>(null);
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [draw, setDraw] = useState<RandomResponse | null>(null);
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const storeRequest = useRef<Promise<StoreResponse> | null>(null);
  const locationRequestId = useRef(0);

  const lat = Number(latitude);
  const lng = Number(longitude);
  const hasLocation = latitude.trim() !== "" && longitude.trim() !== ""
    && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  const disabled = !ready || busy !== null || locating || !hasLocation;

  useEffect(() => () => {
    controller.current?.abort();
    requestId.current += 1;
    locationRequestId.current += 1;
  }, []);

  useEffect(() => {
    const last = readCache<{
      latitude: string; longitude: string; locationLabel: string; selectedPreset: string | null;
      radius: number; query: string; temperature: string; withToppings?: boolean; view: View;
      stores: StoreResponse | null; draw: RandomResponse | null; search: SearchResponse | null; menu: MenuResponse | null;
    }>("last", 30 * 60_000);
    if (last && typeof last.value?.latitude === "string" && typeof last.value.longitude === "string"
        && [1, 3, 5].includes(last.value.radius)) {
      const value = last.value;
      setLatitude(value.latitude); setLongitude(value.longitude); setLocationLabel(value.locationLabel);
      setSelectedPreset(value.selectedPreset); setRadius(value.radius); setQuery(value.query); setTemperature(value.temperature); setWithToppings(value.withToppings === true);
      setView(value.view); setStores(value.stores); setDraw(value.draw); setSearch(value.search); setMenu(value.menu);
      setSavedAt(last.savedAt);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready && hasLocation && !busy && (stores || draw || search || menu)) {
      writeCache("last", { latitude, longitude, locationLabel, selectedPreset, radius, query, temperature, withToppings,
        view, stores, draw, search, menu });
    }
  }, [ready, hasLocation, busy, latitude, longitude, locationLabel, selectedPreset, radius, query, temperature, withToppings, view, stores, draw, search, menu]);

  useEffect(() => {
    if (!ready || !hasLocation) return;
    const activeController = new AbortController();
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng), radius_km: String(radius) });
    const path = `/api/stores?${params}`;
    const cached = readCache<StoreResponse>(path, 30 * 60_000);
    if (cached) { setStores(cached.value); setSavedAt(cached.savedAt); }
    setLoadingStores(true);
    const pending = requestApi<StoreResponse>(path, activeController.signal, true).then(result => {
      if (!Array.isArray(result?.stores)) throw new Error("店家資料不完整，請稍後再試。");
      if (!activeController.signal.aborted) setStores(result);
      return result;
    });
    storeRequest.current = pending;
    void pending.catch(failure => {
      if (!activeController.signal.aborted) setError(failure instanceof Error ? failure.message : "暫時無法取得附近店家。");
    }).finally(() => {
      if (!activeController.signal.aborted) setLoadingStores(false);
    });
    return () => {
      activeController.abort();
      if (storeRequest.current === pending) storeRequest.current = null;
    };
  }, [ready, latitude, longitude, radius, locationRevision]);

  function clearResults() {
    setLoadingStores(false);
    controller.current?.abort();
    requestId.current += 1;
    setBusy(null);
    setError("");
    setStores(null);
    setSearch(null);
    setDraw(null);
    setMenu(null);
    setSavedAt(null);
    setView("stores");
  }

  function clearDrinkResults() {
    setError("");
    setSearch(null);
    setDraw(null);
    setMenu(null);
    controller.current?.abort();
    requestId.current += 1;
    setBusy(null);
    setSavedAt(null);
    setView("stores");
  }

  function setPosition(nextLat: string, nextLng: string, label: string, presetId: string | null = null) {
    clearResults();
    locationRequestId.current += 1;
    setLocating(false);
    setLatitude(nextLat);
    setLongitude(nextLng);
    setLocationLabel(label);
    setSelectedPreset(presetId);
    setLocationRevision((revision) => revision + 1);
  }

  function locate() {
    clearResults();
    if (!navigator.geolocation) {
      setError("這個瀏覽器無法取得位置，請選擇上方地點或輸入座標。");
      return;
    }
    const id = ++locationRequestId.current;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (locationRequestId.current !== id) return;
        setPosition(coords.latitude.toFixed(6), coords.longitude.toFixed(6), "目前位置");
      },
      (failure) => {
        if (locationRequestId.current !== id) return;
        setLocating(false);
        setError(failure.code === 1
          ? "尚未允許定位。可以在瀏覽器開啟權限，或選擇上方地點、手動輸入座標。"
          : failure.code === 3
            ? "定位等候逾時，請再試一次，或選擇上方地點、手動輸入座標。"
            : "目前無法取得位置，請再試一次，或選擇上方地點、手動輸入座標。");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  async function run(task: Task, storeCode?: string) {
    if (!hasLocation) {
      setError("請先設定位置，或輸入有效的緯度與經度。");
      return;
    }
    if (task === "more" && (!search?.hasMore || search.nextOffset === null)) return;
    controller.current?.abort();
    const activeController = new AbortController();
    controller.current = activeController;
    const id = ++requestId.current;
    setError("");
    setSavedAt(null);
    setBusy(task);
    setView(task === "more" ? "search" : task);

    const params = new URLSearchParams({ lat: String(lat), lng: String(lng), radius_km: String(radius) });
    try {
      // Finish the current listing once; subsequent requests reuse its server cache.
      await storeRequest.current?.catch(() => undefined);
      if (activeController.signal.aborted || id !== requestId.current) return;
      if (task === "menu") {
        params.set("code", storeCode!);
        const result = await requestApi<MenuResponse>(`/api/stores/menu?${params}`, activeController.signal);
        if (!Array.isArray(result?.items)) throw new Error("菜單資料不完整，請稍後再試。");
        if (id === requestId.current) setMenu(result);
      } else if (task === "random") {
        if (temperature !== "any") params.set("temperature", temperature);
        if (withToppings) params.set("toppings", "1");
        if (query.trim()) params.set("q", query.trim());
        const result = await requestApi<RandomResponse>(`/api/drinks/random?${params}`, activeController.signal);
        if (!result?.store?.name || !result?.item?.name) throw new Error("飲料資料不完整，請稍後再試。");
        if (id === requestId.current) setDraw(result);
      } else {
        if (query.trim()) params.set("q", query.trim());
        params.set("offset", task === "more" ? String(search!.nextOffset) : "0");
        const result = await requestApi<SearchResponse>(`/api/drinks/search?${params}`, activeController.signal);
        if (!Array.isArray(result?.items)) throw new Error("菜單資料不完整，請稍後再試。");
        if (id === requestId.current) {
          setSearch((previous) => {
            if (task !== "more" || !previous) return result;
            const merged = new Map<string, Drink>();
            for (const item of [...previous.items, ...result.items]) {
              merged.set(`${item.store.code}:${item.id ?? item.name}`, item);
            }
            return { ...result, items: [...merged.values()], warnings: [...new Set([...(previous.warnings ?? []), ...(result.warnings ?? [])])] };
          });
        }
      }
    } catch (failure) {
      if (!activeController.signal.aborted && id === requestId.current) {
        setError(failure instanceof Error ? failure.message : "查詢暫時失敗，請稍後再試。");
      }
    } finally {
      if (id === requestId.current) setBusy(null);
    }
  }

  function mapsUrl(store: Store) {
    const hasStoreCoordinates = typeof store.latitude === "number" && typeof store.longitude === "number"
      && Number.isFinite(store.latitude) && Number.isFinite(store.longitude)
      && store.latitude >= -90 && store.latitude <= 90 && store.longitude >= -180 && store.longitude <= 180;
    const destination = store.address ? `${store.name} ${store.address}`
      : hasStoreCoordinates ? `${store.latitude},${store.longitude}` : store.name;
    const params = new URLSearchParams({ api: "1", destination, travelmode: "walking" });
    if (hasLocation) params.set("origin", `${lat},${lng}`);
    return `https://www.google.com/maps/dir/?${params}`;
  }

  const busyText = busy === "random" ? "正在找店家、看菜單，幫你抽一杯…"
    : busy === "more" ? "正在查下一批店家的菜單…"
        : "正在查看附近店家的菜單…";
  const totalPrice = draw ? priceNumber(draw.totalPrice) : null;
  const fallbackPrice = draw?.variation?.price ?? draw?.item?.price;

  return (
    <main className="drink-app">
      <div className="drink-shell">
        <header className="drink-header">
          <span className="drink-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none"><path d="M19 3h5l-3 9M7 12h18M9 12l2 16h10l2-16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M11 19h10" stroke="currentColor" strokeWidth="2" /><circle cx="14" cy="24" r="1" fill="currentColor" /><circle cx="18" cy="23" r="1" fill="currentColor" /></svg>
          </span>
          <div><h1>附近喝什麼</h1><p>選個距離，從附近店家的菜單抽一杯。</p></div>
        </header>

        <section className="drink-panel drink-controls" aria-label="設定位置與搜尋條件">
          <div className="drink-location-heading"><h2>選擇位置</h2><span className={`drink-location-tag${hasLocation ? " is-ready" : ""}`}>{hasLocation ? locationLabel || "已設定位置" : "尚未設定位置"}</span></div>
          <div className="drink-presets" role="group" aria-label="常用地點">
            {LOCATION_PRESETS.map((preset) => <button key={preset.id} type="button" className={`drink-button ${selectedPreset === preset.id ? "drink-button-location" : "drink-button-secondary"}`} aria-pressed={selectedPreset === preset.id} disabled={preset.latitude === null || preset.longitude === null} onClick={() => {
              if (preset.latitude !== null && preset.longitude !== null) setPosition(String(preset.latitude), String(preset.longitude), preset.label, preset.id);
            }}>{preset.label}</button>)}
          </div>
          {selectedPreset === "ccu" && <p className="drink-location-detail">以中正大學校內郵局為中心。</p>}
          <div className="drink-location-actions">
            <button type="button" className="drink-text-button" onClick={locate} disabled={locating}>{locating ? "定位中…" : "使用我的位置"}</button>
            <button type="button" className="drink-text-button" aria-expanded={manualLocation} aria-controls="drink-coordinates" onClick={() => setManualLocation(!manualLocation)}>{manualLocation ? "收起座標" : "手動輸入座標"}</button>
          </div>
          {manualLocation && <div id="drink-coordinates" className="drink-coordinate-fields">
            <label>緯度<input type="number" inputMode="decimal" min="-90" max="90" step="any" placeholder="輸入緯度" value={latitude} onChange={(event) => setPosition(event.target.value, longitude, "手動輸入位置")} /></label>
            <label>經度<input type="number" inputMode="decimal" min="-180" max="180" step="any" placeholder="輸入經度" value={longitude} onChange={(event) => setPosition(latitude, event.target.value, "手動輸入位置")} /></label>
            {(latitude !== "" || longitude !== "") && !hasLocation && <p className="drink-coordinate-hint">請填入有效座標：緯度 −90～90，經度 −180～180。</p>}
          </div>}

          <div className="drink-divider" />
          <div className="drink-filter-row">
            <fieldset className="drink-radius"><legend>找多遠？</legend><div className="drink-radius-options">{[1, 3, 5].map((value) => <label key={value} className={`drink-radius-option${radius === value ? " is-selected" : ""}`}><input type="radio" name="radius" value={value} checked={radius === value} onChange={() => { clearResults(); setRadius(value); }} /><span>{value} 公里</span></label>)}</div></fieldset>
            <label className="drink-query">想喝什麼？<span className="drink-optional">可留白</span><input type="search" placeholder="例如：奶茶、烏龍、珍珠" value={query} maxLength={80} onChange={(event) => { clearDrinkResults(); setQuery(event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && !disabled) void run("search"); }} /></label>
          </div>
          <fieldset className="drink-radius"><legend>飲用溫度</legend><div className="drink-radius-options">{[["any", "都可以"], ["cold", "冰飲"], ["ambient", "常溫"], ["hot", "熱飲"]].map(([value, label]) => <label key={value} className={`drink-radius-option${temperature === value ? " is-selected" : ""}`}><input type="radio" name="temperature" value={value} checked={temperature === value} onChange={() => { clearDrinkResults(); setTemperature(value); }} /><span>{label}</span></label>)}</div></fieldset>
          <label className="drink-toppings"><input type="checkbox" checked={withToppings} onChange={event => { clearDrinkResults(); setWithToppings(event.target.checked); }} />隨機加料</label>
          <p className="drink-help">開啟後額外抽 1 項店家提供的可選加料，加價計入總價；沒有可選加料時保留原組合。</p>
          <p className="drink-help">溫度用於抽選；常溫只選店家明列的常溫選項，去冰仍屬冰飲。</p>
          <p className="drink-help">留白就從全部品項抽；填入關鍵字，只抽符合的飲料。</p>
          <div className="drink-main-actions">
            <button type="button" className="drink-button drink-button-primary" disabled={disabled} onClick={() => void run("random")}><span aria-hidden="true">✦</span> {busy === "random" ? "幫你抽選中…" : "幫我抽一杯"}</button>
            <button type="button" className="drink-button drink-button-secondary" disabled={disabled} onClick={() => void run("search")}>{busy === "search" ? "搜尋中…" : "找飲料"}</button>
          </div>
          {!hasLocation && <p className="drink-start-hint">先設定位置，就能開始抽。</p>}
        </section>

        {error && <div className="drink-error" role="alert"><strong>暫時無法完成</strong><p>{error}</p></div>}
        {(busy || loadingStores) && <div className="drink-loading" role="status"><span className="drink-spinner" aria-hidden="true" />{busy ? busyText : "正在更新附近店家，可以先設定條件或抽一杯…"}</div>}
        {savedAt && <p className="drink-progress">上次結果 · {new Date(savedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}，價格與供應請以店家為準。</p>}

        <div className="drink-results" aria-live="polite" aria-busy={busy !== null}>
          {view === "random" && draw && <section className="drink-panel drink-draw" aria-labelledby="drink-draw-title">
            <p className="drink-eyebrow">今天就喝這杯</p>
            <h2 id="drink-draw-title">{draw.item.name}</h2>
            {draw.variation?.name && draw.variation.name !== draw.item.name && <p className="drink-variation">{draw.variation.name}</p>}
            <p className="drink-draw-store">{draw.store.name}<span>{distance(draw.store.distanceKm)}</span></p>
            <p className="drink-progress">{draw.store.address || "平台未提供地址"}<br />{draw.store.latitude}, {draw.store.longitude}</p>
            {draw.temperature && <p className="drink-variation">{{ cold: "冰飲", ambient: "常溫", hot: "熱飲" }[draw.temperature]}</p>}
            <div className="drink-choice-box">
              {draw.selectedOptions?.length ? <dl className="drink-options">{draw.selectedOptions.map((option, index) => <div key={`${option.groupName}:${option.name}:${index}`}><dt>{/冰|溫|熱|temperature|ice/iu.test(option.groupName) ? (draw.temperature === "cold" ? "冰量" : "溫度") : option.groupName || "選項"}</dt><dd>{option.name}{(priceNumber(option.price) ?? 0) > 0 && <span className="drink-option-price"> +{money(option.price)}</span>}</dd></div>)}</dl> : <p className="drink-no-options">平台菜單未提供可顯示的糖冰選項。</p>}
              <div className="drink-price"><span>{totalPrice !== null ? "菜單原價" : "品項起價"}</span><strong>{money(totalPrice ?? fallbackPrice)}</strong></div>
            </div>
            <div className="drink-result-actions">
              <a className="drink-button drink-button-location" href={mapsUrl(draw.store)} target="_blank" rel="noopener noreferrer">Google 地圖導航 <span aria-hidden="true">↗</span></a>
              <button type="button" className="drink-text-button" disabled={disabled} onClick={() => void run("menu", draw.store.code)}>查看本站菜單</button>
              <button type="button" className="drink-text-button" disabled={disabled} onClick={() => void run("random")}>再抽一杯</button>
            </div>
            <WarningList warnings={draw.warnings} />
          </section>}

          {view === "random" && draw && <section className="drink-panel" aria-label="這杯飲料的其他選項">
            <h2>這杯還能怎麼選？</h2>
            <p className="drink-help">店家提供的選項；上方卡片是這次抽中的組合。</p>
            <DrinkOptions item={draw.item} />
          </section>}

          {view === "menu" && menu && <section className="drink-panel" aria-labelledby="drink-menu-title">
            <div className="drink-section-heading"><h2 id="drink-menu-title">{menu.store.name} 菜單</h2><span className="drink-count">{menu.items.length} 款</span></div>
            <p className="drink-progress">{menu.store.address || "平台未提供地址"}<br />{menu.store.latitude}, {menu.store.longitude} · {distance(menu.store.distanceKm)}</p>
            <a className="drink-text-button" href={mapsUrl(menu.store)} target="_blank" rel="noopener noreferrer">Google 地圖導航 ↗</a>
            {draw && <button type="button" className="drink-text-button" onClick={() => setView("random")}>回到抽選結果</button>}
            <p className="drink-help">foodpanda 飲品菜單；價格為起價，尺寸與加料可能另計。</p>
            <ul className="drink-item-list">{menu.items.map(item => <li key={item.id}><div className="drink-list-copy"><h3>{item.name}</h3><p>{item.category}</p>{item.description && <p>{item.description}</p>}<MenuDrinkOptions key={`${menu.store.code}:${item.id}`} item={draw?.store.code === menu.store.code && draw.item.id === item.id ? draw.item : { ...item, price: priceNumber(item.price) ?? undefined }} params={new URLSearchParams({ lat: String(lat), lng: String(lng), radius_km: String(radius), code: menu.store.code }).toString()} /></div><strong className="drink-list-price">{money(item.price)}</strong></li>)}</ul>
            {!menu.items.length && <p className="drink-empty">這家店目前沒有平台可提供的飲品。</p>}
            <WarningList warnings={menu.warnings} />
          </section>}

          {view === "search" && search && <section className="drink-panel" aria-labelledby="drink-search-title">
            <div className="drink-section-heading"><h2 id="drink-search-title">{query.trim() ? `「${query.trim()}」的搜尋結果` : "附近有這些飲料"}</h2><span className="drink-count">{search.items.length} 款</span></div>
            <p className="drink-progress">已查 {search.scannedStores} / {search.totalStores} 家店{search.hasMore ? "，還有店家尚未查詢。" : "。"}</p>
            {search.items.length ? <ul className="drink-item-list">{search.items.map((item) => <li key={`${item.store.code}:${item.id ?? item.name}`}><div className="drink-list-copy"><h3>{item.name}</h3><p>{item.store.name} · {distance(item.store.distanceKm)}</p><button type="button" className="drink-text-button" disabled={disabled} onClick={() => void run("menu", item.store.code)}>查看本站菜單</button></div><strong className="drink-list-price">{money(item.price)}</strong></li>)}</ul> : <p className="drink-empty">{search.hasMore ? "這幾家暫時沒有符合的品項，可以繼續查下一批。" : "已查詢的店家沒有符合的品項，試著換個關鍵字或放大範圍。"}</p>}
            {search.hasMore && search.nextOffset !== null && <button type="button" className="drink-button drink-button-secondary drink-more" disabled={disabled} onClick={() => void run("more")}>{busy === "more" ? "繼續查詢中…" : "再查 4 家"}</button>}
            <WarningList warnings={search.warnings} />
          </section>}

          {view === "stores" && stores && <section className="drink-panel" aria-labelledby="drink-stores-title">
            <div className="drink-section-heading"><h2 id="drink-stores-title">附近飲料店</h2><span className="drink-count">{stores.stores.length} 家</span></div>
            <p className="drink-progress">範圍 {radius} 公里{stores.complete ? "。" : "；這次取得的店家清單可能不完整。"}</p>
            {stores.stores.length ? <ul className="drink-item-list">{stores.stores.map((store) => <li key={store.code}><div className="drink-list-copy"><h3>{store.name}</h3><p>{store.address || "平台未提供地址"}</p><button type="button" className="drink-text-button" disabled={disabled} onClick={() => void run("menu", store.code)}>查看本站菜單</button><p>{distance(store.distanceKm)}{store.deliveryAvailable === false ? " · 平台外送暫停" : ""}</p></div><a className="drink-store-link" href={mapsUrl(store)} target="_blank" rel="noopener noreferrer" aria-label={`前往 ${store.name} 的 Google 地圖導航`}>導航 ↗</a></li>)}</ul> : <p className="drink-empty">這次沒有找到附近的飲料店，可以放大範圍再試試。</p>}
            <WarningList warnings={stores.warnings} />
          </section>}
        </div>

        <footer className="drink-footer">資料：foodpanda 平台菜單，價格未套用優惠。<br />品項與供應情況依店家當下菜單為準。</footer>
      </div>
    </main>
  );
}
