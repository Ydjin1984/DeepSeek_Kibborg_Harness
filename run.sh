#!/usr/bin/env bash
# run.sh - меню управления проектом DeepSeek_Kibborg_Harness на Linux.
# Аналог run.bat: те же пункты, порт и журналы, но процессы и сборка
# выполняются нативно (без cmd.exe/taskkill/PowerShell), потому что
# progress.ps1 и server-supervisor.ps1 завязаны на Windows.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1

PORT=3080
URL="http://127.0.0.1:$PORT/"
BAR_WIDTH=50
START_TIMEOUT=300
HTTP_READY_TIMEOUT=120
LOG_DIR="$ROOT/.dsh-build"
WEB_LOG="$LOG_DIR/web-run.log"
PHASE_DIR="$LOG_DIR/phases"
RECORD_PATH="$LOG_DIR/client-build-environment.json"
INDEX_PATH="$ROOT/apps/web/dist/index.html"
PID_FILE="$LOG_DIR/web.pid"
WEB_LOG_KEEP_PREV=5
# Тот же лимит heap, что в progress.ps1: дефолт V8 (~4 ГБ) не тянет
# загрузку истории крупных сессий.
# --no-open: браузер открывает пункт меню [5], автоматически он не нужен.
NODE_HEAP_MB=65536
SERVER_CMD=(node "--max-old-space-size=$NODE_HEAP_MB" --import tsx/esm apps/cli/src/bin.ts web --no-open --host 127.0.0.1 --port "$PORT")

# --- Окружение: Node ставится через nvm, путь к нему есть только в интерактивной оболочке.
export NVM_DIR="${NVM_DIR:-$HOME/.config/nvm}"
load_node() {
  if command -v node >/dev/null 2>&1; then return 0; fi
  [ -s "$NVM_DIR/nvm.sh" ] || return 1
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || return 1
  nvm use --silent default >/dev/null 2>&1 || nvm use --silent 24 >/dev/null 2>&1 || return 1
  command -v node >/dev/null 2>&1
}

need_node() {
  if load_node; then return 0; fi
  echo
  msg_red "Node.js не найден. Установите его через nvm:"
  echo "    export NVM_DIR=\"\$HOME/.config/nvm\"; . \"\$NVM_DIR/nvm.sh\"; nvm install 24"
  return 1
}

need_pnpm() {
  need_node || return 1
  if command -v pnpm >/dev/null 2>&1; then return 0; fi
  # pnpm установлен через corepack для nvm-версии Node. Если в PATH уже
  # есть системный Node (без pnpm) — переключаемся на nvm-версию, где
  # corepack уже настроен и pnpm доступен.
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
    nvm use --silent default >/dev/null 2>&1 || nvm use --silent 24 >/dev/null 2>&1 || true
    if command -v pnpm >/dev/null 2>&1; then return 0; fi
    # corepack enable для nvm-директории на случай, если pnpm-шим отсутствует
    local node_dir; node_dir=$(dirname "$(command -v node)")
    if command -v corepack >/dev/null 2>&1; then
      corepack enable --install-directory "$node_dir" >/dev/null 2>&1 || true
      if command -v pnpm >/dev/null 2>&1; then return 0; fi
    fi
  fi
  echo
  msg_red "pnpm не найден в PATH. Включите corepack: corepack enable"
  msg_red "Если не помогает — установите: npm install -g pnpm"
  return 1
}

# --- Цвета и вывод. Когда вывод перенаправлен, цвета мешают.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_BLUE=$'\033[36m'; C_MAGENTA=$'\033[35m'
  C_GRAY=$'\033[90m'
else
  C_RESET=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_MAGENTA=''; C_GRAY=''
fi

msg_green() { printf '%s%s%s\n' "$C_GREEN" "$1" "$C_RESET"; }
msg_red()   { printf '%s%s%s\n' "$C_RED" "$1" "$C_RESET"; }
msg_yellow(){ printf '%s%s%s\n' "$C_YELLOW" "$1" "$C_RESET"; }
msg_gray()  { printf '%s%s%s\n' "$C_GRAY" "$1" "$C_RESET"; }

