// Browser geometry and navigation over the built fixture client.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, type WebScaffold } from './scaffold.ts'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

let scaffold: WebScaffold
let browser: Browser
let page: Page
const fixture = createChatScrollFixture({
  markerPrefix: 'JOURNAL', title: 'JOURNAL_BROWSER_HISTORY', turns: 310,
})

beforeAll(async () => {
  scaffold = await launchWebScaffold({})
  await seedSession(scaffold, fixture.log, 'journal-browser-history')
  browser = await chromium.launch()
  page = await newEnglishPage(browser, 900)
  await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await scaffold?.close()
})

it('keeps prompt ticks centered and preserves manual bottom control', async () => {
  onTestFailed(() => saveFailureShot(page, 'conversation-feed'))
  const welcome = page.getByRole('dialog', { name: 'Internal Testing Notice' })
  if (await welcome.isVisible()) {
    await welcome.getByRole('button', { name: 'Continue' }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })
  }
  await page.getByText('Ungrouped', { exact: true }).waitFor({ timeout: 30_000 })
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  await page.getByRole('textbox', { name: 'Search sessions...', exact: true })
    .fill(fixture.markers.user(1))
  const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await expect.poll(() => result.count(), { timeout: 60_000 }).toBe(1)
  await result.click()
  await page.getByRole('tab', { name: 'Chat' }).click()
  const chatRows = page.locator('[data-chat-flow-key]')
  await expect.poll(() => chatRows.count()).toBeGreaterThan(0)
  const chatFlow = page.locator('[data-chat-flow]')
  await chatFlow.getByText(fixture.markers.user(80), { exact: false }).waitFor({ timeout: 90_000 }).catch(async (error: unknown) => {
    const markers = (await chatFlow.textContent())?.match(/CHAT_SCROLL_JOURNAL_USER_\d{3}/g) ?? []
    throw new Error(`History boundary unavailable: ${String(error)}; users=${markers.length}, first=${markers[0]}, last=${markers.at(-1)}`)
  })
  expect(await chatFlow.getByText(fixture.markers.user(60), { exact: false }).count()).toBe(0)
  const initiallyLoaded = await chatRows.count()
  const codeGeometry = await chatFlow.locator('.md-code-block').last().evaluate(element => ({
    bannerBottom: element.children[0]?.getBoundingClientRect().bottom ?? 0,
    codeTop: element.querySelector('pre')?.getBoundingClientRect().top ?? 0,
    linePadding: Number.parseFloat(getComputedStyle(element.querySelector('pre.shiki .line')!).paddingLeft),
    lineNumber: getComputedStyle(element.querySelector('pre.shiki .line')!, '::before').content,
  }))
  expect(codeGeometry.bannerBottom).toBeLessThanOrEqual(codeGeometry.codeTop + 1)
  expect(codeGeometry.linePadding).toBeGreaterThan(30)
  expect(codeGeometry.lineNumber).toBe('counter(code-line)')
  const artifactDir = join(process.cwd(), '.artifacts')
  mkdirSync(artifactDir, { recursive: true })
  await chatFlow.locator('.md-code-block').last().evaluate((element) => { element.scrollIntoView({ block: 'start' }) })
  await page.screenshot({ path: join(artifactDir, 'code-block-review.png'), fullPage: false })
  await page.getByRole('button', { name: 'Load earlier', exact: true }).waitFor({ timeout: 90_000 })
  await page.locator('[data-conversation-scroll]').evaluate((element) => { element.scrollTop = 0 })
  await page.getByRole('button', { name: 'Load earlier', exact: true }).click()
  await expect.poll(() => chatRows.count(), { timeout: 30_000 }).toBeGreaterThan(initiallyLoaded)
  await chatFlow.getByText(fixture.markers.user(60), { exact: false }).waitFor()
  expect(await chatFlow.getByText(fixture.markers.user(1), { exact: false }).count()).toBe(0)
  await page.getByRole('tab', { name: 'Execution' }).click()
  const list = page.getByTestId('execution-list')
  expect(await list.locator('[data-execution-row-key]').count()).toBeLessThanOrEqual(120)
  const rail = list.locator('[data-prompt-rail]')
  await rail.waitFor()
  const ticks = rail.locator('[data-prompt-tick]')
  expect(await ticks.count()).toBeLessThanOrEqual(9)
  expect(await ticks.count()).toBeGreaterThan(1)
  const listBox = await list.boundingBox()
  const railBox = await rail.boundingBox()
  if (listBox === null || railBox === null) throw new Error('journal rail geometry unavailable')
  expect(Math.abs(railBox.y + railBox.height / 2 - listBox.y - listBox.height / 2))
    .toBeLessThan(100)

  await page.screenshot({
    path: join(artifactDir, 'conversation-feed-review.png'),
    fullPage: false,
  })

  const jump = list.getByRole('button', { name: 'Jump to latest' })
  await expect.poll(() => jump.count()).toBe(0)
  const bottom = await list.evaluate(element => element.scrollTop)
  await ticks.first().click()
  await expect.poll(() => list.evaluate(element => element.scrollTop))
    .toBeLessThan(bottom)
  await jump.waitFor()
  await jump.click()
  await expect.poll(async () => list.evaluate(element =>
    element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(3)
  await list.hover()
  await page.mouse.wheel(0, -240)
  await jump.waitFor()
  await page.mouse.wheel(0, 20_000)
  await expect.poll(() => jump.count()).toBe(0)

  await page.setViewportSize({ width: 960, height: 720 })
  const narrowList = await list.boundingBox()
  const narrowRail = await rail.boundingBox()
  if (narrowList === null || narrowRail === null) throw new Error('narrow journal geometry unavailable')
  expect(narrowRail.x).toBeGreaterThanOrEqual(narrowList.x)
  expect(narrowRail.x + narrowRail.width).toBeLessThanOrEqual(narrowList.x + narrowList.width)
  await ticks.first().click()
  await jump.click()
  await expect.poll(async () => list.evaluate(element =>
    element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(3)
}, 120_000)
