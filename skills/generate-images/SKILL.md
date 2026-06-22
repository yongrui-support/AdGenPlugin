---
name: generate-images
description: 把 generate-creatives 產出的廣告創意「實際生成主視覺圖」：由 agent 用 CDP 接管的真 Chrome 在 ChatGPT 產圖（吃訂閱、不需 OpenAI API key），逐張回讀對標、迭代到過關，存到 data/images/<批次id>/<uid>.png 並回寫該創意的 images[] 與精修後的 composition_prompt。觸發詞（含口語與意圖）：「幫我生圖 / 把這批做成圖 / 把文案變成圖 / 產主視覺 / 做成主視覺 / 生第 N 組的圖 / 重生某組 / 重畫這組 / 換張圖 / 生成廣告圖 / 做廣告圖 / 出圖 / 來張圖 / 把創意生圖 / 用 ChatGPT 生圖 / 跑生圖 / 生這批的圖」等，觸發。產完叫使用者重刷看板即可看到。
---

# generate-images

把 `data/creatives/<id>.json` 裡的創意，**用瀏覽器（不是 API）產成主視覺圖**，存回 `data/images/` 並回寫 JSON。
看板（server）只負責檢視；本 skill 才是「真的生圖」的地方。

> 為什麼不用 API：gpt-image-2 的 API 又貴又慢且不能併行盯品質。改用「CDP 接管使用者已登入的 ChatGPT」吃訂閱、
> Claude 還能**逐張回讀、對標水準圖、迭代到過關才收**。

> **路徑規約（plugin 場景，務必照做）**：本 skill 被呼叫時系統會給「**Base directory for this skill**」（即 `<plugin>/skills/generate-images`）。
> 由它推出 plugin 根：`PLUGIN_DIR = <base>/../..`（解析成絕對路徑）。原則：**plugin 維持唯讀乾淨、所有「寫入」都落在使用者專案**（暫存收尾清掉）。三類路徑分清楚：
> - **創意資料（讀寫）走「使用者專案」**：`data/creatives/`、`data/images/`、`data/materials/` 用 **cwd 相對路徑**（Claude Code 的 cwd = 使用者專案）。這是要**保留**的產物。
> - **暫存中間檔（下載 base64 的 `<uid>.txt`、回讀印出的 `_tmp_read.txt`、任何 dump）寫進使用者專案的 `.browser/tmp/`**——絕對路徑用 `${CLAUDE_PROJECT_DIR:-$(pwd)}/.browser/tmp/`（兩者皆＝使用者專案、保證可寫）。**不要寫進 plugin 目錄**（保持 plugin 乾淨、更新權責分離），也**不要散在使用者專案根**（需集中在 `.browser/tmp/`）。**任務結束前清空 `.browser/tmp/`**（見 §5）。
> - **MCP 自身輸出**（screenshot 等）由 `.mcp.json` 的 `--output-dir` 決定，Claude 不用管。

## 0. 前置（CDP 瀏覽器環境，每台機器一次性）

需要 **Playwright MCP** + 一台「除錯埠 9222 的真 Chrome」+ 已登入 ChatGPT（Plus）。分工清楚：
- **Playwright MCP 已內建在本 plugin**：plugin 根目錄的 `.mcp.json`（已進版控、隨安裝自動註冊）把它設為 `--cdp-endpoint`（接管、不自己啟動，較不易被偵測）。CDP 網址預設 `http://127.0.0.1:9222`，可用環境變數 `PLAYWRIGHT_CDP_URL` 覆寫；MCP 截圖輸出由 `.mcp.json` 設成**使用者專案的 `.browser/out`**（與暫存 `.browser/tmp` 同站、已 gitignore、plugin 不被寫）。**安裝者不必自己建 `.mcp.json`。**
- **那台已登入的 Chrome 是「使用者本機資產」**，不隨 plugin 發佈：由 `/ad-generator:setup` 在**使用者專案** `.browser/` 放一支啟動腳本（範本＝plugin 的 `templates/launch-chrome-cdp.bat`／`.sh`），登入態存 `.browser/.chrome_cdp`（已 gitignore、只在使用者機器上）。

### 開工前：Claude 自己「確保 Chrome 在跑」——別叫使用者手動雙擊
Claude 用 Bash/PowerShell 跑啟動腳本 ＝ 等同人類雙擊，效果一樣。所以**先探埠、再決定要不要啟動**：

