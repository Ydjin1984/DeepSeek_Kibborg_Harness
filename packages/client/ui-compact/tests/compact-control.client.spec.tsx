// @vitest-environment jsdom
// CompactControl (composer compact button): capability gating, the warning
// tint at the auto-compaction threshold, disable states, and the /compact
// outcome surface (silent success, error/unmatched toasts).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn, zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/index.ts'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { CompactOutcome } from '../src/client/slots.ts'
import { CompactControl, type CompactControlProps } from '../src/client/CompactControl.tsx'
import css from '../src/client/CompactControl.module.css'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

// Mirrors the real lookup chain (compact namespace, then common).
const t = makeTranslate(zh, commonZh) as CompactControlProps['t']

const warnClass = css.warn
if (warnClass === undefined) throw new Error('warn class missing from CompactControl.module.css')

/** Projection seat stub: a key-addressed table of whole values. */
function projections(values: Record<string, unknown>): CompactControlProps['useProjection'] {
  return (key: string) => values[key]
}

function control(
  values: Record<string, unknown>,
  session: Partial<ConversationSnapshot> = {},
  compact: () => Promise<CompactOutcome> = async () => ({ kind: 'success' }),
) {
  const useSession = ((selector: (snapshot: ConversationSnapshot) => unknown) => {
    const snapshot = { running: false, removed: false, ...session } as ConversationSnapshot
    return selector(snapshot)
  }) as CompactControlProps['useSession']
  // The framework standard kit is a full share (useInput/inputActions/sessionId
  // included); the component ignores everything it does not destructure, so the
  // stubs are cast rather than re-typed.
  const props = {
    useProjection: projections(values),
    useSession,
    session: {} as ConversationSnapshot,
    input: undefined as unknown as CompactControlProps['input'],
    compact,
    t,
  } as unknown as CompactControlProps
  return render(<CompactControl {...props} />)
}

const POLICY = { auto: true, thresholdRatio: 0.8, active: false }
const PRESSURE_80 = { pressureTokens: 32_000, projectedTokens: 102_400, contextWindow: 128_000 }

