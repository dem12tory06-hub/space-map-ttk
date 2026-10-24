@echo off
cd /d "%~dp0"
py -3 preview-local.py
if errorlevel 1 python preview-local.py
pause
