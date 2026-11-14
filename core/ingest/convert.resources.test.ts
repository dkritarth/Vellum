import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { convertPdfToMarkdown } from './convert'

const { getDocumentProxy, extractTextItems, destroy, document } = vi.hoisted(() => {
  const destroy = vi.fn()
  const document = { destroy }
  return { getDocumentProxy: vi.fn(), extractTextItems: vi.fn(), destroy, document }
})
vi.mock('unpdf', () => ({ getDocumentProxy, extractTextItems }))
beforeEach(() => {
  vi.clearAllMocks()
  getDocumentProxy.mockResolvedValue(document)
  extractTextItems.mockResolvedValue({ items: [[{ str: 'Paper text', fontSize: 12 }]] })
})

it('supplies readable local fonts explicitly and extracts through the owned document', async () => {
  const bytes = new Uint8Array([1])
  await expect(convertPdfToMarkdown(bytes)).resolves.toBe('Paper text\n')
  expect(getDocumentProxy).toHaveBeenCalledWith(bytes, {
    standardFontDataUrl: expect.stringMatching(/standard_fonts\/$/),
    disableFontFace: true,
  })
  const fontDirectory = getDocumentProxy.mock.calls[0][1].standardFontDataUrl
  expect(isAbsolute(fontDirectory)).toBe(true)
  expect(readFileSync(fontDirectory + 'FoxitSerif.pfb').length).toBeGreaterThan(0)
  expect(extractTextItems).toHaveBeenCalledWith(document)
  expect(destroy).toHaveBeenCalledOnce()
})

it('destroys the document when extraction fails', async () => {
  extractTextItems.mockRejectedValue(new Error('broken text layer'))
  await expect(convertPdfToMarkdown(new Uint8Array([1]))).rejects.toThrow('broken text layer')
  expect(destroy).toHaveBeenCalledOnce()
})