# --- Прогресс-бар: те же 50 ячеек и раскладка процентов, что в progress.ps1.
INTERACTIVE=0
[ -t 1 ] && INTERACTIVE=1

bar_line() {
  local percent=$1 cells pct
  cells=$(( percent * BAR_WIDTH / 100 ))
  [ "$cells" -gt "$BAR_WIDTH" ] && cells=$BAR_WIDTH
  [ "$cells" -lt 0 ] && cells=0
  pct=$percent
  [ "$pct" -gt 100 ] && pct=100
  [ "$pct" -lt 0 ] && pct=0
  printf '%*s' $(( BAR_WIDTH + 6 )) ''
  printf '\r'
  bar_text="$(printf '%*s' "$cells" '' | tr ' ' '#')$(printf '%*s' $(( BAR_WIDTH - cells )) '' | tr ' ' '-')$(printf ' %3d%%' "$pct")"
  if [ "$pct" -ge 100 ]; then printf '%s%s%s' "$C_GREEN" "$bar_text" "$C_RESET"
  elif [ "$pct" -ge 75 ]; then printf '%s%s%s' "$C_MAGENTA" "$bar_text" "$C_RESET"
  elif [ "$pct" -ge 50 ]; then printf '%s%s%s' "$C_BLUE" "$bar_text" "$C_RESET"
  elif [ "$pct" -ge 25 ]; then printf '%s%s%s' "$C_YELLOW" "$bar_text" "$C_RESET"
  else printf '%s' "$bar_text"; fi
  printf '\n'
}

# Печать бара с перезаписью строки в интерактивном терминале, иначе - обычные строки.
draw_bar() {
  local percent=$1
  if [ "$INTERACTIVE" -eq 1 ]; then
    bar_line "$percent"
    printf '\033[1A\r'
  else
    bar_line "$percent"
  fi
}

status_line() {
  local text="$1"
  if [ "$INTERACTIVE" -eq 1 ]; then
    printf '%*s\r' "$(($(tput cols 2>/dev/null || echo 80) - 1))" ''
    printf '%s%s%s\n' "$C_GRAY" "$text" "$C_RESET"
    printf '\033[1A'
  else
    printf '%s\n' "$text"
  fi
}

clear_screen() {
  if [ "$INTERACTIVE" -eq 1 ]; then clear; else printf '\n'; fi
}

format_elapsed() {
  local s=${1%.*} s=${s:-0}
  printf '%d:%02d:%02d' $(( s / 3600 )) $(( s % 3600 / 60 )) $(( s % 60 ))
}

# Экспоненциальное приближение к следующей отметке - тот же закон роста, что в progress.ps1.
approach() {
  local from=$1 to=$2 elapsed=$3 tau=$4
  awk -v f="$from" -v t="$to" -v e="$elapsed" -v k="$tau" \
    'BEGIN { printf "%d", f + (t - f) * (1 - exp(-e / k)) }'
}

# --- Проверки готовности
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") >/dev/null 2>&1; }

http_ready() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -o /dev/null --max-time 3 "$URL" 2>/dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null --timeout=3 "$URL" 2>/dev/null
  else
    port_open
  fi
}

# PID принадлежит самому run.sh или одному из его предков (терминал, qterminal)?
# Такие процессы исключаются из детекта: их командная строка может содержать
# тот же текст - например, когда оператор ищет процесс вручную через pgrep.
is_self_or_ancestor() {
  local candidate=$1 walk=$$
  while [ -n "$walk" ] && [ "$walk" != 0 ] && [ "$walk" != 1 ]; do
    [ "$walk" = "$candidate" ] && return 0
    walk=$(ps -o ppid= -p "$walk" 2>/dev/null | tr -d ' ')
  done
  return 1
}

