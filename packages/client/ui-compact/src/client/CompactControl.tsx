/**
 * CompactControl: the composer's manual compaction button (the
 * `conversation.input.right` entry). It renders only when the host mounted the
 * compaction backend (the `compaction` session projection is present — the
 * capability-absence contract), shows a warning tint once projected occupancy
 * reaches the auto-compaction threshold, and disables while the agent is busy
 * or a compaction is already in flight. The action runs the `/compact` host
 * command; the settled result renders as the durable command/compaction flow
 * node, and only failures surface a transient toast here.
 */

import { useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Tooltip, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the `compaction` SessionProjectionMap key merge and the
// `contextPressure` occupancy vocabulary.
import type {} from '@deepseek-ai/dsh-compaction/client'
import type { ContextPressureProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { CompactControlInjected, CompactOutcome } from './slots.ts'
import type { CompactKey } from './locales.ts'
import css from './CompactControl.module.css'

/** Full props of the compact button: standard kit + injected face + locale seat. */
export type CompactControlProps =
  import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.right'>
  & CompactControlInjected
  & PropsLocale<'compact'>

/** Projected occupancy percent of the next request's prompt, or null while unknown. */
function occupancyPercent(pressure: ContextPressureProjection | undefined): number | null {
  if (pressure === undefined
    || pressure.projectedTokens === undefined
    || pressure.contextWindow === undefined
    || pressure.contextWindow <= 0) return null
  return pressure.projectedTokens / pressure.contextWindow * 100
}

/**
 * Render the composer compact button.
 * @param props - framework kit (projections, session facts), the injected
 * `/compact` verb, and the locale seat.
 * @returns the button, or nothing when the compaction capability is absent.
 */
export function CompactControl({
  useProjection, useSession, compact, t,
}: CompactControlProps) {
  const policy = useProjection('compaction')
  const pressure = useProjection('contextPressure')
  const running = useSession(s => s.running)
  const removed = useSession(s => s.removed)
  const [pending, setPending] = useState(false)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  // Same-render double-click fence (React's pending render cannot gate the
  // second click before the disabled attribute lands), the GoalBar pattern.
  const pendingRef = useRef(false)

  // Capability absence: no compaction backend mounted for this session.
  if (policy === undefined) return null

  const percent = occupancyPercent(pressure)
  const threshold = policy.thresholdRatio === undefined ? undefined : Math.round(policy.thresholdRatio * 100)
  const near = policy.auto && percent !== null && threshold !== undefined && percent >= threshold
  const busy = pending || policy.active
  const disabled = removed || running || busy

  const label: CompactKey = busy
    ? 'active'
    : policy.auto
      ? near ? 'near' : 'button'
      : 'manualOnly'
  const labelText = t(label, { percent: Math.round(percent ?? 0), threshold: threshold ?? 0 })

  const settle = (outcome: CompactOutcome): void => {
    if (outcome.kind === 'success') return
    toastSeq.current += 1
    setToast({
      seq: toastSeq.current,
      text: outcome.kind === 'unmatched' ? t('button') : outcome.text,
    })
  }

  const run = (): void => {
    if (disabled || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    void compact().then(
      (outcome) => {
        pendingRef.current = false
        setPending(false)
        settle(outcome)
      },
      (error: unknown) => {
        pendingRef.current = false
        setPending(false)
        toastSeq.current += 1
        setToast({ seq: toastSeq.current, text: error instanceof Error ? error.message : String(error) })
      },
    )
  }

  return (
    <span ref={rootRef} className={css.root}>
      <Tooltip label={labelText} side="top" delayMs={200}>
        <button
          type="button"
          className={near ? `${css.trigger} ${css.warn}` : css.trigger}
          aria-label={labelText}
          aria-busy={busy}
          disabled={disabled}
          onClick={run}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M8 2.5v4M8 6.5 5.75 4.25M8 6.5l2.25-2.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 13.5v-4M8 9.5l-2.25 2.25M8 9.5l2.25 2.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </Tooltip>
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </span>
  )
}
