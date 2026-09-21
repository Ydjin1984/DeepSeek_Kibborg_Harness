// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { PromptRail } from '../src/client/skeleton/PromptRail.tsx'

afterEach(cleanup)

describe('PromptRail', () => {
  it('offers older request loading before any request reaches the current page', () => {
    const onLoad = vi.fn()
    const view = render(<PromptRail entries={[]} activeKey={null} onSelect={vi.fn()} navLabel="Requests"
      label={index => `Prompt ${index + 1}`} older={{ label: 'Load earlier', loading: false, onLoad }} />)
    fireEvent.click(view.getByRole('button', { name: 'Load earlier' }))
    expect(onLoad).toHaveBeenCalledOnce()
  })

  it('renders bounded, labelled, actionable ticks and adjacent range controls', () => {
    const entries = Array.from({ length: 200 }, (_, index) => ({ key: `p${index}`, seq: index, preview: `Request ${index}` }))
    const onSelect = vi.fn()
    const view = render(<PromptRail entries={entries} activeKey="p100" onSelect={onSelect} navLabel="Requests"
      label={(index, preview) => `Prompt ${index + 1}: ${preview}`} />)
    expect(view.container.querySelectorAll('[data-prompt-tick]')).toHaveLength(9)
    expect(view.container.querySelectorAll('[aria-current="location"]')).toHaveLength(1)
    fireEvent.click(view.getByRole('button', { name: 'Prompt 101: Request 100' }))
    expect(onSelect).toHaveBeenCalledWith('p100')
    expect(view.getAllByRole('button')).toHaveLength(11)
  })
})
