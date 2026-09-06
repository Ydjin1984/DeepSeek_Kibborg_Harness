/** Root/subcall Tool composition with one keyed atomic dispatch path. */
import { memo, useMemo, type ReactNode } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import {
  runningSubagentActivityRows, shallowEqual,
} from '@deepseek-ai/dsh-client-runtime/client'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallOwnerProps, ToolTreeProps } from '../contract/slots.ts'
import { GenericToolCard } from './toolviews/GenericToolCard.tsx'
import css from './ToolCallTree.module.css'

/**
 * Wire tool names whose running call delegates to one or more subagent
 * children (the local orchestration executor and the generic subagent tool).
 */
const SUBAGENT_DELEGATION_TOOLS = new Set(['executor', 'subagent'])

/** Resolve a Tool call's wire name from either lifecycle form. */
function callName(node: ToolCallBlock): string {
  return 'kind' in node ? node.call?.name ?? '' : node.name
}

/**
 * Live strip under a running delegation call: one line per running subagent
 * child of this session, showing its catalog label and folded activity. It
 * mounts only for running delegation calls, so settled history rows never
 * subscribe to the session list.
 */
const RunningSubagentStrip = memo(function RunningSubagentStrip({
  sessionId, useSessions, t,
}: {
  sessionId: ToolTreeProps['sessionId']
  useSessions: ToolTreeProps['useSessions']
  t: ToolTreeProps['t']
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
          <span className={css.subagentActivityText} title={row.detail === '' ? row.label : `${row.label}: ${row.detail}`}>
            {row.detail === ''
              ? t('subagent.runningActivity', { label: row.label })
              : t('subagent.activityDetail', { label: row.label, detail: row.detail })}
          </span>
        </span>
      ))}
    </div>
  )
})

/** One atomic call dispatched through the Tool-owned keyed slot. */
const ToolCall = memo(function ToolCall({
  renderSlot, callId, toolName, block, openFile, selected, cwd, home, inspectCall, t, children,
}: Pick<ToolTreeProps, 'renderSlot' | 'openFile' | 'cwd' | 'inspectCall' | 't'> & {
  callId: string
  toolName: string
  block: ToolCallBlock
  selected: boolean
  home?: string | undefined
  children?: ReactNode
}) {
  const owner: ToolCallOwnerProps = useMemo(() => ({
    callId,
    toolName,
    block,
    openFile,
    cwd,
    home,
    inspect: () => { inspectCall(callId) },
  }), [callId, toolName, block, openFile, cwd, home, inspectCall])
  return (
    <div
      className={css.callRow}
      data-chat-anchor-key={`call:${callId}`}
      data-chat-call-id={callId}
      data-selected={selected || undefined}
    >
      {renderSlot('tool.call.toolview', owner, {
        entryKey: toolName,
        fallback: <GenericToolCard {...owner} t={t} />,
      })}
      {children}
    </div>
  )
})

const ToolCallBranch = memo(function ToolCallBranch({
  renderSlot, block, selectedCallId, cwd, home, openFile, inspectCall, t,
}: Pick<ToolTreeProps, 'renderSlot' | 'selectedCallId' | 'cwd' | 'openFile' | 'inspectCall' | 't'> & {
  block: ToolCallBlock
  home?: string | undefined
}) {
  return (
    <ToolCall
      renderSlot={renderSlot}
      callId={block.callId}
      toolName={callName(block)}
      block={block}
      openFile={openFile}
      selected={block.callId === selectedCallId}
      cwd={cwd}
      home={home}
      inspectCall={inspectCall}
      t={t}
    >
      {block.subCalls.length > 0 ? (
        <div className={css.subCalls} data-subcalls>
          {block.subCalls.map(child => (
            <ToolCallBranch
              key={child.callId}
              renderSlot={renderSlot}
              block={child}
              selectedCallId={selectedCallId}
              cwd={cwd}
              home={home}
              openFile={openFile}
              inspectCall={inspectCall}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </ToolCall>
  )
})

/**
 * Render one root Tool call and its recursive children through the same
 * atomic keyed dispatch.
 * @param props - whole-Tool owner data and the Tool-owned child-slot share.
 * @returns the Tool call tree.
 */
export function ToolCallTree({
  renderSlot, node, selectedCallId, cwd, openFile, inspectCall, useHostDescription, useSessions, sessionId, t,
}: ToolTreeProps) {
  const home = useHostDescription(description => description?.home)
  const block = node.data.root
  const toolName = callName(block)
  const runningDelegation = !('kind' in block) && SUBAGENT_DELEGATION_TOOLS.has(toolName)
  return (
    <>
      <ToolCallBranch
        renderSlot={renderSlot}
        block={block}
        selectedCallId={selectedCallId}
        cwd={cwd}
        home={home}
        openFile={openFile}
        inspectCall={inspectCall}
        t={t}
      />
      {runningDelegation && (
        <RunningSubagentStrip sessionId={sessionId} useSessions={useSessions} t={t} />
      )}
    </>
  )
}
