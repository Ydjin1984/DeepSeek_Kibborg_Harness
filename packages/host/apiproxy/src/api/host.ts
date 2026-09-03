/**
 * host domain contract. No protocol version: client and host ship
 * together; introduce protocolVersion only when an independently released client appears.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One directory row of a listing: a child entry or a breadcrumb ancestor. */
export interface DirectoryEntry {
  /** Base name shown in a browser row (a root crumb carries its full path). */
  name: string
  /** Absolute host path — the client never joins path segments itself. */
  path: string
  /** Hidden by the host platform's convention (dot-prefixed on POSIX); the client owns whether to show it. */
  hidden: boolean
}

/** host.listDirectory response value: one directory level plus its ancestry. */
export interface DirectoryListing {
  /** Absolute path of the listed directory. */
  path: string
  /** The host account's home directory (breadcrumb "Home" rooting). */
  home: string
  /**
   * Ancestor chain from the filesystem root to the listed directory
   * inclusive; every crumb is a jump target (crumb `hidden` is always false).
   */
  crumbs: DirectoryEntry[]
  /** Direct child directories, name-sorted; symlinks to directories included. */
  entries: DirectoryEntry[]
  /** True when the backend cut `entries` at its complete-result bound (the name-sorted tail is absent). */
  truncated: boolean
}

/** One child of a workspace folder, typed for a file-tree surface. */
export interface WorkspaceChildEntry {
  /** Base name shown in the tree row. */
  readonly name: string
  /** Absolute host path — the client never joins path segments itself. */
  readonly path: string
  /** Directory or regular file. */
  readonly kind: 'directory' | 'file'
  /** Hidden by the host platform's convention (dot-prefixed); the client owns whether to show it. */
  readonly hidden: boolean
  /** File size in bytes; absent for directories. */
  readonly size?: number
}

/** host.readTextFile response value. */
export interface ReadTextFileValue {
  /** Absolute host path that was read (containment-resolved). */
  readonly path: string
  /** File base name. */
  readonly name: string
  /** UTF-8 text content. */
  readonly text: string
}

/** Host-level unary methods. */
export interface HostApi {
  /**
   * One-shot host snapshot. Empty payload uses the literal `{}` (extend in place when fields arrive).
   * version = the host app's (apps/cli) package.json version; cwd = the host process working
   * directory (root for session persistence and tool execution); provider/model = the defaults
   * applied when a new agent doesn't specify them explicitly, absent when the host configures
   * no explicit default (the adapter falls back internally);
   * attachedSessions = count of currently attached sessions (those with a live agent);
   * home = the host account home directory (Web display abbreviation on POSIX);
   * canOpenPath = whether this deployment can hand a path to a user-visible native desktop.
   */
  describe(request: RpcRequest<{}>): Promise<RpcResponse<{
    version: string
    cwd: string
    provider?: string
    model?: string
    attachedSessions: number
    home: string
    canOpenPath: boolean
  }>>

  /**
   * Open the operating system's single-directory picker; cancellation returns
   * null. Only served under the `native` capability.
   */
  pickDirectory(
    request: RpcRequest<{}>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ path: string | null }>>

  /**
   * List one directory level for the in-app browser; an absent path lists the
   * host account's home directory. Only served under the `browse` capability;
   * unreadable or missing targets fail with `directory-unreadable`. The
   * carrier's request signal follows the caller, stopping the backend's scan
   * on disconnect or timeout.
   */
  listDirectory(
    request: RpcRequest<{ path?: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<DirectoryListing>>

  /**
   * Create one child directory under an existing parent (the browser's
   * "New folder"). Only served under the `browse` capability; an existing
   * child fails with `directory-exists`, every other filesystem failure with
   * `directory-create-failed`.
   */
  createDirectory(
    request: RpcRequest<{ path: string; name: string }>,
  ): Promise<RpcResponse<{ path: string }>>

  /**
   * Open a filesystem path with the operating system's default application
   * (Finder / Explorer / xdg-open hand-off). The browser carrier's
   * prefix-wide trust fence covers this privileged method like every other
   * `/api` request.
   */
  openPath(
    request: RpcRequest<{ path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ opened: true }>>

  /**
   * List one folder level of the current session's project for the file-tree
   * surface: child directories and files, name-sorted. The target path must
   * resolve inside the session's recorded project (`session.header.cwd`), so
   * the panel can never browse outside the project the user opened. Failures:
   * `session-not-found`, `internal` (the session has no project cwd, or its
   * recorded cwd is missing on disk), `file-outside-project`,
   * `directory-unreadable`. The request carries an AbortSignal; the backend
   * checks it after each folder read (an in-flight directory scan is not
   * cancellable at the syscall level).
   */
  listChildren(
    request: RpcRequest<{ sessionId: string; path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ path: string; entries: readonly WorkspaceChildEntry[]; truncated: boolean }>>

  /**
   * Read a UTF-8 text file inside the current session's project. Served for
   * the Markdown viewer/editor and for attaching workspace files to a prompt;
   * binary or oversized content fails with `file-not-text` /
   * `file-too-large`. Every other filesystem failure reports
   * `file-unreadable`.
   */
  readTextFile(
    request: RpcRequest<{ sessionId: string; path: string; maxBytes?: number }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<ReadTextFileValue>>

  /**
   * Replace the content of a UTF-8 text file inside the current session's
   * project. The parent directory must already exist; oversized writes fail
   * with `file-too-large` and filesystem failures with `file-unwritable`.
   */
  writeTextFile(
    request: RpcRequest<{ sessionId: string; path: string; text: string; maxBytes?: number }>,
  ): Promise<RpcResponse<{ path: string }>>
}