server_pids() {
  # Якорь на полной команде сервера из SERVER_CMD, а не на слове "web":
  # короткий шаблон из run.bat ("*dsh web*") на Linux совпадает с любой
  # командной строкой, где встретилось это слово, включая сам grep.
  local pattern='--import tsx/esm apps/cli/src/bin\.ts web'
  local pid out=()
  while read -r pid; do
    [ -n "$pid" ] || continue
    is_self_or_ancestor "$pid" && continue
    out+=("$pid")
  done < <(pgrep -f -- "$pattern" 2>/dev/null || true)
  [ "${#out[@]}" -gt 0 ] && printf '%s\n' "${out[@]}"
  return 0
}

web_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid=$(cat "$PID_FILE" 2>/dev/null)
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}

show_web_log_tail() {
  echo 'Журнал сервера (последние строки):'
  if [ -s "$WEB_LOG" ]; then
    tail -n 30 "$WEB_LOG"
  else
    echo '(журнал пуст)'
  fi
  echo "Полный журнал: $WEB_LOG"
}

# --- Сборка
build_phase() {
  local script=$1 label=$2 from=$3 to=$4 tau=$5 log=$6
  status_line "Этап: $label   Время: $(format_elapsed 0)"
  ( cd "$ROOT" && pnpm run "$script" ) >"$log" 2>&1 &
  local pid=$! start=$SECONDS
  while kill -0 "$pid" 2>/dev/null; do
    draw_bar "$(approach "$from" "$to" $(( SECONDS - start )) "$tau")"
    status_line "Этап: $label   Время: $(format_elapsed $(( SECONDS - start )))"
    sleep 0.2
  done
  wait "$pid"
  local code=$? elapsed=$(( SECONDS - start ))
  if [ "$code" -ne 0 ]; then
    draw_bar "$from"
    status_line "Этап «$label» завершился с ошибкой (код $code)"
    echo
    echo 'Журнал этапа (последние строки):'
    [ -f "$log" ] && tail -n 40 "$log"
    return 1
  fi
  draw_bar "$to"
  status_line "Этап: $label — готово   Время: $(format_elapsed "$elapsed")"
  return 0
}

