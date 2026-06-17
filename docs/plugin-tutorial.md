# Claude Code Plugin 製作教學 + 實戰經驗

以「把 Ad Generator 做成 plugin」為例，記錄**官方機制**與**實戰踩過的坑**（後者文件上查不到）。

官方文件：
- [Create plugins](https://code.claude.com/docs/en/plugins)
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)

---

## 1. Plugin 是什麼

一個 plugin 就是「一包可被別人 `/plugin install` 安裝的功能」，可含 **skills / slash commands / hooks / agents / MCP servers**，也可以**夾帶任意檔案**（腳本、server、前端…）。

最關鍵的兩個慣例：
- 清單檔放在 **`.claude-plugin/plugin.json`**（**只有 plugin.json 放這**；skills/commands/hooks 放 plugin 根，不放 `.claude-plugin/`）。
- skills 放在 **`skills/<name>/SKILL.md`**（自動探索）。

---

## 2. 目錄結構（我們的實際長相）

```
AdGenPlugin/
├── .claude-plugin/
│   ├── plugin.json        # plugin 清單
│   └── marketplace.json   # 讓 repo 自己當 marketplace（source: "./"）
├── .mcp.json              # 內建 MCP server 宣告（Playwright；隨安裝自動註冊，見 §4.5/§4.6）
├── skills/
│   ├── generate-creatives/SKILL.md
│   ├── generate-images/SKILL.md
│   ├── serve/SKILL.md
│   └── setup/SKILL.md
├── templates/             # 夾帶的範本（setup 複製到使用者專案，如 CDP 啟動腳本）
├── docs/                  # 教學/觀念文件（本檔在此）
├── server.py、frontend/、index.html   # 夾帶的 webui（非典型用法）
├── migrations.py          # 夾帶資料的 schema 版本化遷移
├── pyproject.toml / uv.lock
└── README.md / CLAUDE.md
```

> 比照 marketingskills：**不要放 `.claude/`**。skill 的單一來源就是 `skills/`，沒有「開發版/發佈版」兩份（會 drift）。開發用 `--plugin-dir`（見 §6）。

### `plugin.json`
```json
{
  "name": "ad-generator",
  "description": "…",
  "version": "1.0.0",
  "author": { "name": "Your Name" },
  "license": "MIT",
  "skills": "./skills"
}
```

### `marketplace.json`（單一 repo 同時當 marketplace）
```json
{
  "name": "ad-generator",
  "owner": { "name": "Your Name" },
  "plugins": [
    { "name": "ad-generator", "description": "…", "source": "./" }
  ]
}
```
`source: "./"` = plugin 就在 repo 根。使用者 `/plugin marketplace add <你>/<repo>` 時，Claude clone 後讀這份。

---

## 3. Skill 的寫法

`skills/<name>/SKILL.md`：
```markdown
---
name: generate-creatives
description: 何時用這個 skill（要寫清楚觸發情境）
---

# …skill 指示…
```

- `name` 必須 = 資料夾名。
- 安裝後 skill 變成 **`/<plugin>:<skill>`**（例：`/ad-generator:serve`）。
- 想做成「**只有人能觸發、Claude 不能自動跑**」（例如會裝軟體的 setup）→ 加 `disable-model-invocation: true`。介面會顯示 `🔒 user-only · locked by author`，**使用者照樣能打 `/ad-generator:setup` 執行**，只是 Claude 不會自動呼叫。

---

## 4. ⚠️ 進階：夾帶「會執行的程式」（我們最大的坑）

官方對「skill 去跑包內的腳本/server」**沒有乾淨範例**。我們夾帶一個 Flask webui，踩了一連串坑：

### 坑 1：`$CLAUDE_PLUGIN_ROOT` 在 skill 的 bash 裡是壞的
文件說 `${CLAUDE_PLUGIN_ROOT}` 會被代入 skill/hook/mcp，**但實測在 skill markdown 觸發的 bash 裡是空值**（有官方 bug report）。它只在 `.mcp.json` / `hooks.json` 這種 **JSON 設定**可靠。

### 坑 2：skill 的 bash 工作目錄是「使用者的專案」，不是 plugin 安裝處
所以不能假設 `./server.py` 找得到。

