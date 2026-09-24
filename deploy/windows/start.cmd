@echo off
rem Starts the production server on port 3000 (all interfaces). Set PORT first to use another port.
cd /d "%~dp0\..\.."
if "%PORT%"=="" set PORT=3000
if not exist deploy\logs mkdir deploy\logs
call npm start -- -p %PORT% >> deploy\logs\nuva.log 2>&1
