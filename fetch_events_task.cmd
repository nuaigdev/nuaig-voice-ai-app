@echo off
rem Wrapper for the scheduled task. A headless task has nowhere to print, so
rem this appends stdout, stderr and the exit code to fetch_events.log next to
rem the script. Reads CATIE_USER / CATIE_PASS from the environment, as the
rem script does; it never echoes them.
cd /d "%~dp0"
echo ======== run started %DATE% %TIME% ========>> fetch_events.log
"%~dp0..\venv\Scripts\python.exe" "%~dp0fetch_events.py" >> fetch_events.log 2>&1
echo ---- exit code %ERRORLEVEL% ---->> fetch_events.log
exit /b %ERRORLEVEL%
