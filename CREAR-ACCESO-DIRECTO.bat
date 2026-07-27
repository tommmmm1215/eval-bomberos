@echo off
REM ====================================================================
REM  Crea el acceso directo en el escritorio.
REM
REM  Normalmente no hace falta: el instalador lo crea solo. Esto sirve
REM  para cuando se borro por accidente, o para dejar un acceso a la
REM  version portable, que no se instala y por lo tanto no crea ninguno.
REM
REM  IMPORTANTE: este archivo debe guardarse con finales de linea CRLF.
REM ====================================================================

setlocal
cd /d "%~dp0"

echo(
echo ===============================================================
echo   Acceso directo - Evaluacion Bomberos de Espartillar
echo ===============================================================
echo(

REM Todo el trabajo lo hace PowerShell: crear un .lnk desde cmd puro no
REM se puede, hace falta el objeto COM WScript.Shell.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$repo = '%~dp0'.TrimEnd('\');" ^
  "" ^
  "# Se busca la app instalada en el orden en que puede aparecer. El" ^
  "# instalador es perMachine=false, asi que por defecto va a la carpeta" ^
  "# del usuario; pero permite cambiar el destino, de modo que tambien se" ^
  "# consulta el acceso directo del menu inicio, que apunta a donde sea" ^
  "# que haya quedado." ^
  "$candidatos = @(" ^
  "  (Join-Path $env:LOCALAPPDATA 'Programs\Evaluacion Bomberos Espartillar\Evaluacion Bomberos Espartillar.exe')," ^
  "  (Join-Path ${env:ProgramFiles} 'Evaluacion Bomberos Espartillar\Evaluacion Bomberos Espartillar.exe')" ^
  ");" ^
  "$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Evaluacion Bomberos.lnk';" ^
  "if (Test-Path $menu) {" ^
  "  $w = New-Object -ComObject WScript.Shell;" ^
  "  $candidatos += $w.CreateShortcut($menu).TargetPath;" ^
  "}" ^
  "$portable = Join-Path $repo 'app\dist';" ^
  "if (Test-Path $portable) {" ^
  "  $p = Get-ChildItem $portable -Filter 'EvaluacionBomberos-Portable-*.exe' -ErrorAction SilentlyContinue |" ^
  "       Sort-Object Name -Descending | Select-Object -First 1;" ^
  "  if ($p) { $candidatos += $p.FullName }" ^
  "}" ^
  "" ^
  "$destino = $candidatos | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1;" ^
  "" ^
  "if (-not $destino) {" ^
  "  Write-Host '';" ^
  "  Write-Host '[ERROR] No se encontro la aplicacion instalada.' -ForegroundColor Red;" ^
  "  Write-Host '';" ^
  "  Write-Host 'Instalala primero con:';" ^
  "  Write-Host ('  ' + (Join-Path $repo 'app\dist\EvaluacionBomberos-Setup-1.0.3.exe'));" ^
  "  Write-Host '';" ^
  "  Write-Host 'El instalador crea el acceso directo solo. Este archivo es';" ^
  "  Write-Host 'solo para reponerlo si se borra.';" ^
  "  exit 1;" ^
  "}" ^
  "" ^
  "$icono = Join-Path $repo 'app\build\icon.ico';" ^
  "$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Evaluacion Bomberos.lnk';" ^
  "$w = New-Object -ComObject WScript.Shell;" ^
  "$s = $w.CreateShortcut($lnk);" ^
  "$s.TargetPath = $destino;" ^
  "$s.WorkingDirectory = Split-Path $destino;" ^
  "$s.Description = 'Sistema de evaluacion de rendimiento - Bomberos de Espartillar';" ^
  "if (Test-Path $icono) { $s.IconLocation = $icono } else { $s.IconLocation = $destino };" ^
  "$s.Save();" ^
  "" ^
  "Write-Host '';" ^
  "Write-Host 'LISTO' -ForegroundColor Green;" ^
  "Write-Host '';" ^
  "Write-Host ('  Acceso directo:  ' + $lnk);" ^
  "Write-Host ('  Apunta a:        ' + $destino);" ^
  "Write-Host '';" ^
  "if ($destino -like '*Portable*') {" ^
  "  Write-Host 'OJO: apunta a la version PORTABLE.' -ForegroundColor Yellow;" ^
  "  Write-Host 'La portable NO se auto-actualiza: cuando publiques una version';" ^
  "  Write-Host 'nueva, esta se va a quedar donde esta. Para que se actualice';" ^
  "  Write-Host 'sola hay que instalar con el Setup.';" ^
  "}"

if errorlevel 1 (
  echo(
  pause
  exit /b 1
)

echo(
pause
