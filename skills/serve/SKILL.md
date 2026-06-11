---
name: serve
description: 啟動 Ad Generator 的廣告 WebUI / 看板（Flask，http://localhost:5050）來檢視、編輯、刪除 generate-creatives 產出的廣告素材，並可填入 OpenAI key 後直接生成主視覺。當使用者說「開啟廣告 WebUI / 打開廣告介面 / 開看板 / 啟動看板 / 開網頁看素材 / 把 server 跑起來 / 啟動服務」等，觸發。會用 skill 自己的位置定位 plugin 內的 server.py，並讀取你目前專案的 data/creatives。
---

# serve

啟動看板。看板顯示**目前專案 `./data/creatives`** 底下的創意產出（generate-creatives 寫在那），
可檢視、**編輯回存、刪除**，也能填入 OpenAI key 後直接呼叫 gpt-image-2 生成主視覺（存到 `./data/images`）。
plugin 內含 Flask 後端與 Vue 前端；key 只存後端 `.env`、server 只綁 127.0.0.1。

## 步驟

### 1. 取得 plugin 根目錄
本 skill 被呼叫時，系統會在開頭給你「**Base directory for this skill**」（這個 SKILL.md 的絕對路徑，
即 `<plugin>/skills/serve`）。**plugin 根 = 該 base 的上兩層**：
```
PLUGIN_DIR = <base directory>/../..
```
把它解析成實際絕對路徑（裡面有 `server.py`、`pyproject.toml`、`frontend/`、`index.html`），後續指令都用這個絕對路徑。
不靠 cwd、不靠 `$CLAUDE_PLUGIN_ROOT`（後者在 skill bash 不可靠）。

### 2. 確保相依（冪等）
```bash
uv sync --project "<PLUGIN_DIR>"
```
若 `uv` 不存在 → 請使用者先跑 `/ad-generator:setup`。

### 3. 啟動（背景執行），資料指向使用者專案
伺服器會持續執行（長時間阻塞），請在**背景**跑，再告訴使用者已在 http://localhost:5050 啟動：
```bash
uv run --project "<PLUGIN_DIR>" python "<PLUGIN_DIR>/server.py" --data-dir "$(pwd)/data"
```
（`<PLUGIN_DIR>` 換成步驟 1 解析出的實際絕對路徑。前端從 plugin 服務，創意資料讀使用者專案 `./data`。）

## 注意

- 看板沒資料 = 還沒產 → 先用 `/ad-generator:generate-creatives`。
- 要在看板生圖，需先在右上「設定」填 OpenAI API key（存到專案根 `.env`，已 gitignore）。
- 預設 port **5050**（刻意避開 macOS AirPlay 接收器佔用的 5000），可加 `--port` 換；只綁 `127.0.0.1`、`debug=False`（開發可加 `--reload`）。
- 若啟動報 port 被占，改跑別的 `--port` 並告知使用者實際網址。
