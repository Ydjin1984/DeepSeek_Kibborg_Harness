/** Browser attachment plugin: fills conversation's composer and message-image slots. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ComposerAttachments } from './ComposerAttachments.tsx'
import { MessageImages } from './MessageImages.tsx'
import { PaperclipButton } from './PaperclipButton.tsx'

/** Slot registry required by this presentation plugin. */
export const inject = ['slots']

/** Register attachment presentation without exporting React components as package values. */
export function apply(ctx: ClientContext): void {
  // The attach-files button sits in the composer tool row beside the
  // command-menu `+` button (conversation.input.left renders after the
  // resident chrome); it opens the format-unrestricted file picker.
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'attach-files',
    order: 0,
    locale: 'conversation',
  }, PaperclipButton))
  ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
    name: 'conversation.input.attachments',
    locale: 'conversation',
  }, ComposerAttachments))
  ctx.slots.inject('conversation.message.images', () => ctx.slots.register({
    name: 'conversation.message.images',
    locale: 'conversation',
  }, MessageImages))
}
