# progress.ps1 - прогресс-бар для run.bat: запуск сервиса и сборка бинарника.
# Всё работает в одном окне: сервис стартует скрытым фоновым процессом,
# его вывод пишется в журнал, ошибки показываются текстом, а не красными исключениями.
# Прогресс привязан к реальным событиям, а не к случайным числам:
#   build    - сборка идёт по реальным этапам (build:lib:host -> build:lib:client -> build:web)
#              плюс запись манифеста сборки, как в конце scripts/build.ts;
#   start    - при отсутствии артефактов сначала собирает проект, затем запускает сервис
#              и ждёт реальной готовности: порт слушается (60%) -> HTTP отвечает (100%);
#   bar      - тест отрисовки прогресс-бара;
#   selftest - самопроверка: отрисовка, нормализация пути, механика процессов.

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('build', 'start', 'bar', 'selftest')]
  [string]$Command,
  [string]$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path),
  [int]$Percent = 11
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Normalize-Root([string]$Path) {
  # cmd передаёт корень с хвостовым слэшем и точкой ("%~dp0."); изредка липнет кавычка.
  $result = $Path.TrimEnd('"', '\', '/', '.')
  if ($result -eq '') { return (Get-Location).Path }
  return $result
}

$Root = Normalize-Root $Root

# --- Константы
$BarWidth = 50
$Port = 3080
$Url = "http://127.0.0.1:$Port/"
$LogDir = Join-Path $Root '.dsh-build'
$WebLog = Join-Path $LogDir 'web-run.log'
$PrevWebLog = Join-Path $LogDir 'web-run.prev.log'
$PhaseLogDir = Join-Path $LogDir 'phases'
$RecordPath = Join-Path $LogDir 'client-build-environment.json'
$IndexPath = Join-Path $Root 'apps\web\dist\index.html'
$StartTimeoutSec = 300
$HttpReadyTimeoutSec = 120

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# При перенаправленном выводе (не настоящая консоль) курсор/очистка недоступны —
# тогда просто печатаем строки.
$Interactive = -not [Console]::IsOutputRedirected

# --- Отрисовка
function New-Screen([string]$Title) {
  if (-not $Interactive) { Write-Host $Title; return }
  cls
  $w = [Math]::Min(100, [Math]::Max(40, [Console]::WindowWidth - 1))
  Write-Host $Title
  [Console]::SetCursorPosition(0, 1)
  Write-Host (' ' * $w) -NoNewline
  [Console]::SetCursorPosition(0, 2)
  Write-Host (' ' * $w) -NoNewline
  [Console]::SetCursorPosition(0, 1)
}

function Get-BarLine([double]$Percent) {
  $cells = [int][math]::Floor($Percent * $BarWidth / 100)
  if ($cells -gt $BarWidth) { $cells = $BarWidth }
  if ($cells -lt 0) { $cells = 0 }
  $pct = [int][math]::Floor($Percent)
  if ($pct -gt 100) { $pct = 100 }
  if ($pct -lt 0) { $pct = 0 }
  return ('■' * $cells) + ('-' * ($BarWidth - $cells)) + ' ' + ('{0,3}' -f $pct) + '%'
}

# Цвет бара по проценту: <25 белый, 25-49 жёлтый, 50-74 голубой, 75-99 пурпурный, 100 зелёный.
function Get-BarColor([double]$Percent) {
  if ($Percent -ge 100) { return [ConsoleColor]::Green }
  if ($Percent -ge 75) { return [ConsoleColor]::Magenta }
  if ($Percent -ge 50) { return [ConsoleColor]::Cyan }
  if ($Percent -ge 25) { return [ConsoleColor]::Yellow }
  return [ConsoleColor]::White
}

function Write-BarLine([double]$Percent) {
  $line = Get-BarLine $Percent
  if ($Interactive) {
    [Console]::SetCursorPosition(0, 1)
    Write-Host $line -NoNewline -ForegroundColor (Get-BarColor $Percent)
  } else {
    Write-Host $line
  }
}

function Write-Status([string]$Text) {
  if (-not $Interactive) { return }
  $width = [Math]::Min(100, [Math]::Max(40, [Console]::WindowWidth - 1))
  $pad = [Math]::Max(0, $width - $Text.Length)
  [Console]::SetCursorPosition(0, 2)
  Write-Host ($Text + (' ' * $pad)) -NoNewline
}

function Format-Elapsed([double]$Seconds) {
  return ('{0:F1} с' -f $Seconds)
}

# --- Проверки готовности сервера
function Test-TcpOpen {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    if (-not $task.Wait(400)) { $client.Close(); return $false }
    if ($task.IsFaulted -or $task.IsCanceled) { $client.Close(); return $false }
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Test-HttpReady {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return ($response.StatusCode -eq 200)
  } catch {
    return $false
  }
}

# --- Сборка
function Invoke-BuildPhase {
  param([string]$ScriptName, [string]$Label, [double]$From, [double]$To, [double]$Tau, [string]$LogPath)
  Write-Status ("Этап: {0}   Время: {1}" -f $Label, (Format-Elapsed 0))
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = '/c pnpm run ' + $ScriptName + ' > "' + $LogPath + '" 2>&1'
  $psi.WorkingDirectory = $Root
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $proc = [System.Diagnostics.Process]::Start($psi)
  $start = [DateTime]::UtcNow
  while (-not $proc.HasExited) {
    $elapsed = ([DateTime]::UtcNow - $start).TotalSeconds
    $f = 1 - [math]::Exp(-$elapsed / $Tau)
    $p = $From + ($To - $From) * $f
    Write-BarLine $p
    Write-Status ("Этап: {0}   Время: {1}" -f $Label, (Format-Elapsed $elapsed))
    Start-Sleep -Milliseconds 120
  }
  $proc.WaitForExit()
  $elapsed = ([DateTime]::UtcNow - $start).TotalSeconds
  if ($proc.ExitCode -ne 0) {
    Write-BarLine $From
    Write-Status ("Этап «{0}» завершился с ошибкой (код {1})" -f $Label, $proc.ExitCode)
    Write-Host ''
    Write-Host 'Журнал этапа (последние строки):'
    if (Test-Path -LiteralPath $LogPath) {
      Get-Content -LiteralPath $LogPath -Tail 40 -Encoding UTF8 | ForEach-Object { Write-Host $_ }
    }
    exit 1
  }
  Write-BarLine $To
  Write-Status ("Этап: {0} — готово   Время: {1}" -f $Label, (Format-Elapsed $elapsed))
}

function Invoke-BuildPhases {
  # Хеш коммита: тот же механизм, что в scripts/build.ts (DSH_CLIENT_COMMIT_HASH).
  # Без Select-Object -First 1: он убивает нативный процесс и портит $LASTEXITCODE.
  $hash = (& git rev-parse HEAD 2>$null) -join ''
  if ($LASTEXITCODE -ne 0 -or $hash -notmatch '^[0-9a-f]{7,40}$') {
    Write-Host ''
    Write-Host 'ОШИБКА: не удалось получить хеш коммита (git rev-parse HEAD). Сборка невозможна.' -ForegroundColor Red
    exit 1
  }
  $env:DSH_CLIENT_COMMIT_HASH = $hash.Trim().Substring(0, 7).ToLower()
  New-Item -ItemType Directory -Force -Path $PhaseLogDir | Out-Null
  $totalStart = [DateTime]::UtcNow

  Invoke-BuildPhase 'build:lib:host' '1/3: host-пакеты (tsc + tsdown)' 0 38 15 (Join-Path $PhaseLogDir 'lib-host.log')
  Invoke-BuildPhase 'build:lib:client' '2/3: client-пакеты (tsc + tsdown)' 38 74 12 (Join-Path $PhaseLogDir 'lib-client.log')
  Invoke-BuildPhase 'build:web' '3/3: web-фронтенд (vite)' 74 100 5 (Join-Path $PhaseLogDir 'web.log')

  # Манифест сборки: те же шаги, что в конце scripts/build.ts.
  Write-Status 'Запись манифеста сборки...'
  $recordJs = @'
import { writeClientBuildRecord, repositoryCommitHash } from './scripts/client-build-environment.ts'
const root = process.cwd()
const env = { DSH_CLIENT_COMMIT_HASH: repositoryCommitHash(root, process.env) }
writeClientBuildRecord(root, env)
'@
  & node --input-type=module --import tsx/esm -e $recordJs 2>&1 | Out-File -FilePath (Join-Path $PhaseLogDir 'record.log') -Encoding UTF8
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'ОШИБКА: не удалось записать манифест сборки.' -ForegroundColor Red
    Get-Content -LiteralPath (Join-Path $PhaseLogDir 'record.log') -Tail 20 -Encoding UTF8 | ForEach-Object { Write-Host $_ }
    exit 1
  }
  $total = ([DateTime]::UtcNow - $totalStart).TotalSeconds
  Write-BarLine 100
  Write-Status ('Готово за {0}' -f (Format-Elapsed $total))
  Write-Host ''
  Write-Host ('Сборка завершена за {0}.' -f (Format-Elapsed $total)) -ForegroundColor Green
  Write-Host 'Артефакты: apps/web/dist (web-клиент), packages/*/lib (пакеты).'
}

