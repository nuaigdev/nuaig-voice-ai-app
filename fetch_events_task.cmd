@echo off
rem Wrapper for the scheduled task. A headless task has nowhere to print, so
rem this appends stdout, stderr and the exit code to fetch_events.log next to
rem the script. Credentials come from the environment or .env.local, as the
rem script reads them; it never echoes them.
rem Uses the installer's node.exe by full path (a SYSTEM task may not see the
rem user's PATH), falling back to node on PATH.
cd /d "%~dp0"
set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
echo ======== run started %DATE% %TIME% ========>> fetch_events.log
"%NODE_EXE%" "%~dp0scripts\fetch-events.mjs" >> fetch_events.log 2>&1
echo ---- exit code %ERRORLEVEL% ---->> fetch_events.log
exit /b %ERRORLEVEL%
