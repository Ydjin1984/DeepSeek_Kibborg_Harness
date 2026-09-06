/**
 * Wire adapter for the Claude Code library section: folds the skills domain's
 * RpcResponse envelopes into plain promises. Only the two actions the section
 * needs (list managed skills, toggle one skill) are exposed; every rejection
 * carries the machine-routable RPC error code on a typed error class.
 */

import type { ManagedSkillSummaryView, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { IApiClient, SessionId } from '@deepseek-ai/dsh-client-connection/client'

/** Typed wire failure carrying the RPC error code. */
export class CcApiError extends Error {
  /** Stable machine-routable error code. */
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CcApiError'
    this.code = code
  }
}

/** Unwrap a unary response or throw a CcApiError carrying the routed code. */
function unwrap<T>(response: RpcResponse<T>): T {
  if (response.result.ok) return response.result.value
  const { code, message } = response.result.error
  throw new CcApiError(code, message)
}

/** Business actions the section binds; every rejection is a CcApiError. */
export interface CcActions {
  /** List the full managed catalog (filesystem skills plus built-ins). */
  listManaged: (sessionId: SessionId) => Promise<readonly ManagedSkillSummaryView[]>
  /** Enable or disable one managed skill (writes the .disabled marker). */
  setEnabled: (sessionId: SessionId, name: string, enabled: boolean) => Promise<void>
}

/**
 * Build the section's actions over the shared wire client.
 * @param api - the client's skills domain.
 * @returns the action table.
 */
export function createCcActions(api: Pick<IApiClient, 'skills'>): CcActions {
  return {
    async listManaged(sessionId) {
      return unwrap(await api.skills.listManaged({ sessionId })).skills
    },
    async setEnabled(sessionId, name, enabled) {
      unwrap(await api.skills.setEnabled({ sessionId, name, enabled }))
    },
  }
}