# --- Запуск сервиса (в одном окне: фоновый процесс, вывод в журнал, без отдельного терминала)
function Start-WebServer {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  # Ротация журнала: журнал предыдущего запуска (в т.ч. след падения) сохраняется
  # в $PrevWebLog, иначе оператор ">" в запуске затирает его при каждом старте.
  if (Test-Path -LiteralPath $WebLog) {
    Remove-Item -LiteralPath $PrevWebLog -Force -ErrorAction SilentlyContinue
    Rename-Item -LiteralPath $WebLog -NewName (Split-Path -Leaf $PrevWebLog) -Force -ErrorAction SilentlyContinue
  }
  # Прямой node без pnpm-обёрток и без пайплайнов PowerShell:
  # вывод сервиса идёт в журнал на уровне ОС, ошибки не превращаются в исключения.
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = '/c node --import tsx/esm apps/cli/src/bin.ts web > "' + $WebLog + '" 2>&1'
  $psi.WorkingDirectory = $Root
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  return [System.Diagnostics.Process]::Start($psi)
}

function Show-WebLogTail {
  Write-Host 'Журнал сервера (последние строки):'
  if (Test-Path -LiteralPath $WebLog) {
    Get-Content -LiteralPath $WebLog -Tail 30 -Encoding UTF8 | ForEach-Object { Write-Host $_ }
  } else {
    Write-Host '(журнал пуст)'
  }
  Write-Host ("Полный журнал: {0}" -f $WebLog)
}

