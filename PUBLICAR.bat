@echo off
REM ====================================================================
REM  Publica una version nueva a GitHub Releases.
REM
REM  Antes de ejecutar esto hay que subir el numero de version en
REM  app\package.json. Es el unico numero que hay que tocar.
REM
REM  IMPORTANTE: este archivo debe guardarse con finales de linea CRLF.
REM ====================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0app"

echo(
echo ===============================================================
echo   Evaluacion de Personal - Bomberos de Espartillar
echo   Publicar version nueva
echo ===============================================================
echo(

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js en esta computadora.
  echo Instalalo desde https://nodejs.org
  echo(
  pause
  exit /b 1
)

REM --- El token ------------------------------------------------------
REM Sin GH_TOKEN, electron-builder compila igual y recien falla al subir,
REM despues de varios minutos de compilacion. Se corta antes.

if not defined GH_TOKEN (
  echo [ERROR] Falta la variable GH_TOKEN.
  echo(
  echo Es el permiso para publicar en GitHub. Se configura una sola vez:
  echo(
  echo   1. Entra a https://github.com/settings/tokens
  echo   2. Generate new token ^(classic^), scope: repo
  echo   3. En PowerShell, pegando tu token:
  echo(
  echo      [Environment]::SetEnvironmentVariable^('GH_TOKEN','TU_TOKEN','User'^)
  echo(
  echo   4. Cerra y volve a abrir la consola.
  echo(
  pause
  exit /b 1
)

REM --- La version ----------------------------------------------------

for /f "tokens=2 delims=:," %%v in ('findstr /r "\"version\"" package.json') do (
  set "VER=%%~v"
)
set "VER=%VER: =%"
set "VER=%VER:"=%"

echo Se va a publicar la version:  %VER%
echo(
echo Tiene que ser MAYOR que la ultima publicada. Si no, la computadora
echo del cuartel no detecta que hay algo nuevo.
echo(
set "SEGUIR=n"
set /p "SEGUIR=Continuar? (s/n): "
if /i not "!SEGUIR!"=="s" (
  echo(
  echo Cancelado. Subi la version en app\package.json y volve a ejecutar.
  echo(
  pause
  exit /b 0
)

echo(
echo [1/2] Descargando dependencias...
call npm install
if errorlevel 1 (
  echo(
  echo [ERROR] Fallo la descarga de dependencias.
  echo(
  pause
  exit /b 1
)

echo(
echo [2/2] Compilando y publicando...
echo       Tarda unos minutos: compila y despues sube unos 90 MB.
echo(
call npm run publicar
if errorlevel 1 (
  echo(
  echo [ERROR] Fallo la publicacion. El detalle esta arriba.
  echo(
  echo   401 o "unauthorized"  El token vencio o no tiene scope repo.
  echo   403                   El repositorio no existe o no es tuyo.
  echo   Un release en borrador ya existente para esta version se
  echo   reutiliza tal cual: hay que borrarlo desde GitHub y reintentar.
  echo(
  pause
  exit /b 1
)

echo(
echo ===============================================================
echo   PUBLICADO - version %VER%
echo ===============================================================
echo(
echo Verificalo en:
echo   https://github.com/tommmmm1215/eval-bomberos/releases
echo(
echo La release tiene que tener TRES archivos:
echo(
echo   EvaluacionBomberos-Setup-%VER%.exe   el instalador
echo   latest.yml                           lo que consulta la app
echo   el .blockmap                         para descargas parciales
echo(
echo Si falta latest.yml, la app instalada no se va a enterar de nada.
echo(
echo La computadora del cuartel se actualiza sola la proxima vez que
echo abra la app. Para forzarlo: Configuracion, Buscar actualizacion.
echo(
pause
