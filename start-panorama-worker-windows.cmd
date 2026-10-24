@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 (echo Python 3 is required. & pause & exit /b 1)
)
.venv\Scripts\python.exe -c "import flask, cv2, numpy" >nul 2>&1
if errorlevel 1 (
  .venv\Scripts\python.exe -m pip install -r panorama-requirements.txt
  if errorlevel 1 (echo Flask and OpenCV installation failed. & pause & exit /b 1)
)
set "DATA_DIR=%cd%\data\preview"
set "STITCH_PORT=5000"
echo Panorama worker: http://127.0.0.1:5000. Keep this window open.
.venv\Scripts\python.exe server\panorama-worker.py
pause