1. **探 CDP 埠開了沒**（＝Chrome 是否已開好）：
   ```bash
   curl -s "${PLAYWRIGHT_CDP_URL:-http://127.0.0.1:9222}/json/version"
   ```
   - **有回 JSON** → Chrome 已在跑、可直接接管 → 跳到 §1（讀「最新」JSON＝真相來源），**不要重複開**。
   - **連不上** → 進第 2 步。
2. **幫使用者把 Chrome 啟動起來**（不要叫他手動點）：跑使用者專案的啟動腳本——
   - Windows：`cmd //c "$(pwd)/.browser/launch-chrome-cdp.bat"`
   - macOS／Linux：`bash "$(pwd)/.browser/launch-chrome-cdp.sh"`
   腳本會把帶 9222 埠的 Chrome 開起來（背景、不阻塞）。等 ~2 秒再 `curl` 一次確認埠起來了。
   - 若使用者專案還沒有 `.browser/launch-chrome-cdp.*`：請使用者先跑 `/ad-generator:setup` 第 5 步，或 Claude 直接從 plugin `templates/` 複製過去（並提醒使用者把 `.browser/` 加進專案的 .gitignore）。
3. **指示使用者下一步**：
   - **首次**（profile 還沒登入態）：請使用者在那個視窗**登入 chatgpt.com**（登一次就好、profile 會記住），完成後回報 Claude。
   - **已登入過**：profile 記得登入態 → 直接往下生圖。
4. **MCP 接管**：`mcp__playwright__*` 工具透過 9222 接管那台 Chrome。Playwright MCP 是**用到瀏覽器工具的當下才連 CDP（lazy）**，所以只要 MCP server 有在跑（session 啟動就有了），**Chrome 後開也能直接接上、不必重啟 Claude Code**（已實測確認）。真的連不到時查：
   - 那台 9222 Chrome 是否在跑且已登入。
   - MCP server 起來沒（`/mcp` 看 `playwright`；沒有多半是 Node/npx 沒裝，見 setup §5）。

排查：
- 埠沒開＝Chrome 沒起來（重跑腳本）。
- MCP 起不來＝沒裝 Node/npx（setup §5）。
- 改過 port → 設 `PLAYWRIGHT_CDP_URL`。

## 1. 讀「最新」JSON（真相來源）

每次都重讀 `data/creatives/<id>.json`（使用者可能剛在看板編輯/調比例/存檔）。要產的每組取：
`content`（圖中文字）、`composition_prompt`（構圖，含 `{{content.欄位}}` 佔位）、`aspect`（比例）、`materials`（素材名）、`uid`、**生圖設定三欄 `ai_platform`／`model`／`thinking_effort`**（平台 `chatgpt`/`gemini` ＋該平台要用的模型與思考程度；決定用哪個平台/模型/思考，見 §2）。
**並讀該批品牌的設計準則 `data/materials/<品牌>/design.md`（若有）**（品牌＝`brief.brand_name`）——它是生圖與回讀驗收的準則（見 §3）；沒有就略過。

## 2. 逐組產圖（多分頁並行）

**先看每組 `ai_platform` 決定走哪條路徑**（並記下該組的 `model` 與 `thinking_effort`，送圖前要切到它）：
- **`chatgpt`（預設，絕大多數組走這條）** → ChatGPT 操作（§2A）。
- **`gemini`** → Gemini 操作（§2B）；**僅使用者在看板手動指定才會出現**（Gemini 實測不穩，不主動用）。

> ⚠️ **每組生圖前一定要切到對的「模型＋思考程度」**（讀自該組 `model`／`thinking_effort`）：ChatGPT 用其模型挑選器＋思考程度控制（即時/中等/高）、Gemini 用其模型挑選器＋思考（標準/延長）。**切換後用畫面確認真的切到了再送**——選錯模型或思考＝整張白產。這些控制是 ChatGPT/Gemini 的 UI 細節、改版會變，依當前頁面實況找。

