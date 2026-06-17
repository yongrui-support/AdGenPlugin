@echo off
rem ===================================================================
rem  Launch a real Chrome with remote-debugging-port 9222 so the
rem  Playwright MCP can take it over via CDP. Just run this once.
rem  After it opens: log in to chatgpt.com in that Chrome window, keep it
rem  open, then (re)start Claude Code so the Playwright MCP attaches.
rem  Login is kept in the sibling .chrome_cdp profile (gitignored),
rem  so you only log in once.
rem  -- This is a template: setup copies it into YOUR project's .browser/.
rem  (ASCII-only on purpose: avoids garbled output on non-UTF-8 consoles.)
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
rem  Use ping instead of timeout: timeout fails when stdin is redirected
rem  (e.g. launched non-interactively via cmd //c).
ping -n 5 127.0.0.1 >nul
