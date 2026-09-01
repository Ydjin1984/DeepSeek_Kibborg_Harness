/** `deliverables` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deliverables'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'produced.label': '产物',
  'produced.moreOne': '+ 1 个文件',
  'produced.moreFew': '+ {count} 个文件',
  'produced.more': '+ {count} 个文件',
  'produced.open': '打开 {name}',
  'produced.showInFolder': '在文件夹中显示',
}

/** English dictionary (same key set). */
export const en: Record<DeliverablesKey, string> = {
  'produced.label': 'Produced',
  'produced.moreOne': '+ 1 file',
  'produced.moreFew': '+ {count} files',
  'produced.more': '+ {count} files',
  'produced.open': 'Open {name}',
  'produced.showInFolder': 'Show in folder',
}

/** Russian dictionary (same key set). */
export const ru: Record<DeliverablesKey, string> = {
  'produced.label': 'Результаты',
  'produced.moreOne': '+ 1 файл',
  'produced.moreFew': '+ {count} файла',
  'produced.more': '+ {count} файлов',
  'produced.open': 'Открыть {name}',
  'produced.showInFolder': 'Показать в папке',
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof zh
