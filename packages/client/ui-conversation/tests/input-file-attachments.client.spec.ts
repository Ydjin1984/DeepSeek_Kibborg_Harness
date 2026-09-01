/**
 * Draft-file attachment flow in the input facade: minting via the public
 * addFiles action, removal/pruning, the attachment-only send path, and the
 * claimed-command refusal (commands never carry files).
 */
import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { SessionInputShell } from '../src/client/input/facade.ts'
import type { DraftAttachmentId } from '../src/client/contract/input.ts'

const commandImages = {
  serialize: () => Promise.resolve([]),
  release: () => {},
  unsupportedNotice: (token: string) => `${token.trim()} images-unsupported`,
}

function filesFixture(): {
  create: (files: readonly File[]) => DraftAttachmentId[]
  release: (ids: readonly DraftAttachmentId[]) => void
  unsupportedNotice: (token: string) => string
} {
  let seq = 0
  return {
    create: files => files.map(() => `file-${String(++seq)}` as DraftAttachmentId),
    release: vi.fn<(ids: readonly DraftAttachmentId[]) => void>(),
    unsupportedNotice: (token: string) => `${token.trim()} files-unsupported`,
  }
}

function makeFile(name: string, type = 'text/plain'): File {
  return new File(['content'], name, { type })
}

describe('draft file attachments', () => {
  it('mints browser-owned files and appends their ids to the draft', () => {
    const commandFiles = filesFixture()
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: vi.fn(),
      commandImages,
      commandFiles,
    })
    expect(shell.addFiles([makeFile('a.pdf', 'application/pdf'), makeFile('b.xlsx')])).toBeNull()
    expect(shell.snapshot.fileIds).toEqual(['file-1', 'file-2'])
    expect(shell.snapshot.imageIds).toEqual([])
  })

  it('refuses minting while an admission phase is locked', () => {
    const commandFiles = filesFixture()
    const settle = vi.fn()
    const pending = new Promise<SubmitOutcome>((resolve) => { settle.mockImplementation(resolve) })
    const sink = vi.fn(() => pending)
    const locked = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: sink,
      commandImages,
      commandFiles,
    })
    locked.setDraft('x')
    locked.submit()
    expect(locked.snapshot.phase).toBe('submitting')
    expect(locked.addFiles([makeFile('a.txt')])).toBeNull()
    expect(locked.snapshot.fileIds).toEqual([])
    settle({ kind: 'success' })
  })

  it('removes one file id and releases its browser-owned bytes', () => {
    const commandFiles = filesFixture()
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: vi.fn(),
      commandImages,
      commandFiles,
    })
    shell.addFiles([makeFile('a.txt')])
    shell.addFiles([makeFile('b.txt')])
    shell.removeFile('file-1' as DraftAttachmentId)
    expect(shell.snapshot.fileIds).toEqual(['file-2'])
    expect(commandFiles.release).toHaveBeenCalledWith(['file-1'])
  })

  it('prunes file ids whose browser-owned objects no longer resolve', () => {
    const commandFiles = filesFixture()
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: vi.fn(),
      commandImages,
      commandFiles,
    })
    shell.addFiles([makeFile('a.txt')])
    shell.addFiles([makeFile('b.txt')])
    shell.pruneFiles(['file-1' as DraftAttachmentId])
    expect(shell.snapshot.fileIds).toEqual(['file-1'])
  })

  it('sends an attachment-only prompt and clears both drafts on success', async () => {
    const commandFiles = filesFixture()
    const sink = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'success' }))
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: sink,
      commandImages,
      commandFiles,
    })
    shell.addImages(['img-1' as DraftAttachmentId])
    shell.addFiles([makeFile('a.txt')])
    shell.submit('queue')
    expect(sink).toHaveBeenCalledWith('', ['img-1'], ['file-1'], 'queue', expect.any(AbortSignal))
    await vi.waitFor(() => {
      expect(shell.snapshot.fileIds).toEqual([])
      expect(shell.snapshot.imageIds).toEqual([])
    })
  })

  it('retains files when the attachment-only send is rejected', async () => {
    const commandFiles = filesFixture()
    const sink = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'error' }))
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: sink,
      commandImages,
      commandFiles,
    })
    shell.addFiles([makeFile('a.txt')])
    shell.submit()
    await Promise.resolve()
    await Promise.resolve()
    expect(shell.snapshot.fileIds).toEqual(['file-1'])
  })

  it('carries files with a draft through the default sink', async () => {
    const commandFiles = filesFixture()
    const sink = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'success' }))
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: sink,
      commandImages,
      commandFiles,
    })
    shell.setDraft('read the files')
    shell.addFiles([makeFile('a.txt')])
    shell.submit('queue')
    expect(sink).toHaveBeenCalledWith('read the files', [], ['file-1'], 'queue', expect.any(AbortSignal))
    await vi.waitFor(() => {
      expect(shell.snapshot.fileIds).toEqual([])
      expect(shell.snapshot.draft).toBe('')
    })
  })

  it('refuses submit while a command is claimed and files are attached', () => {
    const commandFiles = filesFixture()
    const sink = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'success' }))
    const shell = new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: sink,
      commandImages,
      commandFiles,
    })
    shell.setDraft('/compact ')
    // Claim the /compact token so the draft reads as a claimed command.
    const accepted = shell.beginCommand({
      token: '/compact ',
      hint: 'compact the conversation',
      submit: () => Promise.resolve({ kind: 'success' }),
    }, { start: 0, end: 9, draftRev: shell.snapshot.draftRev })
    expect(accepted).toBe(true)
    shell.addFiles([makeFile('a.txt')])
    shell.submit()
    expect(sink).not.toHaveBeenCalled()
    expect(shell.notices.getSnapshot()).toMatchObject({
      level: 'error',
      text: '/compact files-unsupported',
    })
    expect(shell.snapshot.fileIds).toEqual(['file-1'])
  })
})
