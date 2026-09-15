# watch-logs.ps1 - живой просмотр логов сервера и сборки с расцветкой.
# Мониторит журналы в реальном времени: сервер (dsh web) и этапы сборки
# (host / client / web). Красный = критично, жёлтый = предупреждение, белый = обычный.
# Читает короткими снимками по изменению размера (без постоянного дескриптора,
# чтобы не мешать ротации и перезаписи журнала). Выход: Esc или Q.

param(
  [string]$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path),
  [int]$Tail = 40,
  [int]$PollMs = 250
)

$ErrorActionPreference = 'Continue'
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
$PhaseDir = Join-Path $LogDir 'phases'

# Цели мониторинга: сервер + три этапа сборки. Порядок = порядок вывода меток.
$Targets = @(
  @{ Name = 'server'; Path = (Join-Path $LogDir 'web-run.log') },
  @{ Name = 'host';   Path = (Join-Path $PhaseDir 'lib-host.log') },
  @{ Name = 'client'; Path = (Join-Path $PhaseDir 'lib-client.log') },
  @{ Name = 'web';    Path = (Join-Path $PhaseDir 'web.log') }
)

# Ключевые слова для раскраски. Сначала критические, потом предупреждения.
$CRITICAL = @(
  'fatal', 'critical', 'crash', 'uncaught', 'unhandled', 'traceback',
  'error:', 'err!', 'failed', 'cannot', 'can not', 'eaddrinuse',
  'exited with code', 'uncaughtException', 'unhandledRejection',
  'ОШИБКА', 'ошибка', 'сбой', 'невозможно', 'не удалось'
)
$WARNING = @(
  'warn', 'warning', 'deprecat', 'reconnect', 'retry', 'hint',
  'timed out', 'timeout', 'retrying', 'предупрежд', 'внимани'
)

function Write-Colorized([string]$Line) {
  $u = $Line.ToUpperInvariant()
  $color = [ConsoleColor]::White
  foreach ($k in $CRITICAL) {
    if ($u.Contains($k.ToUpperInvariant())) { $color = [ConsoleColor]::Red; break }
  }
  if ($color -eq [ConsoleColor]::White) {
    foreach ($k in $WARNING) {
      if ($u.Contains($k.ToUpperInvariant())) { $color = [ConsoleColor]::Yellow; break }
    }
  }
  Write-Host $Line -ForegroundColor $color
}

function Get-LogLines([string]$Path) {
  return @(Get-Content -LiteralPath $Path -Encoding UTF8 -ErrorAction SilentlyContinue)
}

# Esc/Q завершают просмотр. При перенаправленном вводе клавиатуры нет - выходим только по Ctrl+C.
$CanReadKey = $true
try { $null = [Console]::KeyAvailable } catch { $CanReadKey = $false }

Write-Host 'Живые логи: сервер + сборка (dsh web)' -ForegroundColor Cyan
Write-Host ("Каталог: {0}" -f $LogDir) -ForegroundColor DarkGray
Write-Host 'Метки: [server] [host] [client] [web] · красный = критично · жёлтый = предупреждение · Esc или Q — выйти' -ForegroundColor DarkGray
Write-Host ''

# Начальный хвост по каждому существующему логу + позиция отслеживания.
$Positions = @{}
$Sizes = @{}
foreach ($t in $Targets) {
  $p = $t.Path
  if (Test-Path -LiteralPath $p) {
    $lines = Get-LogLines $p
    $lines | Select-Object -Last $Tail | ForEach-Object { Write-Colorized ("[" + $t.Name + "] " + [string]$_) }
    $Positions[$p] = $lines.Count
    $Sizes[$p] = (Get-Item -LiteralPath $p).Length
  } else {
    $Positions[$p] = 0
    $Sizes[$p] = -1
  }
}

while ($true) {
  if ($CanReadKey) {
    while ([Console]::KeyAvailable) {
      $key = [Console]::ReadKey($true)
      if ($key.Key -eq 'Escape' -or $key.Key -eq 'Q') { exit 0 }
    }
  }
  foreach ($t in $Targets) {
    $p = $t.Path
    $item = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue
    if ($null -eq $item) { continue }
    $prevLen = $Sizes[$p]
    if ($item.Length -ne $prevLen) {
      $Sizes[$p] = $item.Length
      $lines = Get-LogLines $p
      $shown = $Positions[$p]
      if ($lines.Count -lt $shown) {
        # Журнал пересоздан (новая сборка / перезапуск сервера) - начинаем счёт заново.
        Write-Host ("--- журнал [{0}] пересоздан ---" -f $t.Name) -ForegroundColor DarkGray
        $shown = 0
      }
      for ($i = $shown; $i -lt $lines.Count; $i++) { Write-Colorized ("[" + $t.Name + "] " + [string]$lines[$i]) }
      $Positions[$p] = $lines.Count
    }
  }
  Start-Sleep -Milliseconds $PollMs
}
