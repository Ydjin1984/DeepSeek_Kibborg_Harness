// Context-source projection lives in contract (shared across the sessions
// domain and its contract face); this module re-exports for in-domain consumers.
export type { ContextProvenanceView, ContextRole, KnownContextForm } from '../contract/context-provenance.ts'
export { contextForm, contextProvenance, sessionRecallLabels } from '../contract/context-provenance.ts'
