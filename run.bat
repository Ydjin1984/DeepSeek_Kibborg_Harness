@echo off
setlocal EnableExtensions
chcp 65001 >nul
title DeepSeek Harness - меню управления проектом
cd /d "%~dp0"

where pnpm >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ОШИБКА: pnpm не найден в PATH.
    echo  Установите Node.js с corepack и убедитесь, что pnpm доступен.
    pause
    exit /b 1
)

set "tries=0"

:menu
cls
echo.
echo  ============================================
echo    DaVinchi Harness - управление проектом
echo  ============================================
echo    Директория: %CD%
echo.
echo    [1] Запустить проект    (индикатор загрузки)
echo    [2] Собрать бинарник    (индикатор прогресса)
echo    [3] Остановить проект   (завершить dsh web)
echo    [4] Статус проекта      (Показывает статус проекта и PID процесса)
echo    [5] Открыть браузер     (http://127.0.0.1:3080)
echo    [6] Перезапустить       (стоп + запуск)
echo    [7] Самопроверка         (тесты progress.ps1)
echo    [8] Обновить граф знаний  (graphify update packages)
echo.
echo    [0] Выход
echo.
set "choice="
set /p "choice=Выберите пункт меню и нажмите Enter: "

if "%choice%"=="1" goto :run
if "%choice%"=="2" goto :build
if "%choice%"=="3" goto :stop
if "%choice%"=="4" goto :status
if "%choice%"=="5" goto :browser
if "%choice%"=="6" goto :restart
if "%choice%"=="7" goto :selftest
if "%choice%"=="8" goto :graphify
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
echo  Запускаю проект: pnpm dsh web
call powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0progress.ps1" -Command start -Root "%~dp0."
echo.
if errorlevel 1 (
    call :msg_red "Сервис не запустился. Смотрите сообщение выше и журнал .dsh-build\web-run.log"
)
pause
goto :menu

:build
echo.
echo  Собираю проект: pnpm run build
call powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0progress.ps1" -Command build -Root "%~dp0."
echo.
if errorlevel 1 (
    call :msg_red "СБОРКА ЗАВЕРШИЛАСЬ С ОШИБКОЙ."
) else (
    call :msg_green "Сборка успешно завершена."
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
call :kill_all
ping -n 3 127.0.0.1 >nul
goto :menu

:restart
echo.
echo  Перезапускаю проект: остановка, затем запуск...
call :kill_all
goto :run

:status
echo.
call :detect
if "%dsh_pids%"=="" (
    echo  Проект НЕ запущен.
) else (
    echo  Проект ЗАПУЩЕН, PID: %dsh_pids%
)
pause
goto :menu

:selftest
echo.
call powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0progress.ps1" -Command selftest -Root "%~dp0."
echo.
if errorlevel 1 (
    call :msg_red "САМОПРОВЕРКА ПРОВАЛЕНА."
) else (
    call :msg_green "Самопроверка пройдена."
)
pause
goto :menu

:graphify
echo.
echo  Обновляю граф знаний: graphify update packages (в graphify-out\)
cd /d "%~dp0"
where graphify >nul 2>&1
if errorlevel 1 (
    call :msg_red "graphify не найден в PATH. Установите: uv tool install graphifyy"
    pause
    goto :menu
)
rem graphify update пишет граф рядом с входным путём (packages\graphify-out),
rem что ломает сборку tsdown; GRAPHIFY_OUT перенаправляет вывод в корневой graphify-out\.
set "GRAPHIFY_OUT=%~dp0graphify-out"
graphify update packages
echo.
if errorlevel 1 (
    call :msg_red "Обновление графа завершилось с ошибкой. Смотрите вывод выше."
) else (
    call :msg_green "Граф знаний обновлён: graphify-out\graph.json"
)
pause
goto :menu

:browser
echo.
echo  Открываю браузер: http://127.0.0.1:3080
start "" "http://127.0.0.1:3080"
goto :menu

:detect
set "dsh_pids="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -like '*dsh web*' -or ($_.CommandLine -match 'apps[\\/]cli[\\/]src[\\/]bin\.ts' -and $_.CommandLine -match 'web')) }; if ($t) { ($t | ForEach-Object { $_.ProcessId }) -join ',' }"`) do set "dsh_pids=%%i"
exit /b 0

:kill_all
call :detect
if "%dsh_pids%"=="" (
    echo  Проект не запущен - останавливать нечего.
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $ids = '%dsh_pids%' -split ','; $ids | ForEach-Object { Stop-Process -Id ([int]$_) -Force -ErrorAction SilentlyContinue }; Write-Host ('Остановлено процессов: ' + @($ids).Count) }"
)
ping -n 2 127.0.0.1 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { Start-Sleep -Milliseconds 800; Get-Process cmd,powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'dsh web' } | Stop-Process -Force -ErrorAction SilentlyContinue }"
exit /b 0

:msg_green
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '%~1' -ForegroundColor Green"
exit /b 0

:msg_red
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '%~1' -ForegroundColor Red"
exit /b 0