> 🗺️ **省重複找元素：把「UI 元素地圖」快取到 tmp**：整批 N 個分頁的操作都一樣（切模型→切思考→上傳→貼 prompt→送出），別每個分頁都重新 `browser_snapshot` 摸索。**第一次在該平台找到這些控制後，把各控制的「穩定定位」記進 `.browser/tmp/ui_map_<platform>.json`**（chatgpt／gemini 各一份），後續同批**直接複用、不再重照**。
> - 存**穩定 selector**（CSS/id／role+name／data-test-id，如 `#prompt-textarea`、模型挑選器的 role 名）——**別存 `browser_snapshot` 的 `ref`**（`ref` 每次截圖/換分頁都會變、複用會點錯）。
> - 只有某個定位**失效（找不到／點不到＝平台改版了）才重照一次、更新該檔**；其餘照舊複用。（tmp 收尾會清，等於每個任務內複用、跨任務重建，剛好避免跨天的舊 selector 殘留。）

> **Pre-flight**：若這批**有 `gemini` 組**，除了 ChatGPT，還要**請使用者把 `gemini.google.com` 也開好並登入好**（同一台 9222 CDP Chrome 開個分頁登入 Google，一次就好）。只有 `chatgpt` 組就不必開 Gemini。

**下面「並行模型」與「組 prompt」兩條路徑共用；之後依平台分 §2A（ChatGPT）／§2B（Gemini）各自操作，兩條出圖後都進 §3 驗收。**

**並行模型（務必照做，別退化成序列）**：Claude 像一個司機，**先把 N 個分頁全部「點火」（每組各送出自己那則 prompt——由 §1 讀到的該組 `composition_prompt` 依下方規則組好），ChatGPT/Gemini 介面同時生圖，然後才一次等、輪流收**。
**最常犯的錯**＝「送一張 → 等它好 → 再送下一張」：那樣 N 張要等 N 倍時間，等於沒並行。正確是**全部送出後一起等、輪流收**。
單帳號 Plus **一次可衝到 ~5 分頁並行**（5 張一起送、再統一等，省時間）——這是**上限嘗試值、不是保證**；被限速就降回 3、分批跑（每批仍「先全送、再統一等」）。

**每組的 prompt＝忠實照 JSON，不在起手重新發想**——框定、logo 版本/位置、場景，generate-creatives 都已寫進 `composition_prompt` 了；這裡又改，前面的文案發想就失真。只做兩件：
1. 把 `composition_prompt` 的 `{{content.欄位}}` 換成該組 `content` 的實際字——**只替換文字、描述一字不動**；並套用該組比例 `aspect`（補一句「直式／橫式 **<aspect>**」）。
2. 把該組 `materials` 列的素材**照單附上**（`browser_file_upload`，讓產品/logo 忠實渲染）——附哪些是 generate-creatives 決定、寫進 JSON 的，這裡照附即可。

> **想微調？留到後面**：覺得框定／質感／版面要調，到 §3 回讀迭代時再改，別在起手就動 prompt（會偏離原發想）。其實直接把 JSON 的 `composition_prompt`（填好 `content`）整段貼上也行。
> **比例命中率**：此法只靠「加一句比例」要求模型，不像舊 API 有精確 aspect→size 對照，命中率較低；靠 §3 的回讀迭代兜底（比例不對就重生），心裡有數即可。

### 2A. ChatGPT 路徑（`ai_platform` = `chatgpt`，預設）

**操作流程（`mcp__playwright__*`；關鍵：先全部送出、再統一等待收圖）**：
1. **逐分頁點火，彼此不等**：對每一組——`browser_tabs` 開新分頁 → 開新對話 → **先切模型與思考（務必）：把模型挑成該組 `model`（如 GPT‑5.5）、思考程度挑成該組 `thinking_effort`（即時/中等/高），畫面確認切到了** → 按 `Control+u`（或點 `composer-plus-btn`）開檔案選擇器 → `browser_file_upload` 附該組素材 → 在 `#prompt-textarea` 貼該組 prompt → **送出後立刻切到下一個分頁做同樣的事，不要在這裡等生圖**。
2. **N 個都送出後，Claude 自己直接輪詢**（`browser_evaluate`／截圖）看好了沒、**出圖就收**（單張常 ~30–40 秒甚至更短）。**不要自己加 `sleep`／等待指令**——光是每次輪詢工具呼叫本身的 round-trip（snapshot/evaluate 上傳下載 token）就已耗去數十秒，自然就拉開了間隔；再加 sleep 純浪費時間。沒好就再輪詢一次即可，**別死等 1–2 分鐘**。
   - ⚠️ **Claude 必須「自己」輪詢、絕不要問使用者「好了沒／圖出來了嗎」**：等圖是 Claude 的工作，丟回去問使用者會大幅降低自動化體感。**尤其只有一張圖時**也一樣——這種雖然需要輪詢、但通常輪沒幾次就出，Claude 自己默默多輪幾次即可，過程不用回報、收到圖再往下走。
