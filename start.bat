@echo off
:: ==========================================
:: HMS - One-Click Launcher (Fully Portable)
:: ==========================================
:: This script auto-detects the host PC's LAN IP,
:: patches backend/.env so the project deploys to
:: that address, then starts Docker containers.
:: ==========================================

title HMS - Hospital Management System Launcher
color 0B

echo ==================================================
echo        HMS - Hospital Management System
echo ==================================================
echo.

:: ── Step 0: Detect this PC's LAN IPv4 address ──────
set "LOCAL_IP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    for /f "tokens=*" %%b in ("%%a") do (
        echo %%b | findstr /v "127.0.0" >nul 2>&1
        if not errorlevel 1 (
            if not defined LOCAL_IP set "LOCAL_IP=%%b"
        )
    )
)
:: Trim leading space
if defined LOCAL_IP for /f "tokens=*" %%x in ("%LOCAL_IP%") do set "LOCAL_IP=%%x"

if not defined LOCAL_IP (
    echo [WARN] Could not auto-detect LAN IP. Falling back to localhost.
    set "LOCAL_IP=localhost"
)

echo [INFO] Detected LAN IP: %LOCAL_IP%
echo.

:: ── Step 1: Check Docker is installed ───────────────
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed or not in PATH.
    echo         Please install Docker Desktop and try again.
    pause
    exit /b 1
)

:: ── Step 2: Check Docker Daemon is running ──────────
echo [INFO] Checking if Docker Desktop is running...
docker info >nul 2>&1
if %errorlevel% equ 0 goto docker_ready

echo [WARN] Docker is not running. Attempting to start Docker Desktop...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Could not find Docker Desktop. Please start it manually.
    pause
    exit /b 1
)

echo [WAIT] Waiting for Docker Daemon to boot (15-60 seconds)...
set /a attempts=0
:docker_wait
ping -n 4 127.0.0.1 >nul
docker info >nul 2>&1
if %errorlevel% equ 0 goto docker_ready
set /a attempts+=1
if %attempts% geq 30 (
    echo.
    echo [ERROR] Timed out waiting for Docker to start.
    pause
    exit /b 1
)
echo|set /p="."
goto docker_wait

:docker_ready
echo [SUCCESS] Docker is running.
echo.

:: ── Step 3: Setup backend/.env if missing ───────────
if not exist "%~dp0backend\.env" (
    echo [INFO] backend\.env not found. Copying from deploy\local.env...
    if exist "%~dp0deploy\local.env" (
        copy "%~dp0deploy\local.env" "%~dp0backend\.env" >nul
        echo [SUCCESS] Created backend\.env
    ) else (
        echo [ERROR] deploy\local.env template not found.
        pause
        exit /b 1
    )
)

:: ── Step 4: Patch backend/.env with detected IP ─────
echo [INFO] Patching backend\.env with detected IP: %LOCAL_IP%
powershell -NoProfile -ExecutionPolicy Bypass -Command "$envFile = '%~dp0backend\.env'; $content = Get-Content $envFile -Raw; $content = $content -replace 'FRONTEND_URL=http://[^:\s]+:(\d+)', ('FRONTEND_URL=http://' + '%LOCAL_IP%' + ':$1'); $content = $content -replace 'CORS_ORIGIN=.*', 'CORS_ORIGIN=*'; Set-Content $envFile $content -NoNewline; Write-Host '[SUCCESS] backend\.env updated'"
echo.

:: ── Step 5: Start Docker Compose ────────────────────
echo [INFO] Starting containers (Backend + Frontend)...
docker-compose -f "%~dp0docker-compose.yml" up -d --build
if %errorlevel% neq 0 (
    echo [ERROR] Failed to start containers via Docker Compose.
    pause
    exit /b 1
)
echo [SUCCESS] Containers started successfully.
echo.

:: ── Step 6: Wait for Frontend to become healthy ─────
echo [WAIT] Waiting for Frontend to become responsive...
set /a ui_attempts=0
:ui_wait
ping -n 3 127.0.0.1 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:4999' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; exit 0 } catch { exit 1 }"
if %errorlevel% equ 0 goto ui_ready
set /a ui_attempts+=1
if %ui_attempts% geq 30 (
    echo.
    echo [WARN] Frontend did not respond in time, but containers are running.
    goto show_info
)
echo|set /p="."
goto ui_wait

:ui_ready
echo.
echo [SUCCESS] Frontend is ready!
echo [LAUNCH] Opening browser...
start "" "http://%LOCAL_IP%:4999"

:show_info
echo.
echo ==================================================
echo  HMS is Live!
echo.
echo  Local URL:  http://localhost:4999
echo  LAN URL:    http://%LOCAL_IP%:4999
echo  Backend:    http://%LOCAL_IP%:5001
echo.
echo  Other devices on this network can access the
echo  dashboard by opening the LAN URL in a browser.
echo.
echo  To stop: run stop.bat or docker-compose down
echo ==================================================
echo.
pause
