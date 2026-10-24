# 附近喝什麼

依定位與 1／3／5 公里範圍，搜尋附近飲料店、查看菜單，或隨機抽一杯飲料與糖冰組合。

## 功能

- 常用地點、瀏覽器定位與手動座標。
- 飲品關鍵字搜尋，以及冰飲／常溫／熱飲抽選。
- 可選擇隨機額外加一項配料，自動計入加價。
- 分店地址與 Google 地圖導航。
- 抽選結果另列完整規格、糖冰、加料與加價。
- 菜單品項展開時才載入選項，避免一次讀取全部商品。
- 短期快取與上次結果恢復；不快取隨機抽選答案。

## 本機開發

需要 Node.js 22.13 以上，以及 package.json 指定的 pnpm 版本。

```sh
corepack enable
pnpm install
pnpm dev
```

預設開啟 http://localhost:5173。無需資料庫、API key 或 foodpanda 帳號。

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

## 技術

React、TypeScript、Vinext／Vite、Cloudflare Workers。正式服務可部署至 Workers；這份公開版本不包含原網站的專案識別碼、憑證或部署歷史。

## API

| 路徑 | 功能 |
| --- | --- |
| `/api/stores` | 附近分店 |
| `/api/stores/menu` | 指定分店飲品菜單 |
| `/api/drinks/search` | 搜尋飲品，分批讀取菜單 |
| `/api/drinks/random` | 隨機抽選與必選項組合 |
| `/api/drinks/options` | 指定飲品完整選項 |

共用參數為 `lat`、`lng`、`radius_km`（1、3 或 5）。菜單使用 `code`；選項另需 `id`；搜尋可加 `q` 與 `offset`；抽選可加 `temperature=cold|ambient|hot`。


## 後端 API 架構

前端只呼叫本專案的 HTTP API；後端負責查詢上游、整理資料與執行抽選。

```text
Browser / React
       |
       | GET /api/... (lat, lng, radius_km, ...)
       v
+------------------------------------------------------+
| Cloudflare Worker                                    |
| worker/index.ts                                      |
| Request-scoped queue and pending-request deduplication|
+---------------------------+--------------------------+
                            |
                            v
+------------------------------------------------------+
| Route handlers: app/api/                              |
| api-utils.ts: validate inputs / JSON / errors         |
|                                                      |
| /stores         -> getNearbyStores                    |
| /stores/menu    -> getNearbyStoreMenu                 |
| /drinks/search  -> searchNearbyDrinks                 |
| /drinks/random  -> randomNearbyDrink                  |
| /drinks/options -> getNearbyDrinkDetails              |
+---------------------------+--------------------------+
                            |
                            v
+------------------------------------------------------+
| Service: lib/foodpanda.ts                             |
|                                                      |
|  Source lookup                                       |
|       |                                              |
|       v                                              |
|  [Memory cache] -> [Worker edge cache]                |
|       | hit               | hit       | miss         |
|       |                   |           v              |
|       |                   |    Upstream HTTP request |
|       |                   |    - Nearby store list   |
|       |                   |    - Menu GraphQL        |
|       |                   |    - Product GraphQL     |
|       |                   |           |              |
|       |                   |           v              |
|       |                   |    Validate / normalize  |
|       |                   |    lib/foodpanda-data.ts |
|       |                   |           |              |
|       +-------------------+-----------+              |
|                           |                          |
|                           v                          |
|  Distance / keyword / temperature / random selection  |
+---------------------------+--------------------------+
                            |
                            | JSON (data / warnings / errors)
                            v
                  Browser cards and menu
                  Short-lived session cache
```

### 各 API 如何處理

| API | 處理流程 |
| --- | --- |
| `/api/stores` | 取得候選分店，驗證座標，計算直線距離，依範圍篩選與排序。 |
| `/api/stores/menu` | 確認分店在範圍內，取得菜單，再核對分店代碼與位置。 |
| `/api/drinks/search` | 每批最多讀取 4 家分店菜單，比對飲品名稱、分類與描述，回傳下一批 offset。 |
| `/api/drinks/random` | 先隨機選店，再選符合關鍵字的品項，取得完整選項，篩選相容溫度與規格，隨機組合必選項並計價；最多嘗試 4 家。 |
| `/api/drinks/options` | 驗證分店及菜單品項，只載入指定飲品的尺寸、糖冰、加料與加價。 |

### 快取與請求控制

- 上游查詢先讀記憶體快取，再讀 Worker edge cache，兩者都未命中才呼叫上游。快取只保存正規化資料，不保存抽選結果。
- 分店資料約保留 2 分鐘；菜單與完整選項約 15 分鐘。讀快取不延長資料原本的期限。
- 等待佇列與進行中的查詢只在同一次 Worker 請求內共用，避免中斷的舊請求阻塞其他請求；同一請求內的來源查詢至少間隔約 500 ms。
- 單次上游查詢逾時為 15 秒。403／429 會回傳明確錯誤，並在目前執行個體短暫停止查詢同一來源。
- 前端背景更新店家；使用者可先按抽選，接續同一筆店家查詢。菜單選項只在展開時載入。
- 瀏覽器查詢快取約 2 分鐘，上次畫面最多恢復 30 分鐘；資料只存在目前工作階段。

## 資料與限制

資料來源為 foodpanda 平台的非官方內部介面，可能因存取限制、頻率限制或介面變更而失效。候選店家不代表當地所有飲料店。價格未套用優惠；實際營業、價格與供應依店家為準。平台未提供的尺寸或糖冰不自行推測；去冰不當作常溫。

快取僅保存正規化資料：店家約 2 分鐘、菜單與選項約 15 分鐘；瀏覽器另有最多 8 筆、約 500 KB 的 sessionStorage 快取。位置與歷史結果只保存在目前瀏覽器工作階段，不包含在此 repository。

第三方來源與授權請見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本專案不是 foodpanda 官方服務。

## 隨機加料

抽選預設不額外加料。開啟「隨機加料」，或呼叫 `/api/drinks/random` 時加上 `toppings=1`，會從該規格允許的可選加料中額外抽一項，將加價計入 `totalPrice`，並列在 `selectedOptions`。`toppings=0` 或省略參數維持原本行為。

僅採用平台提供的可選項目，略過不加料、吸管與袋子等選項；沒有合適加料時保留原組合並回傳提示。店家的必選加料照原規則處理。配料名稱中的「冰」不會被當成飲料溫度設定。加料不需要新增上游請求或套件。