3. 之後逐分頁取圖、回讀驗收（見 §3）。
> **選擇器會過時**：`composer-plus-btn`、`#prompt-textarea`、`backend-api/estuary/content`、`Control+u` 都是 ChatGPT 的 DOM/URL 內部細節，**ChatGPT 改版即可能失效**——這正是 §2「UI 元素地圖」要處理的：失效時就**重照一次當前頁面、用實況的新定位/取圖網址覆蓋 `.browser/tmp/ui_map_chatgpt.json`**，之後同批再複用。（Gemini 同理，更新 `ui_map_gemini.json`。）

### 2B. Gemini 路徑（`ai_platform` = `gemini`，使用者手動指定才走）

> **Gemini 實測不穩、預設不用**：多次測試下**不可靠**——常無視指定文案、自編內容、把產品畫變形（尤其非常規姿態），且 logo 合成／中文字／質感都不如 GPT。**只有使用者在看板把該組手動設成 `gemini` 才走這條**；其餘一律 `chatgpt`。

**Gemini 生圖**（`browser_*` 操作）：`browser_navigate` 到 `gemini.google.com/app` → 開新對話 → **先切模型與思考：模型挑成該組 `model`（如 `3.1 Pro`）、思考挑成該組 `thinking_effort`（標準/延長），畫面確認切到了** → 點「上傳與工具」→「檔案」開檔案選擇器 → `browser_file_upload` 附**該組 `materials` 的圖** → 在輸入框貼**該組 prompt**：`{{content.欄位}}` **務必已換成實際字、用自然語言**——**別丟 JSON 結構**（實測 Gemini 對 JSON 理解極差、會發散自編文案）→ Enter，等生成。

→ 出圖後**取圖＋回讀驗收（§3）、存檔回寫（§4）都與 ChatGPT 共用同一套**（差別只在取圖法：Gemini 用 canvas、那段在 §3）；不過就回頭在 Gemini 重生。

> **要放 logo 的組不建議用 `gemini`**：Gemini logo 合成弱、又沒有收尾救，§3 把「logo 配色/位置正確」列必過 → 容易反覆生不過。`gemini` 適合「不放 logo／logo 非關鍵」的組。

## 3. 回讀對標、迭代到過關（核心價值）

**不過不收。眼睛要嚴格、審美要高（業主明確要求）。** 整批**取回生成圖** → **開 subagent 驗整批**（流程見下）：

- **取回該組的生成圖**（依平台用各自方法取，取到後做下面共通檢查）：
  - **ChatGPT**：在**聊天分頁**內 `fetch` 圖的原始 URL（`backend-api/estuary/content?...`）→base64（影像文件頁的 CSP 會擋 fetch；簽名 URL 要登入 cookie，PowerShell 直接抓會 403）。用 `browser_evaluate`（`filename` 給 `${CLAUDE_PROJECT_DIR:-$(pwd)}/.browser/tmp/<uid>.txt`）存 dataURL → 小腳本解 base64 → PNG。
  - **Gemini**：跨網域 `fetch` 會被 CORS 擋，**改用 canvas**（Gemini 圖未被污染、canvas 讀得到）：
    ```js
    () => { const imgs=[...document.querySelectorAll('img')].filter(i=>Math.max(i.naturalWidth,i.naturalHeight)>=1000);
            const el=imgs[imgs.length-1]; const c=document.createElement('canvas');
            c.width=el.naturalWidth; c.height=el.naturalHeight; c.getContext('2d').drawImage(el,0,0);
            return c.toDataURL('image/png'); }
    ```
    用 `browser_evaluate`（`filename` 給 `${CLAUDE_PROJECT_DIR:-$(pwd)}/.browser/tmp/<uid>.txt`）存下 dataURL → 小腳本解 base64 → PNG。
  - **共通**：**挑「長邊 `≥1000` 的生成圖、不限比例」**（`4:5`／`9:16`／`16:9` 都保留；避開剛上傳的素材縮圖）；**多分頁並行索引會浮動 → 用「圖的內容」（可見文字）認哪張對應哪組、別靠分頁索引（別張冠李戴）**；只抓到素材附件或 NONE＝還沒生好、等一下重抓。
  - **取到後兩平台一樣**：成品圖都暫存成 `.browser/tmp/<uid>.png` 一張本地 PNG（先 `mkdir -p "${CLAUDE_PROJECT_DIR:-$(pwd)}/.browser/tmp"`——`browser_evaluate` 不一定建父層）。**§4 就統一搬這張、不分平台。**

