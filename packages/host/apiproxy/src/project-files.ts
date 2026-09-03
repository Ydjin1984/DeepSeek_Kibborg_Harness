/**
 * Project-scoped text-file operations for the Web file-tree surface: list one
 * folder level, read a UTF-8 text file, and replace a UTF-8 text file. Every
 * operation resolves its target inside one project root (the session's
 * recorded cwd), so the browser can never reach outside the project the user
 * opened — the GUI's own trust boundary for the file panel.
 *
 * @module @deepseek-ai/dsh-host-apiproxy/project-files
 */

import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { WorkspaceChildEntry } from './api/host.ts'

/** Default cap for one text read (25 MiB, mirroring prompt file admission).
 * A caller may only request a smaller cap; this value is also the hard upper
 * bound every read/write clamps to, so a client cannot raise the server limit. */
export const DEFAULT_TEXT_FILE_MAX_BYTES = 25 * 1024 * 1024

/** A project-file operation failure with a stable machine code. */
export class ProjectFileError extends Error {
  /**
   * @param code - machine-routable failure code (see handler mapping).
   * @param message - operator-readable detail.
   * @param path - offending path when the code carries one on the wire.
   */
  constructor(readonly code: string, message: string, readonly path?: string) {
    super(message)
    this.name = 'ProjectFileError'
  }
}

/** Whether one canonical path sits under `root` (Windows compares case-insensitively). */
function insideRoot(root: string, candidate: string): boolean {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (process.platform === 'win32') {
    const rootKey = root.toLowerCase()
    const candidateKey = candidate.toLowerCase()
    return candidateKey === rootKey || candidateKey.startsWith(prefix.toLowerCase())
  }
  return candidate === root || candidate.startsWith(prefix)
}

/** Cap a caller-supplied byte limit at the server's hard bound. */
function clampedCap(maxBytes: number): number {
  return Math.min(maxBytes, DEFAULT_TEXT_FILE_MAX_BYTES)
}

/**
 * Canonicalize a client-supplied path and prove it stays inside the project
 * root. Existing targets are realpath'd (a symlink escaping the root is
 * rejected, on read and write alike); new writes resolve the existing parent,
 * append the bare base name, and re-realpath an already-existing final
 * component, so writing can never follow a symlink out of the project.
 * @param root - canonical project root (realpath'd by the caller).
 * @param target - client-supplied absolute path.
 * @param allowNewFile - permit a not-yet-existing final component (write path).
 * @returns the canonical target path.
 */
export async function canonicalProjectPath(root: string, target: string, allowNewFile: boolean): Promise<string> {
  const absolute = resolve(target)
  // An existing target is canonicalized and containment-checked first, so a
  // symlinked file (or the project directory itself) resolves on its own
  // terms — the parent's location is irrelevant for existing entries.
  const existing = await realpath(absolute).catch(() => null)
  if (existing !== null) {
    if (!insideRoot(root, existing)) {
      throw new ProjectFileError('file-outside-project', `path is outside the project: ${target}`, target)
    }
    return existing
  }
  // A not-yet-existing final component resolves through its parent: the parent
  // must exist and sit inside the project, then the bare base name is appended
  // (no separator traversal is possible through a bare name).
  const parent = await realpath(dirname(absolute)).catch(() => {
    throw new ProjectFileError('file-outside-project', `project directory does not exist: ${dirname(absolute)}`, dirname(absolute))
  })
  if (!insideRoot(root, parent)) {
    throw new ProjectFileError('file-outside-project', `path is outside the project: ${target}`, target)
  }
  if (!allowNewFile) {
    throw new ProjectFileError('file-outside-project', `project path does not exist: ${target}`, target)
  }
  return join(parent, basename(absolute))
}

/** Normalize one directory child name for hidden detection. */
function isHidden(name: string): boolean {
  return name.startsWith('.')
}

/**
 * List one folder level: child directories and files, name-sorted with
 * directories first.
 * @param root - canonical project root.
 * @param target - absolute directory path to list (must resolve inside `root`).
 * @returns the listed path and its child rows.
 */
