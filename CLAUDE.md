# CLAUDE.md

## 這是什麼

一個輕量工具：用 **`generate-creatives` skill** 把品牌 brief / 競品參考，產成可投放的
廣告素材（文案 + 給生圖模型的 `composition_prompt`），存到 `data/creatives/`；
主視覺由 **`generate-images` skill** 用 **CDP 接管已登入的 ChatGPT** 生圖（吃訂閱、**不打 OpenAI API**），
存到 `data/images/` 並**回寫 JSON**；再用一個 **Flask + Vue 3 的看板** 檢視、**編輯、刪除**這些素材並顯示主視覺。

- 創意「發想」與「生圖」都在 Claude session 裡（`generate-creatives` / `generate-images` skill），不是 web app runtime。
- web 端只負責檢視 / 編輯 / 刪除＋顯示圖：會**回寫** `data/creatives/<id>.json`；**看板自己不生圖、不打任何外部 API**。

## 這是一個 Claude Code plugin（ad-generator）

本 repo 同時是 plugin 與自己的 marketplace。

- 清單：`.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`。
- skills 放在 **`skills/<name>/SKILL.md`**：
    - `generate-creatives`（核心，產到使用者專案 `data/creatives/`）
    - `generate-images`（用 CDP 瀏覽器接管 ChatGPT 生主視覺、回寫 JSON）
    - `serve`（WebUI 看板）
    - `setup`（裝 brew/scoop→uv＋Node/nvm，並備 CDP 瀏覽器——生圖環境一次到位）。
- **內建 MCP**：plugin 根的 `.mcp.json`（已進版控）宣告 Playwright MCP，隨安裝自動註冊；`generate-images` 靠它接管 9222 的 Chrome。可攜變數見 `.mcp.json`／`docs/cdp-基本觀念.md`。
- **CDP 瀏覽器啟動腳本範本**在 `templates/`，由 `setup` 複製到**使用者專案** `.browser/`（登入態是使用者資產、不進版控、不隨 plugin 發佈）。
- 開發/測試：
    - 開發 `skills/`，用 `claude --plugin-dir ./`
    - 測試 `/plugin marketplace add <本機路徑或 repo>` → `/plugin install ad-generator@ad-generator`。
- **plugin 路徑**：`serve`/`setup` 要跑包內的 `server.py`，靠 **skill 自己的「Base directory」推 plugin 根**（`<skill base>/../..`）—— skill 被呼叫時系統會在開頭提供該 base 的絕對路徑。**不用** `$CLAUDE_PLUGIN_ROOT`（它在 skill bash 不可靠）、不靠 cwd。

## 環境與指令（uv）

團隊統一用 **uv**（勿用 pip）。`uv.lock` 進版控。後端相依：**只有 Flask**（生圖走 CDP 瀏覽器、server 不讀 `.env`，故不需 OpenAI SDK／dotenv）。生圖用的 Playwright MCP 靠 Node/npx，不在 Python 相依裡。

```bash
uv sync                       # 建立 .venv + 安裝相依
uv run python server.py       # 啟動看板 → http://localhost:5050
uv run python server.py --reload   # 開發用：改 server.py 自動重啟（仍 debug=False）
```

- 沒有測試套件。改後端的驗法：
  1. `import server` —— 只擋語法 / import 錯。
  2. **打真端點驗行為** —— 對著 `--reload` 的 server 用「臨時批」做往返測試（測完清掉，不碰真資料）。
  3. **生圖不在 server**——是 `generate-images` skill 用 CDP 瀏覽器產出、用腳本回寫 JSON；驗生圖要在瀏覽器流程驗，server 端沒有生圖碼可測。
- Lint/format：`uv run ruff format .` 與 `uv run ruff check --fix .`（手動跑）。

## 操作慣例（跑 setup/serve/generate-images 時，agent 必讀）

