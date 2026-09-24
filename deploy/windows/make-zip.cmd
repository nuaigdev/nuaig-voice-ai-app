@echo off
rem Run on the dev machine from anywhere. Zips the project (INCLUDING .env.local, so treat the zip as a secret)
rem without node_modules, .next or .git; the VM rebuilds those. Output: ..\nuva-console.zip
cd /d "%~dp0\..\.."
"%SystemRoot%\System32\tar.exe" -a -c -f "..\nuva-console.zip" --exclude=node_modules --exclude=.next --exclude=.git --exclude=deploy\logs .
echo Created %cd%\..\nuva-console.zip
