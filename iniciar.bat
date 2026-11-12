@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Liquidacion de gastos PBS
where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instale la version LTS desde https://nodejs.org y vuelva a ejecutar este archivo.
  pause
  exit /b 1
)
if not exist config.json copy config.example.json config.json >nul
echo Iniciando el servicio. Para detenerlo cierre esta ventana.
:loop
node --disable-warning=ExperimentalWarning server.js
echo.
echo El servicio se detuvo. Reiniciando en 5 segundos (cierre la ventana para salir)...
timeout /t 5 >nul
goto loop
