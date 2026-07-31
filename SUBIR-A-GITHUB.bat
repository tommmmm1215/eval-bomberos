@echo off
REM ====================================================================
REM  Prepara el repositorio local y lo deja listo para subir a GitHub.
REM  Guardar siempre con finales de linea CRLF.
REM ====================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo(
echo ===============================================================
echo   Repositorio - Evaluacion Bomberos de Espartillar
echo ===============================================================
echo(

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Git. Instalalo desde https://git-scm.com
  pause
  exit /b 1
)

REM --- Identidad de Git -----------------------------------------------
REM Git firma cada commit con un nombre y un email. Es una sola vez por
REM computadora. El email no tiene que ser secreto: queda visible en el
REM historial publico del repositorio.

for /f "delims=" %%i in ('git config --global user.email 2^>nul') do set "GITMAIL=%%i"
for /f "delims=" %%i in ('git config --global user.name 2^>nul') do set "GITNAME=%%i"

if not defined GITMAIL (
  echo Git todavia no sabe quien sos. Se configura una sola vez.
  echo(
  set "GITNAME=Tomi Aguilar"
  set "GITMAIL=tomiagustinaguilar@gmail.com"
  set /p "GITNAME=  Tu nombre [!GITNAME!]: "
  set /p "GITMAIL=  Tu email  [!GITMAIL!]: "
  if not defined GITMAIL (
    echo(
    echo [ERROR] Hace falta un email para poder firmar los commits.
    pause
    exit /b 1
  )
  git config --global user.name  "!GITNAME!"
  git config --global user.email "!GITMAIL!"
  echo(
  echo   Guardado: !GITNAME! ^<!GITMAIL!^>
  echo(
)

REM --- Freno de mano -------------------------------------------------
REM
REM Este script era un bootstrap de una sola vez y borraba .git para
REM arrancar limpio. El problema es que se llama "SUBIR-A-GITHUB" y quedo
REM en la raiz: cualquiera lo ejecuta pensando que sube los cambios, y le
REM borra el historial y el remote. Paso.
REM
REM Ahora, si ya hay repositorio, no lo toca: guarda los cambios y sube.

if exist ".git" (
  echo Ya existe un repositorio. No se toca el historial.
  echo(
  echo Guardando los cambios pendientes...
  git add -A
  git diff --cached --quiet
  if errorlevel 1 (
    set /p "MSJ=  Mensaje del commit: "
    if not defined MSJ set "MSJ=Cambios"
    git commit -q -m "!MSJ!"
    echo   Commit hecho.
  ) else (
    echo   No habia nada nuevo que guardar.
  )
  echo(
  git remote get-url origin >nul 2>nul
  if errorlevel 1 (
    echo No hay un remote configurado. Agregalo con:
    echo(
    echo   git remote add origin https://github.com/tommmmm1215/eval-bomberos.git
    echo   git push -u origin main
  ) else (
    echo Subiendo...
    git push
  )
  echo(
  pause
  exit /b 0
)

echo [1/3] Inicializando...
git init -b main >nul
git add -A 2>nul

echo(
echo [2/3] Verificando que NO entren datos personales...
git ls-files | findstr /i "Imagenes seed_espartillar asignar-fotos" >nul 2>nul
if not errorlevel 1 (
  echo(
  echo [ERROR] Se colaron archivos con datos personales. NO se hace commit.
  echo Revisa el archivo .gitignore.
  echo(
  pause
  exit /b 1
)
echo       OK: ni fotos, ni DNI, ni padron real.

echo(
echo [3/3] Primer commit...
git commit -q -m "Sistema de evaluacion de rendimiento para bomberos"
if errorlevel 1 (
  echo(
  echo [ERROR] Fallo el commit. El detalle esta arriba.
  echo(
  pause
  exit /b 1
)

for /f %%i in ('git ls-files ^| find /c /v ""') do set "NARCH=%%i"

echo(
echo ===============================================================
echo   LISTO - %NARCH% archivos en el primer commit
echo ===============================================================
echo(
echo Los avisos de "LF will be replaced by CRLF" son normales: Git
echo esta normalizando finales de linea. No hay nada que corregir.
echo(
echo AHORA, para subirlo:
echo(
echo 1. Entra a https://github.com/new
echo    Nombre: eval-bomberos     Visibilidad: Public
echo    NO tildes "Add a README" ni ninguna otra opcion.
echo(
echo 2. Volve aca y pega estos dos comandos tal cual:
echo(
echo    git remote add origin https://github.com/tommmmm1215/eval-bomberos.git
echo    git push -u origin main
echo(
echo    ^(Ese usuario ya coincide con lo que espera el auto-update
echo     en app\package.json, asi que no hay nada que ajustar.^)
echo(
pause