function Invoke-Start {
  New-Screen 'Загрузка DeepSeek_Kibborg_Harness'

  # 1. Продакшн-раннер dsh web требует собранные артефакты.
  $needsBuild = (-not (Test-Path -LiteralPath $RecordPath)) -or (-not (Test-Path -LiteralPath $IndexPath))
  if ($needsBuild) {
    Write-Host ''
    Write-Host 'Артефакты не найдены — выполняю сборку проекта...' -ForegroundColor Yellow
    Invoke-BuildPhases
    Write-Status 'Сборка готова — запускаю сервер...'
  }

  # 2. Сервис уже отвечает?
  if (Test-HttpReady) {
    Write-BarLine 100
    Write-Status 'Сервис уже запущен'
    Write-Host ''
    Write-Host ("Сервис уже работает: {0}" -f $Url) -ForegroundColor Green
    return
  }

  # 3. Порт уже слушается (сервис поднимается) — второй экземпляр не запускаем.
  $bound = Test-TcpOpen
  $boundAt = $null
  if ($bound) { $boundAt = Get-Date }
  $serverProc = $null
  if (-not $bound) {
    $serverProc = Start-WebServer
  }

  # 4. Ожидание реальной готовности: порт (60%) -> HTTP 200 (100%).
  $bootStart = [DateTime]::UtcNow
  $deadline = (Get-Date).AddSeconds($StartTimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if ($serverProc -ne $null -and $serverProc.HasExited) {
      Write-Host ''
      Write-Host 'ОШИБКА: сервер завершился до готовности.' -ForegroundColor Red
      Show-WebLogTail
      exit 1
    }
    if ($bound) {
      if (Test-HttpReady) { break }
      if ((Get-Date) -gt $boundAt.AddSeconds($HttpReadyTimeoutSec)) {
        Write-Host ''
        Write-Host 'ОШИБКА: порт занят, но сервер не отвечает по HTTP.' -ForegroundColor Red
        Show-WebLogTail
        exit 1
      }
      $elapsed = ([DateTime]::UtcNow - $bootStart).TotalSeconds
      $f = 1 - [math]::Exp(-$elapsed / 8)
      Write-BarLine (60 + 40 * $f)
      Write-Status ("Сервер отвечает — инициализация...   Время: {0}" -f (Format-Elapsed $elapsed))
    } else {
      if (Test-TcpOpen) {
        $bound = $true
        $boundAt = Get-Date
        $elapsed = ([DateTime]::UtcNow - $bootStart).TotalSeconds
        Write-BarLine 60
        Write-Status ("Сервер начал слушать порт {0}   Время: {1}" -f $Port, (Format-Elapsed $elapsed))
        Start-Sleep -Milliseconds 150
        continue
      }
      $elapsed = ([DateTime]::UtcNow - $bootStart).TotalSeconds
      $f = 1 - [math]::Exp(-$elapsed / 6)
      Write-BarLine (60 * $f)
      Write-Status ("Запуск сервера...   Время: {0}" -f (Format-Elapsed $elapsed))
    }
    Start-Sleep -Milliseconds 150
  }

  if (-not (Test-HttpReady)) {
    Write-Host ''
    Write-Host ("ОШИБКА: таймаут ожидания сервера ({0} с)." -f $StartTimeoutSec) -ForegroundColor Red
    Show-WebLogTail
    exit 1
  }

  $total = ([DateTime]::UtcNow - $bootStart).TotalSeconds
  Write-BarLine 100
  Write-Status 'Сервис готов'
  Write-Host ''
  Write-Host ("Сервис готов за {0} — {1}" -f (Format-Elapsed $total), $Url) -ForegroundColor Green
  Write-Host 'Сервис работает в фоне; журнал: .dsh-build\web-run.log' -ForegroundColor DarkGray
  if (Test-Path -LiteralPath $PrevWebLog) {
    Write-Host 'Журнал предыдущего запуска: .dsh-build\web-run.prev.log' -ForegroundColor DarkGray
  }
}

