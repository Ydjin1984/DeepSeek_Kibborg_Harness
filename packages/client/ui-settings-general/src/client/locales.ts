/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'debug.title': '界面诊断日志',
  'debug.description': '在浏览器控制台和 Host 终端输出每个操作的耗时，用于排查会话列表和会话流加载。关键字 [dsh-debug]。',
  'debug.on': '开',
  'debug.off': '关',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'debug.title': 'UI diagnostics log',
  'debug.description': 'Write per-action timings to the browser console and Host terminal to diagnose session-list and transcript load. Grep [dsh-debug].',
  'debug.on': 'On',
  'debug.off': 'Off',
} satisfies Record<SettingsKey, string>

/** Russian dictionary, checked complete against the zh key set. */
export const ru = {
  'trigger': 'Настройки',
  'title': 'Настройки',
  'close': 'Закрыть',
  'openDocument': 'Открыть файл конфигурации',
  'openDocument.error': 'Не удалось открыть файл конфигурации',
  'general.nav': 'Общие',
  'debug.title': 'Диагностика интерфейса',
  'debug.description': 'Писать время каждого действия в консоль браузера и терминал Host, чтобы искать задержки списка сессий и ленты. Ключ [dsh-debug].',
  'debug.on': 'Вкл',
  'debug.off': 'Выкл',
} satisfies Record<SettingsKey, string>
