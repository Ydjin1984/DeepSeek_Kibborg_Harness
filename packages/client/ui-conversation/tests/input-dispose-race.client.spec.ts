// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputTriggerController, SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { SessionInputShell } from '../src/client/input/facade.ts'
import type { DraftAttachmentId } from '../src/client/contract/input.ts'

const mention = '@[Research](dsh-session:InNvdXJjZSI)'

const commandImages = {
  serialize: () => Promise.resolve([]),
  release: () => {},
  unsupportedNotice: (token: string) => `${token.trim()} images-unsupported`,
}

const commandFiles = {
  create: (files: readonly File[]) => files.map(() => 'file-draft' as DraftAttachmentId),
  release: () => {},
  unsupportedNotice: (token: string) => `${token.trim()} files-unsupported`,
}

function chip(shell: SessionInputShell): void {
  shell.setDraft('@res')
  const accepted = shell.insertReference({
    source: 'reference',
    ref: mention,
    label: 'Research',
    clipboardText: mention,
  }, {
    start: 0,
    end: 4,
    draftRev: shell.snapshot.draftRev,
  })
  expect(accepted).toBe(true)
}

describe('dispose race on serializeReference (M5)', () => {
  it('drops Promise.all settlement silently when disposed between await and .then', async () => {
    let serializeResolve!: (value: string) => void
    const serializeRef = vi.fn(() => new Promise<string>((resolve) => { serializeResolve = resolve }))
    const sink = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'success' }))
    const inputTriggers = {
      serializeReference: serializeRef,
      track: vi.fn(),
    } as unknown as InputTriggerController

    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      inputTriggers: () => inputTriggers,
      defaultSink: sink,
      commandImages,
      commandFiles,
    })
    chip(shell)
    expect(shell.snapshot.occurrences).toHaveLength(1)

    shell.submit('queue')
    expect(shell.snapshot.phase).toBe('submitting')

    // serializeReference is awaiting; dispose shell NOW
    shell.dispose()
    // Now resolve the serializeReference promise
    serializeResolve!(mention)

    // After the microtask, the facade should have dropped the settlement
    // because this.disposed === true
    await vi.waitFor(() => {
      expect(shell.snapshot.phase).toBe('plain')
    })

    // defaultSink should NOT have been called because the Promise.all
    // settled after dispose (the .then guard at line 577 returns early)
    expect(sink).not.toHaveBeenCalled()
  })

  it('catches serializeReference rejection even after dispose', async () => {
    const serializeReject = vi.fn(() => Promise.reject(new Error('owner gone')))
    const sink = vi.fn()
    const inputTriggers = {
      serializeReference: serializeReject,
      track: vi.fn(),
    } as unknown as InputTriggerController

    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      inputTriggers: () => inputTriggers,
      defaultSink: sink,
      commandImages,
      commandFiles,
    })
    chip(shell)
    shell.submit('queue')
    expect(shell.snapshot.phase).toBe('submitting')

    // dispose while serializeReference is pending
    shell.dispose()

    await vi.waitFor(() => {
      expect(shell.snapshot.phase).toBe('plain')
    })

    // sink not called (rejection blocks send)
    expect(sink).not.toHaveBeenCalled()
    // phase returned to plain (error notice is dropped when disposed)
    expect(shell.snapshot.phase).toBe('plain')
  })

  it('handles multiple occurrences with dispose mid-serialize', async () => {
    let resolveFirst!: (v: string) => void
    let resolveSecond!: (v: string) => void
    const serializeRef = vi.fn((_source: string, ref: string) =>
      ref === 'second-ref'
        ? new Promise<string>((r) => { resolveSecond = r })
        : new Promise<string>((r) => { resolveFirst = r }),
    )
    const sink = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'success' }))
    const inputTriggers = {
      serializeReference: serializeRef,
      track: vi.fn(),
    } as unknown as InputTriggerController

    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      inputTriggers: () => inputTriggers,
      defaultSink: sink,
      commandImages,
      commandFiles,
    })
    shell.setDraft('@res @sec')

    // First chip: replace '@res' with reference
    const rev1 = shell.snapshot.draftRev
    shell.insertReference({
      source: 'reference',
      ref: mention,
      label: 'Research',
      clipboardText: mention,
    }, { start: 0, end: 4, draftRev: rev1 })

    // After first insert, '@sec' is now at position displayLength+1
    // Read the actual draft to find the right span
    const afterFirst = shell.snapshot.draft
    const secIndex = afterFirst.indexOf('@sec')
    expect(secIndex).toBeGreaterThanOrEqual(0)
    const rev2 = shell.snapshot.draftRev
    shell.insertReference({
      source: 'reference',
      ref: 'second-ref',
      label: 'Second',
      clipboardText: '@sec',
    }, { start: secIndex, end: secIndex + 4, draftRev: rev2 })

    // wait for machine to settle both inserts synchronously
    await Promise.resolve()
    expect(shell.snapshot.occurrences).toHaveLength(2)

    shell.submit('queue')
    expect(shell.snapshot.phase).toBe('submitting')

    // resolve only the first, then dispose
    resolveFirst!(mention)
    shell.dispose()
    // second resolves after dispose
    resolveSecond!('serialized-second')

    await vi.waitFor(() => {
      expect(shell.snapshot.phase).toBe('plain')
    })

    // Promise.all resolves with both, but .then guard drops it
    expect(sink).not.toHaveBeenCalled()
  })
})
