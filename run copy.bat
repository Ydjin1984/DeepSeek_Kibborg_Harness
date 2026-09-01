@echo off
setlocal EnableExtensions
chcp 65001 >nul
title DeepSeek Harness - меню управления проектом
cd /d "%~dp0"

set "tries=0"

:menu
cls
echo.
echo  ============================================
echo    DeepSeek Harness - управление проектом
echo  ============================================
echo    Директория: %CD%
echo.
echo    [1] Запустить проект    (pnpm dsh web)
echo    [2] Собрать бинарник    (pnpm run build)
echo    [3] Остановить проект   (завершить dsh web)
echo    [4] Статус проекта
echo.
echo    [0] Выход
echo.
set "choice="
set /p "choice=Выберите пункт меню и нажмите Enter: "

if "%choice%"=="1" goto :run
if "%choice%"=="2" goto :build
if "%choice%"=="3" goto :stop
if "%choice%"=="4" goto :status
if "%choice%"=="0" exit /b 0

set /a "tries+=1"
if %tries% GEQ 5 (
    echo.
    echo  Слишком много неверных вводов. Выход.
    exit /b 1
)
echo.
echo  Неверный ввод: "%choice%"
ping -n 3 127.0.0.1 >nul
goto :menu

:run
echo.
echo  Запускаю проект в отдельном окне: pnpm dsh web
start "dsh web" cmd /k "cd /d ""%~dp0"" && pnpm dsh web"
goto :menu

:build
echo.
echo  Собираю проект: pnpm run build
call pnpm run build
if errorlevel 1 (
    echo.
    echo  СБОРКА ЗАВЕРШИЛАСЬ С ОШИБКОЙ.
) else (
    echo.
    echo  Сборка успешно завершена.
)
pause
goto :menu

:stop
echo.
echo  Останавливаю проект (dsh web)...
set /p "confirm=Уверены? Проект будет остановлен (y/n): "
if /i not "%confirm%"=="y" (
    echo  Отменено.
    goto :menu
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $t = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -like '*dsh web*' -or ($_.CommandLine -match 'apps[\\/]cli[\\/]src[\\/]bin\.ts' -and $_.CommandLine -match 'web')) }; if (-not $t) { Write-Host 'Проект не запущен - останавливать нечего.' } else { $t | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Write-Host ('Остановлено процессов: ' + @($t).Count) } }"
ping -n 3 127.0.0.1 >nul
goto :menu

:status
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $t = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -like '*dsh web*' -or ($_.CommandLine -match 'apps[\\/]cli[\\/]src[\\/]bin\.ts' -and $_.CommandLine -match 'web')) }; if ($t) { Write-Host 'Проект ЗАПУЩЕН:'; $t | ForEach-Object { Write-Host ('  PID ' + $_.ProcessId + '  ' + $_.CommandLine) } } else { Write-Host 'Проект НЕ запущен.' } }"
pause
goto :menu
