# CLAUDE.md

本檔提供 Claude Code（claude.ai/code）在此 repo 中工作時的指引。

## 這是什麼

一個輕量工具：用 **`generate-creatives` skill** 把品牌 brief / 競品參考，產成可投放的
廣告素材（文案 + 給 GPT 生圖的 `composition_prompt`），存到 `data/creatives/`；
再用一個 **Flask + Vue 3 的唯讀看板** 檢視、複製 prompt 去生圖。

- 創意的「產生」在 Claude session 裡（`generate-creatives` skill），不是 web app runtime。
- web 端純唯讀，不產生任何東西。

## 這是一個 Claude Code plugin（ad-generator）

本 repo 同時是 plugin 與自己的 marketplace。

- 清單：`.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`（`source: "./"`）。
- skills 放在 **`skills/<name>/SKILL.md`**（唯一來源；比照 marketingskills，**無 `.claude/`**）：`generate-creatives`（核心，產到使用者專案 `data/creatives/`）、`serve`（看板）、`setup`（裝 brew/scoop→uv）。
- 開發/測試：改 `skills/`，用 `claude --plugin-dir ./`（skills 變 `/ad-generator:<skill>`）；或 `/plugin marketplace add <本機路徑或 repo>` → `/plugin install ad-generator@ad-generator`（真安裝，連動態定位都驗得到）。
- **plugin 路徑**：`serve`/`setup` 要跑包內的 `server.py`，靠 **skill 自己的「Base directory」推 plugin 根**（`<skill base>/../..`）—— skill 被呼叫時系統會在開頭提供該 base 的絕對路徑。**不用** `$CLAUDE_PLUGIN_ROOT`（它在 skill bash 不可靠）、也不用 `find ~/.claude`、不靠 cwd。

## 環境與指令（uv）

團隊統一用 **uv**（勿用 pip）。`uv.lock` 進版控。後端只有 Flask。

```bash
uv sync                    # 建立 .venv + 安裝相依
uv run python server.py    # 啟動唯讀看板 → http://localhost:5000
```

- 沒有測試套件。改 `server.py` 後用 `import server` 檢查路由能起來。
- Lint/format：`uv run ruff format .` 與 `uv run ruff check --fix .`（手動跑）。

## 架構

- `server.py` — Flask 唯讀後端：服務 `index.html`、`/api/health`、`/api/creatives`（列表）、`/api/creatives/<id>`（單筆）。前端靜態檔從 `ROOT`（server.py 所在）服務；**創意資料目錄**用 `--data-dir`（或 `DATA_DIR`）指定，預設 `cwd/data` → 讓 plugin 安裝後仍讀**使用者專案**的 `data/creatives/`。不寫、不產生。
- 前端 = Vue 3（CDN，不打包）：`index.html`（結構）+ `frontend/app.js`（看板邏輯）+ `frontend/styles.css`。
- `frontend/theme.css` — **設計系統**：token（CSS 變數）+ 可組裝的 `.ds-*` 元件庫（btn/card/input/badge/surface/modal…）+ 氛圍背景。做新 UI = 套這些 class；改主題只動 `:root` 的 token。
- `data/creatives/<id>.json` — `generate-creatives` skill 的產出（gitignore）。schema 見該 skill 的 SKILL.md。

## 重要 gotchas（勿誤改）

- `server.py` 開頭強制 stdout/stderr 為 UTF-8 — 避免 Windows cp950 的 `UnicodeEncodeError`，勿移除。
- Jinja 已停用（`template_folder=None`），`index.html` 以 `send_file` 原始檔服務；勿改用 template 渲染。
- `static_folder=ROOT, static_url_path=''` 會把整個專案目錄透過 HTTP 服務（`frontend/` 因此可直接取用）。
- 唯讀端點用 `_safe_read` 擋路徑穿越。

## 程式風格

- Python：4 空格縮排、無 type hints。
- JS：2 空格縮排、camelCase。
- 註解中英混用可接受。檔案換行一律 **LF**（`.gitattributes` 強制，部署目標為 Linux/Docker，勿引入 CRLF）。

## Git 慣例

- 在個人分支 `<name>_dev` 工作，完成後開 PR 進 `main`；**勿直接 push `main`**。
- Commit 訊息：**gitmoji + 繁體中文描述**（例：`🐛 fix: 修正…`），結尾加 `Co-Authored-By` trailer。
