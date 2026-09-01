// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {
  ComposerAttachment, ComposerAttachmentsOwnerProps, ComposerAttachmentsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ComposerAttachments } from '../src/client/ComposerAttachments.tsx'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = ((key: string, params?: Readonly<Record<string, unknown>>): string => {
  const messages: Record<string, string> = {
    'image.pending': '待发送图片',
    'image.original': '原图',
    'image.preview': '原图预览',
    'image.closePreview': '关闭原图预览',
    'image.openOriginal': '查看原图',
    'image.scrollLeft': '向左滚动图片',
    'image.scrollRight': '向右滚动图片',
    'image.dropBlocked': '当前无法添加图片',
    'image.dropTitle': '图片拖动到此处即可添加',
  }
  if (key === 'image.remove') {
    const name = params?.name
    return `移除图片 ${typeof name === 'string' ? name : ''}`
  }
  if (key === 'file.remove') {
    const name = params?.name
    return `移除文件 ${typeof name === 'string' ? name : ''}`
  }
  if (key === 'file.pending') return '待发送文件'
  if (key === 'image.dropDesc') {
    const count = params?.count
    const size = params?.size
    return `最多 ${typeof count === 'number' ? String(count) : ''} 张，每张 ${typeof size === 'string' ? size : ''}`
  }
  return messages[key] ?? key
}) as ComposerAttachmentsProps['t']

function attachment(id: string, name = `${id}.png`): ComposerAttachment {
  return {
    kind: 'image',
    id: id as ComposerAttachment['id'],
    file: new File([Uint8Array.of(1)], name, { type: 'image/png' }),
    previewUrl: `blob:${id}`,
  }
}

function props(overrides: Partial<ComposerAttachmentsOwnerProps> = {}): ComposerAttachmentsProps {
  return {
    attachments: [],
    files: [],
    canAcceptDrop: true,
    onAddImages: () => {},
    onAddFiles: () => {},
    onRemoveImage: () => {},
    onRemoveFile: () => {},
    t,
    ...overrides,
  } as unknown as ComposerAttachmentsProps
}

function fileAttachment(id: string, name: string, type = 'text/plain'): ComposerAttachment {
  return {
    kind: 'file',
    id: id as ComposerAttachment['id'],
    file: new File([Uint8Array.of(1, 2, 3)], name, { type }),
  }
}

describe('ComposerAttachments', () => {
  it('accepts file drops anywhere on the document and keeps non-file drags native', () => {
    const onAddImages = vi.fn()
    const view = render(<ComposerAttachments {...props({
      onAddImages,
      dropLimits: { count: 20, size: '5MB' },
    })} />)

    expect(fireEvent.dragEnter(document.body, { dataTransfer: null })).toBe(true)
    const textTransfer = { types: ['text/plain'], files: [], dropEffect: 'none' }
    expect(fireEvent.dragEnter(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.dragOver(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.drop(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(view.queryByRole('status')).toBeNull()

    const image = attachment('dropped').file
    const dataTransfer = { types: ['Files'], files: [image], dropEffect: 'none' }
    expect(fireEvent.dragEnter(document.body, { dataTransfer })).toBe(false)
    expect(view.getByRole('status').textContent).toContain('图片拖动到此处即可添加')
    expect(view.getByRole('status').textContent).toContain('最多 20 张，每张 5MB')
    expect(fireEvent.dragOver(document.body, { dataTransfer })).toBe(false)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(fireEvent.drop(document.body, { dataTransfer })).toBe(false)
    expect(onAddImages).toHaveBeenCalledWith([image])
    expect(view.queryByRole('status')).toBeNull()
  })

  it('tracks nested file drags and clears an aborted drag', () => {
    const view = render(<ComposerAttachments {...props()} />)
    const dataTransfer = { types: ['Files'], files: [], dropEffect: 'none' }
    fireEvent.dragLeave(document.body, {
      dataTransfer: { types: ['text/plain'], files: [], dropEffect: 'none' },
    })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.getByRole('status')).toBeTruthy()
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.documentElement, { dataTransfer })
    const leftViewport = new Event('dragleave', { bubbles: true, cancelable: true })
    Object.defineProperties(leftViewport, {
      dataTransfer: { value: dataTransfer },
      clientX: { value: -1 },
      clientY: { value: 5 },
    })
    fireEvent(document.documentElement, leftViewport)
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnd(window, { dataTransfer })
    expect(view.queryByRole('status')).toBeNull()
  })

  it('shows a blocked drop without forwarding its files', () => {
    const onAddImages = vi.fn()
    const view = render(<ComposerAttachments {...props({ canAcceptDrop: false, onAddImages })} />)
    const image = attachment('blocked').file
    const dataTransfer = { types: ['Files'], files: [image], dropEffect: 'copy' }
    fireEvent.dragEnter(document.body, { dataTransfer })
    expect(view.getByRole('status').textContent).toBe('当前无法添加图片')
    fireEvent.dragOver(document.body, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('none')
    fireEvent.drop(document.body, { dataTransfer })
    expect(onAddImages).not.toHaveBeenCalled()
    expect(view.queryByRole('status')).toBeNull()
  })

  it('routes rail removal and closes previews on Escape or attachment removal', () => {
    const onRemoveImage = vi.fn()
    const image = attachment('draft-1', 'pixel.png')
    const initial = props({ attachments: [image], onRemoveImage })
    const view = render(<ComposerAttachments {...initial} />)

    fireEvent.click(view.getByRole('button', { name: '移除图片 pixel.png' }))
    expect(onRemoveImage).toHaveBeenCalledWith(image.id)
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
    view.rerender(<ComposerAttachments {...props({ attachments: [], onRemoveImage })} />)
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()

    view.rerender(<ComposerAttachments {...initial} />)
    fireEvent.click(view.getByTitle('查看原图'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()
  })

  it('labels an unnamed attachment and its original-image preview', () => {
    const image = attachment('unnamed', '')
    const view = render(<ComposerAttachments {...props({ attachments: [image] })} />)
    expect(view.getByAltText('待发送图片')).toBeTruthy()
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByAltText('原图')).toBeTruthy()
  })

  it('routes non-image dropped files to the file-draft path', () => {
    const onAddFiles = vi.fn()
    render(<ComposerAttachments {...props({ onAddFiles })} />)
    const dataTransfer = { types: ['Files'], files: [fileAttachment('doc', 'spec.pdf').file], dropEffect: 'none' }
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.drop(document.body, { dataTransfer })
    expect(onAddFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'spec.pdf' })])
  })

  it('routes a mixed drop batch by declared type', () => {
    const onAddImages = vi.fn()
    const onAddFiles = vi.fn()
    render(<ComposerAttachments {...props({ onAddImages, onAddFiles })} />)
    const dataTransfer = {
      types: ['Files'],
      files: [attachment('photo', 'photo.png').file, fileAttachment('doc', 'notes.txt').file],
      dropEffect: 'none',
    }
    fireEvent.drop(document.body, { dataTransfer })
    expect(onAddImages).toHaveBeenCalledWith([expect.objectContaining({ name: 'photo.png' })])
    expect(onAddFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'notes.txt' })])
  })

  it('renders file drafts as chips and removes one on click', () => {
    const onRemoveFile = vi.fn()
    const doc = fileAttachment('doc', 'spec.pdf', 'application/pdf')
    render(<ComposerAttachments {...props({ files: [doc], onRemoveFile })} />)
    expect(screen.getByText('spec.pdf')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '移除文件 spec.pdf' }))
    expect(onRemoveFile).toHaveBeenCalledWith(doc.id)
  })
})
