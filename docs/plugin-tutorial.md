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
├── skills/
│   ├── generate-creatives/SKILL.md
│   ├── serve/SKILL.md
│   └── setup/SKILL.md
├── server.py、frontend/、index.html   # 夾帶的 webui（非典型用法）
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

## 5. 發佈與安裝

```text
# 別人安裝
/plugin marketplace add <你的-github>/<repo>
/plugin install ad-generator@ad-generator
```
- `version` 有填 → 使用者要等你 bump 才更新；沒填 → 用 git commit SHA（每次 commit 都算新版）。
- 要分發就 **push 上 GitHub**（`marketplace add` 吃 `<帳號>/<repo>` 或 git URL）。

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
- [ ] 要跑包內程式 → 用「Base directory」推 plugin 根，**勿**靠 `$CLAUDE_PLUGIN_ROOT`/cwd
- [ ] 夾帶 server → 資料目錄用 `--data-dir` 指向使用者專案
- [ ] **真的安裝/`--plugin-dir` 跑過一輪**（不只 import）
- [ ] push 上 GitHub 才能分發