build_project() {
  local hash
  hash=$(git rev-parse HEAD 2>/dev/null)
  if ! printf '%s' "$hash" | grep -qE '^[0-9a-f]{7,40}$'; then
    echo
    msg_red 'ОШИБКА: не удалось получить хеш коммита (git rev-parse HEAD). Сборка невозможна.'
    return 1
  fi
  # Тот же механизм, что в scripts/build.ts (DSH_CLIENT_COMMIT_HASH).
  export DSH_CLIENT_COMMIT_HASH
  DSH_CLIENT_COMMIT_HASH=$(printf '%s' "$hash" | cut -c1-7)
  mkdir -p "$PHASE_DIR"
  local total_start=$SECONDS

  build_phase 'build:lib:host'   '1/3: host-пакеты (tsc + tsdown)' 0  38 15 "$PHASE_DIR/lib-host.log"   || return 1
  build_phase 'build:lib:client' '2/3: client-пакеты (tsc + tsdown)' 38 74 12 "$PHASE_DIR/lib-client.log" || return 1
  build_phase 'build:web'        '3/3: web-фронтенд (vite)'         74 100 5 "$PHASE_DIR/web.log"        || return 1

  # Манифест сборки: те же шаги, что в конце scripts/build.ts.
  status_line 'Запись манифеста сборки...'
  if ! ( cd "$ROOT" && node --input-type=module --import tsx/esm -e "
import { writeClientBuildRecord, repositoryCommitHash } from './scripts/client-build-environment.ts'
const root = process.cwd()
const env = { DSH_CLIENT_COMMIT_HASH: repositoryCommitHash(root, process.env) }
writeClientBuildRecord(root, env)
" ) >"$PHASE_DIR/record.log" 2>&1; then
    echo
    msg_red 'ОШИБКА: не удалось записать манифест сборки.'
    tail -n 20 "$PHASE_DIR/record.log"
    return 1
  fi

  draw_bar 100
  status_line "Готово за $(format_elapsed $(( SECONDS - total_start )))"
  echo
  msg_green "Сборка завершена за $(format_elapsed $(( SECONDS - total_start )))."
  echo 'Артефакты: apps/web/dist (web-клиент), packages/*/lib (пакеты).'
}

# --- Запуск и остановка сервера
rotate_web_log() {
  [ -f "$WEB_LOG" ] || return 0
  local archive="$LOG_DIR/web-run.prev-$(date +%Y%m%d-%H%M%S).log"
  if ! mv -f "$WEB_LOG" "$archive" 2>/dev/null; then
    msg_yellow 'Не удалось сохранить журнал прошлого запуска.'
    return 0
  fi
  # Старые архивы (сверх лимита) удаляются: сортировка по имени совпадает с порядком дат.
  local old
  old=$(ls -1 "$LOG_DIR"/web-run.prev-*.log 2>/dev/null | sort | head -n -"$WEB_LOG_KEEP_PREV")
  [ -n "$old" ] && printf '%s\n' "$old" | xargs -r rm -f --
  return 0
}

start_web_server() {
  mkdir -p "$LOG_DIR"
  rotate_web_log
  # setsid - сервер получает собственную сессию и не умирает при закрытии
  # окна run.sh, как на Windows делает Start-Process с UseShellExecute.
  # Маркер выхода дописывается в тот же журнал: без него падение сервера
  # выглядит как обрыв журнала на строке приветствия.
  ( cd "$ROOT" && setsid "${SERVER_CMD[@]}" >>"$WEB_LOG" 2>&1
    printf '[server] exited with code %d at %s\n' "$?" "$(date)" >>"$WEB_LOG" ) &
  printf '%s' "$!" >"$PID_FILE"
}

stop_project() {
  local pids
  pids=$(server_pids)
  if [ -z "$pids" ]; then
    rm -f "$PID_FILE"
    echo 'Проект не запущен - останавливать нечего.'
    return 0
  fi
  echo "Останавливаю PID: $(printf '%s' "$pids" | tr '\n' ' ')"
  # Дети (MCP-серверы) снимаются вместе с родителем: сначала SIGTERM по
  # дереву, затем SIGKILL по тому же списку, если кто-то выжил.
  printf '%s\n' "$pids" | xargs -r kill -TERM 2>/dev/null
  sleep 2
  pids=$(server_pids)
  if [ -n "$pids" ]; then
    printf '%s\n' "$pids" | xargs -r kill -KILL 2>/dev/null
  fi
  pkill -KILL -P $$ 2>/dev/null
  rm -f "$PID_FILE"
  echo 'Готово: процесс и его дочерние MCP-серверы остановлены.'
}

do_start() {
  clear_screen
  echo 'Загрузка DeepSeek_Kibborg_Harness'
  need_pnpm || return 1

  # 1. Продакшн-раннер dsh web требует собранные артефакты.
  if [ ! -f "$RECORD_PATH" ] || [ ! -f "$INDEX_PATH" ]; then
    echo
    msg_yellow 'Артефакты не найдены — выполняю сборку проекта...'
    build_project || return 1
    status_line 'Сборка готова — запускаю сервер...'
  fi

  # 2. Сервис уже отвечает?
  if http_ready; then
    draw_bar 100
    status_line 'Сервис уже запущен'
    echo
    msg_green "Сервис уже работает: $URL"
    return 0
  fi

  # 3. Порт уже слушается (сервис поднимается) — второй экземпляр не запускаем.
  local bound=0 bound_at=0
  port_open && { bound=1; bound_at=$SECONDS; }
  if [ "$bound" -eq 0 ]; then
    start_web_server
  fi

  # 4. Ожидание реальной готовности: порт (60%) -> HTTP 200 (100%).
  local boot_start=$SECONDS
  while [ $(( SECONDS - boot_start )) -lt "$START_TIMEOUT" ]; do
    if [ -f "$PID_FILE" ]; then
      local pid; pid=$(cat "$PID_FILE" 2>/dev/null)
      if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
        echo
        msg_red 'ОШИБКА: сервер завершился до готовности.'
        show_web_log_tail
        return 1
      fi
    fi
    if [ "$bound" -eq 1 ]; then
      if http_ready; then break; fi
      if [ $(( SECONDS - bound_at )) -ge "$HTTP_READY_TIMEOUT" ]; then
        echo
        msg_red 'ОШИБКА: порт занят, но сервер не отвечает по HTTP.'
        show_web_log_tail
        return 1
      fi
      draw_bar $(( 60 + $(approach 0 40 $(( SECONDS - boot_start )) 8) ))
      status_line "Сервер отвечает — инициализация...   Время: $(format_elapsed $(( SECONDS - boot_start )))"
    else
      if port_open; then
        bound=1
        bound_at=$SECONDS
        draw_bar 60
        status_line "Сервер начал слушать порт $PORT   Время: $(format_elapsed $(( SECONDS - boot_start )))"
        sleep 0.2
        continue
      fi
      draw_bar $(( $(approach 0 60 $(( SECONDS - boot_start )) 6) ))
      status_line "Запуск сервера...   Время: $(format_elapsed $(( SECONDS - boot_start )))"
    fi
    sleep 0.2
  done

  if ! http_ready; then
    echo
    msg_red "ОШИБКА: таймаут ожидания сервера ($START_TIMEOUT с)."
    show_web_log_tail
    return 1
  fi

  draw_bar 100
  status_line 'Сервис готов'
  echo
  msg_green "Сервис готов за $(format_elapsed $(( SECONDS - boot_start ))) — $URL"
  msg_gray "Сервис работает в фоне; журнал: .dsh-build/web-run.log"
  local prev
  prev=$(ls -1 "$LOG_DIR"/web-run.prev-*.log 2>/dev/null | sort | tail -n 1)
  [ -n "$prev" ] && msg_gray "Журнал предыдущего запуска: .dsh-build/$(basename "$prev")"
  return 0
}

# --- Пункты меню
do_build() {
  clear_screen
  echo 'Сборка DeepSeek_Kibborg_Harness'
  need_pnpm || return 1
  build_project
}

do_status() {
  echo
  local pids
  pids=$(server_pids)
  if [ -z "$pids" ]; then
    echo 'Проект НЕ запущен.'
    return 0
  fi
  echo "Проект ЗАПУЩЕН, PID: $(printf '%s' "$pids" | tr '\n' ' ')"
  if http_ready; then
    msg_green "Web UI отвечает: $URL"
  elif port_open; then
    msg_yellow "Порт $PORT слушается, но HTTP не отвечает."
  else
    msg_yellow 'Процесс жив, но порт не слушается.'
  fi
  [ -f "$WEB_LOG" ] && msg_gray "Журнал: $WEB_LOG ($(wc -l <"$WEB_LOG") строк)"
  return 0
}

do_browser() {
  local opener=''
  for candidate in xdg-open sensible-browser x-www-browser firefox chromium google-chrome; do
    if command -v "$candidate" >/dev/null 2>&1; then opener=$candidate; break; fi
  done
  if [ -z "$opener" ]; then
    msg_red 'Не найден браузер для запуска. Откройте вручную: '$URL
    return 1
  fi
  echo "Открываю браузер: $URL"
  "$opener" "$URL" >/dev/null 2>&1 &
}

do_restart() {
  echo
  echo 'Перезапускаю проект: остановка, затем запуск...'
  stop_project
  do_start
}

do_selftest() {
  local fails=0 total=0
  assert() {
    total=$(( total + 1 ))
    if [ "$1" = 'ok' ]; then
      msg_green "  [OK]   $2"
    else
      msg_red "  [FAIL] $2"
      fails=$(( fails + 1 ))
    fi
  }
  expected() { local p=$1 cells; cells=$(( p * BAR_WIDTH / 100 )); printf '%s%s %3d%%' "$(printf '%*s' "$cells" '' | tr ' ' '#')" "$(printf '%*s' $(( BAR_WIDTH - cells )) '' | tr ' ' '-')" "$p"; }

  echo 'Самопроверка run.sh'
  echo
  echo 'Отрисовка прогресс-бара (50 ячеек):'
  [ "$(expected 0)"   = '--------------------------------------------------   0%' ] && assert ok '0% — пустой бар' || assert no '0% — пустой бар'
  [ "$(expected 11)"  = '#####---------------------------------------------  11%' ] && assert ok '11% — 5 блоков' || assert no '11% — 5 блоков'
  [ "$(expected 50)"  = '#########################-------------------------  50%' ] && assert ok '50% — 25 блоков' || assert no '50% — 25 блоков'
  [ "$(expected 100)" = '################################################## 100%' ] && assert ok '100% — полный бар' || assert no '100% — полный бар'

  echo
  echo 'Окружение:'
  if load_node; then
    local nv
    nv=$(node -v)
    case "$nv" in
      v22.19*|v22.2[0-9]*|v2[3-9].*|v[3-9][0-9].*) assert ok "Node $nv удовлетворяет engines (^22.19 || >=24)" ;;
      *) msg_red "  [WARN] Node $nv ниже требуемой версии (^22.19 || >=24)"; ;;
    esac
  else
    assert no 'node доступен в PATH'
  fi
  [ -f "$ROOT/package.json" ] && assert ok 'package.json в корне' || assert no 'package.json в корне'
  [ -f "$ROOT/pnpm-lock.yaml" ] && assert ok 'pnpm-lock.yaml на месте' || assert no 'pnpm-lock.yaml на месте'
  [ -d "$ROOT/node_modules" ] && assert ok 'node_modules установлены' || assert no 'node_modules установлены'
  [ -f "$ROOT/.gitmodules" ] && [ -d "$ROOT/Kibborg_CLI" ] && assert ok 'сабмодуль Kibborg_CLI инициализирован' || msg_yellow '  [WARN] сабмодуль Kibborg_CLI не инициализирован (git submodule update --init)'

  echo
  echo 'Механика процессов:'
  if command -v pgrep >/dev/null 2>&1; then
    assert ok 'pgrep доступен (детект процессов dsh web)'
  else
    assert no 'pgrep доступен'
  fi
  if command -v setsid >/dev/null 2>&1; then
    assert ok 'setsid доступен (фоновый запуск сервера)'
  else
    assert no 'setsid доступен'
  fi
  if port_open; then
    assert ok "порт $PORT слушается"
  else
    msg_yellow "  [WARN] порт $PORT свободен (сервер не запущен)"
  fi
  if http_ready; then
    assert ok "HTTP отвечает на $URL"
  else
    msg_yellow "  [WARN] HTTP не отвечает на $URL"
  fi
  mkdir -p "$LOG_DIR" && assert ok "каталог журналов доступен для записи ($LOG_DIR)" || assert no 'каталог журналов доступен для записи'
  if [ -w "$ROOT" ]; then assert ok 'корень проекта доступен для записи'; else assert no 'корень проекта доступен для записи'; fi

  echo
  echo 'Ключи и переменные:'
  if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
    assert ok 'DEEPSEEK_API_KEY задан в окружении'
  elif [ -f "$ROOT/.env" ] && grep -q '^DEEPSEEK_API_KEY=' "$ROOT/.env" 2>/dev/null; then
    assert ok 'DEEPSEEK_API_KEY задан в .env'
  else
    msg_yellow '  [WARN] DEEPSEEK_API_KEY не задан - агенту нужен ключ DeepSeek (пункт A меню)'
  fi

  echo
  if [ "$fails" -eq 0 ]; then
    msg_green "Самопроверка пройдена: $total проверок."
    return 0
  fi
  msg_red "САМОПРОВЕРКА ПРОВАЛЕНА: $fails из $total."
  return 1
}

