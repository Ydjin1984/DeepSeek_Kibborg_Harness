// SubagentActivityLine: the execution-trace twin of the chat delegation
// strip — one line per running subagent child of this session under the
// running tool-call event that delegated to it. The view mounts it only for
// running executor/subagent calls and while the row is collapsed (the
// expanded body dispatches the same Chat node, whose own Tool renderer shows
// the strip), so settled rows never subscribe to the session list.

import { memo } from 'react'
import {
  runningSubagentActivityRows, shallowEqual,
} from '@deepseek-ai/dsh-client-runtime/client'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './ExecutionEventRow.module.css'

/** One live delegation strip under a running event row. */
export const SubagentActivityLine = memo(function SubagentActivityLine({
  sessionId, useSessions, t,
}: {
  sessionId: ChatViewSlotProps['sessionId']
  useSessions: ChatViewSlotProps['useSessions']
  t: ChatViewSlotProps['t']
}) {
  const rows = useSessions(
    state => runningSubagentActivityRows(sessionId, state.byId, state.subagentsByParent),
    shallowEqual,
  )
  if (rows.length === 0) return null
  return (
    <div className={css.subagentActivity} data-subagent-activity="" role="status" aria-live="polite">
      {rows.map(row => (
        <span key={row.sessionId} className={css.subagentActivityRow}>
          <StateDot state="ongoing" />
          <span
            className={css.subagentActivityText}
            title={row.detail === '' ? row.label : `${row.label}: ${row.detail}`}
          >
            {row.detail === ''
              ? t('subagent.runningActivity', { label: row.label })
              : t('subagent.activityDetail', { label: row.label, detail: row.detail })}
          </span>
        </span>
      ))}
    </div>
  )
})
