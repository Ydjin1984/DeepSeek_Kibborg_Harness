// Notifier lives in contract (shared by the sessions and workspaces domains);
// this module re-exports it for in-domain consumers.
export { Notifier } from '../contract/notifier.ts'
