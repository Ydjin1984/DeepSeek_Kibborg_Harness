/**
 * File-tree glyphs for the workspace drawer, VSCode-flavoured: an amber
 * folder that opens when expanded, a neutral page for untyped files, and
 * colour-coded monogram badges for common source/config formats (the same
 * tinted-badge language vscode-icons and Material Icon Theme use).
 *
 * Every badge paints through CSS custom properties on the svg element
 * (`--file-tint` background, `--file-ink` foreground), so the palette lives
 * in `FilesPanel.module.css`, not in component code; the theme can restyle
 * the glyphs without touching markup.
 */
import css from './FilesPanel.module.css'

/** One monogram badge definition. */
interface BadgeSpec {
  /** CSS module class carrying the `--file-tint` / `--file-ink` pair. */
  readonly cls: string | undefined
  /** Monogram drawn inside the badge (absent for the image variant). */
  readonly label?: string
  /** Font size for the monogram, tuned per label width. */
  readonly fontSize?: number
}

/** Glyph families a file name can map to. */
export type FileGlyphVariant =
  | 'typescript' | 'javascript' | 'json' | 'markdown' | 'html' | 'css' | 'yaml'
  | 'shell' | 'python' | 'image' | 'archive' | 'pdf'

/** Badge look-up keyed by lowercase file extension. */
const EXTENSIONS: Readonly<Record<string, FileGlyphVariant>> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  html: 'html', htm: 'html',
  css: 'css', scss: 'css', sass: 'css', less: 'css',
  yml: 'yaml', yaml: 'yaml',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'shell', bat: 'shell', cmd: 'shell',
  py: 'python', python: 'python',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', ico: 'image',
  zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', '7z': 'archive', rar: 'archive',
  pdf: 'pdf',
}

/** Monogram/colour per variant; keys must exist in the CSS module. */
const BADGES: Readonly<Record<FileGlyphVariant, BadgeSpec>> = {
  typescript: { cls: css.tintTypescript, label: 'TS', fontSize: 8 },
  javascript: { cls: css.tintJavascript, label: 'JS', fontSize: 8 },
  json: { cls: css.tintJson, label: '{}', fontSize: 7.5 },
  markdown: { cls: css.tintMarkdown, label: 'M', fontSize: 9 },
  html: { cls: css.tintHtml, label: '</>', fontSize: 6 },
  css: { cls: css.tintCss, label: '#', fontSize: 9 },
  yaml: { cls: css.tintYaml, label: 'Y', fontSize: 9 },
  shell: { cls: css.tintShell, label: '>_', fontSize: 7 },
  python: { cls: css.tintPython, label: 'Py', fontSize: 7.5 },
  image: { cls: css.tintImage },
  archive: { cls: css.tintArchive, label: 'Z', fontSize: 8 },
  pdf: { cls: css.tintPdf, label: 'PDF', fontSize: 5.4 },
}

/**
 * Map a file name to its glyph variant; names without a known extension get
 * the plain page glyph (variant lookup returns null).
 * @param name - file base name.
 * @returns the matching variant, or null for the generic page.
 */
export function glyphVariantOf(name: string): FileGlyphVariant | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  return EXTENSIONS[name.slice(dot + 1).toLowerCase()] ?? null
}

/** Neutral page with a folded corner, sized like the badges. */
function PageGlyph() {
  return (
    <svg className={css.fileGlyphSvg} viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M4.3 1.6h4.8c.27 0 .52.11.71.29l3 3c.19.19.29.44.29.71v8.1c0 .55-.45 1-1 1H4.3c-.55 0-1-.45-1-1V2.6c0-.55.45-1 1-1z"
      />
      <path fill="currentColor" opacity="0.55" d="M9.1 1.9v2.6c0 .44.36.8.8.8h2.6L9.1 1.9z" />
    </svg>
  )
}

/** Colour-coded monogram badge (vscode-icons style square). */
function BadgeGlyph({ spec }: { spec: BadgeSpec }) {
  const { cls, label, fontSize = 8 } = spec
  return (
    <svg className={`${css.fileGlyphSvg} ${cls}`} viewBox="0 0 16 16" aria-hidden focusable="false">
      <rect x="1" y="1" width="14" height="14" rx="3.5" fill="var(--file-tint)" />
      {label === undefined ? (
        // Mini landscape: sun and hills, reads as an image file.
        <g fill="var(--file-ink)">
          <circle cx="5.1" cy="5.3" r="1.3" />
          <path d="M2.6 12.4 5.9 7.6c.3-.4.9-.4 1.2 0l2 3.2h.9l-1-1.6c.3-.4.9-.4 1.2 0l2.9 3.4c.2.3 0 .6-.4.6H3c-.3 0-.5-.4-.4-.8z" />
        </g>
      ) : (
        <text
          x="8"
          y="10.6"
          textAnchor="middle"
          fontSize={fontSize}
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
          fill="var(--file-ink)"
        >
          {label}
        </text>
      )}
    </svg>
  )
}

/** One file-row glyph: badge for known extensions, neutral page otherwise. */
export function FileGlyph({ name }: { name: string }) {
  const variant = glyphVariantOf(name)
  if (variant === null) return <PageGlyph />
  return <BadgeGlyph spec={BADGES[variant]} />
}

/** Amber folder (VS Code default-theme colour); the open state adds the front flap lowered toward the viewer. */
export function FolderGlyph({ open }: { open: boolean }) {
  return (
    <svg className={css.folderGlyph} viewBox="0 0 16 16" aria-hidden focusable="false">
      {open ? (
        <>
          {/* Open flap: a keystone hanging below the back panel. */}
          <path fill="currentColor" d="M2.3 9.2 4.7 12.7h6.6l2.4-3.5H2.3z" />
          <rect x="1.7" y="4" width="12.6" height="7" rx="1.4" />
          <rect x="1.7" y="2.4" width="4.6" height="2.4" rx="1" />
        </>
      ) : (
        <>
          <rect x="1.7" y="4" width="12.6" height="7.4" rx="1.4" />
          <rect x="1.7" y="2.4" width="4.6" height="2.6" rx="1" />
        </>
      )}
    </svg>
  )
}
