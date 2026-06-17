#!/usr/bin/env bash
# ===================================================================
#  啟動一台「帶遠端除錯埠 9222」的真 Chrome / Chromium，供 Playwright MCP 透過 CDP 接管。
#  執行：bash launch-chrome-cdp.sh （或 chmod +x 後直接跑）。
#  之後在開啟的視窗手動登入 chatgpt.com，保持開著，再（重）啟動 Claude Code，MCP 會自動接管。
#  登入態存在同層的 .chrome_cdp（已 gitignore），下次免再登。
#  ── 這是範本（macOS / Linux 用）：setup 會把它複製到「你的專案」底下的 .browser/。
# ===================================================================
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="$DIR/.chrome_cdp"
mkdir -p "$DIR/out"

# 依序找常見的 Chrome / Chromium 路徑（macOS 與 Linux）
CANDIDATES=(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
  "$(command -v google-chrome || true)"
  "$(command -v google-chrome-stable || true)"
  "$(command -v chromium || true)"
  "$(command -v chromium-browser || true)"
)
CHROME=""
for c in "${CANDIDATES[@]}"; do
  if [ -n "$c" ] && [ -x "$c" ]; then CHROME="$c"; break; fi
done
if [ -z "$CHROME" ]; then
  echo "[x] 找不到 Chrome/Chromium，請編輯本檔把 CHROME 設成你的瀏覽器路徑。"
  exit 1
fi

"$CHROME" --remote-debugging-port=9222 --user-data-dir="$PROFILE" >/dev/null 2>&1 &
echo "[ok] Chrome launched with CDP debug port 9222"
echo "     profile: $PROFILE"
echo
echo " Next: 在那個視窗登入 chatgpt.com、保持開著，再（重）啟動 Claude Code 讓 Playwright MCP 接管。"
