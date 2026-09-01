// @vitest-environment jsdom
/**
 * PaperclipButton behavior: the format-unrestricted picker opens on click and
 * its selection feeds the session input; the button disables during removed
 * sessions and admission phases.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { PaperclipButton } from '../src/client/PaperclipButton.tsx'
import type { PaperclipButtonProps } from '../src/client/PaperclipButton.tsx'

afterEach(cleanup)

function t(key: string): string {
  return key
}

function makeFile(name: string, type = 'text/plain'): File {
  return new File(['content'], name, { type })
}

function props(overrides: Partial<{
  removed: boolean
  phase: 'plain' | 'adjudicating' | 'submitting' | 'claimed'
  addFiles: (files: readonly File[]) => string | null
}> = {}): PaperclipButtonProps {
  const runtime = {
    useSession: (selector: (snapshot: { removed: boolean }) => unknown) =>
      selector({ removed: overrides.removed ?? false }),
    useInput: (selector: (state: { phase: 'plain' | 'adjudicating' | 'submitting' | 'claimed' }) => unknown) =>
      selector({ phase: overrides.phase ?? 'plain' }),
    inputActions: { addFiles: overrides.addFiles ?? (() => null) },
    t: t as never,
  }
  return runtime as unknown as PaperclipButtonProps
}

describe('PaperclipButton', () => {
  const triggerOf = (container: HTMLElement): HTMLButtonElement => {
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="file.attach"]')
    if (trigger === null) throw new Error('paperclip trigger not rendered')
    return trigger
  }

  it('opens a format-unrestricted multi-picker and feeds the selection into the session input', () => {
    const addFiles = vi.fn(() => null)
    const view = render(<PaperclipButton {...props({ addFiles })} />)
    expect(triggerOf(view.container).disabled).toBe(false)
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    expect(input?.multiple).toBe(true)
    expect(input?.accept).toBe('')

    const picked = makeFile('report.pdf', 'application/pdf')
    fireEvent.change(input as HTMLInputElement, { target: { files: [picked] } })
    expect(addFiles).toHaveBeenCalledWith([picked])
    // Re-picking the same file works: the input value resets after change.
    fireEvent.change(input as HTMLInputElement, { target: { files: [picked] } })
    expect(addFiles).toHaveBeenCalledTimes(2)
  })

  it('disables while the session is removed or an admission phase is live', () => {
    const view = render(<PaperclipButton {...props({ phase: 'submitting' })} />)
    expect(triggerOf(view.container).disabled).toBe(true)
    view.rerender(<PaperclipButton {...props({ removed: true })} />)
    expect(triggerOf(view.container).disabled).toBe(true)
  })
})
