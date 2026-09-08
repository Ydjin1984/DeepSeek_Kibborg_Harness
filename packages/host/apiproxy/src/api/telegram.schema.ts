/**
 * telegram domain zod schemas (names derived from map keys:
 * telegramStatusRequestSchema / telegramStatusValueSchema).
 */

import { z } from 'zod'
import { sessionIdSchema } from './sessions.schema.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** telegram.status request payload. */
export const telegramStatusRequestSchema = z.object({
  sessionId: sessionIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'telegram.status'>>>

/** telegram.status response value. */
export const telegramStatusValueSchema = z.object({
  configured: z.boolean(),
  attached: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'telegram.status'>>>

/** telegram.attach request payload. */
export const telegramAttachRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'telegram.attach'>>>

/** telegram.attach response value. */
export const telegramAttachValueSchema = z.object({
}) satisfies z.ZodType<Wire<ResponseValue<'telegram.attach'>>>

/** telegram.detach request payload. */
export const telegramDetachRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'telegram.detach'>>>

/** telegram.detach response value. */
export const telegramDetachValueSchema = z.object({
}) satisfies z.ZodType<Wire<ResponseValue<'telegram.detach'>>>

/** telegram.test request payload. */
export const telegramTestRequestSchema = z.object({
}) satisfies z.ZodType<Wire<RequestPayload<'telegram.test'>>>

/** telegram.test response value. */
export const telegramTestValueSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
}) satisfies z.ZodType<Wire<ResponseValue<'telegram.test'>>>
