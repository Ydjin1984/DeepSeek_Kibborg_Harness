# server-supervisor.ps1 - наблюдатель за процессом сервера dsh web.
# Отвечает за то, чего не делает progress.ps1: progress.ps1 запускает сервер и
# сразу завершается (exit 0), поэтому после падения сервера GUI пропадает и
# поднять его некому. Этот скрипт держит сервер живым:
#   1) запускает сервер той же командной строкой, что Start-WebServer в progress.ps1
#      (--max-old-space-size, вывод в .dsh-build\web-run.log, маркер выхода);
#   2) каждые -PollSeconds снимает WorkingSet64/PrivateMemorySize64 процесса и
#      пишет строку в .dsh-build\server-supervisor.log (ротация по размеру);
#   3) предупреждает, когда память подходит к лимиту heap (-MemoryWarnMb);
#   4) при завершении процесса пишет код выхода и ВРЕМЯ падения (а не время
#      запуска, как это делал маркер %DATE%/%TIME% в cmd) и перезапускает сервер
#      с backoff, пока не исчерпан бюджет перезапусков;
#   5) корректно останавливается по Ctrl+C и по файлу-стопу, убивая дочернее
#      дерево процессов через taskkill /T /F.
#
# Запуск (из корня проекта):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\server-supervisor.ps1
# или через progress.ps1:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\progress.ps1 -Command supervise -Root .
#
# Остановка: Ctrl+C в окне супервизора либо создать файл-стоп
#   New-Item -ItemType File -Force .dsh-build\supervisor.stop

param(
  [string]$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path),
  [int]$Port = 3080,
  [int]$MemoryWarnMb = 39321,
  [int]$MaxRestarts = 5,
  [int]$RestartWindowMinutes = 10,
  [int]$PollSeconds = 5,
  [string]$LogPath = '',
  [string]$WebLogPath = '',
  [string]$StopFile = '',
  [string]$ServerCommand = '',
  [int]$HeapLimitMb = 65536,
  [int]$LogRotateMb = 5,
  [int]$LogKeepPrev = 5
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

