@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Please install Node.js 24 LTS, then open this file again.
 pause
 exit /b 1
)
if not exist node_modules (
 call npm ci
 if errorlevel 1 (
  pause
  exit /b 1
 )
)
echo Open http://127.0.0.1:5173/#/local-setup after the server is ready.
call npm run local
pause
