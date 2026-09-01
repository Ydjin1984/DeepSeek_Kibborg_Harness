// @vitest-environment jsdom
/** The trash section: empty line, per-entry restore and permanent delete. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrashSection } from '../src/client/TrashSection.tsx'
import type { TrashSectionProps } from '../src/client/TrashSection.tsx'
import { en } from '../src/client/locales.ts'
import { t, trashEntry } from './helpers.client.ts'

afterEach(cleanup)

function renderTrash(over: Partial<TrashSectionProps> = {}) {
  const onRestore = vi.fn()
  const onDeletePermanently = vi.fn()
  const props = {
    entries: [],
    t,
    busyName: null,
    onRestore,
    onDeletePermanently,
    ...over,
  } satisfies TrashSectionProps
  render(<TrashSection {...props} />)
  return { onRestore, onDeletePermanently }
}

describe('TrashSection', () => {
  it('says so when the trash is empty', () => {
    renderTrash()
    expect(screen.getByText(en.trashEmpty)).toBeTruthy()
  })

  it('lists every entry with its scope and path', () => {
    renderTrash({
      entries: [
        trashEntry({ name: 'alpha', scope: 'project', path: '/a/alpha' }),
        trashEntry({ name: 'beta', scope: 'agents', path: '/a/beta' }),
      ],
    })

    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.getByText('beta')).toBeTruthy()
    expect(screen.getByText('Project', { exact: false })).toBeTruthy()
    expect(screen.getByText('Agents', { exact: false })).toBeTruthy()
    expect(screen.getByText(/\/a\/alpha/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: en.actionRestore })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: en.actionDeletePermanently })).toHaveLength(2)
  })

  it('forwards restore and permanent delete per entry', () => {
    const { onRestore, onDeletePermanently } = renderTrash({
      entries: [trashEntry({ name: 'alpha' }), trashEntry({ name: 'beta' })],
    })

    fireEvent.click(screen.getAllByRole('button', { name: en.actionRestore })[1]!)
    fireEvent.click(screen.getAllByRole('button', { name: en.actionDeletePermanently })[0]!)

    expect(onRestore).toHaveBeenCalledExactlyOnceWith('beta')
    expect(onDeletePermanently).toHaveBeenCalledExactlyOnceWith('alpha')
  })

  it('blocks every row action while one is in flight', () => {
    renderTrash({ entries: [trashEntry()], busyName: 'restore:gone-skill' })

    expect(screen.getByRole('button', { name: en.actionRestore })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: en.actionDeletePermanently })).toHaveProperty('disabled', true)
  })
})
