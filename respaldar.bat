@echo off
cd /d "%~dp0"
set STAMP=%date:~-4%%date:~3,2%%date:~0,2%
if not exist respaldos mkdir respaldos
xcopy /e /i /y data "respaldos\data_%STAMP%" >nul
echo Respaldo creado en respaldos\data_%STAMP%
pause
