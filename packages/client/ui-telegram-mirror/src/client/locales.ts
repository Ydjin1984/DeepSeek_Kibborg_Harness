/**
 * Copy dictionaries for the Telegram mirror toggle. The plugin owns a single
 * namespace (`telegram.mirror`) registered with the locale service.
 */

/** English source of truth; `ru`/`zh` mirror every key. */
export const en = {
  title: 'Telegram mirror',
  titleActive: 'Telegram mirror — on (click to turn off)',
  notConfiguredTitle: 'Configure Telegram in Settings → Telegram first',
} as const

/** Russian copy. */
export const ru: Record<keyof typeof en, string> = {
  title: 'Telegram-зеркало',
  titleActive: 'Telegram-зеркало — включено (нажмите, чтобы выключить)',
  notConfiguredTitle: 'Сначала настройте Telegram: Настройки → Telegram',
}

/** Chinese copy. */
export const zh: Record<keyof typeof en, string> = {
  title: 'Telegram 镜像',
  titleActive: 'Telegram 镜像 — 已开启（点击关闭）',
  notConfiguredTitle: '请先在 设置 → Telegram 中完成配置',
}

export type TelegramMirrorKey = keyof typeof en
