@echo off
REM ====================================================================
REM  Genera el ejecutable de la app de evaluacion.
REM  Doble clic y listo. No hace falta saber PowerShell.
REM
REM  IMPORTANTE: este archivo debe guardarse con finales de linea CRLF.
REM  Con LF solos, cmd.exe parte mal las lineas y se come caracteres.
REM ====================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0app"

echo(
echo ===============================================================
echo   Evaluacion de Personal - Bomberos de Espartillar
echo   Generando el ejecutable para Windows
echo ===============================================================
echo(

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js en esta computadora.
  echo Instalalo desde https://nodejs.org, cerra esta ventana
  echo y volve a ejecutar este archivo.
  echo(
  pause
  exit /b 1
)

if exist dist (
  echo [0/3] Borrando la compilacion anterior...
  rmdir /s /q dist
)

echo [1/3] Descargando dependencias...
echo       La primera vez tarda unos minutos: baja Electron, unos 100 MB.
echo(
call npm install
if errorlevel 1 (
  echo(
  echo [ERROR] Fallo la descarga de dependencias.
  echo Suele ser falta de internet o un antivirus bloqueando la descarga.
  echo(
  pause
  exit /b 1
)

echo(
echo [2/3] Compilando el ejecutable...
echo(
call npm run build:win

echo(
echo [3/3] Verificando el resultado...

REM Se lee la version del package.json en lugar de escribirla aca: cuando
REM estaba fija, cada publicacion la dejaba desactualizada y el chequeo
REM fallaba sobre una compilacion que en realidad habia salido bien.
for /f "tokens=2 delims=:," %%v in ('findstr /r "\"version\"" package.json') do (
  set "VER=%%~v"
)
set "VER=%VER: =%"
set "VER=%VER:"=%"

REM No se confia solo en errorlevel: se comprueba que los archivos existan.
set "FALTA="
if not exist "dist\EvaluacionBomberos-Setup-%VER%.exe"    set "FALTA=1"
if not exist "dist\EvaluacionBomberos-Portable-%VER%.exe" set "FALTA=1"

if defined FALTA (
  echo(
  echo [ERROR] La compilacion no genero los ejecutables esperados
  echo         para la version %VER%.
  echo Revisa el detalle mas arriba en esta misma ventana.
  echo(
  pause
  exit /b 1
)

echo(
echo ===============================================================
echo   LISTO - version %VER%
echo ===============================================================
echo(
echo Los archivos quedaron en:  %CD%\dist
echo(
echo   EvaluacionBomberos-Setup-%VER%.exe      Instalador (unos 90 MB)
echo   EvaluacionBomberos-Portable-%VER%.exe   Version portable
echo(
echo Al abrir la app, arriba a la izquierda tiene que decir "v%VER%"
echo al lado del nombre del cuartel. Si dice otra cosa, estas
echo ejecutando una compilacion vieja.
echo(
echo OJO: esto compila pero NO publica. La app instalada en el cuartel
echo no se entera de esta version. Para eso esta PUBLICAR.bat.
echo(
echo La primera vez Windows va a mostrar "Windows protegio su PC",
echo porque el programa no esta firmado con certificado de editor.
echo Para abrirlo: Mas informacion, y despues Ejecutar de todas formas.
echo(

explorer "%CD%\dist"
pause
