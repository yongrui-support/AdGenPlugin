---
name: setup
description: 安裝/設定 Ad Generator（廣告發想機器人）的執行環境：檢查 uv → 沒有就經套件管理器裝（macOS Homebrew / Windows Scoop，缺管理器先裝它）→ uv sync；要用 generate-images 生圖再選用備 CDP 瀏覽器（用 NVM 裝 Node 24 LTS + 啟動腳本 + 登入 ChatGPT）。當使用者說「幫我設定環境 / 初始化 / 做廣告發想機器人的環境設定 / 第一次使用要準備什麼」，或 serve、generate 提示缺 uv 時，觸發。
---

# setup

安裝執行環境。**會安裝軟體**，每個安裝動作前先簡短告知使用者、徵得同意再跑。

## 步驟

### 1. 取得 plugin 根目錄
系統會在開頭給你「**Base directory for this skill**」（即 `<plugin>/skills/setup`）。
**plugin 根 = 該 base 的上兩層**（`<skill base>/../..`），解析成絕對路徑，步驟 4 用。
不靠 cwd 或 `$CLAUDE_PLUGIN_ROOT`。

### 2. 問使用者的作業系統
直接問：「你的作業系統是 **Windows / macOS / Linux** 哪一個？」依回答走步驟 3 對應分支。

### 3. 確保 uv（檢查順序：uv → 套件管理器 → 都沒有才裝）
依序檢查，**有就直接用、絕不重複安裝**：

1. `uv --version` 有 → 跳到步驟 4。
2. 有 `brew`（macOS）/ `scoop`（Windows）→ `brew install uv` / `scoop install uv`。
3. 都沒有 → 先裝套件管理器，再回到 2：
   - **macOS** 裝 Homebrew（會互動要密碼，請使用者用 `!` 前綴自己跑）：
     ```bash
     /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
     ```
     裝完若找不到 `brew` → 直接用 `/opt/homebrew/bin/brew`（Apple Silicon 的 PATH 尚未設定）。
   - **Windows** 裝 Scoop（PowerShell）：
     ```powershell
     Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force; iwr -useb get.scoop.sh | iex
     ```
   - **Linux**（無 brew/scoop 文化，例外用官方安裝器）：
     ```bash
     curl -LsSf https://astral.sh/uv/install.sh | sh
     ```

> 刻意統一走套件管理器：未來其他工具（nvm…）同一管道，移除也乾淨（`brew uninstall uv` / `scoop uninstall uv`）。勿改成各平台官方安裝器。

### 4. 安裝專案相依
```bash
uv sync --project "<PLUGIN_DIR>"
```

### 5.（選用，要用 `generate-images` 生圖才需要）備 CDP 瀏覽器
`generate-images` 靠 plugin **內建的 Playwright MCP**（`.mcp.json` 隨安裝自動註冊）接管一台你已登入 ChatGPT 的 Chrome。MCP 不用你建，但**那台 Chrome 要本機備**：

1. **確保 Node/npx（用 NVM 裝 Node 24 LTS）**——MCP 會跑 `npx @playwright/mcp`，需要 Node。
   先檢查：`node --version` 與 `npx --version` 都有、且 Node ≥ 20 → **直接跳過、絕不重裝**。
   否則**走 NVM**（版本可控，且與步驟 3「統一走套件管理器」一致）：
   - **Windows**（Scoop 裝 nvm-windows）：
     ```powershell
     scoop install nvm
     nvm install 24
     nvm use 24
     ```
     （`nvm install 24` 在新版 nvm-windows 會解析成最新 24.x；若該版本只吃完整版號，改 `nvm install lts` 或指定如 `nvm install 24.0.0`。）
   - **macOS**（Homebrew 裝 nvm）：brew 的 nvm 要自建 `NVM_DIR` 並 source，且 **source 與 `nvm install` 必須在同一個 bash 指令裡**（本工具每次 bash 不共用 shell 狀態）：
     ```bash
     brew install nvm
     mkdir -p ~/.nvm
     export NVM_DIR="$HOME/.nvm"; . "$(brew --prefix nvm)/nvm.sh"; nvm install 24 && nvm use 24
     ```
     提醒使用者把 `export NVM_DIR="$HOME/.nvm"` 與 `. "$(brew --prefix nvm)/nvm.sh"` 兩行加進 `~/.zshrc`（之後每個新 shell 才有 node）。
   - **Linux**（無 brew/scoop 文化，用官方 nvm 安裝器）：
     ```bash
     curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
     export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm install 24 && nvm use 24
     ```
   裝完用 `node --version`（應為 v24.x）+ `npx --version` 確認。
   - 萬一 Windows 下 MCP 因 `npx` 解析不到（找不到 `npx.cmd`）而起不來：把 plugin 的 `.mcp.json` 該 server 的 `"command"` 改成 `"cmd"`、`"args"` 開頭插 `"/c", "npx"`（其餘不動）。預設用裸 `npx` 是為了 macOS/Linux 也能跑。
2. **把啟動腳本放進「使用者專案」的 `.browser/`**（不是 plugin 內——登入態是使用者資產）：
   ```bash
   mkdir -p "$(pwd)/.browser"
   # Windows：
   cp "<PLUGIN_DIR>/templates/launch-chrome-cdp.bat" "$(pwd)/.browser/"
   # macOS / Linux：
   cp "<PLUGIN_DIR>/templates/launch-chrome-cdp.sh" "$(pwd)/.browser/"
   ```
   提醒使用者把 `.browser/` 加進**他自己專案**的 `.gitignore`（裡面有登入態，勿進版控）。
3. **執行它**（Windows 雙擊 `.bat`／macOS·Linux `bash .browser/launch-chrome-cdp.sh`）→ 在開啟的 Chrome **登入 chatgpt.com、保持開著** → （重）啟動 Claude Code，MCP 自動接管 9222。換 port 就設環境變數 `PLAYWRIGHT_CDP_URL`。

### 6. 回報
環境就緒。接著可：`/ad-generator:generate-creatives` 產素材、`/ad-generator:serve` 開 WebUI 看板；備好 CDP 瀏覽器後 `/ad-generator:generate-images` 生主視覺。
