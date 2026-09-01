/** `compact` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'button': '压缩对话历史',
  'active': '正在压缩对话…',
  'near': '已接近自动压缩阈值（{percent}% / {threshold}%）',
  'manualOnly': '自动压缩已关闭，仅手动压缩',
} satisfies Record<string, string>

/** The compact namespace key union. */
export type CompactKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'button': 'Compact conversation history',
  'active': 'Compacting conversation…',
  'near': 'Near the auto-compaction threshold ({percent}% / {threshold}%)',
  'manualOnly': 'Auto-compaction is off — manual only',
} satisfies Record<CompactKey, string>

/** Russian dictionary, checked complete against the zh key set. */
export const ru = {
  'button': 'Сжать историю диалога',
  'active': 'Сжатие истории…',
  'near': 'Близко к порогу автосжатия ({percent}% / {threshold}%)',
  'manualOnly': 'Автосжатие выключено — только вручную',
} satisfies Record<CompactKey, string>