### 3.1 ▶ 開獨立 subagent 嚴格驗收（鐵則：主 agent 不准自己驗、直接寫檔）

主 agent 剛花 tokens 把圖弄出來、有強烈的「想過」確認偏誤，自己驗的一次過率高得不正常、超常漏掉錯字／logo 配色／多畫一張產品這種一眼能看出的問題。實測踩過：logo 雙色變單色、第三張卡沒刪、文字微錯——全是主 agent 漏掉、subagent 抓到的。所以**正確流程是雙層 gate**：

1. **主 agent 先把該批所有圖存到 `.browser/tmp/<uid>.png`**（fetch+解碼，上面那段；subagent **沒辦法控 CDP**、所以這步一定要主 agent 先做完，subagent 才有檔可讀）。
2. **開一個 `Agent` 呼叫**，`subagent_type: "claude"`、**`model` 設成與主 agent 同一個**（獨立 context、能 Read PNG；**驗收要用同等強的模型——掉到較弱的預設會把「漏抓錯字/logo」的風險又帶回來**，失去這層 gate 的意義）。**一次驗整批**（不是每張開一個 subagent）。給它的 prompt 必須包含：
   - 該批品牌的 `data/materials/<brand>/design.md` **原文整段**（subagent 沒有專案存取，要把內容貼進 prompt）；沒 design.md 就明說「無 design.md，下面 `design.md` 那條免驗、用通用審美把關」
   - 每組：`angle`／`content` 槽位（**圖中文字逐字答案**）／`composition_prompt` 重點摘要／該組 PNG 的**絕對路徑**
   - 下面那份「**驗收清單**」原文整段，要它逐項對照
   - 要求**逐張 Read PNG 後**回報每組：**PASS**（過）或 **不過**（列出哪幾條不過＋一句理由）
3. **主 agent 根據 subagent 結果處理**：
   - **PASS** → 進 §4 搬到 `data/images/` 並回寫 JSON。
   - **不過** → 回**該圖的原對話**（`chatgpt` 組在 ChatGPT、`gemini` 組在 Gemini）**基於該圖調整**（不開新分頁、附本次要修的素材、明說「只修 X、其餘維持」；GPT 仍會重畫整張但局部會收斂——模型限制，先告知使用者）→ **重新抓圖覆蓋 `.browser/tmp/<uid>.png`**（取法同 §3 那段）→ 再開 subagent 複驗。
   - **上限按「每張」算：每張不過的圖各自最多修 2 次**（不是整批 2 輪）——某張一過就定案、不再動，別的張各自繼續修；複驗時仍把「這輪還沒過的那幾張」**一起送 subagent**（保留一次驗多張、省呼叫）。某張修滿 2 次仍不過分兩種收尾：**文字／優惠數字錯** → 廢稿、**不存進相簿**、極大聲標「文字錯誤、勿用」，請使用者改 `content` 或換 `ai_platform`／`model`／`thinking_effort`；**美感／質感差** → 存目前最好一版、標「待人工」。都回報使用者。
4. **每張都要先過 subagent 才能把它寫進 JSON**（§4；過的存、修到上限仍不過的依上面收尾）。**未經 subagent 驗就直接寫檔＝違規**——這是業主明確要求的雙層 gate，目的是擋掉主 agent 的自我合理化。

---

**驗收清單**（這份原文整段給 subagent 當審查標準、主 agent 心裡也以這份為準）：
- **功能性「一票否決」（這幾項比美感更致命，不過＝不收、別只看好不好看）**：
  1. **圖中文字逐字正確**：每段文字**逐字比對該組 `content`**——標題／優惠標／CTA **一字不差**，**無錯字／漏字／多字**，**優惠數字正確**（`$100` 不能變 `$1,000`、「限時」不能變「現時」）。GPT 中文渲染雖強仍會錯字／畫錯數字，**一個錯字或錯的優惠數字就是廢稿**（creatives 用 `{{content.欄位}}` 精準控字，這裡要把那個迴圈收口）。
  2. **比例符合該組 `aspect`**（不符＝不過；若該圖修滿 2 次仍拿不到目標比例 → 取最接近版、必要時裁切、回報該組比例未達，§2 已知此法命中率較低）。
