---
name: setup
description: 安裝/設定 Ad Generator（廣告發想機器人）的執行環境：檢查 uv → 沒有就經套件管理器裝（macOS Homebrew / Windows Scoop，缺管理器先裝它）→ uv sync。當使用者說「幫我設定環境 / 初始化 / 做廣告發想機器人的環境設定 / 第一次使用要準備什麼」，或 serve、generate 提示缺 uv 時，觸發。
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

### 5. 回報
環境就緒。接著可：`/ad-generator:generate-creatives` 產素材、`/ad-generator:serve` 開 WebUI 看板。
