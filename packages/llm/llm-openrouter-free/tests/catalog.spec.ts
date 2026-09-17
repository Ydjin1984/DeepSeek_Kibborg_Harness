import { describe, expect, it } from 'vitest'
import { isFreeEntry, parseFreeModels } from '../src/catalog.ts'

/** One directory entry, priced at zero unless the case overrides it. */
function entry(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'vendor/model',
    name: 'Vendor Model',
    context_length: 65_536,
    pricing: { prompt: '0', completion: '0' },
    architecture: { input_modalities: ['text'] },
    ...overrides,
  }
}

describe('parseFreeModels', () => {
  it('keeps zero-priced text models, largest context first', () => {
    const models = parseFreeModels({
      data: [
        entry({ id: 'a/small', context_length: 8_192 }),
        entry({ id: 'b/large', context_length: 200_000 }),
      ],
    }, { minContextWindow: 4_096, excludeModels: [], maxModels: 10, requireToolSupport: false })
    expect(models.map(model => model.id)).toEqual(['b/large', 'a/small'])
    expect(models[0]?.contextLength).toBe(200_000)
  })

  it('rejects a model that is free to prompt but priced to complete', () => {
    const models = parseFreeModels({
      data: [entry({ pricing: { prompt: '0', completion: '0.000001' } })],
    }, { minContextWindow: 0, excludeModels: [], maxModels: 10, requireToolSupport: false })
    expect(models).toEqual([])
  })

  it('accepts both price spellings and the :free id suffix', () => {
    expect(isFreeEntry(entry({}))).toBe(true)
    expect(isFreeEntry(entry({ pricing: { prompt: 0, completion: 0 } }))).toBe(true)
    expect(isFreeEntry({ id: 'vendor/model:free' })).toBe(true)
    expect(isFreeEntry({ id: 'vendor/model:free', pricing: { prompt: '0.000001', completion: '0' } })).toBe(false)
    expect(isFreeEntry({ id: 'vendor/model', pricing: { prompt: '1', completion: '0' } })).toBe(false)
    expect(isFreeEntry({ id: 'vendor/model', pricing: {} })).toBe(false)
  })

  it('drops models below the context floor, excluded ids, and image-only models', () => {
    const models = parseFreeModels({
      data: [
        entry({ id: 'a/tiny', context_length: 4_096 }),
        entry({ id: 'b/excluded', context_length: 100_000 }),
        entry({ id: 'c/image', architecture: { input_modalities: ['image'] } }),
        entry({ id: 'd/kept', context_length: 100_000 }),
      ],
    }, { minContextWindow: 32_768, excludeModels: ['b/excluded'], maxModels: 10, requireToolSupport: false })
    expect(models.map(model => model.id)).toEqual(['d/kept'])
  })

  it('caps the pool after ordering and de-duplicates repeated ids', () => {
    const models = parseFreeModels({
      data: [
        entry({ id: 'a/one', context_length: 1_000_000 }),
        entry({ id: 'a/one', context_length: 1_000_000 }),
        entry({ id: 'b/two', context_length: 500_000 }),
        entry({ id: 'c/three', context_length: 100_000 }),
      ],
    }, { minContextWindow: 0, excludeModels: [], maxModels: 2, requireToolSupport: false })
    expect(models.map(model => model.id)).toEqual(['a/one', 'b/two'])
  })

  it('reads the reported output cap and falls back to the shared default', () => {
    const models = parseFreeModels({
      data: [
        entry({ id: 'a/capped', top_provider: { max_completion_tokens: 4_096 } }),
        entry({ id: 'b/uncapped' }),
      ],
    }, { minContextWindow: 0, excludeModels: [], maxModels: 10, requireToolSupport: false })
    const byId = new Map(models.map(model => [model.id, model]))
    expect(byId.get('a/capped')?.maxTokens).toBe(4_096)
    expect(byId.get('b/uncapped')?.maxTokens).toBeGreaterThan(0)
  })

  it('falls back to the id when the directory omits a name', () => {
    const models = parseFreeModels({ data: [entry({ name: '' })] }, {
      minContextWindow: 0, excludeModels: [], maxModels: 10, requireToolSupport: false,
    })
    expect(models[0]?.name).toBe('vendor/model')
  })

  it('refuses a body that is not a model directory', () => {
    expect(() => parseFreeModels({}, { minContextWindow: 0, excludeModels: [], maxModels: 1, requireToolSupport: false }))
      .toThrow(/"data" array/)
    expect(() => parseFreeModels(null, { minContextWindow: 0, excludeModels: [], maxModels: 1, requireToolSupport: false }))
      .toThrow(/"data" array/)
  })

  it('keeps only models that advertise tool calling when that is required', () => {
    const options = { minContextWindow: 0, excludeModels: [], maxModels: 10, requireToolSupport: true }
    const models = parseFreeModels({
      data: [
        entry({ id: 'a/tools', supported_parameters: ['temperature', 'tools'] }),
        entry({ id: 'b/plain-text', supported_parameters: ['temperature'] }),
        entry({ id: 'c/undeclared' }),
      ],
    }, options)
    expect(models.map(model => model.id)).toEqual(['a/tools'])
    expect(models[0]?.supportsTools).toBe(true)

    // Without the requirement every free model stays pooled, and each entry
    // still reports whether the directory advertises tool calling for it.
    const relaxed = parseFreeModels({
      data: [
        entry({ id: 'a/tools', supported_parameters: ['tools'] }),
        entry({ id: 'b/plain-text', supported_parameters: ['temperature'] }),
      ],
    }, { ...options, requireToolSupport: false })
    expect(relaxed.map(model => [model.id, model.supportsTools])).toEqual([
      ['a/tools', true],
      ['b/plain-text', false],
    ])
  })
})
