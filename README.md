# Ad Generator — 廣告創意產生 + 生圖看板（Claude Code plugin）

用 Claude 的 **`generate-creatives` skill** 把品牌 brief（或競品參考）變成可投放的廣告素材：
**文案 + 給生圖模型的 `composition_prompt`**，一次多組、衝量提高可用率。產出存到 `data/creatives/`。

主視覺由 **`generate-images` skill** 用 **CDP 接管你已登入的 ChatGPT** 生圖
（**吃訂閱、不需 OpenAI API key**，還能讓 Claude 逐張回讀對標、迭代到過關），存到 `data/images/` 並**回寫 JSON**。
最後用輕量的 **Flask + Vue 3 看板** 檢視、**編輯、刪除**素材，並顯示生成的主視覺。

> 不懂「CDP 接管 ChatGPT」是什麼？看 **[docs/cdp-基本觀念.md](docs/cdp-基本觀念.md)**（小白向，從啟動到接管一步步講）。

```
品牌 brief / 競品參考
   ↓  /ad-generator:generate-creatives（在 Claude session 裡）
<你的專案>/data/creatives/<id>.json  ── 每組：文案 + composition_prompt
   ↓  /ad-generator:generate-images（Claude 用 CDP 瀏覽器在 ChatGPT 生圖、回讀對標、回寫）
<你的專案>/data/images/<批次id>/<uid>.png  +  回寫該組 images[] 與精修後的 composition_prompt
   ↓  /ad-generator:serve
看板：檢視 / 編輯 / 刪除（生圖完成「重刷頁面」即見新圖）
```

## Claude Code plugin 設置

- **安裝**：`/plugin marketplace add yongrui-support/AdGenPlugin` → `/plugin install ad-generator@ad-generator`
- **更新**：`/plugin marketplace update` → 在 `/plugin` 更新 ad-generator → `/reload-plugins`
- **移除**：`/plugin uninstall ad-generator` → `/plugin marketplace remove ad-generator`（完全可逆）

裝好後四個 skill：

| skill | 用途 |
|---|---|
| `/ad-generator:setup` | **第一次先跑這個**：偵測 OS → 經 Homebrew/Scoop 裝 uv ＋ Node（nvm，Node 24 LTS）→ 安裝相依 → 備 **CDP 瀏覽器**（複製啟動腳本 + 登入 ChatGPT）。生圖環境一次到位 |
| `/ad-generator:generate-creatives` | 把品牌 brief 變成 N 組「文案 + 構圖 prompt」，存到目前專案 `data/creatives/` |
| `/ad-generator:generate-images` | 用 CDP 瀏覽器接管 ChatGPT 把某批創意**實際生成主視覺**，逐張回讀對標、過關後存 `data/images/` 並回寫 JSON |
| `/ad-generator:serve` | 啟動看板 → http://localhost:5050，檢視 / 編輯 / 刪除創意、顯示主視覺 |

## 用法

1. `/ad-generator:setup`（首次，把 uv＋Node＋專案相依＋CDP 瀏覽器一次備好）。
2. `/ad-generator:generate-creatives` —— 一步步給品牌資訊，產出多組素材。
3. `/ad-generator:generate-images` —— 把某批做成主視覺（Claude 開 ChatGPT 分頁生圖、回讀迭代、回寫 JSON）。
4. `/ad-generator:serve` —— 開看板，每組素材可：
   - **編輯**：文案／圖中文字／構圖 prompt 直接改、按「儲存」回存；每組可換**比例**與**生圖路徑**（ChatGPT／Gemini→GPT／Gemini，預設 ChatGPT；物理/方向題用 Gemini→GPT）。
   - **複製 prompt**：把 prompt 帶去外部模型自行生圖（已有圖時會問「基於附圖改圖／生新圖」）。
   - **看主視覺**：`generate-images` 產出的圖**累積成相簿**，用 `‹ ›` 切換；**重刷頁面**即見新圖。
   - **刪除**：移除該組（連同其所有圖）。

> 看板本身**不生圖、不打任何外部 API**，只負責檢視／編輯／刪除＋顯示圖；生圖在 `generate-images` skill。

## 開發者：直接在 repo 跑（不用安裝 plugin）

