@echo off
:: ==========================================
:: HMS - One-Click Stopper
:: ==========================================

title HMS - Stopping Hospital Management System
color 0E

echo ==================================================
echo        HMS - Winding Down
echo ==================================================
echo.

:: Check Docker is available
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed or not in PATH.
    pause
    exit /b 1
)

:: Check Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker Desktop is not running. Nothing to stop.
    pause
    exit /b 1
)

:: Stop containers
echo [INFO] Stopping and removing containers...
docker-compose -f "%~dp0docker-compose.yml" down
if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] Containers stopped and network removed.
    echo          (Your database volume remains intact)
) else (
    echo.
    echo [ERROR] Docker Compose encountered an error while stopping.
)

echo.
echo ==================================================
echo  HMS is safely shut down.
echo ==================================================
echo.
pause
