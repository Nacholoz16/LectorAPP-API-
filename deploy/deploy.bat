@echo off
setlocal EnableExtensions
REM ============================================================================
REM  Deploy de Lectorapp API a produccion.
REM
REM  Uso:
REM    deploy\deploy.bat            -> despliega origin/main (lo ultimo subido a GitHub)
REM    deploy\deploy.bat <commit>   -> despliega ese commit (sirve para ROLLBACK)
REM
REM  Requisitos: PuTTY (plink.exe) y la llave .ppk del servidor.
REM  La ruta de la llave se puede cambiar con la variable de entorno LECTORAPP_SSH_KEY.
REM ============================================================================

set "SERVER=ubuntu@155.181.180.178"
set "REMOTE_API_DIR=/home/ubuntu/[LECTORAPP]/api"
if defined LECTORAPP_SSH_KEY (set "KEY=%LECTORAPP_SSH_KEY%") else (set "KEY=%USERPROFILE%\Downloads\LLAVE SERVER 129.151.98.217.ppk")

set "REF=%~1"
if "%REF%"=="" set "REF=origin/main"

REM --- Comprobaciones -----------------------------------------------------------
set "PLINK=plink.exe"
where plink.exe >nul 2>&1 || set "PLINK=C:\Program Files\PuTTY\plink.exe"
if not exist "%PLINK%" if not "%PLINK%"=="plink.exe" (
    echo [ERROR] No se encontro plink.exe. Instala PuTTY: https://www.putty.org/
    goto :fail
)
if not exist "%KEY%" (
    echo [ERROR] No se encontro la llave SSH: "%KEY%"
    echo         Define LECTORAPP_SSH_KEY con la ruta correcta.
    goto :fail
)

REM Advertir si hay commits locales en main que no estan en GitHub (el servidor descarga de GitHub).
pushd "%~dp0.."
git fetch origin --quiet 2>nul
for /f %%c in ('git rev-list --count origin/main..main 2^>nul') do set "UNPUSHED=%%c"
popd
if defined UNPUSHED if not "%UNPUSHED%"=="0" (
    echo [AVISO] Tu rama main local tiene %UNPUSHED% commit^(s^) sin subir a GitHub.
    echo         El servidor despliega lo que esta en GitHub. Haz "git push origin main" primero.
    choice /m "Continuar de todos modos"
    if errorlevel 2 goto :fail
)

echo.
echo === Desplegando "%REF%" en %SERVER% ===
echo.
"%PLINK%" -batch -ssh -i "%KEY%" %SERVER% "cd '%REMOTE_API_DIR%' && git fetch --prune --quiet origin && git checkout --quiet --detach %REF% && bash deploy/remote-deploy.sh"
if errorlevel 1 goto :fail

echo.
echo === Deploy terminado correctamente ===
echo Verificacion: https://api.nacholoz3d.cl/api/health
pause
exit /b 0

:fail
echo.
echo === El deploy FALLO. Revisa los mensajes de arriba. ===
echo Para volver a la version anterior: deploy\deploy.bat ^<commit-anterior^>
pause
exit /b 1