- **所有 shell 動作一律走 Bash 工具，別用 PowerShell 工具**：permission allow 是「依工具」分的——`Bash(...)` 規則只蓋 Bash 工具。用 PowerShell 跑 serve／探埠／開瀏覽器，setup 預核准的 `Bash(...)` 都不算數、每次跳框。（serve＝`uv run …`、探埠＝`curl 127.0.0.1:9222`、開網頁＝`cmd //c start`、清檔＝`rm`，全走 Bash。）
- **指令別用 `cd xxx && uv run …` 開頭**：複合指令開頭是 `cd` 就不符 `Bash(uv run:*)`、會跳框。Bash 工具 cwd 已是專案根，**直接 `uv run …` + 相對路徑**即可。
- 破壞性指令（`rm`、`taskkill`／關行程）**刻意不預核准**，每次問過再做。

## 架構

架構與端點細節見 **README「架構」**（程式本身請直接讀 code）。開發時要記的：

- 資料目錄用 `--data-dir`（或 `DATA_DIR`）指定，預設 `cwd/data` —— plugin 安裝後讀**使用者專案**的 `data/`，前端靜態檔永遠從 plugin 目錄（`ROOT`）服務。
- **改 schema**：`migrations.py` 版號 +1、加 `_migrate_N_to_N+1`（需冪等）、SKILL.md 的 schema 同步。
- **做新 UI**：套 `frontend/theme.css` 的 `.ds-*` 元件；改主題只動 `:root` 的 token。

## 重要 gotchas（勿誤改）

- `server.py` 開頭強制 stdout/stderr 為 UTF-8 — 避免 Windows cp950 的 `UnicodeEncodeError`，勿移除。
- Jinja 停用（`template_folder=None`），`index.html` 以 `send_file` 原始檔服務；勿改用 template 渲染。
- `static_folder=ROOT, static_url_path=''` 會把**整個 plugin 目錄**透過 HTTP 服務——好處是 `frontend/` 免寫路由直接可用；代價是 `server.py` 等檔案也抓得到，且 **dev 模式（cwd=ROOT）下連 `.browser/`（CDP 登入態）都在服務範圍內**。靠「只綁 127.0.0.1 + 無 CORS（外站 JS 讀不到回應）+ 本地工具不上雲」緩解，屬已知取捨。
- 讀寫端點都用 `_safe_read` 驗證 id（擋路徑穿越）；`uid` 也驗 `basename`。
- **並發鐵則**（threaded=True 多請求並行，且 `generate-images` 是**另一行程**寫同一份 JSON）：凡「讀改寫」creatives JSON 一律包 `_JSON_LOCK`（擋 server 內多執行緒互蓋；含讀取時 schema 遷移的寫回），且**寫回前重讀最新檔、以 uid 找回該組**——拿舊快照整份覆寫會洗掉別人剛寫入的結果。`PUT` 的 `uid`/`images` 一律以磁碟為準（勿改成信任前端）。`_JSON_LOCK` **管不到跨行程的 `generate-images` 回寫**——那靠兩份 skill 都遵守「append/寫回前重讀最新檔＋以 uid 比對＋原子寫入（.tmp→os.replace）」協調（見 generate-images §4 / generate-creatives §6）。
- **生圖走 CDP 瀏覽器、server 完全不打 API**：server 不含任何 OpenAI／key／`.env`／`/api/settings`／生圖端點，只做檢視/編輯/刪除＋服務檔案。Playwright MCP 由 plugin 的 `.mcp.json` 內建（CDP 接管 9222 的 ChatGPT），server 只綁 `127.0.0.1`。生圖暫存檔寫**使用者專案的 `.browser/tmp`**（保證可寫、已 gitignore）、收尾清空——**plugin 目錄全程不被寫**（權責分離、更新乾淨）；見 generate-images skill。

## 程式風格

- Python：4 空格縮排、無 type hints。
- JS：2 空格縮排、camelCase。
- 註解中英混用可接受。檔案換行一律 **LF**（`.gitattributes` 強制——plugin 會在 Windows/macOS/Linux 的使用者機器上跑，勿引入 CRLF）。

## Git 慣例

- 在個人分支 `<name>_dev` 工作，完成後開 PR 進 `main`；**勿直接 push `main`**。
- Commit 訊息：**gitmoji + 繁體中文描述**（例：`🐛 fix: 修正…`），結尾加 `Co-Authored-By` trailer。