function Normalize-Root([string]$Path) {
  # cmd передаёт корень с хвостовым слэшем и точкой ("%~dp0."); изредка липнет кавычка.
  $result = $Path.TrimEnd('"', '\', '/', '.')
  if ($result -eq '') { return (Get-Location).Path }
  return $result
}

$Root = Normalize-Root $Root
$LogDir = Join-Path $Root '.dsh-build'

# Каталоги и журналы создаются до первого обращения: супервизор может стартовать
# раньше, чем что-либо положило в .dsh-build.
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
if ([string]::IsNullOrWhiteSpace($LogPath)) { $LogPath = Join-Path $LogDir 'server-supervisor.log' }
if ([string]::IsNullOrWhiteSpace($WebLogPath)) { $WebLogPath = Join-Path $LogDir 'web-run.log' }
$WebLog = $WebLogPath
if ([string]::IsNullOrWhiteSpace($StopFile)) { $StopFile = Join-Path $LogDir 'supervisor.stop' }

# Командная строка сервера: то же ядро, что в Start-WebServer (progress.ps1), но
# время падения маркера считается в PowerShell (см. Write-ExitMarker) - %DATE%/%TIME%
# в cmd раскрываются при разборе строки, то есть ДО старта node, и показывали время
# запуска, а не падения.
$customCommand = -not [string]::IsNullOrWhiteSpace($ServerCommand)
if (-not $customCommand) {
  $ServerCommand = 'node --max-old-space-size=' + $HeapLimitMb + ' --import tsx/esm apps/cli/src/bin.ts web'
}

# Каскад задержек перезапуска (секунды) и бюджет перезапусков за окно.
$BackoffSeconds = @(5, 15, 30, 60)

function Write-Log([string]$Message) {
  $line = '[supervisor] ' + (Get-Date).ToString('s') + ' ' + $Message
  try {
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  } catch {
    # Журнал супервизора - единственный источник сведений о падениях: если запись
    # невозможна (файл занят, диск, права), сообщаем в консоль, но продолжаем
    # наблюдение - падение внутри логирования не должно убивать супервизор.
    $line = $line + ' (log write failed: ' + $_.Exception.Message + ')'
  }
  Write-Host $line
}

function Invoke-LogRotation {
  # Ротация по размеру: журнал переименовывается в server-supervisor.prev-<штамп>.log
  # (prev.log был бы перезаписан следующим падением и потерял бы след предыдущего).
  $item = Get-Item -LiteralPath $LogPath -ErrorAction SilentlyContinue
  if ($null -eq $item -or $item.Length -lt ($LogRotateMb * 1MB)) { return }
  $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
  $archive = Join-Path (Split-Path -Parent $LogPath) ('server-supervisor.prev-' + $stamp + '.log')
  try { Move-Item -LiteralPath $LogPath -Destination $archive -Force } catch { return }
  Write-Log ('log rotated -> ' + (Split-Path -Leaf $archive))
  # Держим не более $LogKeepPrev архивов: лишние удаляем от самых старых.
  $archives = @(Get-ChildItem -LiteralPath (Split-Path -Parent $LogPath) -Filter 'server-supervisor.prev-*.log' -ErrorAction SilentlyContinue |
    Sort-Object -Property Name)
  if ($archives.Count -gt $LogKeepPrev) {
    for ($i = 0; $i -lt ($archives.Count - $LogKeepPrev); $i++) {
      Remove-Item -LiteralPath $archives[$i].FullName -Force -ErrorAction SilentlyContinue
    }
  }
}

function Get-ListenPids([int]$PortNumber) {
  # Кто слушает порт: команды Get-NetTCPConnection может не быть на старых системах,
  # поэтому netstat с разбором строк - устойчивее.
  $pids = @()
  try {
    $lines = @(netstat -ano -p TCP 2>$null)
    foreach ($line in $lines) {
      if ($line -match ('^\s+TCP\s+\S+:' + $PortNumber + '\s+\S+\s+LISTENING\s+(\d+)\s*$')) {
        $found = [int]$Matches[1]
        if (-not ($pids -contains $found)) { $pids += $found }
      }
    }
  } catch {
    # netstat недоступен: считаем порт свободным, решение остаётся за сервером.
  }
  return $pids
}

function Get-ServerProcess {
  # Ищем уже работающий сервер проекта: node с apps/cli/src/bin.ts и web в строке.
  try {
    $found = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
      Where-Object { $_.CommandLine -match 'apps[\\/]cli[\\/]src[\\/]bin\.ts' -and $_.CommandLine -match 'web' })
    return $found
  } catch {
    return @()
  }
}

function Start-ServerProcess {
  # Запуск через скрипт-обёртку в .dsh-build: перенаправление вывода и код выхода
  # сервера заданы внутри скрипта, поэтому не зависят от того, как cmd разберёт
  # кавычки и разделители & в аргументе (inline-вариант ломался: команда в
  # кавычках давала ParserError, а echo сбрасывал errorlevel до 0).
  # Обёртка также держит строку процесса "cmd" с явным путём .dsh-build - момент
  # появления дерева видно снаружи по файлу обёртки.
  $scriptPath = Write-ExitCodeScript
  return Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c "' + $scriptPath + '"') -WorkingDirectory $Root -WindowStyle Hidden -PassThru
}

function Write-ExitMarker([int]$Code, [DateTime]$Stopped) {
  # Точное время падения: считается здесь, а не в cmd-маркере, где %TIME%
  # раскрывается при разборе командной строки (до старта node) и показывало время
  # запуска. Формат 's' - тот же, что у строк журнала супервизора.
  # Журнал может быть занят другим процессом (например, в него пишет уже
  # работающий сервер) - тогда маркер уходит в журнал супервизора, а не теряется
  # вместе с падением наблюдателя.
  $line = '[server] exited with code ' + $Code + ' at ' + $Stopped.ToString('s')
  try {
    Add-Content -LiteralPath $WebLog -Value $line -Encoding UTF8
  } catch {
    try {
      Add-Content -LiteralPath $LogPath -Value ('[supervisor] ' + (Get-Date).ToString('s') + ' exit marker not written to ' + (Split-Path -Leaf $WebLog) + ': ' + $line) -Encoding UTF8
    } catch {
      Write-Host ('[supervisor] ' + $line)
    }
  }
}

