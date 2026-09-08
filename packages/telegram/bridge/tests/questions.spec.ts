import { describe, expect, it } from 'vitest'
import { TelegramQuestionProvider } from '../src/questions.ts'
import { RecorderTransport, flushMicrotasks } from './helpers.ts'

const quiet = { warn: () => {} }

describe('TelegramQuestionProvider', () => {
  it('asks a single-select question with option buttons and settles by callback', async () => {
    const transport = new RecorderTransport()
    const provider = new TelegramQuestionProvider(transport, quiet)
    const answer = provider.ask({ questions: [{ id: 'q', question: 'Продолжаем?', options: [{ label: 'Да' }, { label: 'Нет' }] }] })
    await flushMicrotasks()
    expect(transport.text(1)).toContain('Продолжаем?')
    expect(transport.messages[0]?.markup?.inline_keyboard.flatMap(row => row.map(button => button.callback_data))).toEqual(['opt:0', 'opt:1'])

    expect(await provider.handleCallbackQuery('opt:1')).toBe(true)
    await flushMicrotasks()
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['Нет'] }] })
    // The asked message is rewritten with the answer and its buttons dropped.
    expect(transport.text(1)).toContain('✅ Ваш ответ: Нет')
    expect(transport.messages[0]?.markup).toBeUndefined()
  })

  it('settles a free-text question from an inbound message', async () => {
    const transport = new RecorderTransport()
    const provider = new TelegramQuestionProvider(transport, quiet)
    const answer = provider.ask({ questions: [{ id: 'q', question: 'Что делаем?' }] })
    await flushMicrotasks()

    expect(await provider.handleText('Проверь логи')).toBe(true)
    await flushMicrotasks()
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: [], custom: 'Проверь логи' }] })
  })

  it('settles a multi-select question from numbered text', async () => {
    const transport = new RecorderTransport()
    const provider = new TelegramQuestionProvider(transport, quiet)
    const answer = provider.ask({
      questions: [{
        id: 'q', question: 'Что проверить?', multiSelect: true,
        options: [{ label: 'Логи' }, { label: 'Тесты' }, { label: 'Сборка' }],
      }],
    })
    await flushMicrotasks()
    expect(transport.text(1)).toContain('1) Логи')

    expect(await provider.handleText('1, 3')).toBe(true)
    await flushMicrotasks()
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['Логи', 'Сборка'] }] })
  })

  it('asks several questions one at a time', async () => {
    const transport = new RecorderTransport()
    const provider = new TelegramQuestionProvider(transport, quiet)
    const answer = provider.ask({
      questions: [
        { id: 'a', question: 'Первый?', options: [{ label: 'Да' }] },
        { id: 'b', question: 'Второй?' },
      ],
    })
    await flushMicrotasks()
    expect(transport.text(1)).toContain('Первый?')
    expect(transport.text(2)).toBeUndefined()

    await provider.handleCallbackQuery('opt:0')
    await flushMicrotasks()
    expect(transport.text(2)).toContain('Второй?')

    await provider.handleText('готово')
    await flushMicrotasks()
    await expect(answer).resolves.toEqual({
      answers: [{ id: 'a', selected: ['Да'] }, { id: 'b', selected: [], custom: 'готово' }],
    })
  })

  it('rejects with ASK_ABORTED and marks the question closed on signal abort', async () => {
    const transport = new RecorderTransport()
    const provider = new TelegramQuestionProvider(transport, quiet)
    const controller = new AbortController()
    const answer = provider.ask({
      questions: [{ id: 'q', question: 'Ждём?' }],
      signal: controller.signal,
    })
    await flushMicrotasks()
    controller.abort()
    await flushMicrotasks()

    await expect(answer).rejects.toMatchObject({ name: 'UserQuestionError', code: 'ASK_ABORTED' })
    expect(transport.text(1)).toContain('Вопрос закрыт')
  })

  it('ignores inbound text while no question is active', async () => {
    const provider = new TelegramQuestionProvider(new RecorderTransport(), quiet)
    expect(await provider.handleText('привет')).toBe(false)
    expect(await provider.handleCallbackQuery('opt:0')).toBe(false)
  })
})
