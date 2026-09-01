// Pending-wait types and carrier live in contract (shared across the sessions
// domain and its contract face); this module re-exports them for in-domain
// consumers.
export type {
  PendingInteraction, PendingInteractionStatus, PendingKind, PendingPayloads,
} from '../contract/pending.ts'
export { PendingWait } from '../contract/pending.ts'
