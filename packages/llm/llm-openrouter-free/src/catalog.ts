/**
 * Reading the OpenRouter model directory into the pool's own entry list.
 *
 * The endpoint is a model boundary, so every field is read defensively: a
 * directory that grows a field, drops one, or spells a price as a number
 * instead of a string must narrow the pool rather than fail a scan. Price is
 * the filter that matters — OpenRouter marks a zero-price model with `"0"`
 * strings, with `0` numbers, or (for its own free variants) an id ending in
 * `:free`; accepting only one spelling would silently empty the pool.
 *
 * @module @deepseek-ai/dsh-llm-openrouter-free/catalog
 */

import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_CONTEXT_WINDOW } from './config.ts'

/** One free model the directory offered, reduced to what a route profile needs. */
export interface FreeModelEntry {
  /** OpenRouter model id, sent verbatim on the wire. */
  id: string
  /** Display name; falls back to the id when the directory omits one. */
  name: string
  /** Context capacity in tokens, floored at the configured minimum. */
  contextLength: number
  /** Output cap in tokens. */
  maxTokens: number
  /** Whether the directory advertises tool calling for this model. */
  supportsTools: boolean
}

/** Whether one raw value is a plain record (not an array, null, or primitive). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read a price field as a number of USD per token.
 * @param value - raw price value from the directory.
 * @returns the parsed price, or `undefined` when the value is not a usable number.
 */
function priceOf(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Whether one directory entry costs nothing to use.
 *
 * Both halves must be free: a model with a free prompt and a priced completion
 * would spend real money on every answer, which is the one outcome the pool
 * exists to avoid. The `:free` id suffix is accepted as corroboration because
 * OpenRouter's own free variants carry it, and it never appears on a priced id.
 * @param entry - raw directory entry.
 * @returns whether the entry is a zero-price model.
 */
export function isFreeEntry(entry: Record<string, unknown>): boolean {
  const pricing = entry['pricing']
  if (isRecord(pricing)) {
    const prompt = priceOf(pricing['prompt'])
    const completion = priceOf(pricing['completion'])
    const request = priceOf(pricing['request'])
    if (prompt === 0 && completion === 0 && (request === undefined || request === 0)) return true
    if (prompt !== undefined && completion !== undefined) return false
  }
  const id = entry['id']
  return typeof id === 'string' && id.endsWith(':free') && !isRecord(pricing)
}

/** Whether one directory entry advertises text input (the pool's only usable modality). */
function acceptsText(entry: Record<string, unknown>): boolean {
  const architecture = entry['architecture']
  if (!isRecord(architecture)) return true
  const modalities = architecture['input_modalities']
  if (!Array.isArray(modalities)) return true
  return modalities.some(modality => modality === 'text')
}

/**
 * Whether one directory entry advertises tool calling.
 *
 * A pooled model is delegated to with the harness's tool set, so a model
 * without `tools` in its `supported_parameters` answers 404 the moment a worker
 * tries to call one — the failure arrives as a provider error after the task
 * was admitted, which is exactly the rotation the pool exists to avoid. An
 * entry whose parameter list is absent or empty is treated as unsupported:
 * under-claiming costs one model, over-claiming costs a failed delegation.
 */
function supportsTools(entry: Record<string, unknown>): boolean {
  const parameters = entry['supported_parameters']
  if (!Array.isArray(parameters)) return false
  return parameters.some(parameter => parameter === 'tools')
}

/** Read the directory's context capacity, preferring the model record's own field. */
function contextLengthOf(entry: Record<string, unknown>): number {
  const raw = entry['context_length'] ?? entry['contextLength']
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
}

/** Read the output cap the directory reports, if any. */
function maxTokensOf(entry: Record<string, unknown>): number {
  const top = entry['top_provider']
  const raw = isRecord(top) ? top['max_completion_tokens'] : undefined
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_TOKENS
}

/** Selection inputs for {@link parseFreeModels}. */
export interface ParseFreeModelsOptions {
  /** Models below this context capacity are dropped. */
  minContextWindow: number
  /** Model ids never pooled. */
  excludeModels: readonly string[]
  /** Maximum entries to return. */
  maxModels: number
  /** Drop models the directory does not advertise tool calling for. */
  requireToolSupport: boolean
}

/**
 * Reduce one `/models` response body to the pool's entry list.
 *
 * Entries are ordered by context capacity (largest first, id as tiebreak) so a
 * `maxModels` cut keeps the capable models rather than whichever the directory
 * happened to list first.
 * @param payload - parsed JSON body of the model directory.
 * @param options - the pool's selection bounds.
 * @returns the pooled entries, possibly empty.
 */
export function parseFreeModels(payload: unknown, options: ParseFreeModelsOptions): FreeModelEntry[] {
  const data = isRecord(payload) ? payload['data'] : undefined
  if (!Array.isArray(data)) {
    throw new Error('llm-openrouter-free: the model directory did not return a "data" array')
  }
  const excluded = new Set(options.excludeModels.filter(id => id.trim() !== ''))
  const seen = new Set<string>()
  const entries: FreeModelEntry[] = []
  for (const raw of data) {
    if (!isRecord(raw)) continue
    const id = raw['id']
    if (typeof id !== 'string' || id.trim() === '' || seen.has(id) || excluded.has(id)) continue
    if (!isFreeEntry(raw) || !acceptsText(raw)) continue
    const toolSupport = supportsTools(raw)
    if (options.requireToolSupport && !toolSupport) continue
    const contextLength = contextLengthOf(raw)
    if (contextLength < options.minContextWindow) continue
    const name = typeof raw['name'] === 'string' && raw['name'].trim() !== '' ? raw['name'] : id
    seen.add(id)
    entries.push({ id, name, contextLength, maxTokens: maxTokensOf(raw), supportsTools: toolSupport })
  }
  entries.sort((left, right) =>
    right.contextLength - left.contextLength || left.id.localeCompare(right.id))
  return entries.slice(0, Math.max(1, options.maxModels))
}

/**
 * Default context floor for a caller that has none configured.
 * @returns the shared minimum context capacity.
 */
export function defaultMinContextWindow(): number {
  return DEFAULT_MIN_CONTEXT_WINDOW
}
