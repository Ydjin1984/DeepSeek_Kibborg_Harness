/** `command` namespace dictionaries (the popupSelect shell's copy + menu row copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'search.placeholder': '搜索…',
  'search.aria': '筛选选项',
  'status.loading': '正在加载选项…',
  'status.applying': '正在应用…',
  'status.empty': '无选项',
  'overlay.aria': '/{command} 选项',
  'listbox.aria': '/{command} 匹配项',
  'notice.imagesUnsupported': '/{command} 不接受图片附件，请先移除图片',
  'menu.goal': '目标',
  'menu.goal.description': '设置或查看长任务的进行目标',
  'menu.plan': '计划',
  'menu.plan.description': '进入或退出计划模式',
  'menu.compact': '压缩',
  'menu.compact.description': '压缩较早的对话历史',
  'menu.feedback': '反馈',
  'menu.feedback.description': '记录关于本次会话的反馈',
  'menu.export': '导出',
  'menu.export.description': '将会话日志下载为 ZIP 存档',
  'menu.permission': '权限',
  'menu.permission.description': '切换权限预设（沙箱模式 + 审批策略）',
  'menu.model': '模型',
  'menu.model.description': '选择本会话使用的模型',
} satisfies Record<string, string>

/** The command namespace key union. */
export type CommandKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
  'notice.imagesUnsupported': '/{command} does not accept image attachments; remove them first',
  // English menu rows mirror the Host catalog verbatim, so the English menu
  // and the Host's own descriptions never drift apart.
  'menu.goal': 'goal',
  'menu.goal.description': 'set or view the goal for a long-running task',
  'menu.plan': 'plan',
  'menu.plan.description': 'Enter or leave plan mode',
  'menu.compact': 'compact',
  'menu.compact.description': 'Compact older conversation history',
  'menu.feedback': 'feedback',
  'menu.feedback.description': 'record feedback about this session',
  'menu.export': 'export',
  'menu.export.description': 'Download this Session log as a ZIP archive',
  'menu.permission': 'permission',
  'menu.permission.description': 'Switch the permission preset (sandbox mode + approval policy)',
  'menu.model': 'model',
  'menu.model.description': 'Select the model for this conversation',
} satisfies Record<CommandKey, string>

/** Russian dictionary, checked complete against the zh key set. */
export const ru = {
  'search.placeholder': 'Поиск…',
  'search.aria': 'Фильтр вариантов',
  'status.loading': 'Загрузка вариантов…',
  'status.applying': 'Применение…',
  'status.empty': 'Нет вариантов',
  'overlay.aria': 'Варианты /{command}',
  'listbox.aria': 'Совпадения /{command}',
  'notice.imagesUnsupported': '/{command} не принимает вложения-изображения; сначала удалите их',
  'menu.goal': 'Цель',
  'menu.goal.description': 'Установить или просмотреть цель длительной задачи',
  'menu.plan': 'План',
  'menu.plan.description': 'Войти в режим плана или выйти из него',
  'menu.compact': 'Сжать',
  'menu.compact.description': 'Сжать более раннюю историю диалога',
  'menu.feedback': 'Отзыв',
  'menu.feedback.description': 'Записать отзыв об этой сессии',
  'menu.export': 'Экспорт',
  'menu.export.description': 'Скачать журнал этой сессии как ZIP-архив',
  'menu.permission': 'Права',
  'menu.permission.description': 'Переключить пресет прав (режим песочницы + политика одобрений)',
  'menu.model': 'Модель',
  'menu.model.description': 'Выбрать модель для этой сессии',
} satisfies Record<CommandKey, string>
