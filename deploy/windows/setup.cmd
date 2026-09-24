@echo off
rem Run once on the VM after unzipping (and again after each update): installs dependencies and builds.
rem Needs Node.js 20.9+ (LTS) installed and internet access to the npm registry.
cd /d "%~dp0\..\.."
if not exist .env.local ( echo .env.local is missing - it must be in the project root. & exit /b 1 )
call npm ci || exit /b 1
call npm run build || exit /b 1
echo Build complete. Start the console with deploy\windows\start.cmd
