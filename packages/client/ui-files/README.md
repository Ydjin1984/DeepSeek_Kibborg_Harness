# @deepseek-ai/dsh-client-ui-files

English | [中文](README.zh.md)

Workspace file panel, browser half: one occupant of the composer tool row (`conversation.input.left`, the list seat behind the paperclip) opens a right-side drawer over the current session's project folder. The drawer shows the project's file tree — folders expand lazily through `host.listChildren`, hidden (dot) files are listed but visually muted — and file rows are draggable onto the composer. A drop reads the file through `host.readTextFile` and attaches it as an ordinary file draft (`inputActions.addFiles`) stamped with the project path, so the host cites that path on the model-visible descriptor instead of copying the bytes under `.dsh/attachments/`.

Double-clicking a file opens the built-in Markdown viewer/editor dialog: preview renders through the shared `MarkdownText` renderer, edit is a plain textarea, and Save writes through `host.writeTextFile`. Preview and edit share one draft, and a dirty close asks before discarding.

All three host verbs are session-routed and containment-checked by the host (`api-proxy` resolves the session's recorded project cwd and rejects any path outside it), so the panel cannot browse or edit outside the project the user opened. The node half is empty; registration, dictionaries, and the occupant all live in the browser half.

## Model Experience

Indirectly: a dropped file becomes a regular draft file whose submit path cites the original project path in the durable user message. Editing a Markdown file through the dialog writes the file on disk; neither action adds prompt content by itself.

#### KV Cache effect

None. The panel performs no model calls; content folded into a message by the host follows the normal prompt path.

## Known Limitations and Deferred Work

- **Text-only attach** — the file drawer reads UTF-8 text (`host.readTextFile`); binary drops report an inline error rather than attaching bytes.
- **Session-rooted** — the tree roots at the current session's project folder; browsing other folders is not offered yet.
- **Editor scope** — the dialog is a single-file plain-textarea editor; no multi-file tabs or rich editing is planned here.
- **Drops attach copies** — a dropped tree file rides the ordinary draft pipeline: the host materializes the bytes under `.dsh/attachments` and describes that copy to the model (`Attached file: …/Path: …`). The row's original project path is not quoted in the model-visible text yet; attaching-by-reference is deferred until the prompt part wire carries an original path field.