- **⭐ 品牌 `design.md`（§1 已讀，若有）＝這張圖的最高視覺準則、最重要的一關**：有 design.md 的品牌，**整張圖務必逐條遵守它**（配色／字體／版面／風格／必避免的元素）——這是業主對該品牌視覺的明文規範，**比下面所有通用審美都優先**。逐條對照，**只要有一條不符就改 prompt、跟模型調到完全符合為止，不符不收**；與通用審美衝突一律以 `design.md` 為準。（唯一壓得過它的是**合規與 logo 配色正確性**——design.md 只管視覺、不能蓋過這兩項。）沒有 design.md 才退而用下面的通用審美把關。
- **對標素材庫裡的「設計水準基準」圖**（若有），並用**一線品牌級**的眼睛逐項審：
  1. **整體構圖與元件排版**——版面是否平衡、留白是否足夠、各元件（標題/徽章/CTA/logo/產品）位置是否協調不打架。
  2. **字體大小與排版層級**——主標 > 徽章 > CTA 的層級是否分明、字級是否舒服、有沒有過大過小或塞爆。
  3. **整體是否「非常舒適、和諧」**——這是業主的核心驗收點：通篇看下來順不順眼、像不像專業設計師交付的稿，而不是「字對了就好」。
  4. 能量/亮度、配色、光影質感、層次、產品準度、文字清晰、**logo 配色與位置正確**。
- **分頁被拒絕／生成失敗**（content policy：品牌、真人、療效字眼常踩）→ **改寫 prompt 重試一次**；仍不行就**回報哪一組沒成功**，別默默少一張當沒事。

> 以上各項：subagent 逐項判「**過／不過**」、列出不過的條目與一句理由；主 agent 收到「不過」後的迭代/收尾流程見 **§3.1 step 3**（不在這裡重複）。

**▶ 請模型自評再優化（可選；與 §3.1 subagent 驗收不同——此步是 GPT 生成端的靈感優化、求建議；§3.1 是獨立 subagent 審查端的守關、判過／不過。兩者互補不衝突）**：只在 subagent 已給 PASS 卻仍覺得「真的很瞎、很不到位」時才做（一般 PASS 的不用每張都來，省時間）。在同一個對話直接問 GPT「這張哪裡可以更好？構圖/光影/敘事/字體排版/品牌一致性，給具體可執行的調整」。
- 它常對自己的產出有好點子（尤其難命題，如「站直的那一刻」這種抽象敘事）——把它的建議當**靈感與盲點檢查**，不是照單全收。
- Claude **篩選**：採納真的能提升質感/敘事/排版的；**剔除**會偏離 brief、加雜訊、改錯 logo 配色、或違反上面雷區的建議。
- 把採納的點請它**重生一版**，再回讀對標——**和前一版並排比較，確認真的更好才換掉**（沒更好就保留原版，別為改而改）。這一步常能再上一個檔次。

**踩過的雷（務必內建）**：
- **Logo（有才驗，沒有就略過）一律「直接上、忠實配色」，不要後製淨空區**：構圖時把 logo 直接畫進去，別在 prompt 裡保留「淨空區供 logo 後製」。（品牌若有多版 logo／深淺底用哪版這種規則，寫進 `design.md` 讓設計師定、§3 會照 design.md 驗——skill 不在這硬規定通用規則。）
- **附參考圖的時機（很重要）**：**「成品廣告」（完整競品廣告稿）絕對別附圖**——模型會整張照抄，連**錯的金額、賽事名**都抄進去；這種改用**純文字 prompt** 描述要的方向。**只有「單純產品實拍」（顯卡照、產品照…）才適合附圖**讓它忠實渲染。複雜雙產品/多參考圖命題也一樣：附圖易整張照抄某張附件，傾向**純文字逼原創**（雖非 100% 對實拍，但跳出照抄陷阱）。
- **嚴禁照抄水準圖**：不得出現它的版面、文字、場景、任何第三方/基金會標誌。
- **別硬拚「把產品轉到不尋常角度/姿態」的構圖**：模型（與 Claude 的視覺判讀）對特定產品的理解有限——要它畫「2 輪平衡車躺平/翻倒」這種非常規姿態時，常自己腦補成錯的形態（實測：躺平那台被多生出輪子、變成 4 輪車）。**越偏離素材實拍的角度/姿態，越不可靠**。敘事盡量交給**標題、光影、單一動態暗示**，讓產品維持它被拍攝的自然角度；真要表現「狀態變化」（如倒下→站直），寧可**一台主體 + 輕暗示**，別硬生第二台反向姿態的車去拚（多模態生成與人眼認知有落差，硬拚只會出戲）。

