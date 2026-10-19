@echo off
setlocal
pushd "%~dp0" || exit /b 1

if exist "MdNotes.exe" goto run

echo MdNotes.exe not found. Building the app...
call npm install
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
python -m pip install -r requirements-build.txt
if errorlevel 1 goto failed
python -m PyInstaller --noconfirm --clean --onefile --console --name MdNotes --distpath . --workpath build\pyinstaller --add-data "src\index.html;src" --add-data "src\styles.css;src" --add-data "src\app.bundle.js;src" --add-data "src\config.json;src" src\server.py
if errorlevel 1 goto failed
if not exist "MdNotes.exe" goto failed

:run
"%CD%\MdNotes.exe"
set "app_exit=%errorlevel%"
popd
exit /b %app_exit%

:failed
echo Build failed. Check the error above and ensure Node.js, npm, and Python are installed.
pause
popd
exit /b 1
