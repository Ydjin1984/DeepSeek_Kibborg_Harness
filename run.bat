@echo off
setlocal EnableExtensions
chcp 65001 >nul
title DeepSeek_Kibborg_Harness - меню управления проектом
cd /d "%~dp0"

REM Автозапуск Tor (onion-прокси, SOCKS5 127.0.0.1:9050) вместе с сервером. Идемпотентно: если уже запущен - пропустит.
call "%USERPROFILE%\.dsh\tor\start-tor.cmd"

where pnpm >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ОШИБКА: pnpm не найден в PATH.
    echo  Установите Node.js с corepack и убедитесь, что pnpm доступен.
    pause
    exit /b 1
)

REM Windows PowerShell 5.1 читает .ps1 без BOM как ANSI: кириллица рассыпается
REM и скрипт не парсится. Проверяем BOM у вспомогательных скриптов при каждом старте.
call :ensure_utf8_sources

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
echo    [9] Живые логи сервера   (real-time, Esc или Q - выход)
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
if "%choice%"=="9" goto :logs
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

:logs
echo.
echo  Живые логи сервера (Esc или Q — вернуться в меню)...
call powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0watch-logs.ps1" -Root "%~dp0."
echo.
goto :menu

:detect
set "dsh_pids="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -like '*dsh web*' -or ($_.CommandLine -match 'apps[\\/]cli[\\/]src[\\/]bin\.ts' -and $_.CommandLine -match 'web')) }; if ($t) { ($t | ForEach-Object { $_.ProcessId }) -join ',' }"`) do set "dsh_pids=%%i"
exit /b 0

:kill_all
call :kill_supervisor
call :detect
if "%dsh_pids%"=="" (
    echo  Проект не запущен - останавливать нечего.
) else (
    echo  Останавливаю PID: %dsh_pids% ...
    for %%P in (%dsh_pids%) do (
        taskkill /PID %%P /T /F >nul 2>&1
    )
    echo  Готово: процесс и его дочерние MCP-серверы остановлены.
)
ping -n 2 127.0.0.1 >nul
exit /b 0

:kill_supervisor
rem Супервизор (server-supervisor.ps1) держит сервер живым и перезапустил бы его
rem сразу после остановки, поэтому его останавливаем ПЕРВЫМ. Порядок важен:
rem сперва просим выйти файлом-стопом (супервизор сам убивает своё дерево
rem процессов через taskkill /T /F), и только если он не вышел за 3 секунды -
rem убиваем процесс супервизора. Текст сообщений на латинице не случаен:
rem powershell -Command из bat-файла портит кириллицу в аргументе.
set "sup_pids="
rem Из результата исключаем сам вспомогательный powershell и его родителя: строка
rem детектора содержит "server-supervisor" и иначе совпадает сама с собой.
rem Хост супервизора бывает любым: powershell 5.1 при штатном запуске из меню и
rem pwsh 7 при запуске из другого терминала, поэтому перебираем оба имени - иначе
rem запущенный на pwsh супервизор не находится и перезапускает остановленный сервер.
for /f "usebackq delims=" %%p in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$me = $PID; $parent = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $me) -ErrorAction SilentlyContinue).ParentProcessId; $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'powershell.exe' -or $_.Name -eq 'pwsh.exe' }); $p = @($all | Where-Object { $_.CommandLine -match 'server-supervisor' -and $_.ProcessId -ne $me -and $_.ProcessId -ne $parent }); if ($p) { ($p | ForEach-Object { $_.ProcessId }) -join ',' }"`) do set "sup_pids=%%p"
if "%sup_pids%"=="" (
    exit /b 0
)
echo  Stopping server supervisor: PID %sup_pids% ...
echo. > "%~dp0.dsh-build\supervisor.stop"
ping -n 4 127.0.0.1 >nul
for %%p in (%sup_pids%) do (
    taskkill /PID %%p /T /F >nul 2>&1
)
rem Файл-стоп мог остаться после убийства супервизора: свежей сессии он не помешает
rem (супервизор снимает его при старте), но чистим за собой сразу.
del /q "%~dp0.dsh-build\supervisor.stop" >nul 2>&1
ping -n 2 127.0.0.1 >nul
exit /b 0

:ensure_utf8_sources
rem Список не перечисляем поимённо: новый .ps1 в корне (например server-supervisor.ps1)
rem иначе остался бы без BOM, а кириллица ВНУТРИ строковых литералов в этом случае
rem рассыпается и скрипт не парсится.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$changed = @(); foreach ($f in @(Get-ChildItem -LiteralPath '%~dp0' -Filter '*.ps1' -File -ErrorAction SilentlyContinue)) { $b = [IO.File]::ReadAllBytes($f.FullName); if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { continue }; [IO.File]::WriteAllBytes($f.FullName, [byte[]](@(0xEF,0xBB,0xBF) + $b)); $changed += $f.Name }; if ($changed.Count -gt 0) { Write-Host ('Восстановлена кодировка UTF-8 BOM: ' + ($changed -join ', ')) -ForegroundColor Yellow }"
exit /b 0

:msg_green
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '%~1' -ForegroundColor Green"
exit /b 0

:msg_red
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '%~1' -ForegroundColor Red"
exit /b 0
