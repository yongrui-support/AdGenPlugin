---
name: generate-images
description: 把 generate-creatives 產出的廣告創意「實際生成主視覺圖」。不打 OpenAI API（省錢）——改由 agent 用 CDP 接管的真 Chrome 在 ChatGPT 產圖，逐張回讀對標、迭代到過關，存到 data/images/<批次id>/<uid>.png 並回寫該創意的 images[] 與精修後的 composition_prompt。當使用者說「幫我生圖 / 把這批做成圖 / 產主視覺 / 生第 N 組的圖 / 重生某組」等，觸發。產完叫使用者重刷看板即可看到。
---

# generate-images

把 `data/creatives/<id>.json` 裡的創意，**用瀏覽器（不是 API）產成主視覺圖**，存回 `data/images/` 並回寫 JSON。
看板（server）只負責檢視；本 skill 才是「真的生圖」的地方。

> 為什麼不用 API：gpt-image-2 的 API 又貴又慢且不能併行盯品質。改用「CDP 接管你已登入的 ChatGPT」吃訂閱、
> 我還能**逐張回讀、對標水準圖、迭代到過關才收**。

> **路徑規約（plugin 場景，務必照做）**：本 skill 被呼叫時系統會給「**Base directory for this skill**」（即 `<plugin>/skills/generate-images`）。
> 由它推出 plugin 根：`PLUGIN_DIR = <base>/../..`（解析成絕對路徑）。三類路徑分清楚：
> - **創意資料（讀寫）走「使用者專案」**：`data/creatives/`、`data/images/`、`data/materials/` 用 **cwd 相對路徑**（Claude Code 的 cwd = 使用者專案）。使用者專案**只應被寫入 `data/`**。
> - **暫存中間檔（下載 base64 的 `dl_*.txt`、回讀印出的 `_tmp_read.txt`、任何 dump）寫進 `${CLAUDE_PLUGIN_DATA:-<PLUGIN_DIR>}/tmp/`**——即**優先用 `$CLAUDE_PLUGIN_DATA`**（官方持久且可寫的 plugin 資料目錄；安裝後的 plugin **根目錄可能唯讀**，別往那寫），dev 或取不到該變數時退回 `<PLUGIN_DIR>/tmp/`。**絕不寫進使用者專案根**（會弄髒對方 repo）。**任務結束前清空該 tmp**（見 §5）。
> - **MCP 自身輸出**（screenshot 等）已由 `.mcp.json` 設成 `${CLAUDE_PLUGIN_DATA}/out`，不用你管。

## 0. 前置（CDP 瀏覽器環境，每台機器一次性）

需要 **Playwright MCP** + 一台「除錯埠 9222 的真 Chrome」+ 已登入 ChatGPT（Plus）。分工清楚：
- **Playwright MCP 已內建在本 plugin**：plugin 根目錄的 `.mcp.json`（已進版控、隨安裝自動註冊）把它設為 `--cdp-endpoint`（接管、不自己啟動，較不易被偵測）。CDP 網址預設 `http://127.0.0.1:9222`，可用環境變數 `PLAYWRIGHT_CDP_URL` 覆寫；MCP 輸出落在 `${CLAUDE_PLUGIN_DATA}/out`（持久目錄，`/plugin update` 不會清）。**安裝者不必自己建 `.mcp.json`。**
- **那台已登入的 Chrome 是「使用者本機資產」**，不隨 plugin 發佈：由 `/ad-generator:setup` 在**你的專案** `.browser/` 放一支啟動腳本（範本＝plugin 的 `templates/launch-chrome-cdp.bat`／`.sh`），登入態存 `.browser/.chrome_cdp`（已 gitignore、只在你機器上）。

流程（每台機器一次）：跑 `/ad-generator:setup` → 執行 `.browser/launch-chrome-cdp`（Windows 雙擊 `.bat`／macOS·Linux 跑 `.sh`）→ **在那台 Chrome 登入 chatgpt.com、保持開著** → 啟動/resume Claude Code（MCP 自動接管 9222）。
若 `mcp__playwright__*` 連不到瀏覽器，常見三因：① 那台 9222 Chrome 沒開或沒登入；② 沒裝 `npx`/Node（MCP 起不來）；③ 改過 port → 設 `PLAYWRIGHT_CDP_URL`。請使用者照上面備好再說。

## 1. 讀「最新」JSON（真相來源）

每次都重讀 `data/creatives/<id>.json`（使用者可能剛在看板編輯/調比例/存檔）。要產的每組取：
`content`（圖中文字）、`composition_prompt`（構圖，含 `{{content.欄位}}` 佔位）、`aspect`（比例）、`materials`（素材名）、`uid`。

## 2. 逐組產圖（多分頁並行）

**並行模型**：一個司機（我）開 N 個 ChatGPT 分頁，各丟一個 prompt，OpenAI 同時生，我輪流收。
單帳號 Plus 實測一次 **3 張** 穩；可再往上試天花板。注意時段額度，被限速就分批。

每組的 prompt = 把 `composition_prompt` 裡的 `{{content.欄位}}` 換成該組 `content` 的實際字，
加一句「直式/橫式 **<aspect>** 比例」，並把 `materials` 對應的圖**附上**（`mcp__playwright__browser_file_upload`）。
開頭再補一句**品牌級水準框定**（例：「一線品牌級廣告水準：乾淨俐落排版、舒適和諧構圖、精緻光影、字體層級分明」），
並依背景明暗選對 logo 版本＋寫明「直接擺上、忠實配色不改色不變形」（見 §3 雷區）。
> **比例命中率**：此法只靠「加一句比例」要求模型，不像舊 API 有精確 aspect→size 對照，命中率較低；靠 §3 的回讀迭代兜底（比例不對就重生），心裡有數即可。

