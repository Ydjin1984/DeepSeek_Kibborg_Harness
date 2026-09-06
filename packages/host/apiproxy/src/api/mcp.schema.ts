/**
 * mcp domain zod schemas (names derived from map keys:
 * mcpListRequestSchema / mcpListValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { McpServerEntryView, McpServerView } from './mcp.ts'

/** McpServerEntryView body of mcp.save. */
export const mcpServerEntrySchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
}) satisfies z.ZodType<Wire<McpServerEntryView>>

/** McpServerView row of mcp.list and mcp.save. */
export const mcpServerViewSchema = z.object({
  name: z.string().min(1),
  source: z.union([z.literal('user'), z.literal('project')]),
  kind: z.union([z.literal('stdio'), z.literal('streamable-http')]).optional(),
  enabled: z.boolean(),
  command: z.string().optional(),
  url: z.string().optional(),
  state: z.union([z.literal('disabled'), z.literal('connected'), z.literal('starting'), z.literal('error')]),
  toolCount: z.number().int().min(0),
  error: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<McpServerView>>

/** mcp.list request payload. */
export const mcpListRequestSchema = z.object({
}) satisfies z.ZodType<Wire<RequestPayload<'mcp.list'>>>

/** mcp.list response value. */
export const mcpListValueSchema = z.object({
  servers: z.array(mcpServerViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'mcp.list'>>>

/** mcp.save request payload. */
export const mcpSaveRequestSchema = z.object({
  name: z.string().min(1),
  entry: mcpServerEntrySchema,
}) satisfies z.ZodType<Wire<RequestPayload<'mcp.save'>>>

/** mcp.save response value. */
export const mcpSaveValueSchema = z.object({
  server: mcpServerViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'mcp.save'>>>

/** mcp.remove request payload. */
export const mcpRemoveRequestSchema = z.object({
  name: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'mcp.remove'>>>

/** mcp.remove response value. */
export const mcpRemoveValueSchema = z.object({
}) satisfies z.ZodType<Wire<ResponseValue<'mcp.remove'>>>
