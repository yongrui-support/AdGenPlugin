# Ad Generator — 廣告創意產生 + 生圖看板（Claude Code plugin）

用 Claude 的 **`generate-creatives` skill** 把品牌 brief（或競品參考）變成可投放的廣告素材：
**文案 + 給 GPT 生圖的 `composition_prompt`**，一次多組、衝量提高可用率。產出存到
`data/creatives/`，再用一個輕量的 **Flask + Vue 3 看板** 檢視、**編輯、刪除**，並可填入
OpenAI key 後直接呼叫 **gpt-image-2** 生成主視覺。

```
品牌 brief / 競品參考
   ↓  /ad-generator:generate-creatives（在 Claude session 裡）
<你的專案>/data/creatives/<id>.json  ── 每組：文案 + composition_prompt
   ↓
看板（/ad-generator:serve）：檢視 / 編輯 / 生圖（gpt-image-2）/ 刪除
```

## Claude Code plugin 設置

- **安裝**：`/plugin marketplace add yongrui-support/AdGenPlugin` → `/plugin install ad-generator@ad-generator`
- **更新**：`/plugin marketplace update` → 在 `/plugin` 更新 ad-generator → `/reload-plugins`
- **移除**：`/plugin uninstall ad-generator` → `/plugin marketplace remove ad-generator`（完全可逆）

裝好後三個 skill：

| skill | 用途 |
|---|---|
| `/ad-generator:setup` | **第一次先跑這個**：偵測 OS → macOS 裝 Homebrew、Windows 裝 Scoop → 裝 uv → 安裝相依 |
| `/ad-generator:generate-creatives` | 把品牌 brief 變成 N 組「文案 + 構圖 prompt」，存到目前專案 `data/creatives/` |
| `/ad-generator:serve` | 啟動看板 → http://localhost:5050，檢視/編輯/生圖/刪除創意 |

## 用法

1. `/ad-generator:setup`（首次，裝好 uv 與相依）。
2. `/ad-generator:generate-creatives` —— 一步步給品牌資訊，產出多組素材。
3. `/ad-generator:serve` —— 開看板，每組素材可：
   - **編輯**：文案／圖中文字／構圖 prompt 直接改、按「儲存」回存。
   - **複製**：把 prompt 帶去 ChatGPT/Gemini 自行生圖（已有圖時會問「基於附圖改圖／生新圖」）。
   - **生圖**：右上「設定」填 OpenAI key 後直接生（單張或「一鍵生成全部」）；每組可換**比例**出不同版位，生成的圖**累積成相簿**用 `‹ ›` 切換。非同步任務——中途重整、切換頁面都沒關係，完成自動出現。
   - **刪除**：移除該組（連同其所有圖）。

## 開發者：直接在 repo 跑（不用安裝 plugin）

需求：[**uv**](https://docs.astral.sh/uv/)。在 repo 內：

```bash
uv sync                        # 建立 .venv + 安裝相依
uv run python server.py        # 看板 → http://localhost:5050（讀 ./data；--reload 開發自動重啟）
claude --plugin-dir ./         # 以 plugin 形式載入 skills（/ad-generator:<skill>）
```

## 檔案結構

```
AdGenPlugin/
├── .claude-plugin/
│   ├── plugin.json        plugin 清單
│   └── marketplace.json   marketplace（指向自己）
├── skills/
│   ├── generate-creatives/SKILL.md   核心：產素材
│   ├── serve/SKILL.md                啟動看板（自動定位 server.py）
│   └── setup/SKILL.md                環境安裝（brew/scoop → uv）
├── server.py              Flask 後端（前端 + 檢視/編輯/刪除/生圖 API；--data-dir 指定資料目錄）
├── migrations.py          批次 JSON 的 schema 版本化遷移（讀取時惰性逐版升級）
├── index.html             看板 UI 結構（Vue 3）
├── frontend/
│   ├── app.js             看板邏輯
│   ├── theme.css          設計系統（token + 可組裝的 .ds-* 元件庫 + 氛圍背景）
│   └── styles.css         App 專屬覆寫
├── data/creatives/        產出 JSON（gitignore；每組有 uid、brief 為發想輸入快照）
├── data/images/           生圖產物（gitignore；每張圖各自 uid，由該組 images[] 引用成相簿）
├── pyproject.toml / uv.lock
└── README.md / CLAUDE.md
```

## 架構

- `server.py` — Flask 後端。前端靜態檔從 `ROOT`（server.py 所在）服務；**創意資料目錄**用 `--data-dir`（或 `DATA_DIR`）指定，預設 `cwd/data` → plugin 安裝後仍讀**使用者專案**的 `data/`。端點：
  - 唯讀（讀取時順手做 **schema 遷移**（`migrations.py`）＋補每組 `uid`/`images`，有變更就寫回）：
    - `GET /api/health` — 健康檢查
    - `GET /api/creatives` — 批次列表（id + brief + 組數）
    - `GET /api/creatives/<id>` — 單批完整內容
  - 寫入：
    - `PUT/DELETE /api/creatives/<id>/<uid>` — 編輯回存 / 刪除單組（以 uid 指認）
    - `POST /api/settings/key` — 把 OpenAI key 寫進專案根 `.env`
    - `GET /api/settings` — 只回報 key 是否已設定（**永不回傳 key**）
  - 生圖（非同步任務）：
    - `POST /api/images {id, uid}` — 登記任務即回 202，背景執行緒呼叫 gpt-image-2 → 存 `data/images/<圖uid>.png`
    - `GET /api/images/status` — 任務表（前端輪詢用）
    - `GET /api/images/<uid>` — 取圖
- `migrations.py` — 批次 JSON 的 **schema 版本化遷移**（檔案即演進史）：`SCHEMA_VERSION` + 逐版增量遷移函式；server 讀取時惰性套用（缺版號視為 0、逐版補課、函式需冪等）。
- 前端 = Vue 3（CDN，不打包）：
  - `index.html` — 結構 + 設定／確認 modal。
  - `frontend/app.js` — 檢視／編輯／生圖／刪除邏輯。
  - `frontend/theme.css` — **設計系統**：token（CSS 變數）+ 可組裝的 `.ds-*` 元件庫（btn/card/input/badge/surface/modal…）+ 氛圍背景。
  - `frontend/styles.css` — App 專屬樣式覆寫。
- `data/creatives/<id>.json` — `generate-creatives` skill 的產出（gitignore），schema 見該 skill 的 SKILL.md：
  - 看板的編輯／刪除會**回寫**這個檔。
  - 每組創意有穩定 `uid`（生成圖、API 都以它指認）。
  - **brief = 發想時的輸入快照**：`default_offer`/`default_aspect` 只是預設值，卡片的 content／生圖比例可蓋過，分歧是正常演化。
- `data/images/<圖uid>.png` — 生圖產物（gitignore）：
  - **每張圖各自一個 uid**，由該組 creative 的 `images[]` 清單引用——生圖 append 成相簿、不覆蓋。
  - 刪組時連同清單裡所有圖一起刪。
