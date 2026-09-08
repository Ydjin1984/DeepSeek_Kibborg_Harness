import { describe, expect, it } from 'vitest'
import { clampLine, extractVisibleText, parseQuestionAnswers, questionAnswerLine, toolActionLine, toolOutcomeSuffix, userLine } from '../src/format.ts'

describe('format helpers', () => {
  it('prefixes user lines and clamps long content', () => {
    expect(userLine('привет')).toBe('👤 привет')
    const long = 'x'.repeat(5000)
    expect(clampLine(long)).toHaveLength(3900)
    expect(clampLine(long).endsWith('…')).toBe(true)
  })

  it('extracts only visible text blocks, skipping reasoning', () => {
    const content = [
      { type: 'text' as const, text: 'Привет' },
      { type: 'reasoning' as const, text: 'скрыто' },
      { type: 'text' as const, text: ', мир' },
    ]
    expect(extractVisibleText(content)).toBe('Привет, мир')
  })

  it('builds compact tool lines with an emoji by kind', () => {
    expect(toolActionLine('pnpm test', 'execute', 'bash')).toBe('🛠 pnpm test')
    expect(toolActionLine('Read src/a.ts', 'read', 'read')).toBe('📖 Read src/a.ts')
    expect(toolOutcomeSuffix(undefined)).toBe(' — ✅')
    expect(toolOutcomeSuffix('ERR')).toBe(' — ❌ ERR')
  })

  it('parses ask_user_question result JSON', () => {
    const parsed = parseQuestionAnswers('{"answers":[{"id":"q1","selected":["да"],"custom":"x"}]}')
    expect(parsed?.answers[0]).toEqual({ id: 'q1', selected: ['да'], custom: 'x' })
    expect(parseQuestionAnswers('not json')).toBeUndefined()
    expect(parseQuestionAnswers('{"answers":{}}')).toBeUndefined()
  })

  it('renders question answers human-readably', () => {
    const questions = [
      { id: 'q1', question: 'Продолжаем?' },
      { id: 'q2', question: 'Что делаем?' },
    ]
    const text = questionAnswerLine(questions, [
      { id: 'q1', selected: ['Да'] },
      { id: 'q2', selected: [], custom: 'Проверь логи' },
    ])
    expect(text).toContain('👤 Продолжаем?: Да')
    expect(text).toContain('👤 Что делаем?: «Проверь логи»')
  })
})
