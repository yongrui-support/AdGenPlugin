@echo off
rem ===================================================================
rem  啟動一台「帶遠端除錯埠 9222」的真 Chrome，供 Playwright MCP 透過 CDP 接管。
rem  雙擊即可。之後在開啟的 Chrome 視窗手動登入 chatgpt.com，保持開著，
rem  再（重）啟動 Claude Code（resume 回對話），MCP 會自動接管這台。
rem  登入態存在同層的 .chrome_cdp（已 gitignore），下次免再登。
rem  ── 這是範本：setup 會把它複製到「你的專案」底下的 .browser/。
rem ===================================================================
setlocal
set "PROFILE=%~dp0.chrome_cdp"
set "OUT=%~dp0out"
if not exist "%OUT%" mkdir "%OUT%"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo [x] chrome.exe not found. Edit this .bat and set CHROME to your Chrome path.
  pause
  exit /b 1
)

start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%PROFILE%"
echo [ok] Chrome launched with CDP debug port 9222
echo      profile: %PROFILE%
echo.
echo  Next: log in to chatgpt.com in that Chrome window, keep it open,
echo        then (re)start Claude Code so the Playwright MCP attaches.
timeout /t 4 >nul
