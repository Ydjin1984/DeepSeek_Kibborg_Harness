/**
 * CompactControl's injected face. The 'conversation.input.right' seat is
 * declared (children table) and typed by ui-conversation; this package only
 * contributes one occupant, so no SlotMap merge lives here.
 */

import type { CompactKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The manual-compaction button's copy. */
    compact: CompactKey
  }
}

/** One settled manual-compaction request, normalized for the button surface. */
export type CompactOutcome =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }
  | { readonly kind: 'unmatched' }

/** Injected business face of the composer compact button. */
export interface CompactControlInjected {
  /**
   * Execute one manual compaction (`/compact`) against the session's agent.
   * Resolves with the normalized outcome; transport failures settle as an
   * error outcome rather than rejecting.
   */
  compact: () => Promise<CompactOutcome>
}
