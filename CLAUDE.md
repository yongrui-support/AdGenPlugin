# CLAUDE.md

本檔提供 Claude Code（claude.ai/code）在此 repo 中工作時的指引。

## 這是什麼

一個輕量工具：用 **`generate-creatives` skill** 把品牌 brief / 競品參考，產成可投放的
廣告素材（文案 + 給 GPT 生圖的 `composition_prompt`），存到 `data/creatives/`；
再用一個 **Flask + Vue 3 的看板** 檢視、**編輯、刪除**這些素材，並可填入 OpenAI key 後
直接呼叫 **gpt-image-2** 生成主視覺。

- 創意的「發想」在 Claude session 裡（`generate-creatives` skill），不是 web app runtime。
- web 端負責檢視 / 編輯 / 生圖 / 刪除：會**回寫** `data/creatives/<id>.json`、把圖存到 `data/images/`。

## 這是一個 Claude Code plugin（ad-generator）

本 repo 同時是 plugin 與自己的 marketplace。

- 清單：`.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`（`source: "./"`）。
- skills 放在 **`skills/<name>/SKILL.md`**（**無 `.claude/`**）：`generate-creatives`（核心，產到使用者專案 `data/creatives/`）、`serve`（看板）、`setup`（裝 brew/scoop→uv）。
- 開發/測試：改 `skills/`，用 `claude --plugin-dir ./`（skills 變 `/ad-generator:<skill>`）；或 `/plugin marketplace add <本機路徑或 repo>` → `/plugin install ad-generator@ad-generator`（真安裝，連動態定位都驗得到）。
- **plugin 路徑**：`serve`/`setup` 要跑包內的 `server.py`，靠 **skill 自己的「Base directory」推 plugin 根**（`<skill base>/../..`）—— skill 被呼叫時系統會在開頭提供該 base 的絕對路徑。**不用** `$CLAUDE_PLUGIN_ROOT`（它在 skill bash 不可靠）、也不用 `find ~/.claude`、不靠 cwd。

## 環境與指令（uv）

團隊統一用 **uv**（勿用 pip）。`uv.lock` 進版控。後端相依：Flask + OpenAI SDK（生圖）+ python-dotenv（讀 `.env`）。

```bash
uv sync                       # 建立 .venv + 安裝相依
uv run python server.py       # 啟動看板 → http://localhost:5000
uv run python server.py --reload   # 開發用：改 server.py 自動重啟（仍 debug=False）
```

- 沒有測試套件。改 `server.py` 後用 `import server` 檢查路由能起來。
- Lint/format：`uv run ruff format .` 與 `uv run ruff check --fix .`（手動跑）。

## 架構

架構與端點細節見 **README「架構」**（程式本身請直接讀 code）。開發時要記的：

- 資料目錄用 `--data-dir`（或 `DATA_DIR`）指定，預設 `cwd/data` —— plugin 安裝後讀**使用者專案**的 `data/`，前端靜態檔永遠從 plugin 目錄（`ROOT`）服務。
- **改 schema**：`migrations.py` 版號 +1、加 `_migrate_N_to_N+1`（需冪等）、SKILL.md 的 schema 同步。
- **做新 UI**：套 `frontend/theme.css` 的 `.ds-*` 元件；改主題只動 `:root` 的 token。

## 重要 gotchas（勿誤改）

- `server.py` 開頭強制 stdout/stderr 為 UTF-8 — 避免 Windows cp950 的 `UnicodeEncodeError`，勿移除。
- Jinja 已停用（`template_folder=None`），`index.html` 以 `send_file` 原始檔服務；勿改用 template 渲染。
- `static_folder=ROOT, static_url_path=''` 會把整個專案目錄透過 HTTP 服務（`frontend/` 因此可直接取用）。
- 讀寫端點都用 `_safe_read` 驗證 id（擋路徑穿越）；`uid` 也驗 `basename`。
- **並發鐵則**（threaded=True，並行生圖/編輯/刪除都動同一份 JSON）：凡「讀改寫」creatives JSON 一律包 `_JSON_LOCK`，且**寫回前重讀最新檔、以 uid 找回該組**——拿舊快照整份覆寫會洗掉別人剛寫入的結果。`PUT` 的 `uid`/`images` 一律以磁碟為準（勿改成信任前端）。生圖必須維持**非同步任務**（`_JOBS` 表 + 202 + 輪詢），改回同步會復活「重整失憶／長連線逾時」。`_JOBS` 放記憶體是刻意的（狀態與背景執行緒同生共死）。
- **OpenAI key 只存後端 `.env`**（`.env` 已 gitignore，勿提交），`GET /api/settings` 不回傳 key；server 只綁 `127.0.0.1`。Responses 主模型用 `OPENAI_RESPONSES_MODEL` 覆寫（預設 `gpt-5.5`，底層生圖為 gpt-image-2）。

## 程式風格

- Python：4 空格縮排、無 type hints。
- JS：2 空格縮排、camelCase。
- 註解中英混用可接受。檔案換行一律 **LF**（`.gitattributes` 強制，部署目標為 Linux/Docker，勿引入 CRLF）。

## Git 慣例

- 在個人分支 `<name>_dev` 工作，完成後開 PR 進 `main`；**勿直接 push `main`**。
- Commit 訊息：**gitmoji + 繁體中文描述**（例：`🐛 fix: 修正…`），結尾加 `Co-Authored-By` trailer。
