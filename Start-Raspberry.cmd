@echo off
setlocal
cd /d "%~dp0"

set "RASPBERRY_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "RASPBERRY_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if "%RASPBERRY_NODE%"=="node" goto dependencies
if exist "%RASPBERRY_NODE%" goto dependencies
echo Node.js was not found. Install Node.js 24 or newer, then run this file again.
pause
exit /b 1

:dependencies
if exist "node_modules\next\dist\bin\next" goto launch
echo Raspberry's dependencies are missing. Run pnpm install in this folder first.
pause
exit /b 1

:launch
echo Starting Raspberry on this computer.
echo Open http://127.0.0.1:3000 after the server reports Ready.
echo Keep this window open while using Raspberry. Press Ctrl+C to stop it.
echo This address works on this computer only; NikDTM hosting is not set up yet.
echo.
"%RASPBERRY_NODE%" scripts\local.mjs dev
if errorlevel 1 pause
