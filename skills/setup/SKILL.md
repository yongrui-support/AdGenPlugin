---
name: setup
description: 安裝/設定 Ad Generator（廣告發想機器人）的執行環境，一次把「跑起來＋生圖」需要的都備好：經套件管理器（macOS Homebrew / Windows Scoop）裝 uv 與 Node（nvm，Node 24 LTS）→ uv sync → 備 CDP 瀏覽器（複製啟動腳本、登入 ChatGPT）。觸發詞（含口語與失敗情境）：「幫我設定環境 / 安裝 / 裝環境 / 初始化 / 環境準備 / 配置環境 / 把環境裝好 / 做廣告發想機器人的環境設定 / 第一次使用要準備什麼 / 我要開始用 / 怎麼開始 / 怎麼跑起來 / 準備生圖環境 / setup / install」；以及遇到「缺 uv / 沒裝 uv / 缺 Node 或 npx / uv sync 失敗 / 生圖跑不起來 / MCP 連不到瀏覽器 / serve 或 generate 提示缺工具」等狀況時，也觸發本 skill。
---

# setup

把這包的執行環境一次備好——**包含生圖**（生圖是本 plugin 的核心價值，環境不是選配）。
**會安裝軟體**，每個安裝動作前先簡短告知使用者、徵得同意再跑。

## 步驟

### 1. 取得 plugin 根目錄
系統會在開頭給你「**Base directory for this skill**」（即 `<plugin>/skills/setup`）。
**plugin 根 = 該 base 的上兩層**（`<skill base>/../..`），解析成絕對路徑，後續用。不靠 cwd 或 `$CLAUDE_PLUGIN_ROOT`。

### 2. 問使用者的作業系統
直接問：「你的作業系統是 **Windows / macOS / Linux** 哪一個？」依回答走對應分支。

### 3. 裝好工具鏈：uv ＋ Node（都走套件管理器，一次備齊）
**統一走套件管理器**（brew/scoop），有就跳過、絕不重裝。先確保管理器在，再裝 uv 與 Node。

**3a. 套件管理器**（沒有才裝）：
- **macOS** Homebrew（互動要密碼，請使用者用 `!` 前綴自己跑）：
  ```bash
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  ```
  裝完找不到 `brew` → 用 `/opt/homebrew/bin/brew`（Apple Silicon PATH 未設）。
- **Windows** Scoop（PowerShell）：
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force; iwr -useb get.scoop.sh | iex
  ```
- **Linux**（無 brew/scoop 文化，下面 uv/nvm 改用官方安裝器）。

**3b. uv**：`uv --version` 有 → 跳過；否則 `brew install uv`／`scoop install uv`（Linux：`curl -LsSf https://astral.sh/uv/install.sh | sh`）。

**3c. Node（用 nvm 裝 Node 24 LTS）**——`generate-images` 的 Playwright MCP 要跑 `npx`，**Node 是必備、不是選配**。
`node --version` 與 `npx --version` 都有且 Node ≥ 20 → 跳過；缺的話就用 nvm 安裝（依 OS）：
- **Windows**（Scoop 裝 nvm-windows）：
  ```powershell
  scoop install nvm
  nvm install 24
  nvm use 24
  ```
  （新版 nvm-windows `nvm install 24` 會解析成最新 24.x；舊版只吃完整版號就改 `nvm install lts` 或 `nvm install 24.x.x`。）
- **macOS**（Homebrew 裝 nvm；要自建 `NVM_DIR` 並 source，且 **source 與 `nvm install` 必須在同一條 bash 指令**——每次 bash 不共用 shell 狀態）：
  ```bash
  brew install nvm
  mkdir -p ~/.nvm
  export NVM_DIR="$HOME/.nvm"; . "$(brew --prefix nvm)/nvm.sh"; nvm install 24 && nvm use 24
  ```
  提醒使用者把 `export NVM_DIR="$HOME/.nvm"` 與 `. "$(brew --prefix nvm)/nvm.sh"` 加進 `~/.zshrc`（之後新 shell 才有 node）。
- **Linux**（官方 nvm 安裝器）：
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm install 24 && nvm use 24
  ```
裝完用 `node --version`（應為 v24.x）+ `npx --version` 確認。

> 統一走套件管理器，未來新工具同一管道、移除也乾淨（`brew/scoop uninstall uv nvm`）。勿改成各平台官方安裝器（Linux 例外）。

### 4. 安裝專案相依
```bash
uv sync --project "<PLUGIN_DIR>"
```

### 5. 備 CDP 瀏覽器（生圖環境）
`generate-images` 靠 plugin **內建的 Playwright MCP**（`.mcp.json` 隨安裝自動註冊）接管一台你已登入 ChatGPT 的 Chrome。MCP 不用你建，但那台 Chrome 要本機備好：

1. **把啟動腳本放進「使用者專案」的 `.browser/`**（登入態是使用者資產、不放 plugin 內）：
   ```bash
   mkdir -p "$(pwd)/.browser"
   cp "<PLUGIN_DIR>/templates/launch-chrome-cdp.bat" "$(pwd)/.browser/"   # Windows
   cp "<PLUGIN_DIR>/templates/launch-chrome-cdp.sh"  "$(pwd)/.browser/"   # macOS / Linux
   ```
   提醒使用者把 `.browser/` 加進**他自己專案**的 `.gitignore`（裡面有登入態）。
2. **由「Claude」幫使用者啟動那台 Chrome**（不必使用者手動雙擊——Claude 跑腳本＝等同人親手雙擊）：
   - Windows：`cmd //c "$(pwd)/.browser/launch-chrome-cdp.bat"`
   - macOS／Linux：`bash "$(pwd)/.browser/launch-chrome-cdp.sh"`
   會開出一台帶 9222 埠的 Chrome（背景、不阻塞）。
3. **唯一需要「使用者」親手做的事：在那台 Chrome 登入 chatgpt.com**（登入無法自動化、只有真人能做；登一次就好，profile 會記住、下次免登）。
   - 之後**使用者不用再手動開 Chrome**——跑 `generate-images` 時是 Claude 自己探 9222 埠、沒開就幫忙啟動。`serve` 只開看板、不碰 Chrome。
4. 使用者登入後，（重）啟動 Claude Code 讓 MCP 接上。換 port 就設環境變數 `PLAYWRIGHT_CDP_URL`。
   - Windows 若 MCP 因 `npx` 解析不到（找不到 `npx.cmd`）起不來：把 `.mcp.json` 的 `"command"` 改成 `"cmd"`、`"args"` 開頭插 `"/c", "npx"`（其餘不動；預設裸 `npx` 是為了跨平台）。

### 6. 回報
環境就緒（uv、Node、專案相依、CDP 瀏覽器都備好）。接著可：
- `/ad-generator:generate-creatives` —— 把品牌 brief 變成多組文案＋構圖 prompt
- `/ad-generator:generate-images` —— 生主視覺（**核心**：用 CDP 瀏覽器在 ChatGPT 產圖、回寫 JSON）
- `/ad-generator:serve` —— 開看板檢視／編輯／刪除
