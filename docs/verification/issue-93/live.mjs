// Real Electron rapid page/zoom regression. Run from repository root after build.
// xvfb-run -a node docs/verification/issue-93/live.mjs /path/attention.pdf /tmp/evidence
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchIsolatedApp, cleanupIsolatedApp, assertNoConsoleErrors } from '../../../test/harness.mjs'

const pdf = path.resolve(process.argv[2])
const evidence = path.resolve(process.argv[3])
fs.mkdirSync(evidence, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-93-profile-'))
process.env.XDG_CONFIG_HOME = path.join(profile, 'config')
process.env.XDG_CACHE_HOME = path.join(profile, 'cache')
// Ingest degrades to PDF metadata without starting a signed-in adapter.
const emptyBin = path.join(profile, 'bin')
fs.mkdirSync(emptyBin)
process.env.PATH = emptyBin
let active
let dataDir
const consoleLines = []
const measurements = []

async function launch() {
  active = await launchIsolatedApp({ dataDir })
  dataDir = active.dataDir
  active.window.setDefaultTimeout(15000)
  await active.window.locator('footer:has-text("bridge: pong")').waitFor()
  return active.window
}

async function close() {
  consoleLines.push(...active.consoleLines)
  await active.app.close()
  active = undefined
}

async function geometry(window, scale, label) {
  await window.waitForFunction(scale => {
    const canvas = document.querySelector('canvas')
    const layer = document.querySelector('[class*="textLayer"]')
    return canvas?.width === Math.floor(612 * scale) && layer?.textContent.includes('Attention Is All You Need') &&
      Math.abs(layer.getBoundingClientRect().width - Math.floor(612 * scale)) < 1
  }, scale)
  const span = window.locator('[class*="textLayer"] > span').filter({ hasText: 'Attention Is All You Need' }).first()
  const info = await span.evaluate(element => {
    const layer = element.parentElement
    const canvas = layer.parentElement.querySelector('canvas')
    const c = canvas.getBoundingClientRect()
    const l = layer.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    const r = range.getBoundingClientRect()
    const copy = document.createElement('canvas')
    copy.width = canvas.width
    copy.height = canvas.height
    const context = copy.getContext('2d', { willReadFrequently: true })
    context.drawImage(canvas, 0, 0)
    const pixels = context.getImageData(Math.floor(r.left - c.left), Math.floor(r.top - c.top), Math.ceil(r.width), Math.ceil(r.height)).data
    let ink = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 128 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 128) ink++
    return { width: canvas.width, height: canvas.height, layerWidth: l.width, layerHeight: l.height,
      x: r.left - c.left, y: r.top - c.top, rangeWidth: r.width, rangeHeight: r.height, ink }
  })
  assert.equal(info.width, Math.floor(612 * scale))
  assert.equal(info.height, Math.floor(792 * scale))
  assert(Math.abs(info.layerHeight - Math.floor(792 * scale)) < 1)
  assert(Math.abs(info.x - 211.488 * scale) < 0.2, 'Title uses independent PDF X coordinate')
  assert(Math.abs(info.rangeWidth - 188.40534 * scale) < 2 * scale)
  assert(info.y < 162.043 * scale && info.y + info.rangeHeight > 162.043 * scale)
  assert(info.ink > 100, 'Final canvas contains actual title raster ink')
  measurements.push({ label, scale, ...info })
  fs.writeFileSync(path.join(evidence, 'measurements.json'), JSON.stringify(measurements, null, 2))
  await window.screenshot({ path: path.join(evidence, `${label}.png`) })
  console.log(`${label}: canvas, text geometry and raster verified`)
  return span
}

async function select(window, span, verify = true) {
  await span.scrollIntoViewIfNeeded()
  const box = await span.boundingBox()
  await window.mouse.move(box.x + 0.2, box.y + box.height / 2)
  await window.mouse.down()
  await window.mouse.move(box.x + box.width - 0.2, box.y + box.height / 2, { steps: 20 })
  await window.mouse.up()
  if (verify) assert.equal(await window.evaluate(() => window.getSelection()?.toString()), 'Attention Is All You Need')
}

