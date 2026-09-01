/** Locale namespace owned by Session export browser feedback. */
export const NS = 'session-log-download'

/** Simplified-Chinese Session export strings. */
export const zh = {
  'dialog.preparingTitle': '正在导出 Session',
  'dialog.preparingDescription': '正在准备包含当前 Session、子 Session 和附件的 ZIP 文件。',
  'dialog.successTitle': 'Session 导出已开始下载',
  'dialog.successDescription': '浏览器正在下载 Session ZIP 文件。',
  'dialog.errorTitle': 'Session 导出失败',
  'dialog.close': '关闭',
  'dialog.commandFailed': '无法启动 Session 导出。',
} as const

/** English Session export strings. */
export const en: Record<keyof typeof zh, string> = {
  'dialog.preparingTitle': 'Exporting Session',
  'dialog.preparingDescription': 'Preparing a ZIP containing this Session, its sub-Sessions, and attachments.',
  'dialog.successTitle': 'Session download started',
  'dialog.successDescription': 'The browser is downloading the Session ZIP.',
  'dialog.errorTitle': 'Session export failed',
  'dialog.close': 'Close',
  'dialog.commandFailed': 'Could not start the Session export.',
}

/** Russian Session export strings. */
export const ru: Record<keyof typeof zh, string> = {
  'dialog.preparingTitle': 'Экспорт сессии',
  'dialog.preparingDescription': 'Готовится ZIP с этой сессией, её подсессиями и вложениями.',
  'dialog.successTitle': 'Скачивание сессии началось',
  'dialog.successDescription': 'Браузер скачивает ZIP-файл сессии.',
  'dialog.errorTitle': 'Не удалось экспортировать сессию',
  'dialog.close': 'Закрыть',
  'dialog.commandFailed': 'Не удалось начать экспорт сессии.',
}

/** Stable locale keys consumed by the shared modal. */
export type SessionLogDownloadKey = keyof typeof zh
