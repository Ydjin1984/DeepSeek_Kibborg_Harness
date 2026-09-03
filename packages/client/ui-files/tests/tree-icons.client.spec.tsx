// @vitest-environment jsdom
/**
 * TreeIcons: file names map to glyph variants by extension, every known
 * variant renders a badge, unknown names fall back to the neutral page, and
 * the folder glyph renders both its closed and open states.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FileGlyph, FolderGlyph, glyphVariantOf } from '../src/client/TreeIcons.tsx'

afterEach(cleanup)

function svgOf(name: string): SVGSVGElement | null {
  const { container } = render(<FileGlyph name={name} />)
  return container.querySelector('svg')
}

describe('glyphVariantOf', () => {
  it('maps known extensions to their glyph variants', () => {
    expect(glyphVariantOf('a.ts')).toBe('typescript')
    expect(glyphVariantOf('a.TSX')).toBe('typescript')
    expect(glyphVariantOf('b.js')).toBe('javascript')
    expect(glyphVariantOf('c.json')).toBe('json')
    expect(glyphVariantOf('d.md')).toBe('markdown')
    expect(glyphVariantOf('e.html')).toBe('html')
    expect(glyphVariantOf('f.css')).toBe('css')
    expect(glyphVariantOf('g.yaml')).toBe('yaml')
    expect(glyphVariantOf('h.sh')).toBe('shell')
    expect(glyphVariantOf('i.py')).toBe('python')
    expect(glyphVariantOf('j.png')).toBe('image')
    expect(glyphVariantOf('k.zip')).toBe('archive')
    expect(glyphVariantOf('l.pdf')).toBe('pdf')
  })

  it('returns null for dotfiles, extensionless names, and unknown extensions', () => {
    expect(glyphVariantOf('.env')).toBeNull()
    expect(glyphVariantOf('README')).toBeNull()
    expect(glyphVariantOf('a.unknownext')).toBeNull()
  })
})

describe('FileGlyph', () => {
  it('renders a badge for every known extension', () => {
    for (const name of [
      'a.ts', 'b.js', 'c.json', 'd.md', 'e.html', 'f.css', 'g.yaml',
      'h.sh', 'i.py', 'j.png', 'k.zip', 'l.pdf', 'm.jsonc', 'n.ps1',
      'o.svg', 'p.gz',
    ]) {
      expect(svgOf(name), name).toBeTruthy()
    }
  })

  it('renders the neutral page for generic names', () => {
    for (const name of ['LICENSE', '.gitignore', 'notes.txt']) {
      expect(svgOf(name), name).toBeTruthy()
    }
  })
})

describe('FolderGlyph', () => {
  it('renders closed and open folder states', () => {
    const closed = render(<FolderGlyph open={false} />)
    expect(closed.container.querySelector('svg')).toBeTruthy()
    closed.unmount()
    const open = render(<FolderGlyph open />)
    expect(open.container.querySelector('svg')).toBeTruthy()
  })
})
