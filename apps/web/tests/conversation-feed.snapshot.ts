// @vitest-environment jsdom
/** The built conversation graph projects one real fixture session into the execution journal. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { hasClass, installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/web/tests/snapshots/conversation-feed/activity.expected.txt')

installAssembledBootEnv()

it('renders grouped actions, prompt navigation and inline file detail from the assembled session', async () => {
  mountAssembledApp()
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  fireEvent.click(await within(tree).findByText('Fixture 历史会话'))
  await waitFor(() => { expect(document.querySelector('[data-tool="read"]')).not.toBeNull() }, { timeout: 10_000 })
  fireEvent.click(await screen.findByRole('tab', { name: 'Execution' }))
  const journal = await screen.findByTestId('execution-view')
  fireEvent.click(journal.querySelector<HTMLButtonElement>('[data-filter="files"]')!)
  const readRow = await waitFor(() => {
    const found = [...journal.querySelectorAll<HTMLElement>('[data-testid="execution-event"]')]
      .find(row => row.querySelector('[data-file-path]')?.textContent
        ?.includes('packages/client/ui-primitives/src/ReadBlock.tsx'))
    expect(found).toBeDefined()
    return found!
  })
  const file = readRow.querySelector<HTMLElement>('[data-file-path]')
  expect(file).not.toBeNull()
  fireEvent.click(file!)
  await waitFor(() => { expect(readRow.querySelector('[data-read]')).not.toBeNull() })

  const rows = [...journal.querySelectorAll('[data-testid="execution-event"]')]
  const actions = rows.slice(0, 16).map((row) => {
    const field = (name: string) => [...row.querySelectorAll('*')]
      .find(element => hasClass(element, name))?.textContent?.trim() ?? ''
    return [field('typeBadge'), field('title'), field('summary'), row.getAttribute('data-status')]
      .filter(Boolean).join(' | ')
  })
  const groups = [...journal.querySelectorAll('*')]
    .filter(element => hasClass(element, 'groupHeading'))
    .slice(0, 5).map(element => element.textContent?.trim() ?? '')
  const ticks = journal.querySelectorAll('[data-prompt-tick]').length
  const shape = [
    `groups=${groups.join(' / ')}`,
    `prompt-buttons=${ticks}`,
    `older-control=${within(journal).queryByRole('button', { name: 'Load earlier' }) !== null}`,
    `older-prompt-control=${journal.querySelector('[data-prompt-rail] [aria-label="Load earlier requests"]') !== null}`,
    ...actions.map(action => `action=${action}`),
    `read-open=${journal.querySelector('[data-read]') !== null}`,
  ].join('\n') + '\n'
  if (REFRESHING_GOLDEN) {
    mkdirSync(dirname(EXPECTED), { recursive: true })
    writeFileSync(EXPECTED, shape)
  }
  await expect(shape).toMatchFileSnapshot(EXPECTED)
})