export async function listProjectChildren(
  root: string,
  target: string,
): Promise<{ path: string; entries: readonly WorkspaceChildEntry[] }> {
  const directory = await canonicalProjectPath(root, target, false)
  const names = await readdir(directory).catch((error: unknown) => {
    throw new ProjectFileError('directory-unreadable', `cannot read directory ${directory}: ${String(error)}`, directory)
  })
  const entries: WorkspaceChildEntry[] = []
  for (const name of names) {
    const path = join(directory, name)
    const stats = await stat(path).catch(() => null)
    if (stats?.isDirectory()) {
      entries.push({ name, path, kind: 'directory', hidden: isHidden(name) })
    } else if (stats?.isFile()) {
      entries.push({ name, path, kind: 'file', hidden: isHidden(name), size: stats.size })
    }
    // Non-file, non-directory children (sockets, symlink loops) are skipped.
  }
  entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
  return { path: directory, entries }
}

/**
 * Read one project text file as UTF-8.
 * @param root - canonical project root.
 * @param target - absolute file path (must resolve inside `root`).
 * @param maxBytes - content cap, clamped to the server hard bound; `file-too-large` beyond it.
 * @returns the canonical path, base name, and decoded text.
 */
export async function readProjectTextFile(
  root: string,
  target: string,
  maxBytes = DEFAULT_TEXT_FILE_MAX_BYTES,
): Promise<{ path: string; name: string; text: string }> {
  const path = await canonicalProjectPath(root, target, false)
  const cap = clampedCap(maxBytes)
  const stats = await stat(path).catch(() => null)
  if (stats?.isDirectory()) {
    throw new ProjectFileError('file-not-text', `cannot read a directory as text: ${path}`, path)
  }
  // Size-check before buffering: an oversized file is rejected without ever
  // being read into memory.
  if (stats !== null && stats.size > cap) {
    throw new ProjectFileError(
      'file-too-large',
      `file ${path} is ${String(stats.size)} bytes; the ${String(cap)}-byte text cap is exceeded`,
      path,
    )
  }
  const buffer = await readFile(path).catch((error: unknown) => {
    throw new ProjectFileError('file-unreadable', `cannot read ${path}: ${String(error)}`, path)
  })
  if (buffer.byteLength > cap) {
    // v8 ignore next 3 -- TOCTOU backstop: the stat above already rejected an
    // oversized file; only a concurrent grow between stat and read reaches this arm.
    throw new ProjectFileError(
      'file-too-large',
      `file ${path} is ${String(buffer.byteLength)} bytes; the ${String(cap)}-byte text cap is exceeded`,
      path,
    )
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new ProjectFileError('file-not-text', `file ${path} is not valid UTF-8 text`, path)
  }
  return { path, name: basename(path), text }
}

/**
 * Replace one project text file's content (creating the file when absent).
 * @param root - canonical project root.
 * @param target - absolute file path (must resolve inside `root`).
 * @param text - new UTF-8 content.
 * @param maxBytes - content cap, clamped to the server hard bound; `file-too-large` beyond it.
 * @returns the canonical written path.
 */
export async function writeProjectTextFile(
  root: string,
  target: string,
  text: string,
  maxBytes = DEFAULT_TEXT_FILE_MAX_BYTES,
): Promise<string> {
  const path = await canonicalProjectPath(root, target, true)
  const encoded = Buffer.from(text, 'utf8')
  const cap = clampedCap(maxBytes)
  if (encoded.byteLength > cap) {
    throw new ProjectFileError(
      'file-too-large',
      `write of ${String(encoded.byteLength)} bytes exceeds the ${String(cap)}-byte text cap`,
      path,
    )
  }
  await writeFile(path, encoded).catch((error: unknown) => {
    throw new ProjectFileError('file-unwritable', `cannot write ${path}: ${String(error)}`, path)
  })
  return path
}
