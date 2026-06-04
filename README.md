# Ad Generator — 廣告創意產生 + 檢視（Claude Code plugin）

用 Claude 的 **`generate-creatives` skill** 把品牌 brief（或競品參考）變成可投放的廣告素材：
**文案 + 給 GPT 生圖的 `composition_prompt`**，一次多組、衝量提高可用率。產出存到
`data/creatives/`，再用一個輕量的 **Flask + Vue 3 唯讀看板** 檢視、一鍵複製 prompt 去生圖。

```
品牌 brief / 競品參考
   ↓  /ad-generator:generate-creatives（在 Claude session 裡）
<你的專案>/data/creatives/<id>.json  ── 每組：文案 + composition_prompt
   ↓
唯讀看板（/ad-generator:serve）只負責「檢視 / 複製」
```

- 產生在 Claude session（skill），web 端純唯讀。後端只有 Flask。

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
| `/ad-generator:serve` | 啟動唯讀看板 → http://localhost:5000，檢視/複製創意 |

## 用法

1. `/ad-generator:setup`（首次，裝好 uv 與相依）。
2. `/ad-generator:generate-creatives` —— 一步步給品牌資訊，產出多組素材。
3. `/ad-generator:serve` —— 開看板，選產出，**複製**某組（含使用說明 + brief + creative）貼到 ChatGPT / GPT-Image 生圖；文案直接可用。

## 開發者：直接在 repo 跑（不用安裝 plugin）

需求：[**uv**](https://docs.astral.sh/uv/)。在 repo 內：

```bash
uv sync                        # 建立 .venv + 安裝相依
uv run python server.py        # 唯讀看板 → http://localhost:5000（讀 ./data）
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
├── server.py              Flask 唯讀後端（前端 + /api/creatives；--data-dir 指定資料目錄）
├── index.html             看板 UI 結構（Vue 3）
├── frontend/
│   ├── app.js             看板邏輯
│   ├── theme.css          設計系統（token + 可組裝的 .ds-* 元件庫 + 氛圍背景）
│   └── styles.css         App 專屬覆寫
├── data/creatives/        產出（gitignore；plugin 安裝後寫在使用者專案）
├── pyproject.toml / uv.lock
└── README.md / CLAUDE.md
```

## 端點（皆唯讀）

| 端點 | 用途 |
|---|---|
| `GET /api/creatives` | 列出所有產出（id + brief + 組數） |
| `GET /api/creatives/<id>` | 單一產出的完整內容 |
| `GET /api/health` | 健康檢查 |
