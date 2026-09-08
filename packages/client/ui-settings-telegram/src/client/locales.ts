/**
 * Copy dictionaries for the Telegram settings section. The plugin owns a
 * single namespace (`settings.telegram`) registered with the locale service.
 */

/** English source of truth; `ru`/`zh` mirror every key. */
export const en = {
  nav: 'Telegram',
  description: 'Mirror an agent session into a Telegram chat: start the mirror from the composer button, follow the run from your phone, and answer agent questions right in the chat.',
  botTokenLabel: 'Bot token',
  botTokenHint: 'Token from @BotFather. Stored on this computer only.',
  chatIdLabel: 'Chat ID',
  chatIdHint: 'Your chat id with this bot (e.g. 123456789).',
  chatIdHelp: 'To find it: message the bot, then press "Test connection" — the reply shows whether the bot reaches this chat.',
  configured: 'configured',
  notConfigured: 'not configured',
  save: 'Save',
  saved: 'Saved',
  saveFailed: 'Failed to save settings.',
  test: 'Test connection',
  testing: 'Testing…',
  testOk: 'Connected — check the chat for the test message.',
  testFailed: 'Connection failed: {message}',
  clearToken: 'Clear token',
} as const

/** Russian copy. */
export const ru: Record<keyof typeof en, string> = {
  nav: 'Telegram',
  description: 'Зеркалируйте сессию агента в Telegram: включите зеркало кнопкой в композере, следите за ходом работы с телефона и отвечайте на вопросы агента прямо в чате.',
  botTokenLabel: 'Токен бота',
  botTokenHint: 'Токен от @BotFather. Хранится только на этом компьютере.',
  chatIdLabel: 'Chat ID',
  chatIdHint: 'Ваш chat id с этим ботом (например, 123456789).',
  chatIdHelp: 'Как узнать: напишите боту, затем нажмите «Проверить подключение» — ответ покажет, доходит ли бот до этого чата.',
  configured: 'настроено',
  notConfigured: 'не настроено',
  save: 'Сохранить',
  saved: 'Сохранено',
  saveFailed: 'Не удалось сохранить настройки.',
  test: 'Проверить подключение',
  testing: 'Проверяем…',
  testOk: 'Подключено — проверьте чат: там тестовое сообщение.',
  testFailed: 'Ошибка подключения: {message}',
  clearToken: 'Очистить токен',
}

/** Chinese copy. */
export const zh: Record<keyof typeof en, string> = {
  nav: 'Telegram',
  description: '将会话镜像到 Telegram：用输入栏按钮开启镜像，在手机上跟踪运行进度并直接在聊天中回答智能体的问题。',
  botTokenLabel: '机器人令牌',
  botTokenHint: '来自 @BotFather 的令牌，仅存储在本机。',
  chatIdLabel: '聊天 ID',
  chatIdHint: '你与该机器人的聊天 ID（例如 123456789）。',
  chatIdHelp: '查找方法：先给机器人发消息，再点击“测试连接”，回复会显示机器人是否到达该聊天。',
  configured: '已配置',
  notConfigured: '未配置',
  save: '保存',
  saved: '已保存',
  saveFailed: '保存设置失败。',
  test: '测试连接',
  testing: '测试中…',
  testOk: '已连接 — 请查看聊天中的测试消息。',
  testFailed: '连接失败：{message}',
  clearToken: '清除令牌',
}

export type TelegramSettingsKey = keyof typeof en