try {
  let window = await launch()
  await window.getByRole('button', { name: 'Library', exact: true }).click()
  await window.getByText('No papers yet — ingest one to get started.').waitFor()
  await window.getByRole('button', { name: 'Create', exact: true }).click()
  const dialog = window.getByRole('dialog', { name: 'Add Paper' })
  const input = dialog.getByRole('textbox', { name: 'Paper identifier or URL' })
  assert(await input.evaluate(element => element === document.activeElement))
  await input.fill(pdf)
  await dialog.getByRole('button', { name: 'Add Paper', exact: true }).click()
  await dialog.waitFor({ state: 'hidden', timeout: 60000 })
  await geometry(window, 1, 'initial')
  const session = await window.context().newCDPSession(window)
  await session.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  const plus = window.locator('[class*="zoom"]').getByRole('button', { name: '+', exact: true })
  const minus = window.locator('[class*="zoom"]').getByRole('button', { name: '−', exact: true })
  const next = window.locator('[class*="pageNav"]').getByRole('button', { name: '›', exact: true })
  const previous = window.locator('[class*="pageNav"]').getByRole('button', { name: '‹', exact: true })
  // Actual input events, no waits for canvas/text between changes.
  for (let round = 0; round < 4; round++) {
    await plus.press('Enter'); await plus.press('Enter'); await next.press('Enter'); await minus.press('Enter'); await previous.press('Enter'); await minus.press('Enter')
  }
  await plus.press('Enter')
  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await window.getByLabel('Zoom', { exact: true }).filter({ hasText: '125%' }).waitFor()
  await window.getByLabel('Page', { exact: true }).filter({ hasText: '1 of 15' }).waitFor()
  let span = await geometry(window, 1.25, 'rapid-final-125')
  assertNoConsoleErrors(active.consoleLines, [])
  await select(window, span)
  await window.getByRole('button', { name: 'Add to chat', exact: true }).click()
  const ask = window.getByRole('textbox', { name: 'Ask a question', exact: true })
  await ask.waitFor()
  assert((await ask.inputValue()).includes('> "Attention Is All You Need" (p. 1)'))
  assert(await ask.evaluate(element => element === document.activeElement))
  // Fault injection at Chromium's public canvas API proves the visible render
  // error and recovery, while all paper parsing/rendering remains real PDF.js.
  await window.evaluate(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (...args) {
      HTMLCanvasElement.prototype.getContext = original
      throw new Error('Issue 93 injected canvas failure')
    }
  })
  await plus.press('Enter')
  await window.getByRole('alert').filter({ hasText: 'Issue 93 injected canvas failure' }).waitFor()
  assert(await window.locator('[class*="pageLayer"]').isHidden())
  await window.screenshot({ path: path.join(evidence, 'render-error.png') })
  await minus.press('Enter')
  span = await geometry(window, 1.25, 'error-recovered')
  await window.getByRole('alert').waitFor({ state: 'hidden' })
  await window.getByRole('button', { name: 'Highlight', exact: true }).click()
  await select(window, span, false)
  await window.waitForFunction(() => document.querySelectorAll('[class*="highlightRect"]').length > 0)
  const highlights = await window.evaluate(async () => {
    const paper = (await window.vellum.listPapers())[0]
    return window.vellum.highlightsList(paper.slug)
  })
  assert.equal(highlights.length, 1)
  assert.equal(highlights[0].quote, 'Attention Is All You Need')
  await next.click(); await previous.click()
  await geometry(window, 1.25, 'highlight-after-navigation')
  await window.waitForFunction(() => document.querySelectorAll('[class*="highlightRect"]').length > 0)
  const paper = (await window.evaluate(() => window.vellum.listPapers()))[0]
  await close()
  window = await launch()
  await window.getByRole('button', { name: 'Library', exact: true }).click()
  await window.getByRole('button', { name: paper.title, exact: true }).click()
  await geometry(window, 1, 'restart')
  await window.waitForFunction(() => document.querySelectorAll('[class*="highlightRect"]').length > 0)
  await close()
  const expectedFailure = { pattern: /^\[error\] \[Reader\] Failed to render page 1: Error: Issue 93 injected canvas failure/, reason: 'Deliberately injected one canvas failure to verify visible error and recovery.' }
  assert.equal(consoleLines.filter(line => expectedFailure.pattern.test(line)).length, 1)
  assertNoConsoleErrors(consoleLines, [expectedFailure])
  console.log('PASS: 25 rapid changes, final geometry/raster, pointer selection, Add to chat, render error/recovery, saved highlight, restart, no unexpected console errors')
} catch (error) {
  if (active) await active.window.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (active) consoleLines.push(...active.consoleLines)
  fs.writeFileSync(path.join(evidence, 'console.log'), consoleLines.join('\n'))
  await cleanupIsolatedApp(active?.app, dataDir)
  fs.rmSync(profile, { recursive: true, force: true })
}