## 4. 存圖 + 回寫 JSON（命名與並發契約；**只有 §3 subagent 給 PASS 才進這步**）

subagent 驗 PASS 後：
1. **存圖（兩平台統一）**：§3 取圖已把該組成品暫存成 `.browser/tmp/<uid>.png`（ChatGPT＝fetch、Gemini＝canvas，到這裡都一樣是一張本地 PNG）。這步：
   - **先驗 PNG 有效**：檔頭是 PNG magic（`\x89PNG`）、大小合理（非 0／非極小）、開得起來；**壞檔／截斷／抓到錯誤頁 → 回 §3 重抓**，別讓裂圖 append 進相簿（§3 目測的是瀏覽器裡的圖、存的是這份檔，要各自確認）。
   - 有效就**搬進 `data/images/<批次id>/<新 uid>.png`**（**cwd 相對＝使用者專案**；`新 uid = uuid4().hex[:12]`，每張生成圖一個；`<批次id>`＝該批 creatives JSON 的 id；資料夾給人翻、uid 給程式引用）。
2. **回寫該創意**（用小腳本，UTF-8）：
   - `images[]` **append** 該 uid（保留舊圖 → 看板相簿可多張）。
   - **`composition_prompt` 更新成「最後精修版」**（含情境/比例提示）——JSON 才留住好的提示詞，下次重生有基礎。
3. **並發鐵則**：寫回前**重讀最新 JSON、以 uid 找回該組**再改，不要拿舊快照整份覆寫（會洗掉使用者剛在看板的編輯）。原子寫入（先 .tmp 再 os.replace）。

## 5. 完成

回報：產了哪幾組、各存到哪、過關摘要。**告訴使用者「重刷看板頁面」即可看到新圖**（看板不輪詢、不顯示「生成中」，就是讀 JSON 顯示）。
若使用者要再生（換比例、改文字、再來一張），回 §1 重跑——同組的新圖會 append 進相簿。**重生＝相簿多一版、不刪舊版**（`images[]` 只 append、不 replace）；要刪舊版請到看板刪。

**收分頁（業主要求）**：整批都產完、回寫完後，用 `browser_tabs` 把這次開的**所有生圖分頁（ChatGPT＋有用到的 Gemini）全部關掉，只留一個分頁導回 `chatgpt.com`**（乾淨首頁）。**別關整台 Chrome**——那是使用者登入態的 9222 瀏覽器，下次還要用。

**收尾清理（業主要求）**：任務結束前清掉三處暫存／垃圾——
1. **清空 `.browser/tmp/`**（生圖／瀏覽器流程暫存：dataURL `.txt`、PNG、截圖等）：`rm -rf "${CLAUDE_PROJECT_DIR:-$(pwd)}/.browser/tmp/"*`。
2. **清掉 repo `tmp/` 內自己產的過程性暫存**（讀 JSON 的中間檔、dump 等——Claude 的過程檔本來就該寫在這、收工即刪）：`rm -f "${CLAUDE_PROJECT_DIR:-$(pwd)}/tmp/"*` 或只刪本次產的那幾個。
3. **掃掉散落在「專案根」的中間垃圾**：正常中間檔都該落在上面兩個 tmp，但萬一有 `.txt`／`.json`／`.png` 等中途漏寫到 project root（例如 MCP `filename` 給了裸檔名），**一律找出來刪掉**——`ls` 專案根確認只剩該有的檔，別把垃圾留在版控視野裡。

`.browser/` 其餘（登入態 `.chrome_cdp`、MCP 截圖 `out`）已 gitignore、不用動。**收完後使用者專案只應留下 `data/` 的產物；`.browser/tmp/`、`tmp/`、專案根都無殘留暫存，plugin 目錄全程沒被寫過。**