describe('CompactControl', () => {
  it('renders nothing while the compaction capability is absent', () => {
    expect(control({}).container.textContent).toBe('')
    expect(control({ contextPressure: PRESSURE_80 }).container.textContent).toBe('')
  })

  it('renders the button with the base label when mounted', () => {
    const view = control({ compaction: POLICY })
    const button = view.getByRole('button', { name: '压缩对话历史' })
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('tints and re-labels when occupancy reaches the auto-compaction threshold', () => {
    const view = control({ compaction: POLICY, contextPressure: PRESSURE_80 })
    const button = view.getByRole('button', { name: '已接近自动压缩阈值（80% / 80%）' })
    expect(button.className).toContain(warnClass)
  })

  it('stays neutral below the threshold', () => {
    const view = control({
      compaction: POLICY,
      contextPressure: { pressureTokens: 32_000, projectedTokens: 64_000, contextWindow: 128_000 },
    })
    const button = view.getByRole('button', { name: '压缩对话历史' })
    expect(button.className).not.toContain(warnClass)
  })

  it('disables while the agent is running', () => {
    const view = control({ compaction: POLICY }, { running: true })
    expect(view.getByRole('button').hasAttribute('disabled')).toBe(true)
  })

  it('disables while a compaction is in flight', () => {
    const view = control({ compaction: { ...POLICY, active: true } })
    expect(view.getByRole('button', { name: '正在压缩对话…' }).hasAttribute('disabled')).toBe(true)
  })

  it('labels manual-only when automatic compaction is off', () => {
    const view = control({ compaction: { auto: false, thresholdRatio: 0.8, active: false } })
    expect(view.getByRole('button', { name: '自动压缩已关闭，仅手动压缩' }).hasAttribute('disabled')).toBe(false)
  })

  it('runs /compact and stays silent on success', async () => {
    const compact = vi.fn(async (): Promise<CompactOutcome> => ({ kind: 'success' }))
    const view = control({ compaction: POLICY }, {}, compact)
    fireEvent.click(view.getByRole('button'))
    expect(compact).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(view.container.querySelector('[role="alert"]')).toBeNull()
  })

  it('surfaces an error outcome as a transient toast', async () => {
    const compact = vi.fn(async (): Promise<CompactOutcome> => ({
      kind: 'error',
      text: 'Compaction is unavailable because the agent is not idle.',
    }))
    const view = control({ compaction: POLICY }, {}, compact)
    fireEvent.click(view.getByRole('button'))
    const alert = await vi.waitFor(() => {
      const found = document.body.querySelector('[role="alert"]')
      if (found === null) throw new Error('toast not rendered')
      return found
    })
    expect(alert.textContent).toContain('agent is not idle')
  })

  it('disables while its own request is pending', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const compact = vi.fn(async (): Promise<CompactOutcome> => {
      await gate
      return { kind: 'success' }
    })
    const view = control({ compaction: POLICY }, {}, compact)
    fireEvent.click(view.getByRole('button'))
    expect(view.getByRole('button').hasAttribute('disabled')).toBe(true)
    release?.()
    await Promise.resolve()
  })

  it('single-flights rapid clicks while the request is pending', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const compact = vi.fn(async (): Promise<CompactOutcome> => {
      await gate
      return { kind: 'success' }
    })
    const view = control({ compaction: POLICY }, {}, compact)
    const button = view.getByRole('button')
    // Both clicks land in the same act before the pending render applies the
    // disabled attribute, so the ref fence is the only gate.
    act(() => {
      button.click()
      button.click()
    })
    expect(compact).toHaveBeenCalledTimes(1)
    release?.()
    await Promise.resolve()
  })

  it('renders with zero threshold and occupancy when the projection omits them', () => {
    const view = control({
      compaction: { auto: true, active: false },
      contextPressure: { pressureTokens: 32_000 },
    })
    // threshold ?? 0 and percent ?? 0 feed the interpolation.
    expect(view.getByRole('button', { name: '压缩对话历史' })).toBeTruthy()
  })

  it('surfaces an unmatched outcome as a transient toast', async () => {
    const compact = vi.fn(async (): Promise<CompactOutcome> => ({ kind: 'unmatched' }))
    const view = control({ compaction: POLICY }, {}, compact)
    fireEvent.click(view.getByRole('button'))
    const alert = await vi.waitFor(() => {
      const found = document.body.querySelector('[role="alert"]')
      if (found === null) throw new Error('toast not rendered')
      return found
    })
    expect(alert.textContent).toContain('压缩对话历史')
  })

  it('surfaces a rejected transport as a transient toast', async () => {
    const compact = vi.fn(async (): Promise<CompactOutcome> => {
      throw new Error('connection lost')
    })
    const view = control({ compaction: POLICY }, {}, compact)
    fireEvent.click(view.getByRole('button'))
    const alert = await vi.waitFor(() => {
      const found = document.body.querySelector('[role="alert"]')
      if (found === null) throw new Error('toast not rendered')
      return found
    })
    expect(alert.textContent).toContain('connection lost')
  })

  it('stringifies a non-Error transport rejection', async () => {
    const compact = vi.fn(async (): Promise<CompactOutcome> => {
      throw 'plain rejection'
    })
    const view = control({ compaction: POLICY }, {}, compact)
    fireEvent.click(view.getByRole('button'))
    const alert = await vi.waitFor(() => {
      const found = document.body.querySelector('[role="alert"]')
      if (found === null) throw new Error('toast not rendered')
      return found
    })
    expect(alert.textContent).toContain('plain rejection')
  })

  it('dismisses the toast when it finishes', async () => {
    const compact = vi.fn(async (): Promise<CompactOutcome> => ({
      kind: 'error',
      text: 'Compaction is unavailable because the agent is not idle.',
    }))
    const view = control({ compaction: POLICY }, {}, compact)
    fireEvent.click(view.getByRole('button'))
    const alert = await vi.waitFor(() => {
      const found = document.body.querySelector('[role="alert"]')
      if (found === null) throw new Error('toast not rendered')
      return found
    })
    expect(alert.textContent).toContain('agent is not idle')
    // The Toast holds HOLD_MS then fades; onDone clears the local state.
    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="alert"]')).toBeNull()
    }, { timeout: 6_000 })
  })
})

describe('CompactControl English copy', () => {
  it('uses the English dictionary when the locale seat is English', () => {
    const tEn = makeTranslate(en, commonEn) as CompactControlProps['t']
    const useSession = ((selector: (snapshot: ConversationSnapshot) => unknown) =>
      selector({ running: false, removed: false } as ConversationSnapshot)) as CompactControlProps['useSession']
    const props = {
      useProjection: projections({ compaction: { auto: true, thresholdRatio: 0.8, active: false } }),
      useSession,
      session: {} as ConversationSnapshot,
      input: undefined as unknown as CompactControlProps['input'],
      compact: async (): Promise<CompactOutcome> => ({ kind: 'success' }),
      t: tEn,
    } as unknown as CompactControlProps
    const view = render(<CompactControl {...props} />)
    expect(view.getByRole('button', { name: 'Compact conversation history' })).toBeTruthy()
  })
})
