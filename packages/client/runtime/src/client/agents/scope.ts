// Agent-scope primitives live in contract (shared by the agents and sessions
// domains); this module re-exports them for in-domain consumers.
export type { AgentContext, AgentScopeHandle } from '../contract/agent-scope.ts'
export { createScope, scopeOf } from '../contract/agent-scope.ts'
