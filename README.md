# Ad Generator — 廣告創意產生 + 檢視（Claude Code plugin）

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

- 發想在 Claude session（skill）；web 端負責檢視 / 編輯 / 生圖 / 刪除。後端：Flask + OpenAI SDK。

## 安裝（Claude Code plugin）

```text
/plugin marketplace add yongrui-support/AdGenPlugin
/plugin install ad-generator@ad-generator
```

裝好後三個 skill：

| skill | 用途 |
|---|---|
| `/ad-generator:setup` | **第一次先跑這個**：偵測 OS → macOS 裝 Homebrew、Windows 裝 Scoop → 裝 uv → 安裝相依 |
| `/ad-generator:generate-creatives` | 把品牌 brief 變成 N 組「文案 + 構圖 prompt」，存到目前專案 `data/creatives/` |
| `/ad-generator:serve` | 啟動看板 → http://localhost:5000，檢視/編輯/生圖/刪除創意 |

## 用法

1. `/ad-generator:setup`（首次，裝好 uv 與相依）。
2. `/ad-generator:generate-creatives` —— 一步步給品牌資訊，產出多組素材。
3. `/ad-generator:serve` —— 開看板：可**編輯**文案/構圖並儲存、**複製** prompt 自行貼到 ChatGPT/Gemini 生圖，或在右上「設定」填 OpenAI key 後**直接生圖**（單張或「一鍵生成全部」）、**刪除**不要的組。

## 開發者：直接在 repo 跑（不用安裝 plugin）

需求：[**uv**](https://docs.astral.sh/uv/)。在 repo 內：

```bash
uv sync                        # 建立 .venv + 安裝相依
uv run python server.py        # 看板 → http://localhost:5000（讀 ./data；--reload 開發自動重啟）
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
├── index.html             看板 UI 結構（Vue 3）
├── frontend/
│   ├── app.js             看板邏輯
│   ├── theme.css          設計系統（token + 可組裝的 .ds-* 元件庫 + 氛圍背景）
│   └── styles.css         App 專屬覆寫
├── data/creatives/        產出 JSON（gitignore；每組有 uid）；data/images/ 生圖 <uid>.png（gitignore）
├── pyproject.toml / uv.lock
└── README.md / CLAUDE.md
```

## 端點

| 端點 | 用途 |
|---|---|
| `GET /api/creatives` | 列出所有產出（id + brief + 組數） |
| `GET /api/creatives/<id>` | 單一產出完整內容（補齊每組 uid） |
| `PUT/DELETE /api/creatives/<id>/<idx>` | 編輯回存 / 刪除單組 |
| `POST /api/images` · `GET /api/images/<uid>` | 生成主視覺（gpt-image-2）/ 取圖 |
| `GET/POST /api/settings[/key]` | 讀取/設定 OpenAI key（存 `.env`，不回傳 key） |
| `GET /api/health` | 健康檢查 |
