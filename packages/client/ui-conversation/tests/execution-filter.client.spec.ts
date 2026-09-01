// Execution trace filtering: category chips and free-text search.

import { describe, expect, it } from 'vitest'
import type { ExecutionEvent } from '../src/client/execution/execution-event.ts'
import {
  EXECUTION_FILTERS, executionStatusCounts, matchesFilter, matchesQuery,
} from '../src/client/execution/execution-filter.ts'

function event(overrides: Partial<ExecutionEvent>): ExecutionEvent {
  return {
    key: 'k', seq: 1, time: 1_000, kind: 'tool-call', category: 'tools', type: 'tool_call',
    status: 'success', title: 'read_file', description: 'src/auth/login.ts',
    ...overrides,
  }
}

describe('matchesFilter', () => {
  it('keeps every event under all', () => {
    for (const filter of EXECUTION_FILTERS) {
      expect(matchesFilter(event({ category: 'tools' }), filter === 'all' ? 'all' : filter))
        .toBe(filter === 'all' || filter === 'success' || filter === 'tools')
    }
  })

  it('buckets by category for the analysis/tools/files/terminal/git chips', () => {
    const analysis = event({ category: 'agent', type: 'analysis' })
    expect(matchesFilter(analysis, 'agent')).toBe(true)
    expect(matchesFilter(analysis, 'tools')).toBe(false)
    expect(matchesFilter(event({ category: 'files', type: 'file_edit' }), 'files')).toBe(true)
    expect(matchesFilter(event({ category: 'terminal', type: 'command' }), 'terminal')).toBe(true)
    expect(matchesFilter(event({ category: 'git', type: 'git_commit' }), 'git')).toBe(true)
    expect(matchesFilter(event({ category: 'message', type: 'user_message' }), 'agent')).toBe(false)
  })

  it('matches errors and successes by status', () => {
    expect(matchesFilter(event({ status: 'error', type: 'tool_error' }), 'errors')).toBe(true)
    expect(matchesFilter(event({ status: 'error', type: 'task_failed' }), 'errors')).toBe(true)
    expect(matchesFilter(event({ status: 'warning' }), 'errors')).toBe(false)
    expect(matchesFilter(event({ status: 'success' }), 'success')).toBe(true)
    expect(matchesFilter(event({ status: 'info' }), 'success')).toBe(false)
  })
})

describe('matchesQuery', () => {
  it('is case-insensitive over title, description, tool, path, and type', () => {
    const e = event({
      title: 'read_file',
      description: 'src/Auth/Login.ts',
      toolName: 'read_file',
      filePath: 'src/Auth/Login.ts',
      type: 'file_read',
    })
    expect(matchesQuery(e, 'AUTH')).toBe(true)
    expect(matchesQuery(e, 'login.ts')).toBe(true)
    expect(matchesQuery(e, 'file_read')).toBe(true)
    expect(matchesQuery(e, 'missing')).toBe(false)
    expect(matchesQuery(e, '   ')).toBe(true)
  })
})

describe('executionStatusCounts', () => {
  it('tallies events per status', () => {
    const counts = executionStatusCounts([
      event({ status: 'success' }),
      event({ status: 'error' }),
      event({ status: 'error' }),
      event({ status: 'running' }),
    ])
    expect(counts).toEqual({ running: 1, success: 1, warning: 0, error: 2, info: 0 })
  })
})
