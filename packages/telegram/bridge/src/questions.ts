/**
 * The Telegram answer channel for `ctx.userQuestions`: renders each question
 * as a chat message (option buttons for single-select choices, numbered
 * choices for multi-select, free text otherwise) and resolves the ask once
 * every question is answered. Questions are asked one at a time so each
 * incoming button press or text answer is unambiguous. The provider aborts
 * (and marks its messages) when the shared signal fires — a competing channel
 * answered first, or the owning step was cancelled.
 * @module @deepseek-ai/dsh-telegram-bridge/questions
 */

import { UserQuestionError, type AskUserQuestionAnswer, type AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type { ChatTransport } from './chat.ts'
import type { InlineKeyboardMarkup } from './types.ts'

/** Callback payload prefix for one option button. */
const OPTION_DATA_PREFIX = 'opt:'

/** One in-flight ask: current question index plus collected answers. */
interface PendingAsk {
  request: AskUserQuestionRequest
  messageIds: number[]
  index: number
  answers: { id: string; selected: string[]; custom?: string }[]
  resolve: (answer: AskUserQuestionAnswer) => void
  reject: (error: UserQuestionError) => void
  onAbort: () => void
}

/** Minimal logger surface. */
export interface QuestionLogger {
  warn(message: string): void
}

/**
 * Collects one answer batch through a Telegram chat. Owns a single in-flight
 * ask at a time; a second concurrent ask (parallel tool calls) is rejected as
 * unsupported by the channel.
 */
export class TelegramQuestionProvider {
  private active: PendingAsk | null = null

  constructor(
    private readonly transport: ChatTransport,
    private readonly logger: QuestionLogger,
  ) {}

  /** Whether a question is currently waiting for an answer in this chat. */
  get hasActiveQuestion(): boolean {
    return this.active !== null
  }

  /** Ask the user and wait for the batch answer. */
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    if (this.active !== null) {
      return Promise.reject(new UserQuestionError(
        'the Telegram channel already waits on an earlier question batch',
        'TELEGRAM_BUSY'))
    }
    return new Promise<AskUserQuestionAnswer>((resolve, reject) => {
      const onAbort = (): void => {
        const active = this.active
        if (active === null) return
        this.active = null
        void this.markClosed(active, 'Вопрос закрыт')
        active.reject(new UserQuestionError(
          'ask_user_question was aborted before the user answered', 'ASK_ABORTED'))
      }
      const pending: PendingAsk = {
        request, messageIds: [], index: 0, answers: [], resolve, reject, onAbort,
      }
      this.active = pending
      request.signal?.addEventListener('abort', onAbort, { once: true })
      void this.askCurrent(pending)
    })
  }

  /** Handle one inbound button press; returns whether the provider consumed it. */
  async handleCallbackQuery(data: string | undefined): Promise<boolean> {
    const active = this.active
    if (active === null) return false
    if (!data?.startsWith(OPTION_DATA_PREFIX)) return false
    const optionIndex = Number(data.slice(OPTION_DATA_PREFIX.length))
    const question = active.request.questions[active.index]
    if (question === undefined || question.options === undefined || question.multiSelect === true) {
      return false
    }
    const option = question.options[optionIndex]
    if (option === undefined) return false
    await this.settle(active, { id: question.id, selected: [option.label] })
    return true
  }

  /** Handle one inbound text message; returns whether the provider consumed it. */
  async handleText(text: string): Promise<boolean> {
    const active = this.active
    if (active === null) return false
    const question = active.request.questions[active.index]
    if (question === undefined) return false
    const trimmed = text.trim()
    if (trimmed === '') return false
    if (question.options !== undefined && question.multiSelect === true) {
      const labels = this.labelsByNumbers(question.options.map(option => option.label), trimmed)
      if (labels.length === 0) return false
      await this.settle(active, { id: question.id, selected: labels })
      return true
    }
    await this.settle(active, { id: question.id, selected: [], custom: trimmed })
    return true
  }

  /** Cancel any in-flight ask without marking (used while the mirror detaches). */
  abortActive(): void {
    if (this.active !== null) this.active.onAbort()
  }

  private async askCurrent(pending: PendingAsk): Promise<void> {
    const question = pending.request.questions[pending.index]
    if (question === undefined) return
    try {
      const { text, markup } = this.renderQuestion(question, pending.index, pending.request.questions.length)
      const messageId = await this.transport.sendText(text, markup)
      pending.messageIds.push(messageId)
    } catch (error: unknown) {
      this.logger.warn(`telegram question send failed: ${String(error)}`)
    }
  }

  private renderQuestion(
    question: AskUserQuestionRequest['questions'][number],
    index: number,
    total: number,
  ): { text: string; markup: InlineKeyboardMarkup | undefined } {
    const heading = total > 1 ? `Вопрос ${index + 1}/${total}\n` : ''
    const options = question.options
    if (options !== undefined && options.length > 0 && question.multiSelect !== true) {
      const markup: InlineKeyboardMarkup = {
        inline_keyboard: options.map((option, optionIndex) => [{
          text: option.label,
          callback_data: `${OPTION_DATA_PREFIX}${optionIndex}`,
        }]),
      }
      return {
        text: `${heading}${question.question}\nВыберите вариант ниже или ответьте своим текстом.`,
        markup,
      }
    }
    if (options !== undefined && question.multiSelect === true) {
      const lines = options.map((option, optionIndex) => `${optionIndex + 1}) ${option.label}`)
      return {
        text: `${heading}${question.question}\nМожно выбрать несколько. Ответьте номерами через запятую:\n${lines.join('\n')}`,
        markup: undefined,
      }
    }
    return {
      text: `${heading}${question.question}\n(Ответьте своим текстом.)`,
      markup: undefined,
    }
  }

  private labelsByNumbers(labels: string[], raw: string): string[] {
    const numbers = raw.split(',').map(part => Number(part.trim())).filter(Number.isInteger)
    const picked: string[] = []
    for (const number of numbers) {
      const label = labels[number - 1]
      if (label !== undefined && !picked.includes(label)) picked.push(label)
    }
    return picked
  }

  private async settle(
    pending: PendingAsk,
    answer: { id: string; selected: string[]; custom?: string },
  ): Promise<void> {
    const question = pending.request.questions[pending.index]
    const display = [
      ...answer.selected,
      ...(answer.custom === undefined ? [] : [answer.custom]),
    ].join(', ')
    const messageId = pending.messageIds[pending.index]
    if (messageId !== undefined) {
      const base = question === undefined ? '' : question.question
      const edited = this.transport.editText(messageId, `${base}\n✅ Ваш ответ: ${display}`)
      void edited
        .then(() => this.transport.clearKeyboard(messageId))
        .catch((reason: unknown) => this.logger.warn(`telegram question edit failed: ${String(reason)}`))
    }
    pending.answers.push(answer)
    if (pending.index + 1 < pending.request.questions.length) {
      pending.index += 1
      void this.askCurrent(pending)
      return
    }
    const active = this.active
    this.active = null
    if (active !== null) active.request.signal?.removeEventListener('abort', active.onAbort)
    pending.resolve({ answers: pending.answers })
  }

  private async markClosed(pending: PendingAsk, label: string): Promise<void> {
    for (const messageId of pending.messageIds) {
      try {
        await this.transport.editText(messageId, label)
        await this.transport.clearKeyboard(messageId)
      } catch (error: unknown) {
        this.logger.warn(`telegram question close failed: ${String(error)}`)
      }
    }
  }
}