需求：[**uv**](https://docs.astral.sh/uv/)。在 repo 內：

```bash
uv sync                        # 建立 .venv + 安裝相依（只有 Flask）
uv run python server.py        # 看板 → http://localhost:5050（讀 ./data；--reload 開發自動重啟）
claude --plugin-dir ./         # 以 plugin 形式載入 skills（/ad-generator:<skill>）
```

生圖環境（瀏覽器自動化）的準備見 `skills/setup/SKILL.md` 第 5 步與 `skills/generate-images/SKILL.md`。

## 檔案結構

```
AdGenPlugin/
├── .claude-plugin/
│   ├── plugin.json        plugin 清單
│   └── marketplace.json   marketplace（指向自己）
├── .mcp.json              plugin 內建的 Playwright MCP 宣告（進版控、隨安裝自動註冊）
├── skills/
│   ├── generate-creatives/SKILL.md   核心：產素材
│   ├── generate-images/SKILL.md      用 CDP 瀏覽器在 ChatGPT 生圖、回寫 JSON
│   ├── serve/SKILL.md                啟動看板（自動定位 server.py）
│   └── setup/SKILL.md                環境安裝（brew/scoop → uv＋Node；備 CDP 瀏覽器）
├── templates/
│   └── launch-chrome-cdp.{bat,sh}    CDP Chrome 啟動腳本範本（setup 複製到使用者專案 .browser/）
├── docs/
│   ├── cdp-基本觀念.md               CDP 入門（純教學）
│   ├── plugin-tutorial.md            Claude Code plugin 製作教學 + 實戰踩坑
│   └── ModemDarkDesignPrompt.xml     設計系統整合用的 prompt（建 theme.css 時的參考）
├── server.py              Flask 後端（前端 + 檢視/編輯/刪除 + 服務素材與生成圖；--data-dir 指定資料目錄）
├── migrations.py          批次 JSON 的 schema 版本化遷移（讀取時惰性逐版升級）
├── index.html             看板 UI 結構（Vue 3）
├── frontend/
│   ├── app.js             看板邏輯
│   ├── theme.css          設計系統（token + 可組裝的 .ds-* 元件庫 + 氛圍背景）
│   └── styles.css         App 專屬覆寫
├── data/creatives/        產出 JSON（gitignore；每組有 uid、brief 為發想輸入快照）
├── data/images/<批次id>/  生圖產物（gitignore；依批次分資料夾好翻找，檔名=圖uid 供引用）
├── data/materials/        參考素材（gitignore；圖直接丟這裡、可用子資料夾分類，名稱=相對路徑；index.json 放可選描述；可放 <品牌>/design.md 設計準則供產構圖/生圖遵循）
├── pyproject.toml / uv.lock
└── README.md / CLAUDE.md
```

> `.browser/`（CDP Chrome 的登入態/profile）是**使用者本機資產**、gitignore、不進版控、不隨 plugin 發佈。

## 架構

- `server.py` — Flask 後端，**只做檢視/編輯/刪除＋服務檔案，完全不打任何外部 API、不生圖**。前端靜態檔從 `ROOT`（server.py 所在）服務；**創意資料目錄**用 `--data-dir`（或 `DATA_DIR`）指定，預設 `cwd/data` → plugin 安裝後仍讀**使用者專案**的 `data/`。端點：
  - 讀取（讀取時順手做 **schema 遷移**（`migrations.py`）＋補每組 `uid`/`images`，有變更就寫回）：
    - `GET /api/health` — 健康檢查
    - `GET /api/creatives` — 批次列表（id + brief + 組數）
    - `GET /api/creatives/<id>` — 單批完整內容
  - 寫入：
    - `PUT/DELETE /api/creatives/<id>/<uid>` — 編輯回存 / 刪除單組（以 uid 指認）
  - 素材庫（**把圖丟進 `data/materials/` 即可**，可用子資料夾分類、名稱=相對路徑如 `Dutek/平衡車`，列表時即時遞迴掃描）：
    - `GET /api/materials` — 素材列表（name + description）
    - `GET /api/materials/<name>` — 取素材圖；`DELETE` — 刪除
  - 生成圖：
    - `GET /api/images/<uid>` — 取用 `generate-images` 產出、存在 `data/images/<批次id>/<uid>.png` 的圖
- **生圖在 plugin 外的瀏覽器、不在 server**：`generate-images` skill 用 CDP 接管 ChatGPT 生圖，再用小腳本把圖存進 `data/images/`、**直接回寫** `data/creatives/<id>.json` 的 `images[]`。server 對此不知情——兩個流程協調靠「寫回前重讀最新檔、以 uid 比對、原子寫入」（見下方並發說明與兩份 SKILL.md）。
- `migrations.py` — 批次 JSON 的 **schema 版本化遷移**（檔案即演進史）：`SCHEMA_VERSION` + 逐版增量遷移函式；server 讀取時惰性套用（缺版號視為 0、逐版補課、函式需冪等）。
- `.mcp.json` — plugin 內建的 **Playwright MCP 宣告**（`mcpServers`），隨安裝自動註冊。可攜：CDP 網址 `${PLAYWRIGHT_CDP_URL:-http://127.0.0.1:9222}`、輸出 `${CLAUDE_PROJECT_DIR:-.}/.browser/out`（使用者專案內、已 gitignore），無機器路徑。
- 前端 = Vue 3（CDN，不打包）：
  - `index.html` — 結構 + 確認 modal。
  - `frontend/app.js` — 檢視／編輯／刪除／相簿邏輯（**不打 API、不生圖**）。
  - `frontend/theme.css` — **設計系統**：token（CSS 變數）+ 可組裝的 `.ds-*` 元件庫（btn/card/input/badge/surface/modal…）+ 氛圍背景。
  - `frontend/styles.css` — App 專屬樣式覆寫。
- `data/creatives/<id>.json` — `generate-creatives` 的產出（gitignore），schema 見該 skill 的 SKILL.md：
  - 看板的編輯／刪除、`generate-images` 的回寫都**寫回**這個檔。
  - 每組創意有穩定 `uid`（生成圖以它分組引用）。
  - **brief = 發想時的輸入快照**：`default_offer`/`default_aspect` 只是預設值，卡片的 content／生圖比例可蓋過，分歧是正常演化。
- `data/images/<批次id>/<圖uid>.png` — 生圖產物（gitignore；資料夾=批次 id 給人翻找，檔名=圖 uid 供程式引用；舊扁平檔自動相容）：
  - **每張圖各自一個 uid**，由該組 creative 的 `images[]` 清單引用——生圖 append 成相簿、不覆蓋。
  - 刪組時連同清單裡所有圖一起刪。

### 並發

- server `threaded=True` → 多請求並行。凡「讀改寫」creatives JSON 一律包 `_JSON_LOCK`（含讀取時的 schema 遷移寫回），擋 server 內多執行緒互蓋。
- `generate-images` 是**另一個行程**寫同一份 JSON，`_JSON_LOCK` 管不到——兩份 skill（generate-images §4、generate-creatives §6）都遵守「append/寫回前重讀最新檔、以 uid 比對、原子寫入（.tmp→os.replace）」來協調。