function Write-ExitCodeScript {
  # Скрипт-заглушка вместо inline-команды: перенаправление сервера задано внутри
  # скрипта, поэтому не зависит от того, как cmd разберёт кавычки в аргументе.
  # Файл создаётся в .dsh-build и удаляется в finally.
  $path = Join-Path $LogDir 'supervisor-launch.cmd'
  $lines = @(
    '@echo off',
    '# Обёртка запуска сервера: создаётся супервизором, содержит только эту команду.',
    ('> "' + $WebLog + '" 2>&1 ' + $ServerCommand),
    'set exit_code=%errorlevel%',
    ('>> "' + $WebLog + '" echo.'),
    ('>> "' + $WebLog + '" echo [server] exited with code %exit_code% at %DATE% %TIME%'),
    'exit /b %exit_code%'
  )
  Set-Content -LiteralPath $path -Value $lines -Encoding ASCII
  return $path
}

function Remove-ExitCodeScript {
  # Вспомогательный скрипт не нужен после остановки: следующий запуск создаст его
  # заново. Неудача удаления не критична - файл будет перезаписан.
  $path = Join-Path $LogDir 'supervisor-launch.cmd'
  Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
}

function Get-MemoryInfo($Process) {
  # Рабочий набор и приватная память процесса. Свойства читаются статическим
  # вызовом с typeof: в ConstrainedLanguage-режиме обращение к свойствам .NET
  # объектов может быть запрещено, а статический вызов разрешён.
  # Измеряется не cmd-обёртка запуска (её рабочий набор - единицы мегабайт и о
  # сервере не говорит ничего), а самый тяжёлый node.exe в дереве потомков.
  $ws = -1
  $private = -1
  $alive = $false
  $targetPid = -1
  if ($null -eq $Process) { return @{ WsMb = $ws; PrivateMb = $private; Alive = $alive; TargetPid = $targetPid } }
  try {
    $targetPid = Get-ServerProcessId $Process
    $proc = [System.Diagnostics.Process]::GetProcessById($targetPid)
    $proc.Refresh()
    $ws = [int][Math]::Round($proc.WorkingSet64 / 1MB)
    $private = [int][Math]::Round($proc.PrivateMemorySize64 / 1MB)
    $alive = -not $proc.HasExited
  } catch {
    # Процесс уже завершился - метрики недоступны, это штатный случай при выходе.
    $alive = $false
  }
  return @{ WsMb = $ws; PrivateMb = $private; Alive = $alive; TargetPid = $targetPid }
}

function Get-DescendantProcesses([int]$RootPid) {
  # Потомки по CIM: сервер запускается как cmd.exe -> node.exe (-> MCP-серверы),
  # поэтому без обхода дерева память самого сервера не видна.
  $found = @()
  $frontier = @($RootPid)
  while ($frontier.Count -gt 0) {
    $next = @()
    foreach ($parentPid in $frontier) {
      $children = @(Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $parentPid) -ErrorAction SilentlyContinue)
      foreach ($child in $children) {
        $found += $child
        $next += [int]$child.ProcessId
      }
    }
    $frontier = $next
  }
  return $found
}

function Get-ServerProcessId($Process) {
  # Самый тяжёлый node.exe в дереве - это и есть сервер; когда его ещё нет
  # (сервер стартует либо упал), измеряется сам процесс запуска.
  $candidates = @(Get-DescendantProcesses $Process.Id | Where-Object { $_.Name -eq 'node.exe' })
  if ($candidates.Count -eq 0) { return $Process.Id }
  return [int]($candidates | Sort-Object WorkingSetSize -Descending | Select-Object -First 1).ProcessId
}

function Stop-ChildProcess($Process) {
  # taskkill /T /F обязателен: кроме node сервер поднимает MCP-серверы, и без /T
  # они остаются висеть после остановки супервизора.
  if ($null -eq $Process) { return }
  try {
    if (-not $Process.HasExited) {
      $null = & taskkill /PID $Process.Id /T /F 2>&1
    }
  } catch {
    # Процесс уже завершился сам - останавливать нечего.
  }
  $timeout = $PollSeconds * 1000
  if ($timeout -lt 5000) { $timeout = 5000 }
  try { $null = $Process.WaitForExit($timeout) } catch { }
}