do_graphify() {
  echo
  echo 'Обновляю граф знаний: graphify update packages (в graphify-out/)'
  if ! command -v graphify >/dev/null 2>&1; then
    msg_red 'graphify не найден в PATH. Установите: uv tool install graphifyy'
    return 1
  fi
  # graphify update пишет граф рядом с входным путём (packages/graphify-out),
  # что ломает сборку tsdown; GRAPHIFY_OUT перенаправляет вывод в корневой graphify-out/.
  export GRAPHIFY_OUT="$ROOT/graphify-out"
  if graphify update packages; then
    msg_green "Граф знаний обновлён: $GRAPHIFY_OUT/graph.json"
  else
    msg_red 'Обновление графа завершилось с ошибкой. Смотрите вывод выше.'
    return 1
  fi
}

do_logs() {
  if [ ! -f "$WEB_LOG" ]; then
    msg_yellow "Журнал $WEB_LOG ещё не создан. Сначала запустите проект (пункт 1)."
    return 1
  fi
  echo 'Живые логи сервера (Q - выход)...'
  # Цвет по словам-маркерам, как в watch-logs.ps1: красный = критично,
  # жёлтый = предупреждение. За пределами интерактивного терминала
  # раскраска отключается - grep не умеет цвета без --color=always.
  # --line-buffered обязателен: без него grep копит вывод блоками и в
  # «живом» режиме строки появляются пачками раз в 4 КБ.
  local color_args=()
  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    color_args=( --color=always )
  else
    color_args=( --color=never )
  fi
  tail -n 40 -f "$WEB_LOG" | grep -E --line-buffered "${color_args[@]}" \
    -e 'fatal|critical|crash|uncaught|unhandled|traceback|error:|err!|failed|cannot|can not|eaddrinuse|exited with code|ОШИБКА|ошибка|сбой|не удалось' \
    -e 'warn|warning|deprecat|reconnect|retry|hint|timed out|timeout|retrying|предупреж' \
    || true
}

