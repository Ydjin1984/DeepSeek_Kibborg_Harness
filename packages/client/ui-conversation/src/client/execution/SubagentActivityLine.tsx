// SubagentActivityLine: the execution-trace readout of every subagent child
// delegated by one session — one line per child (running and settled alike),
// so the trace shows which subagent did what, not just that a delegation call
// is in flight. The view mounts it under a delegation tool-call event
// (executor/subagent) while the row is collapsed; the expanded body dispatches
// the same Chat node, whose own Tool renderer shows the running strip. Each
// line carries the child's durable label, a live state dot, and its last
// folded activity (a tool name or a bounded reply snippet).

import { memo } from 'react'
import {
  subagentActivityRows, shallowEqual,
} from '@deepseek-ai/dsh-client-runtime/client'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './ExecutionEventRow.module.css'

/** Every direct subagent child of this session, running and settled. */
export const SubagentActivityLine = memo(function SubagentActivityLine({
  sessionId, useSessions, t,
}: {
  sessionId: ChatViewSlotProps['sessionId']
  useSessions: ChatViewSlotProps['useSessions']
  t: ChatViewSlotProps['t']
}) {
  const rows = useSessions(
    state => subagentActivityRows(sessionId, state.byId, state.subagentsByParent),
    shallowEqual,
  )
  if (rows.length === 0) return null
  return (
    <div className={css.subagentActivity} data-subagent-activity="" role="status" aria-live="polite">
      {rows.map((row) => {
        const text = row.running
          ? row.detail === ''
            ? t('subagent.runningActivity', { label: row.label })
            : t('subagent.activityDetail', { label: row.label, detail: row.detail })
          : t('subagent.completed', { label: row.label })
        return (
          <span key={row.sessionId} className={css.subagentActivityRow}>
            <StateDot state={row.running ? 'ongoing' : 'done'} />
            <span
              className={css.subagentActivityText}
              title={row.running && row.detail !== '' ? `${row.label}: ${row.detail}` : row.label}
            >
              {text}
            </span>
          </span>
        )
      })}
    </div>
  )
})