# --- Ctrl+C: помечаем остановку и уходим в общий путь завершения (убить дерево,
# --- снять файл-стоп, записать причину), а не падаем посреди итерации.
$script:StopRequested = $false
$script:StopReason = ''
$cancelHandler = [ConsoleCancelEventHandler] {
  param($eventSender, $eventArgs)
  $script:StopRequested = $true
  $script:StopReason = 'Ctrl+C'
  $eventArgs.Cancel = $true
}
try { [Console]::add_CancelKeyPress($cancelHandler) } catch { }

# --- Стартовые проверки: чужой процесс на порту и остатки файла-стопа.
if (Test-Path -LiteralPath $StopFile) {
  # Файл-стоп от предыдущего запуска означал бы мгновенную остановку нового:
  # убираем его, чтобы он не сработал "сам".
  Remove-Item -LiteralPath $StopFile -Force -ErrorAction SilentlyContinue
}
# @() обязателен: из функции с одним pid возвращается скаляр, а у скаляра в
# StrictMode нет свойства Count.
$listenPids = @(Get-ListenPids $Port)
if ($listenPids.Count -gt 0) {
  Write-Log ('port ' + $Port + ' already in use by pid=' + ($listenPids -join ',') + ' - supervisor not started')
  [Console]::remove_CancelKeyPress($cancelHandler)
  exit 3
}

# Второй супервизор не нужен и вреден: два наблюдателя наперегонки поднимают и
# убивают сервер. Свою копию узнаём по строке node с apps/cli/src/bin.ts web.
# Проверка только для штатной команды: при явном -ServerCommand оператор следит
# за своей командой (например, на отдельном порту), и чужой сервер ему не мешает.
if (-not $customCommand) {
  $runningServers = @(Get-ServerProcess)
  if ($runningServers.Count -gt 0) {
    $pids = @($runningServers | ForEach-Object { $_.ProcessId }) -join ','
    Write-Log ('dsh web already running: pid=' + $pids + ' - supervisor not started')
    [Console]::remove_CancelKeyPress($cancelHandler)
    exit 3
  }
}

if (-not (Test-Path -LiteralPath $WebLog)) {
  New-Item -ItemType File -Force -Path $WebLog | Out-Null
}

Write-Log ('start root=' + $Root + ' port=' + $Port + ' warn=' + $MemoryWarnMb + 'MB poll=' + $PollSeconds + 's')
Write-Log ('command: ' + $ServerCommand)

# --- Основной цикл: запуск -> наблюдение -> перезапуск с backoff.
$restarts = @()
$child = $null
$childStart = $null
$nextPoll = [DateTime]::MinValue
$warned = $false
$exitCode = 0
$stopMessage = ''

