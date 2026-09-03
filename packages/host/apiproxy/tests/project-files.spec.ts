/**
 * Unit coverage for the project-scoped file operations: containment,
 * read/write round-trips, caps, and directory/file projection.
 */

import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canonicalProjectPath,
  listProjectChildren,
  ProjectFileError,
  readProjectTextFile,
  writeProjectTextFile,
} from '../src/project-files.ts'

let roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-files-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  roots = []
})

describe('project text-file operations', () => {
  it('writes and reads a UTF-8 text file round-trip', async () => {
    const root = await makeRoot()
    const target = join(root, 'docs', 'note.md')
    await mkdir(join(root, 'docs'))
    const written = await writeProjectTextFile(root, target, '# Привет\n')
    expect(written.endsWith('note.md')).toBe(true)
    const read = await readProjectTextFile(root, target)
    expect(read.text).toBe('# Привет\n')
    expect(read.name).toBe('note.md')
  })

  it('creates a missing file on write', async () => {
    const root = await makeRoot()
    const target = join(root, 'new.md')
    await writeProjectTextFile(root, target, 'fresh')
    const read = await readProjectTextFile(root, target)
    expect(read.text).toBe('fresh')
  })

  it('overwrites an existing file in place', async () => {
    const root = await makeRoot()
    const target = join(root, 'note.md')
    await writeProjectTextFile(root, target, 'first')
    const written = await writeProjectTextFile(root, target, 'second')
    expect(written.endsWith('note.md')).toBe(true)
    const read = await readProjectTextFile(root, target)
    expect(read.text).toBe('second')
  })

  it('rejects reads and writes outside the project root', async () => {
    const root = await makeRoot()
    const outside = await mkdtemp(join(tmpdir(), 'dsh-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'secret.md'), 'secret')
    await expect(readProjectTextFile(root, join(outside, 'secret.md')))
      .rejects.toMatchObject({ code: 'file-outside-project' })
    await expect(writeProjectTextFile(root, join(outside, 'x.md'), 'x'))
      .rejects.toMatchObject({ code: 'file-outside-project' })
  })

  it('rejects a symlink that escapes the project root', async () => {
    const root = await makeRoot()
    const outside = await mkdtemp(join(tmpdir(), 'dsh-outside-link-'))
    roots.push(outside)
    await writeFile(join(outside, 'target.md'), 'outside')
    const link = join(root, 'escape.md')
    await symlink(join(outside, 'target.md'), link).catch(() => {
      // Symlinks can be unavailable (permissions); the containment check is
      // still covered by the direct-outside case above.
      return undefined
    })
    const exists = await canonicalProjectPath(root, link, false).catch(() => undefined)
    if (exists !== undefined) {
      await expect(readProjectTextFile(root, link)).rejects.toMatchObject({ code: 'file-outside-project' })
    }
  })

  it('rejects a write through a symlink that escapes the project root', async () => {
    const root = await makeRoot()
    const outside = await mkdtemp(join(tmpdir(), 'dsh-outside-write-link-'))
    roots.push(outside)
    await writeFile(join(outside, 'target.md'), 'outside')
    const link = join(root, 'escape-write.md')
    const linked = await symlink(join(outside, 'target.md'), link).then(() => true).catch(() => {
      // Symlinks need OS privileges (Windows) — on such hosts the escape case
      // cannot be materialized; the read-escape test above and the direct
      // outside-root case still pin containment, and CI Linux covers this arm.
      return false
    })
    if (linked) {
      await expect(writeProjectTextFile(root, link, 'x'))
        .rejects.toMatchObject({ code: 'file-outside-project' })
    }
  })

  it('does not let a caller raise the byte cap above the server bound', async () => {
    const root = await makeRoot()
    const big = join(root, 'huge.md')
    const oneMiBOver = 26 * 1024 * 1024
    await writeFile(big, Buffer.alloc(oneMiBOver, 0x61))
    // A requested cap above the 25 MiB bound is clamped, so the file is still
    // rejected instead of being read into memory.
    await expect(readProjectTextFile(root, big, oneMiBOver))
      .rejects.toMatchObject({ code: 'file-too-large' })
    // A small file passes with the same over-bound request (clamp is not an error).
    const small = join(root, 'small.md')
    await writeFile(small, 'ok')
    const read = await readProjectTextFile(root, small, oneMiBOver)
    expect(read.text).toBe('ok')
  })

  it('rejects a directory read as text and a non-text body', async () => {
    const root = await makeRoot()
    await expect(readProjectTextFile(root, root)).rejects.toMatchObject({ code: 'file-not-text' })
    const binary = join(root, 'blob.bin')
    await writeFile(binary, Buffer.from([0x00, 0xff, 0xfe]))
    await expect(readProjectTextFile(root, binary)).rejects.toMatchObject({ code: 'file-not-text' })
  })

  it('enforces the byte cap on read and write', async () => {
    const root = await makeRoot()
    const big = join(root, 'big.txt')
    await writeFile(big, 'a'.repeat(300))
    await expect(readProjectTextFile(root, big, 100)).rejects.toMatchObject({ code: 'file-too-large' })
    await expect(writeProjectTextFile(root, join(root, 'big2.txt'), 'b'.repeat(300), 100))
      .rejects.toMatchObject({ code: 'file-too-large' })
  })

  it('lists directories before files, both name-sorted, with hidden flags', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'zeta'))
    await mkdir(join(root, 'alpha'))
    await mkdir(join(root, '.hidden-dir'))
    await writeFile(join(root, 'b.txt'), 'b')
    await writeFile(join(root, 'a.md'), 'a')
    await writeFile(join(root, '.dot'), 'dot')
    const listed = await listProjectChildren(root, root)
    expect(listed.path).toBe(root)
    expect(listed.entries.map(entry => entry.name)).toEqual([
      '.hidden-dir', 'alpha', 'zeta', '.dot', 'a.md', 'b.txt',
    ])
    expect(listed.entries.filter(entry => entry.kind === 'directory')).toHaveLength(3)
    const file = listed.entries.find(entry => entry.name === 'a.md')
    expect(file).toMatchObject({ kind: 'file', size: 1, hidden: false })
    expect(listed.entries.find(entry => entry.name === '.dot')?.hidden).toBe(true)
  })

  it('reports an unreadable directory listing', async () => {
    const root = await makeRoot()
    await expect(listProjectChildren(root, join(root, 'nope')))
      .rejects.toMatchObject({ code: 'file-outside-project' })
  })

  it('throws ProjectFileError instances with codes', async () => {
    const root = await makeRoot()
    const error = await readProjectTextFile(root, join(root, 'missing.md')).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProjectFileError)
    expect((error as ProjectFileError).code).toBe('file-outside-project')
    expect((error as ProjectFileError).path).toBeDefined()
  })
})