do_env_setup() {
  echo
  echo 'Настройка ключей DeepSeek (.env в корне проекта, файл в .gitignore)'
  echo
  if [ -f "$ROOT/.env" ]; then
    local current
    current=$(sed -n 's/^DEEPSEEK_API_KEY=//p' "$ROOT/.env" | head -n 1)
    if [ -n "$current" ]; then
      msg_green "Ключ уже задан (начинается с ${current:0:6}..., длина ${#current})."
    else
      msg_yellow 'Файл .env есть, но DEEPSEEK_API_KEY в нём не найден.'
    fi
    local base
    base=$(sed -n 's/^DEEPSEEK_BASE_URL=//p' "$ROOT/.env" | head -n 1)
    [ -n "$base" ] && echo "DEEPSEEK_BASE_URL: $base" || echo 'DEEPSEEK_BASE_URL: не задан (используется публичный API)'
  else
    echo 'Файла .env нет - он будет создан.'
  fi
  echo
  printf 'Вставьте DEEPSEEK_API_KEY (вида sk-...), Enter - оставить без изменений: '
  local key
  read -r key
  if [ -n "$key" ]; then
    # Ключ пишется только в gitignored .env, в stdout не печатается.
    touch "$ROOT/.env"
    if grep -q '^DEEPSEEK_API_KEY=' "$ROOT/.env" 2>/dev/null; then
      sed -i "s|^DEEPSEEK_API_KEY=.*|DEEPSEEK_API_KEY=$key|" "$ROOT/.env"
    else
      printf 'DEEPSEEK_API_KEY=%s\n' "$key" >>"$ROOT/.env"
    fi
    chmod 600 "$ROOT/.env"
    msg_green 'Ключ сохранён в .env (права 600).'
  else
    msg_yellow 'Ключ не изменён.'
  fi
  echo
  printf 'DEEPSEEK_BASE_URL (пусто = публичный API): '
  local url
  read -r url
  if [ -n "$url" ]; then
    touch "$ROOT/.env"
    if grep -q '^DEEPSEEK_BASE_URL=' "$ROOT/.env" 2>/dev/null; then
      sed -i "s|^DEEPSEEK_BASE_URL=.*|DEEPSEEK_BASE_URL=$url|" "$ROOT/.env"
    else
      printf 'DEEPSEEK_BASE_URL=%s\n' "$url" >>"$ROOT/.env"
    fi
    msg_green "Базовый URL сохранён: $url"
  fi
}