**操作要點**（`mcp__playwright__*`）：開新對話 → 點 `composer-plus-btn` 或按 `Control+u` 開檔案選擇器 → `browser_file_upload` 附素材 → 在 `#prompt-textarea` 貼 prompt 並送出 → 等 ~1.5–2 分鐘。
> **選擇器會過時**：`composer-plus-btn`、`#prompt-textarea`、`backend-api/estuary/content`、`Control+u` 都是 ChatGPT 的 DOM/URL 內部細節，**ChatGPT 改版即可能失效**——屆時請依當前頁面實況更新這些選擇器與取圖網址。

## 3. 回讀對標、迭代到過關（核心價值）

**不過不收。眼睛要嚴格、審美要高（業主明確要求）。** 每張：
- 取生成圖的原始 URL（`backend-api/estuary/content?...`），在**聊天分頁**內 `fetch`→base64（影像文件頁的 CSP 會擋 fetch），或開新分頁看完整圖。（同一套取圖法、存檔細節見 §4.1，不重複。）
- **對標素材庫裡的「設計水準基準」圖**（若有），並用**一線品牌級**的眼睛逐項審：
  1. **整體構圖與元件排版**——版面是否平衡、留白是否足夠、各元件（標題/徽章/CTA/logo/產品）位置是否協調不打架。
  2. **字體大小與排版層級**——主標 > 徽章 > CTA 的層級是否分明、字級是否舒服、有沒有過大過小或塞爆。
  3. **整體是否「非常舒適、和諧」**——這是業主的核心驗收點：通篇看下來順不順眼、像不像專業設計師交付的稿，而不是「字對了就好」。
  4. 能量/亮度、配色（克制 2~3 色不彩虹）、光影質感、層次、產品準度、文字清晰、**logo 配色與位置正確**。
- 任一項不到位就**改 prompt 重生**（同對話「微調重生」），再讀再評，直到整體舒適、達到基準水準才收。**寧可多迭代，不要放水。**

**踩過的雷（務必內建）**：
- **Logo 一律「直接上、忠實配色」，不要後製淨空區**：構圖時就把 logo 畫進去，別在 prompt 裡保留「淨空區供 logo 後製」。**深色背景→用白色版 logo**（白字＋白圖標，但**旁邊的品牌輔色（如青藍）要保留、用「反白」描述、別整個洗成純白丟失品牌色**）；**淺色背景→用原版 logo**（深色版）。一律「忠實呈現、不改色、不變形、不留佔位框」。素材庫若已備白色版 logo（如 `Dutek/Dutek_Logo_白色版`），深底直接附那張。**業主對 logo 配色錯誤零容忍。**
- **烘焙類產品（如起司酥球）禁「牽絲/拉絲」**——它是烘焙物、冷掉不會像熱起司拉絲。用「濃稠流出、醬狀、無拉絲」正面描述；**括號裡的否定（「(不是拉絲)」）模型常忽略**，要正面寫。
- **標題顏色克制 2~3 色**，別每字一色變彩虹。
- **複雜雙產品/多參考圖命題**（如「兩款產品+公益」）：**附參考圖時模型會整張照抄某張附件**（抄基準圖或抄產品照）。改用**純文字 prompt、完全不附圖**逼它原創——產品依文字描述生成、雖非 100% 對實拍，但能跳出照抄陷阱。
- **嚴禁照抄水準圖**：不得出現它的版面、文字、場景、任何第三方/基金會標誌。

## 4. 存圖 + 回寫 JSON（命名與並發契約）

過關後：
1. **存圖**：`data/images/<批次id>/<uid>.png`（**cwd 相對＝使用者專案**），`uid = uuid4().hex[:12]`（每張新 uid，唯一命名；資料夾給人翻、uid 給程式引用）。下載方式：聊天分頁內 `fetch` 圖 URL → base64 → 存檔（簽名 URL 需登入 cookie，PowerShell 直接抓會 403）。**base64 中間檔落在 plugin 暫存區**：`browser_evaluate` 的 `filename` 給**絕對路徑** `${CLAUDE_PLUGIN_DATA:-<PLUGIN_DIR>}/tmp/dl_<uid>.txt`（即 §頂規約那個 tmp；別給裸檔名——預設會寫到 cwd＝使用者專案根，污染對方 repo）。回寫小腳本再從這個絕對路徑讀回、解出 PNG 存到使用者專案 `data/images/`。
2. **回寫該創意**（用小腳本，UTF-8）：
   - `images[]` **append** 該 uid（保留舊圖 → 看板相簿可多張）。
   - **`composition_prompt` 更新成「最後精修版」**（含情境/比例提示）——JSON 才留住好的提示詞，下次重生有基礎。
3. **並發鐵則**：寫回前**重讀最新 JSON、以 uid 找回該組**再改，不要拿舊快照整份覆寫（會洗掉使用者剛在看板的編輯）。原子寫入（先 .tmp 再 os.replace）。

## 5. 完成

回報：產了哪幾組、各存到哪、過關摘要。**告訴使用者「重刷看板頁面」即可看到新圖**（看板不輪詢、不顯示「生成中」，就是讀 JSON 顯示）。
若使用者要再生（換比例、改文字、再來一張），回 §1 重跑——同組的新圖會 append 進相簿。

**收尾清理（業主要求）**：任務結束前**清空那個 tmp 整個資料夾**（`rm -rf "${CLAUDE_PLUGIN_DATA:-<PLUGIN_DIR>}/tmp/"*`）。MCP 輸出（`${CLAUDE_PLUGIN_DATA}/out`、dev 的 `.browser/`）已 gitignore 可不動。**使用者專案端只應留下 `data/` 的產物，不該有任何暫存檔。**