### ✅ 正解：用 skill 自己的「Base directory」推 plugin 根
**skill 被呼叫時，系統會在開頭給 Claude：**
```
Base directory for this skill: <…>/skills/serve
```
這是該 SKILL.md 的**絕對路徑**。所以：
```
plugin 根 = <Base directory>/../..
```
Claude 把它解析成實際絕對路徑，後續所有指令都用這個絕對路徑 —— **不靠 cwd、不靠 `$CLAUDE_PLUGIN_ROOT`、不用 `find ~/.claude`**。三種情境（`--plugin-dir` / 真安裝 / repo 內）全部成立。

我們 `serve` skill 的做法（節錄）：
```markdown
### 1. 取得 plugin 根目錄
系統會給你「Base directory for this skill」（= <plugin>/skills/serve）。
plugin 根 = 該 base 的上兩層，解析成絕對路徑後用於後續指令。

### 3. 啟動（背景），資料指向使用者專案
uv run --project "<PLUGIN_DIR>" python "<PLUGIN_DIR>/server.py" --data-dir "$(pwd)/data"
```

### 坑 3：shell 變數不跨 bash 指令保留
每次 Bash 工具呼叫是獨立 shell，`PLUGIN_DIR=…` 在下一個指令就沒了。所以**要嘛串成一條指令、要嘛讓 Claude 拿到實際路徑後直接代入**（我們的 SKILL.md 用 `<PLUGIN_DIR>` 佔位，提示 Claude 填實際絕對路徑）。

### 資料目錄要分離（dev 與安裝都能用）
夾帶的 server 安裝後在 plugin 目錄，但**創意資料要讀「使用者的專案」**。做法：
- 前端靜態檔 → 從 `server.py` 自己的目錄（`ROOT`）服務。
- 資料 → 用 `--data-dir`（或 `DATA_DIR` env）指定，預設 `cwd/data`。
- serve skill 啟動時補 `--data-dir "$(pwd)/data"` → 讀使用者專案的 `./data/creatives`。

---

## 4.5 補充：包 MCP server（給 Claude 用的工具，跟 webui 不同）

> 先分清楚：**webui（HTTP server）是給「人」開瀏覽器看的；MCP server 是給「Claude」當工具用的。** 兩者不同。
> 本專案的看板是前者；若哪天想讓 Claude 直接讀/操作 `data/creatives`（不開瀏覽器），那才是 MCP 的場景。

### 兩種放法（擇一）
**A. plugin 根放 `.mcp.json`（推薦，多 server 時清楚）**
```json
{
  "mcpServers": {
    "my-server": {
      "command": "${CLAUDE_PLUGIN_ROOT}/servers/server.js",
      "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"],
      "env": { "FOO": "${SOME_ENV}" }
    }
  }
}
```
**B. 直接寫進 `plugin.json` 的 `mcpServers` 欄位**（單一 server 較簡單）。

### 設定形狀
- **stdio（本機程序）**：`command` + `args` + `env` + `cwd`(可選)。
- **遠端**：`"type": "http" | "sse" | "ws"` + `url` + `headers`。

### 🔑 關鍵（跟 §4 的坑相反）
**`${CLAUDE_PLUGIN_ROOT}` 在 MCP 的 JSON 設定裡是可靠的** —— 壞掉的只有「skill markdown 的 bash」。
所以 **MCP 要定位包內檔案，直接用 `${CLAUDE_PLUGIN_ROOT}` 即可，不必像 serve/setup 那樣繞 base 目錄。**

### 行為
- plugin 啟用時自動起；**第一次需使用者授權**（安全）。
- 工具自動發現，命名 `mcp__plugin_<plugin>_<server>__<tool>`，`/mcp` 看得到，Claude 直接能用（不用打 slash）。
- 可包多個 server；與專案自己的 `.mcp.json` 各自獨立（同名時 project 優先）。

---

## 4.6 路徑變數與環境變數展開（ROOT / DATA / PROJECT_DIR）

Claude Code 跑 plugin 時會注入幾個路徑變數，**只在「真的被安裝/啟用」時才有值**（dev 用 `--plugin-dir`／在 repo 裡跑通常沒注入）。三個主角：

| 變數 | 指向 | 可寫？ | `/plugin update` 後 | 拿來做什麼 |
|------|------|--------|---------------------|-----------|
| `${CLAUDE_PLUGIN_ROOT}` | plugin **安裝目錄** | 當**唯讀** | 被換掉（更新即覆蓋） | 指「隨 plugin 發佈的檔」：腳本、設定、範本 |
| `${CLAUDE_PLUGIN_DATA}` | plugin **專屬持久資料夾** | **可寫** | **保留**（不清） | 快取、輸出、要跨更新存活的狀態 |
| `${CLAUDE_PROJECT_DIR}` | **使用者專案根** | 可寫 | — | 指使用者專案裡的檔（`.env`、`data/`…） |

