// @vitest-environment jsdom
/** Built plugin graph: authored code remains literal in the draft and sent user card. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/web/tests/snapshots/conversation-feed/user-code.expected.txt')
const USER_TEXT = 'Please inspect this sample.\n```ts\nconst path = "@literal/path";\n```\nKeep the exact text.'

installAssembledBootEnv()

it('renders a user fenced code draft and message from the assembled session', async () => {
  mountAssembledApp()
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  const start = tree.querySelector<HTMLButtonElement>('button[aria-label="New session in fixture"]')
  if (start === null) throw new Error('fixture Workspace new-session action missing')
  fireEvent.click(start)
  const textarea = await screen.findByPlaceholderText('Describe what you want to build', {}, { timeout: 10_000 }) as HTMLTextAreaElement
  fireEvent.change(textarea, { target: { value: USER_TEXT } })
  expect(textarea.value).toBe(USER_TEXT)
  const backdrop = document.querySelector('[data-input-backdrop]')
  expect(backdrop?.querySelectorAll('[data-decoration="code-fence"]').length).toBe(2)
  expect(backdrop?.querySelector('[data-decoration="code-content"]')?.textContent)
    .toContain('@literal/path')
  expect(backdrop?.querySelector('[data-ref-chip]')).toBeNull()
  const draftFences = backdrop?.querySelectorAll('[data-decoration="code-fence"]').length

  const send = await screen.findByRole('button', { name: 'Send message' })
  await waitFor(() => { expect(send.hasAttribute('disabled')).toBe(false) }, { timeout: 10_000 })
  fireEvent.click(send)
  fireEvent.click(await screen.findByRole('tab', { name: 'Chat' }))
  const card = await waitFor(() => {
    const found = document.querySelector('.md-code-block')
    expect(found).not.toBeNull()
    return found!
  }, { timeout: 10_000 })
  expect(textarea.value).toBe('')
  const bubble = card.closest('[data-time-hover-root]')
  expect(bubble).not.toBeNull()
  const shape = [
    `draft-fences=${draftFences}`,
    `card-language=${card.querySelector('[class*="infostring"]')?.textContent}`,
    `card-code=${card.querySelector('pre')?.textContent}`,
    `before=${bubble?.textContent?.includes('Please inspect this sample.') ?? false}`,
    `after=${bubble?.textContent?.includes('Keep the exact text.') ?? false}`,
    `literal-reference=${bubble?.querySelector('[data-ref-chip]') === null}`,
  ].join('\n')
  if (REFRESHING_GOLDEN) {
    mkdirSync(dirname(EXPECTED), { recursive: true })
    writeFileSync(EXPECTED, shape)
  }
  await expect(shape).toMatchFileSnapshot(EXPECTED)
})
