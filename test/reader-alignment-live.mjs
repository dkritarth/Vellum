// Issue #86: real Electron text geometry, raster ink and pointer selection.
// Run after build + Electron native-module rebuild:
// xvfb-run -a node test/reader-alignment-live.mjs /path/to/attention.pdf /tmp/evidence
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchIsolatedApp, cleanupIsolatedApp, assertNoConsoleErrors } from './harness.mjs'

const pdf = path.resolve(process.argv[2] ?? '/tmp/vellum-live-evidence/attention.pdf')
const evidence = path.resolve(process.argv[3] ?? 'test-artifacts/reader-alignment')
fs.mkdirSync(evidence, { recursive: true })
assert(fs.existsSync(pdf), `Real paper required: ${pdf}`)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-reader-profile-'))
process.env.XDG_CONFIG_HOME = path.join(profile, 'config')
process.env.XDG_CACHE_HOME = path.join(profile, 'cache')
// Exercise unavailable-agent recovery deterministically. This gate verifies
// selection context, not ACP answers; never reads a signed-in personal profile.
const emptyBin = path.join(profile, 'bin')
fs.mkdirSync(emptyBin)
process.env.PATH = emptyBin

// Independent PDF geometry, extracted from the real paper's text content.
// Coordinates are PDF points; baseline Y is measured from the bottom.
const title = { text: 'Attention Is All You Need', x: 211.488, baseline: 629.957, width: 188.40534, font: 17.2154 }
const introduction = { text: 'Introduction', x: 125.9328, baseline: 710.037, width: 64.88087, font: 11.9552 }
const near = (actual, expected, tolerance, label) => assert(Math.abs(actual - expected) <= tolerance,
  `${label}: expected ${expected} ± ${tolerance}, got ${actual}`)
let active
let dataDir
const consoleLines = []
const measurements = []

async function launch() {
  active = await launchIsolatedApp({ dataDir })
  dataDir = active.dataDir
  await active.window.waitForSelector('footer:has-text("bridge: pong")')
  return active.window
}

async function close() {
  consoleLines.push(...active.consoleLines)
  await active.app.close()
  active = undefined
}

async function checkAlignment(window, sample, scale, name) {
  const span = window.locator('[class*="textLayer"] > span').filter({ hasText: sample.text }).first()
  await span.waitFor()
  // Canvas and text are asynchronous. Wait for newly rendered dimensions.
  await window.waitForFunction(({ scale, text }) => {
    const canvas = document.querySelector('[class*="pageLayer"] > canvas')
    const layer = document.querySelector('[class*="textLayer"]')
    return canvas?.width === Math.floor(612 * scale) && layer?.textContent.includes(text)
  }, { scale, text: sample.text })
  const info = await span.evaluate((element) => {
    const layer = element.parentElement
    const canvas = layer.parentElement.querySelector('canvas')
    const c = canvas.getBoundingClientRect()
    const l = layer.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    const r = range.getBoundingClientRect()
    const style = getComputedStyle(element)
    // Inspect a copy so repeated gate readbacks do not alter the product
    // canvas's GPU strategy or generate Chromium readback warnings.
    const copy = document.createElement('canvas')
    copy.width = canvas.width
    copy.height = canvas.height
    const context = copy.getContext('2d', { willReadFrequently: true })
    context.drawImage(canvas, 0, 0)
    const pixels = context.getImageData(0, 0, copy.width, copy.height)
    // Raster ink within the selected word's box must fill its horizontal
    // extent. Hiding the duplicate alone cannot satisfy geometry checks.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let y = Math.max(0, Math.floor(r.top - c.top)); y < Math.min(canvas.height, Math.ceil(r.bottom - c.top)); y++) {
      for (let x = Math.max(0, Math.floor(r.left - c.left)); x < Math.min(canvas.width, Math.ceil(r.right - c.left)); x++) {
        const i = (y * canvas.width + x) * 4
        if (pixels.data[i + 3] > 128 && Math.max(...pixels.data.slice(i, i + 3)) < 128) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x)
          minY = Math.min(minY, y); maxY = Math.max(maxY, y)
        }
      }
    }
    return {
      position: style.position, color: style.color, font: parseFloat(style.fontSize),
      layer: { x: l.x - c.x, y: l.y - c.y, width: l.width, height: l.height },
      range: { x: r.x - c.x, y: r.y - c.y, width: r.width, height: r.height },
      ink: { minX, maxX, minY, maxY },
    }
  })
  measurements.push({ name, scale, ...info })
  fs.writeFileSync(path.join(evidence, 'measurements.json'), JSON.stringify(measurements, null, 2))
  await window.screenshot({ path: path.join(evidence, `${name}.png`) })
  assert.equal(info.position, 'absolute', 'Selectable glyphs must use PDF positions, not normal text flow')
  assert.equal(info.color, 'rgba(0, 0, 0, 0)', 'Canvas must be the only visible text')
  near(info.layer.x, 0, 0.1, 'Layer left')
  near(info.layer.y, 0, 0.1, 'Layer top')
  near(info.layer.width, Math.floor(612 * scale), 0.1, 'Layer width')
  near(info.layer.height, Math.floor(792 * scale), 0.1, 'Layer height')
  near(info.font, sample.font * scale, 0.1, 'PDF font size')
  near(info.range.x, sample.x * scale, 0.15, 'Selection left')
  // PDF advances and browser selection bounds differ slightly with fallback
  // font metrics/rounding. Allow 2 PDF points, also check actual raster ink.
  near(info.range.width, sample.width * scale, 2 * scale, 'Selection width')
  assert(info.range.y < (792 - sample.baseline) * scale &&
    info.range.y + info.range.height > (792 - sample.baseline) * scale, 'Selection must contain PDF baseline')
  assert(Number.isFinite(info.ink.minX), 'Selection must cover actual raster glyphs')
  near(info.ink.maxX - info.ink.minX, info.range.width, Math.max(4, 4 * scale), 'Raster/selection width')
  console.log(`${name}: aligned canvas, text dimensions and raster ink`)
  return span
}