口訣：**ROOT = 唯讀程式碼/資源、DATA = 可寫持久狀態、PROJECT_DIR = 使用者那邊。**

### 展開語法（在 JSON 設定裡）
- `${VAR}` — 代入該變數值；**沒設又沒給預設 → Claude Code 解析設定會直接失敗**。
- `${VAR:-預設值}` — 有設用設的、沒設用預設（保險，強烈建議都帶）。
- 不只 CLAUDE_* 那幾個，**任何環境變數**都能引用（例：`${PLAYWRIGHT_CDP_URL:-http://127.0.0.1:9222}`）。
- 細節：**使用者自訂**的 `.mcp.json` 引用 `${CLAUDE_PROJECT_DIR}` 要帶預設（`${CLAUDE_PROJECT_DIR:-.}`）；**plugin 內建**的 `${CLAUDE_PLUGIN_ROOT}` 不用帶。

### ⚠️ 哪裡可靠、哪裡不可靠（會踩）
- ✅ **JSON 設定（`.mcp.json` / `hooks.json`）裡這些變數可靠展開。**
- ❌ **skill markdown 觸發的 bash 裡 `$CLAUDE_PLUGIN_ROOT` 是壞的**（見 §4 坑 1）→ 用「Base directory」推 plugin 根。
- ⚠️ `$CLAUDE_PLUGIN_DATA` 在 skill bash 是否注入，**我們還沒實機驗過**（同一家族、同風險）。所以 skill bash 裡**要寫檔，別賭它**。

### 我們的取捨（對照最好懂）
- **`.mcp.json`（JSON，可靠）**：`--cdp-endpoint ${PLAYWRIGHT_CDP_URL:-http://127.0.0.1:9222}`、`--output-dir ${CLAUDE_PLUGIN_DATA:-.browser}/out`（持久輸出、更新不清；`DATA` 是獨立資料夾、不弄髒 plugin code）。
- **skill bash（不賭變數）**：暫存檔寫**使用者專案的 `.browser/tmp/`**（`${CLAUDE_PROJECT_DIR:-$(pwd)}/.browser/tmp`，cwd=使用者專案可靠、保證可寫），收尾清掉。原則：**plugin 維持唯讀乾淨、寫入都落使用者端**。
- **定位包內檔**（`server.py`/`templates/`）：從 skill 的 Base directory 推，**不用** `$CLAUDE_PLUGIN_ROOT`。

### dev vs 真安裝
dev（`--plugin-dir` 或 repo 內）通常**沒注入** CLAUDE_* → 全走 `:-` 後面的 fallback；所以**每個變數都務必帶預設**，否則沒注入時直接解析失敗。**只有真的 `/plugin install` 起來，才看得到這些變數實際被填成什麼**——值得在那關專門驗一次（尤其 skill bash 到底拿不拿得到 `$CLAUDE_PLUGIN_DATA`）。

---

## 5. 發佈與安裝

### 基本指令速查
```text
# Marketplace（商店目錄）
/plugin marketplace add <帳號>/<repo>         # 加入商店（git clone 到 cache，預設追 main）
/plugin marketplace add <帳號>/<repo>#<ref>   # 釘分支 / tag / commit（例：#v1.2.0、#abc1234）
/plugin marketplace list                      # 列出已加入的商店
/plugin marketplace update [名稱]             # 刷新商店目錄（去 cache git pull）
/plugin marketplace remove <名稱>             # 移除商店

# Plugin（單一外掛）
/plugin install <plugin>@<marketplace>        # 安裝（例：ad-generator@ad-generator）
/plugin                                        # 互動選單：瀏覽 / 更新 / 啟用停用
/plugin uninstall <plugin>                    # 解除安裝
/reload-plugins                                # 重新載入（改動後生效）

# 開發測試（不必 GitHub）
claude --plugin-dir .                          # 直接把當前 repo 當 plugin 載入
```
全部可逆：`/plugin uninstall` + `/plugin marketplace remove` 就乾淨移除；cache 在 `~/.claude/plugins/`。

