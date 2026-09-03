// @vitest-environment jsdom
/**
 * MarkdownDialog behavior: preview renders through MarkdownText, edit saves
 * through the injected verb, dirty close asks before discarding, and failures
 * surface inline.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownDialog, type MarkdownDialogProps } from '../src/client/MarkdownDialog.tsx'

afterEach(cleanup)

const t = ((key: string, params?: { message?: string }) => {
  if (key === 'markdownSaveFailed' && params?.message !== undefined) {
    return `markdownSaveFailed:${params.message}`
  }
  return key
}) as MarkdownDialogProps['t']

describe('MarkdownDialog', () => {
  it('previews the markdown content', () => {
    render(<MarkdownDialog name="note.md" initialText="# Заголовок" t={t} onSave={vi.fn()} onClose={vi.fn()} />)
    // MarkdownText renders the heading; the raw source stays in the edit tab only.
    expect(screen.getByText('Заголовок')).toBeTruthy()
  })

  it('edits and saves through the injected verb, then reports saved', async () => {
    const onSave = vi.fn(async () => undefined)
    render(<MarkdownDialog name="note.md" initialText="old" t={t} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'markdownEdit' }))
    const textarea = screen.getByRole('textbox', { name: 'markdownEdit' }) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'new text' } })
    fireEvent.click(screen.getByRole('button', { name: 'markdownSave' }))
    await waitFor(() => { expect(onSave).toHaveBeenCalledExactlyOnceWith('new text') })
    expect(screen.getByText('markdownSaved')).toBeTruthy()
  })

  it('reports a save failure inline', async () => {
    const onSave = vi.fn(async () => { throw new Error('disk full') })
    render(<MarkdownDialog name="note.md" initialText="old" t={t} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'markdownEdit' }))
    fireEvent.click(screen.getByRole('button', { name: 'markdownSave' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('disk full')
    })
  })

  it('asks before closing with unsaved edits', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onClose = vi.fn()
    render(<MarkdownDialog name="note.md" initialText="old" t={t} onSave={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('tab', { name: 'markdownEdit' }))
    const textarea = screen.getByRole('textbox', { name: 'markdownEdit' }) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'edited' } })
    fireEvent.click(screen.getByRole('button', { name: 'markdownClose' }))
    expect(confirmSpy).toHaveBeenCalledWith('markdownDirty')
    expect(onClose).toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('keeps the dialog open when a dirty close is declined', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onClose = vi.fn()
    render(<MarkdownDialog name="note.md" initialText="old" t={t} onSave={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('tab', { name: 'markdownEdit' }))
    const textarea = screen.getByRole('textbox', { name: 'markdownEdit' }) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'edited' } })
    fireEvent.click(screen.getByRole('button', { name: 'markdownClose' }))
    expect(onClose).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('closes cleanly when nothing was edited', () => {
    const onClose = vi.fn()
    render(<MarkdownDialog name="note.md" initialText="old" t={t} onSave={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'markdownClose' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape when nothing was edited', () => {
    const onClose = vi.fn()
    render(<MarkdownDialog name="note.md" initialText="old" t={t} onSave={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('asks before discarding a dirty draft on Escape', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onClose = vi.fn()
    render(<MarkdownDialog name="note.md" initialText="old" t={t} onSave={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('tab', { name: 'markdownEdit' }))
    const textarea = screen.getByRole('textbox', { name: 'markdownEdit' })
    fireEvent.change(textarea, { target: { value: 'edited' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(confirmSpy).toHaveBeenCalledWith('markdownDirty')
    expect(onClose).not.toHaveBeenCalled()
    confirmSpy.mockReturnValue(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    confirmSpy.mockRestore()
  })

  it('syncs the draft when a new file opens with fresh content', () => {
    const props: MarkdownDialogProps = {
      name: 'note.md', t, onSave: vi.fn(), onClose: vi.fn(),
    }
    const { rerender } = render(<MarkdownDialog {...props} initialText="first" />)
    rerender(<MarkdownDialog {...props} initialText="second" />)
    rerender(<MarkdownDialog {...props} initialText="second" />)
    fireEvent.click(screen.getByRole('tab', { name: 'markdownEdit' }))
    expect(screen.getByRole('textbox', { name: 'markdownEdit' }).value).toBe('second')
  })

  it('ignores extra save clicks while a save is in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const onSave = vi.fn(async () => { await gate })
    render(<MarkdownDialog name="note.md" initialText="old" t={t} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'markdownEdit' }))
    const save = screen.getByRole('button', { name: 'markdownSave' })
    fireEvent.click(save)
    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledTimes(1)
    await act(async () => { release() })
  })

  it('surfaces a non-Error save failure by its string value', async () => {
    const onSave = vi.fn(async () => { throw 'boom-string' })
    render(<MarkdownDialog name="note.md" initialText="old" t={t} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'markdownEdit' }))
    fireEvent.click(screen.getByRole('button', { name: 'markdownSave' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('boom-string')
    })
  })

  it('switches back to preview through the view tab', () => {
    render(<MarkdownDialog name="note.md" initialText="# Hi" t={t} onSave={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'markdownEdit' }))
    expect(screen.getByRole('textbox', { name: 'markdownEdit' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'markdownView' }))
    expect(screen.queryByRole('textbox', { name: 'markdownEdit' })).toBeNull()
    expect(screen.getByText('Hi')).toBeTruthy()
  })
})