async function selectWithPointer(window, span, text) {
  await span.scrollIntoViewIfNeeded()
  const box = await span.boundingBox()
  await window.mouse.move(box.x + 0.2, box.y + box.height / 2)
  await window.mouse.down()
  await window.mouse.move(box.x + box.width - 0.2, box.y + box.height / 2, { steps: 30 })
  await window.mouse.up()
  assert.equal(await window.evaluate(() => window.getSelection()?.toString()), text)
  await window.getByRole('button', { name: 'Add to chat', exact: true }).waitFor()
}

try {
  let window = await launch()
  await window.getByRole('button', { name: 'Library', exact: true }).click()
  await window.getByText('No papers yet — ingest one to get started.').waitFor()
  await window.getByRole('button', { name: 'Create', exact: true }).click()
  const dialog = window.getByRole('dialog', { name: 'Add Paper' })
  const input = dialog.getByRole('textbox', { name: 'Paper identifier or URL' })
  assert(await input.evaluate(el => el === document.activeElement), 'Ingest input gets keyboard focus')
  await input.fill(pdf)
  await dialog.getByRole('button', { name: 'Add Paper', exact: true }).click()
  await dialog.getByText('Ingesting paper… parsing and analyzing').waitFor()
  await dialog.waitFor({ state: 'hidden', timeout: 60000 })
  await window.getByLabel('Page', { exact: true }).filter({ hasText: '1 of 15' }).waitFor()
  await window.getByText('Loading…', { exact: true }).waitFor({ state: 'hidden' })
  let span = await checkAlignment(window, title, 1, 'page1-100')
  await selectWithPointer(window, span, title.text)
  await window.screenshot({ path: path.join(evidence, 'selection-page1.png') })
  await window.getByRole('button', { name: 'Add to chat', exact: true }).click()
  const ask = window.getByRole('textbox', { name: 'Ask a question', exact: true })
  await ask.waitFor()
  await window.waitForFunction(() => document.querySelector('input[aria-label="Ask a question"]')?.value.includes('(p. 1)'))
  assert((await ask.inputValue()).includes(`> "${title.text}" (p. 1)`))
  assert(await ask.evaluate(el => el === document.activeElement), 'Add to chat focuses composer')
  await window.screenshot({ path: path.join(evidence, 'add-to-chat.png') })

  await window.locator('[class*="zoom"]').getByRole('button', { name: '+', exact: true }).click()
  await checkAlignment(window, title, 1.25, 'page1-125')
  await window.locator('[class*="pageNav"]').getByRole('button', { name: '›', exact: true }).click()
  span = await checkAlignment(window, introduction, 1.25, 'page2-125')
  await selectWithPointer(window, span, introduction.text)
  await window.getByRole('button', { name: 'Explain', exact: true }).click()
  await window.getByText('Explain this passage from page 2:', { exact: false }).waitFor()
  assert((await window.locator('[aria-live="polite"]').first().innerText()).includes('> "Introduction"'))
  await window.getByRole('alert').filter({ hasText: /ENOENT|not found|spawn/ }).waitFor({ timeout: 20000 })
  await window.screenshot({ path: path.join(evidence, 'explain-page2.png') })
  const paper = (await window.evaluate(() => window.vellum.listPapers()))[0]
  await close()
  window = await launch()
  await window.getByRole('button', { name: 'Library', exact: true }).click()
  await window.getByRole('button', { name: paper.title, exact: true }).click()
  await checkAlignment(window, title, 1, 'restart-page1-100')
  await window.getByRole('tab', { name: 'Ask', exact: true }).click()
  await window.getByText('Explain this passage from page 2:', { exact: false }).waitFor()
  await close()
  assertNoConsoleErrors(consoleLines, [])
  console.log('PASS: pointer selections, Add to chat page 1, Explain page 2, restart and clean renderer console')
} catch (error) {
  if (active) await active.window.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (active) consoleLines.push(...active.consoleLines)
  fs.writeFileSync(path.join(evidence, 'console.log'), consoleLines.join('\n'))
  await cleanupIsolatedApp(active?.app, dataDir)
  fs.rmSync(profile, { recursive: true, force: true })
}
