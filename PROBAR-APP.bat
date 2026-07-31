@echo off
REM ====================================================================
REM  Abre la app sin compilar el ejecutable.
REM  Sirve para probarla o para usarla mientras tanto.
REM  Guardar siempre con finales de linea CRLF.
REM ====================================================================

setlocal
cd /d "%~dp0app"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js. Instalalo desde https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Primera vez: descargando dependencias, tarda unos minutos...
  echo(
  call npm install
  if errorlevel 1 (
    echo [ERROR] Fallo la descarga de dependencias.
    pause
    exit /b 1
  )
)

echo Abriendo la aplicacion...
call npm start