try {
  while ($true) {
    if ($script:StopRequested) {
      $stopMessage = 'stop requested (' + $script:StopReason + ')'
      break
    }
    if (Test-Path -LiteralPath $StopFile) {
      $stopMessage = 'stop file detected'
      break
    }

    # Процесс завершился сам: фиксируем код, время и аптайм до перезапуска.
    if ($null -ne $child -and $child.HasExited) {
      $exitCode = $child.ExitCode
      $stopped = Get-Date
      $uptimeMin = [Math]::Round(($stopped - $childStart).TotalMinutes, 1)
      Write-ExitMarker $exitCode $stopped
      Write-Log ('exited code=' + $exitCode + ' at ' + $stopped.ToString('s') + ' after ' + $uptimeMin + ' min')
      $child = $null
    }

    if ($null -eq $child) {
      # Бюджет перезапусков: в окне учитываются ВСЕ запуски, включая первый.
      # Иначе первый запуск не попадал в счёт, и бюджет из 5 перезапусков
      # фактически позволял бесконечно много попыток.
      $now = Get-Date
      $restarts = @($restarts | Where-Object { ($now - $_).TotalMinutes -lt $RestartWindowMinutes })
      if ($restarts.Count -ge $MaxRestarts) {
        Write-Log ('restart budget exhausted: ' + $restarts.Count + ' restarts in ' + $RestartWindowMinutes + ' min - supervisor stopped')
        $exitCode = 2
        $stopMessage = 'restart budget exhausted'
        break
      }
      if ($restarts.Count -gt 0) {
        # Backoff растёт по каскаду 5/15/30/60 с и дальше держится на последнем шаге.
        $idx = $restarts.Count - 1
        if ($idx -ge $BackoffSeconds.Count) { $idx = $BackoffSeconds.Count - 1 }
        $delay = $BackoffSeconds[$idx]
        Write-Log ('restart ' + ($restarts.Count + 1) + '/' + $MaxRestarts + ' in ' + $delay + 's')
        # Ожидание разбито на шаги: файл-стоп и Ctrl+C срабатывают во время паузы.
        $deadline = (Get-Date).AddSeconds($delay)
        while ((Get-Date) -lt $deadline) {
          if ($script:StopRequested) { break }
          if (Test-Path -LiteralPath $StopFile) { break }
          Start-Sleep -Milliseconds 250
        }
        if ($script:StopRequested) { break }
        if (Test-Path -LiteralPath $StopFile) {
          $stopMessage = 'stop file detected during backoff'
          break
        }
      }
      $restarts += (Get-Date)
      try {
        $child = Start-ServerProcess
        $childStart = Get-Date
        $warned = $false
        $nextPoll = $childStart
        Write-Log ('started pid=' + $child.Id + ' log=' + (Split-Path -Leaf $WebLog))
      } catch {
        $child = $null
        Write-Log ('start failed: ' + $_.Exception.Message)
        Start-Sleep -Seconds 1
        continue
      }
    }

    if ((Get-Date) -ge $nextPoll) {
      Invoke-LogRotation
      $mem = Get-MemoryInfo $child
      if ($mem.Alive) {
        $uptimeMin = [Math]::Round(((Get-Date) - $childStart).TotalMinutes, 1)
        Write-Log ('launcher=' + $child.Id + ' server=' + $mem.TargetPid + ' ws=' + $mem.WsMb + ' MB private=' + $mem.PrivateMb + ' MB uptime=' + $uptimeMin + ' min')
        if ($mem.WsMb -ge $MemoryWarnMb) {
          $pctOfLimit = [int][Math]::Round(100 * $mem.WsMb / $HeapLimitMb)
          Write-Log ('WARN server=' + $mem.TargetPid + ' memory high: ws=' + $mem.WsMb + ' MB = ' + $pctOfLimit + '% of heap limit ' + $HeapLimitMb + ' MB (threshold ' + $MemoryWarnMb + ' MB)')
          $warned = $true
        } elseif ($warned -and $mem.WsMb -lt ($MemoryWarnMb * 0.9)) {
          # Возврат под порог отмечаем один раз: иначе предупреждения теряют смысл.
          Write-Log ('memory back under threshold: ws=' + $mem.WsMb + ' MB')
          $warned = $false
        }
      }
      $nextPoll = (Get-Date).AddSeconds($PollSeconds)
    }

    # Ожидание опроса короткими шагами: остановка реагирует за 250 мс, а не за PollSeconds.
    $waitUntil = (Get-Date).AddMilliseconds(250)
    while ((Get-Date) -lt $waitUntil) {
      if ($null -ne $child -and $child.HasExited) { break }
      Start-Sleep -Milliseconds 50
    }
  }
} finally {
  try { [Console]::remove_CancelKeyPress($cancelHandler) } catch { }
  Stop-ChildProcess $child
  $final = Get-Date
  if ($null -ne $child) {
    Write-ExitMarker $exitCode $final
    Write-Log ('killed pid=' + $child.Id + ' after ' + [Math]::Round(($final - $childStart).TotalMinutes, 1) + ' min (code=' + $exitCode + ')')
  }
  Remove-ExitCodeScript
  Remove-Item -LiteralPath $StopFile -Force -ErrorAction SilentlyContinue
  Write-Log ('supervisor stopped: ' + $stopMessage + ' (restarts=' + $restarts.Count + ')')
}

# Код выхода отражает причину остановки: 0 - штатная остановка, 2 - исчерпан
# бюджет перезапусков (вызывающий видит, что сервер не просто "закрыли").
exit $exitCode
