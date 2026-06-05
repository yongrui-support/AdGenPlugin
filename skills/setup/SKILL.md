---
name: setup
description: 安裝/設定 Ad Generator（廣告創意產生・廣告發想機器人）的執行環境：偵測作業系統，缺套件管理器就裝（macOS → Homebrew、Windows → Scoop），再裝 uv、uv sync 安裝相依。當使用者說「幫我設定環境 / 安裝環境 / 初始化 / 做廣告發想機器人的環境設定 / 裝好這個工具 / 第一次使用要準備什麼」，或 serve、generate 提示缺 uv 時，觸發。
---

# setup

安裝執行環境。**會安裝軟體**，每個安裝動作前先簡短告知使用者要做什麼、徵得同意再跑（bash 本來就會要權限）。

## 步驟

### 1. 取得 plugin 根目錄（含 pyproject.toml）
本 skill 被呼叫時，系統會在開頭給你「**Base directory for this skill**」（即 `<plugin>/skills/setup` 的絕對路徑）。
**plugin 根 = 該 base 的上兩層**：
```
PLUGIN_DIR = <base directory>/../..
```
解析成實際絕對路徑（裡面有 `pyproject.toml`、`server.py`），步驟 3 用它。不靠 cwd 或 `$CLAUDE_PLUGIN_ROOT`。

### 2. 確保 uv 已安裝（沒有就先裝套件管理器）
先 `uv --version` 檢查；已存在就跳到步驟 3。否則依 OS：

- **macOS**（`uname` = Darwin）：
  - 沒 `brew` → 裝 Homebrew：
    ```bash
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    ```
  - 裝 uv：`brew install uv`
- **Windows**（用 PowerShell）：
  - 沒 `scoop` → 裝 Scoop：
    ```powershell
    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force; iwr -useb get.scoop.sh | iex
    ```
  - 裝 uv：`scoop install uv`
- **Linux**（備援，無 brew/scoop 需求）：
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

### 3. 安裝專案相依
```bash
uv sync --project "<PLUGIN_DIR>"
```
（`<PLUGIN_DIR>` 換成步驟 1 解析出的實際絕對路徑。）

### 4. 回報
告訴使用者環境就緒，接著可：
- `/ad-generator:generate-creatives` 產廣告素材（存到目前專案的 `data/creatives/`）
- `/ad-generator:serve` 開唯讀看板檢視