do_install_deps() {
  echo
  echo 'Обновляю зависимости: pnpm install'
  need_pnpm || return 1
  if pnpm install; then
    msg_green 'Зависимости обновлены.'
    msg_gray 'Если менялась версия Node.js - пересоберите проект (пункт 2): нативные аддоны привязаны к ABI.'
  else
    msg_red 'pnpm install завершился с ошибкой.'
    return 1
  fi
}

do_headless() {
  need_pnpm || return 1
  echo
  echo 'Headless-режим: pnpm dsh --profile headless "<задача>"'
  echo
  read -r -p 'Задача для агента: ' task
  if [ -z "$task" ]; then
    msg_yellow 'Пустая задача - запуск отменён.'
    return 1
  fi
  echo
  pnpm dsh --profile headless "$task"
}

pause_enter() {
  echo
  read -r -p 'Enter - назад в меню...' _
}

tries=0
menu() {
  clear_screen
  echo
  echo '============================================'
  echo '  DaVinchi Harness - управление проектом'
  echo '============================================'
  echo "  Директория: $ROOT"
  echo
  echo '  [1] Запустить проект    (индикатор загрузки)'
  echo '  [2] Собрать бинарник    (индикатор прогресса)'
  echo '  [3] Остановить проект   (завершить dsh web)'
  echo '  [4] Статус проекта      (статус и PID процесса)'
  echo '  [5] Открыть браузер     (http://127.0.0.1:3080)'
  echo '  [6] Перезапустить       (стоп + запуск)'
  echo '  [7] Самопроверка        (тесты run.sh)'
  echo '  [8] Обновить граф знаний (graphify update packages)'
  echo '  [9] Живые логи сервера  (реальное время, Q - выход)'
  echo '  [A] API-ключ DeepSeek   (.env: DEEPSEEK_API_KEY)'
  echo '  [B] Обновить зависимости (pnpm install)'
  echo '  [C] Задача в терминале  (headless-режим)'
  echo
  echo '  [0] Выход'
  echo
  read -r -p 'Выберите пункт меню и нажмите Enter: ' choice

  case "$choice" in
    1) do_start;     pause_enter ;;
    2) do_build;     pause_enter ;;
    3) echo
       read -r -p 'Уверены? Проект будет остановлен (y/n): ' confirm
       if [ "${confirm,,}" = 'y' ]; then stop_project; else echo 'Отменено.'; fi
       pause_enter ;;
    4) do_status;    pause_enter ;;
    5) do_browser;   pause_enter ;;
    6) do_restart;   pause_enter ;;
    7) do_selftest;  pause_enter ;;
    8) do_graphify;  pause_enter ;;
    9) do_logs;      pause_enter ;;
    A|a) do_env_setup;  pause_enter ;;
    B|b) do_install_deps; pause_enter ;;
    C|c) do_headless; pause_enter ;;
    0) exit 0 ;;
    *)
      tries=$(( tries + 1 ))
      if [ "$tries" -ge 5 ]; then
        echo
        echo 'Слишком много неверных вводов. Выход.'
        exit 1
      fi
      echo
      echo "Неверный ввод: \"$choice\""
      sleep 2
      ;;
  esac
}

load_node >/dev/null 2>&1
menu