# --- Диспетчер команд
switch ($Command) {
  'build' {
    New-Screen 'Сборка DeepSeek_Kibborg_Harness'
    Invoke-BuildPhases
    exit 0
  }
  'start' {
    Invoke-Start
    exit 0
  }
  'bar' {
    New-Screen 'Загрузка DeepSeek_Kibborg_Harness'
    Write-BarLine $Percent
    Write-Status ("Статичный тест отрисовки ({0}%)" -f $Percent)
    Write-Host ''
    Write-Host ('Тест: прогресс-бар при {0}%.' -f $Percent)
    exit 0
  }
  'selftest' {
    $fails = 0
    $total = 0
    function Assert([bool]$Cond, [string]$Name) {
      $script:total++
      if ($Cond) { Write-Host ('  [OK]   ' + $Name) -ForegroundColor Green } else { Write-Host ('  [FAIL] ' + $Name) -ForegroundColor Red; $script:fails++ }
    }
    Write-Host 'Самопроверка progress.ps1'
    Write-Host ''
    Write-Host 'Отрисовка прогресс-бара (50 ячеек):'
    Assert ((Get-BarLine 0) -eq (('-' * 50) + '   0%')) '0% — пустой бар'
    Assert ((Get-BarLine 11) -eq (('■' * 5) + ('-' * 45) + '  11%')) '11% — 5 блоков (как в примере)'
    Assert ((Get-BarLine 50) -eq (('■' * 25) + ('-' * 25) + '  50%')) '50% — 25 блоков'
    Assert ((Get-BarLine 100) -eq (('■' * 50) + ' 100%')) '100% — полный бар'
    Write-Host 'Цвета прогресс-бара:'
    Assert ((Get-BarColor 0) -eq [ConsoleColor]::White) '<25% — белый'
    Assert ((Get-BarColor 24) -eq [ConsoleColor]::White) '24% — белый'
    Assert ((Get-BarColor 25) -eq [ConsoleColor]::Yellow) '25% — жёлтый'
    Assert ((Get-BarColor 49) -eq [ConsoleColor]::Yellow) '49% — жёлтый'
    Assert ((Get-BarColor 50) -eq [ConsoleColor]::Cyan) '50% — голубой'
    Assert ((Get-BarColor 74) -eq [ConsoleColor]::Cyan) '74% — голубой'
    Assert ((Get-BarColor 75) -eq [ConsoleColor]::Magenta) '75% — пурпурный'
    Assert ((Get-BarColor 99) -eq [ConsoleColor]::Magenta) '99% — пурпурный'
    Assert ((Get-BarColor 100) -eq [ConsoleColor]::Green) '100% — зелёный'
    Write-Host 'Нормализация корневого пути:'
    Assert ((Normalize-Root 'D:\Deepseec_DaVinchi\.') -eq 'D:\Deepseec_DaVinchi') 'хвостовые \ и . убираются'
    Assert ((Normalize-Root 'D:\Deepseec_DaVinchi\"') -eq 'D:\Deepseec_DaVinchi') 'липшая кавычка убирается'
    Assert ((Normalize-Root 'D:\Deepseec_DaVinchi') -eq 'D:\Deepseec_DaVinchi') 'обычный путь не меняется'
    Write-Host 'Механика ожидания процессов:'
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'cmd.exe'
    $psi.Arguments = '/c exit 7'
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.WaitForExit()
    Assert ($proc.HasExited -and $proc.ExitCode -eq 7) 'обнаружение завершения процесса и код выхода'
    Write-Host ''
    if ($fails -eq 0) {
      Write-Host ("САМОПРОВЕРКА ПРОЙДЕНА: {0}/{0} проверок." -f $total) -ForegroundColor Green
      exit 0
    } else {
      Write-Host ("САМОПРОВЕРКА ПРОВАЛЕНА: {0} из {1}." -f $fails, $total) -ForegroundColor Red
      exit 1
    }
  }
}
