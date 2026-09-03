/** Locale bundles for the workspace file panel (ui-files). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'files'

/** Locale keys the file panel surfaces render. */
export type FilesLocaleKey =
  | 'openButton'
  | 'drawerTitle'
  | 'drawerClose'
  | 'drawerEmpty'
  | 'folder'
  | 'file'
  | 'loadFailed'
  | 'retry'
  | 'hiddenFiles'
  | 'dropNotText'
  | 'dropFailed'
  | 'dropTooLarge'
  | 'openFailed'
  | 'markdownTitle'
  | 'markdownView'
  | 'markdownEdit'
  | 'markdownSave'
  | 'markdownSaving'
  | 'markdownSaved'
  | 'markdownSaveFailed'
  | 'markdownCancel'
  | 'markdownClose'
  | 'markdownDirty'

/** English copy. */
export const en: Record<FilesLocaleKey, string> = {
  openButton: 'Files',
  drawerTitle: 'Files',
  drawerClose: 'Close the file panel',
  drawerEmpty: 'No project folder for this session yet.',
  folder: 'Folder',
  file: 'File',
  loadFailed: 'Could not read this folder.',
  retry: 'Retry',
  hiddenFiles: 'Show hidden files',
  dropNotText: 'This file is not readable text.',
  dropFailed: 'Could not attach the file: {message}',
  dropTooLarge: 'This file is larger than the attachment limit.',
  openFailed: 'Could not open the file: {message}',
  markdownTitle: 'Markdown',
  markdownView: 'Preview',
  markdownEdit: 'Edit',
  markdownSave: 'Save',
  markdownSaving: 'Saving…',
  markdownSaved: 'Saved.',
  markdownSaveFailed: 'Could not save: {message}',
  markdownCancel: 'Cancel',
  markdownClose: 'Close',
  markdownDirty: 'Discard unsaved changes?',
}

/** Simplified Chinese copy. */
export const zh: Record<FilesLocaleKey, string> = {
  openButton: '文件',
  drawerTitle: '文件',
  drawerClose: '关闭文件面板',
  drawerEmpty: '当前会话还没有项目文件夹。',
  folder: '文件夹',
  file: '文件',
  loadFailed: '无法读取此文件夹。',
  retry: '重试',
  hiddenFiles: '显示隐藏文件',
  dropNotText: '该文件不是可读文本。',
  dropFailed: '无法附加文件：{message}',
  dropTooLarge: '该文件超过附件大小限制。',
  openFailed: '无法打开文件：{message}',
  markdownTitle: 'Markdown',
  markdownView: '预览',
  markdownEdit: '编辑',
  markdownSave: '保存',
  markdownSaving: '保存中…',
  markdownSaved: '已保存。',
  markdownSaveFailed: '无法保存：{message}',
  markdownCancel: '取消',
  markdownClose: '关闭',
  markdownDirty: '放弃未保存的更改？',
}

/** Russian copy. */
export const ru: Record<FilesLocaleKey, string> = {
  openButton: 'Файлы',
  drawerTitle: 'Файлы',
  drawerClose: 'Закрыть панель файлов',
  drawerEmpty: 'У этой сессии ещё нет папки проекта.',
  folder: 'Папка',
  file: 'Файл',
  loadFailed: 'Не удалось прочитать эту папку.',
  retry: 'Повторить',
  hiddenFiles: 'Показывать скрытые файлы',
  dropNotText: 'Этот файл не является читаемым текстом.',
  dropFailed: 'Не удалось прикрепить файл: {message}',
  dropTooLarge: 'Файл больше лимита вложения.',
  openFailed: 'Не удалось открыть файл: {message}',
  markdownTitle: 'Markdown',
  markdownView: 'Просмотр',
  markdownEdit: 'Правка',
  markdownSave: 'Сохранить',
  markdownSaving: 'Сохранение…',
  markdownSaved: 'Сохранено.',
  markdownSaveFailed: 'Не удалось сохранить: {message}',
  markdownCancel: 'Отмена',
  markdownClose: 'Закрыть',
  markdownDirty: 'Отменить несохранённые изменения?',
}