### 更新機制（我們實測驗證過，別搞混）
**唯一驅動更新的是 `plugin.json` 的 `version`，而且改動一定要進 `main`。** 發版 SOP：

1. **bump `.claude-plugin/plugin.json` 的 `version`**（如 1.0.0 → 1.0.1）。version 沒改 → 即使推了新碼也被當「同版」、不會套用。（不寫 version 則改用 commit SHA，每次 commit 都算新版。）
2. **合併到 `main` 並 push**：marketplace 預設追 repo 的預設分支（main）。只 push 個人分支 `<name>_dev`（即使帶了新 version）**不會被抓**。
3. 使用者端：`/plugin marketplace update` → cache `git pull` main 取得新版 → `/plugin` 更新（或開了 auto-update 會自動）。

容易混的三點：
- **`marketplace.json` 的 `version` 是幌子** —— 純標籤，**不影響任何更新**。自產自銷型常順手把它對齊 plugin 版號（純美觀）；聚合別人 plugin 的商店則只在自己變動時才動它。
- **git pull 不看 version**：只要 main 有新 commit，pull 就會拉；version 只在 pull 完「要不要套用」時才比對。
- ⚠️ 已知 bug（[#10182](https://github.com/anthropics/claude-code/issues/10182)）：`/plugin marketplace update` 有時不會真的 `git pull`、只更新時間戳。手動解：`git -C ~/.claude/plugins/marketplaces/<名> pull origin main` 再 `/reload-plugins`。

---

## 6. 開發 / 測試流程

| 方式 | 指令 | 驗到什麼 |
|---|---|---|
| **開發** | `cd <repo> && claude --plugin-dir .` | skills 變 `/ad-generator:*`，cwd=repo 最省事 |
| **真安裝（不必 GitHub）** | `/plugin marketplace add <本機路徑>` → `/plugin install …` | 複製到 `~/.claude/plugins`，**驗動態定位**那關 |

> **務必真的跑一次**，別只 `import` / `py_compile`（見坑 5）。

---

## 7. 我們踩過的坑（精華）

1. **`$CLAUDE_PLUGIN_ROOT` 在 skill bash 不可用** → 改用 skill 的「Base directory」推 plugin 根。（§4）
2. **ruff `--fix` 自動 hook 會刪「當下未使用」的 import**：我們先加 `import argparse`、用法在後面才補，中間 hook 把 import 當未使用刪掉 → server 一跑就 `NameError`。**教訓：自動 `--fix` hook 有隱形風險，這類 plugin 我們最後把它移除了。**
3. **驗證盲點**：`import server` / `py_compile` **驗不出 `__main__` 裡的 NameError**（不執行、只檢查語法）。**會被執行的進入點一定要實際跑一次。**
4. **user-only skill**：裝軟體的 `setup` 加 `disable-model-invocation: true`，避免 Claude 自動裝東西；使用者仍可手動觸發。
5. **不要留 `.claude/`**：skill 單一來源 = `skills/`，別搞「開發版 + 發佈版」兩份（會 drift）。開發靠 `--plugin-dir`。
6. **LF 換行**：跨平台/部署一致，用 `.gitattributes` 強制 LF。

---

## 8. 快速檢查清單

- [ ] `.claude-plugin/plugin.json`（name 與安裝後的 `/name:` 一致）
- [ ] `.claude-plugin/marketplace.json`（`source: "./"`）
- [ ] `skills/<name>/SKILL.md`（name = 資料夾名；description 寫清楚觸發情境）
- [ ] 會裝軟體/有副作用的 skill → `disable-model-invocation: true`
- [ ] 發版：bump `plugin.json` 的 `version` + **合進 `main`** + push（只 push 個人分支不會被抓；`marketplace.json` 版號不影響更新）
- [ ] 要跑包內程式 → 用「Base directory」推 plugin 根，**勿**靠 `$CLAUDE_PLUGIN_ROOT`/cwd
- [ ] 路徑變數（§4.6）：JSON 設定可用 `${CLAUDE_PLUGIN_ROOT/DATA}`；skill bash 不可靠 → 寫檔走使用者專案、變數一律帶 `:-預設`
- [ ] 夾帶 server → 資料目錄用 `--data-dir` 指向使用者專案
- [ ] **真的安裝/`--plugin-dir` 跑過一輪**（不只 import）
- [ ] push 上 GitHub 才能分發
