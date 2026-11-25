// Live Electron gate for Reader continuous scroll + zoom (#198, #199).
//
// Usage (after `npm run build`):
//   xvfb-run -a node test/reader-scroll-zoom-gate.mjs path/to/multi-page.pdf
//
// Needs a real paper with at least 3 pages, e.g. arXiv 1706.03762 (15
// pages) downloaded to a temp dir. The bundled fixtures are too short to
// exercise scrolling. Screenshots land in
// test-artifacts/reader-scroll-zoom-<timestamp>/ on success and failure.
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT,
  launchIsolatedApp,
  captureFailureArtifacts,
  assertNoConsoleErrors,
  cleanupIsolatedApp,
} from './harness.mjs'

if (!process.argv[2]) {
  console.error('usage: node test/reader-scroll-zoom-gate.mjs path/to/multi-page.pdf (>= 3 pages)')
  process.exit(2)
}
const pdfPath = path.resolve(process.argv[2])
const shotsDir = path.join(ROOT, 'test-artifacts', `reader-scroll-zoom-${new Date().toISOString().replace(/[:.]/g, '-')}`)
fs.mkdirSync(shotsDir, { recursive: true })

const VIEWPORT = '[data-reader-viewport]'

async function state(window) {
  return window.evaluate((sel) => {
    const vp = document.querySelector(sel)
    const vpRect = vp.getBoundingClientRect()
    const slots = [...document.querySelectorAll('[data-page-slot]')]
    const rendered = slots
      .filter((s) => s.querySelector('canvas'))
      .map((s) => {
        const canvas = s.querySelector('canvas')
        const layer = s.querySelector('[data-text-layer]')
        const c = canvas.getBoundingClientRect()
        const l = layer.getBoundingClientRect()
        const spans = [...layer.querySelectorAll('span')]
        const outside = spans.filter((sp) => {
          const r = sp.getBoundingClientRect()
          if (r.width === 0 && r.height === 0) return false
          return r.left < l.left - 2 || r.top < l.top - 2 || r.right > l.right + 2 || r.bottom > l.bottom + 2
        }).length
        return {
          page: Number(s.dataset.pageNumber),
          canvasCss: [c.width, c.height],
          canvasPx: [canvas.width, canvas.height],
          layer: [l.width, l.height],
          spans: spans.length,
          outside,
        }
      })
    return {
      numSlots: slots.length,
      rendered,
      indicator: document.querySelector('[aria-label="Page"]').textContent,
      zoom: document.querySelector('[aria-label="Zoom"]').textContent,
      scrollTop: vp.scrollTop,
      scrollLeft: vp.scrollLeft,
      scrollHeight: vp.scrollHeight,
      scrollWidth: vp.scrollWidth,
      clientHeight: vp.clientHeight,
      clientWidth: vp.clientWidth,
      vpRect: [vpRect.left, vpRect.top, vpRect.width, vpRect.height],
      dpr: window.devicePixelRatio,
    }
  }, VIEWPORT)
}

function indicatorPage(s) {
  return Number(s.indicator.split(' of ')[0])
}

function assertAligned(s, label) {
  for (const p of s.rendered) {
    assert(Math.abs(p.canvasCss[0] - p.layer[0]) <= 1 && Math.abs(p.canvasCss[1] - p.layer[1]) <= 1,
      `${label}: page ${p.page} text layer ${p.layer} != canvas ${p.canvasCss}`)
    assert(p.spans > 0, `${label}: page ${p.page} has no text spans`)
    assert.strictEqual(p.outside, 0, `${label}: page ${p.page} has ${p.outside} spans outside the layer`)
  }
}

/** Page-relative point currently under client (x, y). */
async function pointUnder(window, x, y) {
  return window.evaluate(([cx, cy]) => {
    for (const s of document.querySelectorAll('[data-page-slot]')) {
      const r = s.getBoundingClientRect()
      if (cy >= r.top && cy <= r.bottom) return { page: Number(s.dataset.pageNumber), fx: (cx - r.left) / r.width, fy: (cy - r.top) / r.height }
    }
    return null
  }, [x, y])
}

async function run() {
  console.log(`=== Reader scroll/zoom gate: ${pdfPath} ===`)
  const { app, window, consoleLines, dataDir } = await launchIsolatedApp()
  window.setDefaultTimeout(20000)
  const shot = (name) => window.screenshot({ path: path.join(shotsDir, `${name}.png`) })
  let passed = false
  try {
    await window.waitForSelector('footer:has-text("bridge: pong")', { timeout: 15000 })
    const paper = await window.evaluate((p) => window.vellum.ingest(p), pdfPath)
    assert(paper?.slug, 'ingest failed')
    await window.click('nav button:has-text("Library")')
    await window.click(`button:has-text(${JSON.stringify(paper.title.slice(0, 20))})`)
    await window.waitForSelector('[data-page-slot] canvas')
    await window.waitForTimeout(1000)

    // 1. Layout + windowing.
    let s = await state(window)
    const numPages = Number(s.indicator.split(' of ')[1])
    console.log(`1. ${s.numSlots} page slots, ${s.rendered.length} rendered, indicator "${s.indicator}"`)
    assert.strictEqual(s.numSlots, numPages, 'one slot per page')
    assert(numPages >= 3, `gate needs a PDF with at least 3 pages, got ${numPages}`)
    if (numPages > 4) assert(s.rendered.length < numPages, 'pages far from the viewport must not render')
    assertAligned(s, 'initial')
    await shot('01-initial')

    // 2. Scroll the whole document with the wheel; indicator must climb to M.
    const box = await window.locator(VIEWPORT).boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await window.mouse.move(cx, cy)
    let last = 1
    let maxRendered = s.rendered.length
    for (let i = 0; i < 400 && last < numPages; i += 1) {
      await window.mouse.wheel(0, 300)
      await window.waitForTimeout(40)
      if (i % 5 === 0) {
        await window.waitForTimeout(250)
        s = await state(window)
        const page = indicatorPage(s)
        assert(page >= last, `indicator went backwards while scrolling down: ${last} -> ${page}`)
        last = page
        maxRendered = Math.max(maxRendered, s.rendered.length)
        assertAligned(s, `scroll step ${i}`)
      }
    }
    await window.waitForTimeout(400)
    s = await state(window)
    console.log(`2. scrolled to "${s.indicator}", max ${maxRendered} pages mounted at once`)
    assert.strictEqual(indicatorPage(s), numPages, 'indicator reaches last page')
    assert(maxRendered <= 5, `windowing should keep at most 5 pages mounted, saw ${maxRendered}`)
    await shot('02-scrolled-to-end')

    // 3. Prev/next + outline jumps scroll to their page.
    await window.evaluate((sel) => { document.querySelector(sel).scrollTop = 0 }, VIEWPORT)
    await window.waitForTimeout(300)
    await window.click('button[aria-label="Next page"]')
    await window.click('button[aria-label="Next page"]')
    await window.waitForTimeout(400)
    s = await state(window)
    assert.strictEqual(indicatorPage(s), 3, `next x2 -> page 3, got ${s.indicator}`)
    assert(s.rendered.some((p) => p.page === 3), 'page 3 rendered after jump')
    await window.click('button[aria-label="Previous page"]')
    await window.waitForTimeout(400)
    assert.strictEqual(indicatorPage(await state(window)), 2, 'prev -> page 2')
    console.log('3. prev/next scroll to target page')

    // 4. Pinch (Ctrl+wheel) zoom anchored at the cursor. Horizontally the
    // cursor sits at the pane centre: while the page is narrower than the
    // pane it is centred, and scrollLeft can't go negative to hold an
    // off-centre point (same as pdf.js / Preview).
    const ax = box.x + box.width / 2
    const ay = box.y + box.height * 0.4
    await window.mouse.move(ax, ay)
    const before = await pointUnder(window, ax, ay)
    const zoomBefore = (await state(window)).zoom
    await window.keyboard.down('Control')
    for (let i = 0; i < 12; i += 1) {
      await window.mouse.wheel(0, -4)
      await window.waitForTimeout(16)
    }
    await window.keyboard.up('Control')
    await window.waitForTimeout(500)
    const after = await pointUnder(window, ax, ay)
    s = await state(window)
    const slotWidth = s.rendered.find((p) => p.page === before.page)?.canvasCss[0] ?? 600
    const slotHeight = s.rendered.find((p) => p.page === before.page)?.canvasCss[1] ?? 800
    const drift = Math.hypot((after.fx - before.fx) * slotWidth, (after.fy - before.fy) * slotHeight)
    console.log(`4. pinch ${zoomBefore} -> ${s.zoom}; anchor page ${before.page}->${after.page}, drift ${drift.toFixed(2)}px (dx ${((after.fx - before.fx) * slotWidth).toFixed(2)}, dy ${((after.fy - before.fy) * slotHeight).toFixed(2)})`)
    assert.notStrictEqual(s.zoom, zoomBefore, 'pinch changed zoom')
    assert.strictEqual(after.page, before.page, 'anchor stays on the same page')
    assert(drift < 4, `anchor drifted ${drift}px`)
    const electronZoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
    assert.strictEqual(electronZoom, 1, 'Electron page zoom must not change')
    assertAligned(s, 'after pinch')
    for (const p of s.rendered) {
      const expected = Math.floor(p.canvasCss[0] * s.dpr)
      assert(Math.abs(p.canvasPx[0] - expected) <= 2, `page ${p.page} canvas ${p.canvasPx[0]}px not re-rendered at ${expected}px`)
    }
    await shot('04-after-pinch')

    // 5. Keyboard zoom while the reader is focused.
    await window.locator(VIEWPORT).focus()
    await window.keyboard.press('Control+0')
    await window.waitForTimeout(200)
    assert.strictEqual((await state(window)).zoom, '100%', 'Ctrl+0 resets')
    await window.keyboard.press('Control+=')
    await window.waitForTimeout(200)
    assert.strictEqual((await state(window)).zoom, '125%', 'Ctrl+= zooms in')
    await window.keyboard.press('Control+-')
    await window.waitForTimeout(200)
    assert.strictEqual((await state(window)).zoom, '100%', 'Ctrl+- zooms out')
    assert.strictEqual(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()),
      1,
      'Electron menu zoom must not fire',
    )
    console.log('5. Ctrl+0 / Ctrl+= / Ctrl+- drive reader zoom; Electron zoom stays 1')

    // 6. Wide pages scroll horizontally to both edges.
    for (let i = 0; i < 12; i += 1) {
      if (await window.locator('button[aria-label="Zoom in"]').isEnabled()) await window.click('button[aria-label="Zoom in"]')
    }
    await window.waitForTimeout(600)
    const edges = await window.evaluate((sel) => {
      const vp = document.querySelector(sel)
      const slot = [...vp.querySelectorAll('[data-page-slot]')].find((el) => el.querySelector('canvas'))
      vp.scrollLeft = 0
      const leftGap = slot.getBoundingClientRect().left - vp.getBoundingClientRect().left
      vp.scrollLeft = vp.scrollWidth
      const rightGap = vp.getBoundingClientRect().left + vp.clientWidth - slot.getBoundingClientRect().right
      return { leftGap, rightGap, zoom: document.querySelector('[aria-label="Zoom"]').textContent }
    }, VIEWPORT)
    console.log(`6. at ${edges.zoom}: left gutter ${edges.leftGap.toFixed(0)}px, right gutter ${edges.rightGap.toFixed(0)}px`)
    assert(edges.leftGap >= 0, 'left edge of the page reachable')
    assert(edges.rightGap >= 0, 'right edge of the page reachable')
    await shot('06-max-zoom-right-edge')
    await window.keyboard.press('Control+0')
    await window.waitForTimeout(600)

    // 7. Select text on a later page and send it to chat.
    const target = Math.min(3, numPages)
    await window.evaluate((sel) => { document.querySelector(sel).scrollLeft = 0 }, VIEWPORT)
    const pageInput = target
    for (let i = indicatorPage(await state(window)); i < pageInput; i += 1) await window.click('button[aria-label="Next page"]')
    for (let i = indicatorPage(await state(window)); i > pageInput; i -= 1) await window.click('button[aria-label="Previous page"]')
    await window.waitForTimeout(600)
    const span = window.locator(`[data-page-number="${target}"] [data-text-layer] span`).filter({ hasText: /\w{4,}/ }).nth(3)
    const spanBox = await span.boundingBox()
    await window.mouse.move(spanBox.x + 1, spanBox.y + spanBox.height / 2)
    await window.mouse.down()
    await window.mouse.move(spanBox.x + spanBox.width - 1, spanBox.y + spanBox.height / 2, { steps: 5 })
    await window.mouse.up()
    await window.getByRole('button', { name: 'Add to chat' }).waitFor()
    await shot('07-selection-menu')
    await window.getByRole('button', { name: 'Add to chat' }).click()
    await window.waitForTimeout(400)
    const composer = await window.evaluate(() =>
      [...document.querySelectorAll('textarea, input[type="text"]')].map((el) => el.value).find((v) => v.includes('(p. ')) ?? '',
    )
    console.log(`7. Add to chat from page ${target}: ${JSON.stringify(composer.slice(0, 60))}`)
    assert(composer.includes(`(p. ${target})`), `composer should cite page ${target}`)

    // 8. Search marks hits and next-match scrolls to the result page.
    const word = (await span.textContent()).trim().split(/\s+/).find((w) => /^[A-Za-z]{5,}$/.test(w)) || 'the'
    await window.fill('input[aria-label="Search in document"]', word)
    await window.press('input[aria-label="Search in document"]', 'Enter')
    await window.locator('[aria-label="Search matches"]').waitFor()
    await window.waitForTimeout(600)
    const hits = await window.locator('[data-search-hit]').count()
    const matches = await window.locator('[aria-label="Search matches"]').textContent()
    console.log(`8. search "${word}": ${matches}, ${hits} hit marks on rendered pages`)
    assert(hits > 0, 'search hits are marked')
    if (!matches.endsWith('/ 1')) {
      await window.click('button[aria-label="Next match"]')
      await window.waitForTimeout(600)
      const hitVisible = await window.evaluate((sel) => {
        const vp = document.querySelector(sel).getBoundingClientRect()
        return [...document.querySelectorAll('[data-search-hit]')].some((h) => {
          const r = h.getBoundingClientRect()
          return r.top >= vp.top && r.bottom <= vp.bottom
        })
      }, VIEWPORT)
      assert(hitVisible, 'next match brings a hit into view')
    }
    await shot('08-search')
    await window.press('input[aria-label="Search in document"]', 'Escape')
    assert.strictEqual(await window.locator('[data-search-hit]').count(), 0, 'Escape clears hits')

    // 8b. (#259) Several hits on one page. The counter counts hits, and
    // Next/Previous (buttons and Enter/Shift+Enter) step through every hit on
    // a page, scrolling each into view, before moving on; both ends wrap.
    // Zoomed in so a page is taller than the pane and stepping must scroll.
    await window.locator(VIEWPORT).focus()
    for (let i = 0; i < 4; i += 1) await window.keyboard.press('Control+=')
    await window.waitForTimeout(600)
    const SEARCH = 'input[aria-label="Search in document"]'
    const current = () =>
      window.evaluate((sel) => {
        const vp = document.querySelector(sel)
        const view = vp.getBoundingClientRect()
        const inView = (el) => {
          const r = el.getBoundingClientRect()
          return r.top >= view.top && r.bottom <= view.top + vp.clientHeight && r.left >= view.left && r.right <= view.left + vp.clientWidth
        }
        const hits = [...document.querySelectorAll('[data-search-current]')]
        const pageOf = (el) => Number(el.closest('[data-page-number]').dataset.pageNumber)
        const page1Hits = new Set([...document.querySelectorAll('[data-page-number="1"] [data-search-hit]')].map((el) => el.dataset.searchHit))
        return {
          counter: document.querySelector('[aria-label="Search matches"]')?.textContent ?? '',
          hits: hits.map((el) => ({ page: pageOf(el), hit: Number(el.dataset.searchHit), inView: inView(el) })),
          page1Marked: page1Hits.size,
          scrollTop: vp.scrollTop,
        }
      }, VIEWPORT)
    // Wait until the counter reads `k / total` and hit `hit` on `page` is
    // the current hit and fully in view. `page` null means any page after 1.
    async function expectCurrent(k, page, hit, label) {
      const deadline = Date.now() + 10000
      let c
      do {
        c = await current()
        const ok = c.counter.startsWith(`${k} / `) && c.hits.length > 0 && c.hits.every((h) => (page === null ? h.page > 1 : h.page === page) && h.hit === hit) && c.hits[0].inView
        if (ok) return c
        await window.waitForTimeout(100)
      } while (Date.now() < deadline)
      throw new Error(`${label}: expected hit ${k} = page ${page} hit ${hit} current and in view, got ${JSON.stringify(c)}`)
    }
    await window.fill(SEARCH, 'attention')
    await window.press(SEARCH, 'Enter')
    let c = await expectCurrent(1, 1, 0, 'search')
    const total = Number(c.counter.split(' / ')[1])
    const onPage1 = c.page1Marked
    console.log(`8b. search "attention": ${c.counter}, ${onPage1} hits marked on page 1`)
    assert(onPage1 >= 2, 'page 1 has several hits')
    assert(total > onPage1, 'counter totals hits across pages')
    let scrolledToSamePageHit = false
    for (let k = 1; k < onPage1; k += 1) {
      const before = c.scrollTop
      if (k % 2) await window.click('button[aria-label="Next match"]')
      else await window.press(SEARCH, 'Enter')
      c = await expectCurrent(k + 1, 1, k, `next to page-1 hit ${k}`)
      if (c.scrollTop !== before) scrolledToSamePageHit = true
    }
    console.log(`    stepped through all ${onPage1} page-1 hits; scrolled within page 1: ${scrolledToSamePageHit}`)
    assert(scrolledToSamePageHit, 'stepping to a later hit on the same page scrolls it into view')
    await window.click('button[aria-label="Next match"]')
    c = await expectCurrent(onPage1 + 1, null, 0, 'next leaves page 1 for the next page with a hit')
    await window.press(SEARCH, 'Shift+Enter')
    c = await expectCurrent(onPage1, 1, onPage1 - 1, 'shift+enter back to last page-1 hit')
    for (let k = onPage1 - 1; k >= 1; k -= 1) await window.click('button[aria-label="Previous match"]')
    c = await expectCurrent(1, 1, 0, 'previous back to first hit')
    await window.click('button[aria-label="Previous match"]')
    // The last hit's index on its page isn't known up front; read it once the counter wraps.
    await window.getByLabel('Search matches', { exact: true }).filter({ hasText: `${total} / ${total}` }).waitFor()
    // The jump mounts that page; its hit marks follow once its text layer is built.
    await window.waitForSelector('[data-search-current]')
    c = await current()
    assert(c.hits.length > 0 && c.hits[0].page > 1, `previous from the first hit wraps to the last: ${JSON.stringify(c)}`)
    c = await expectCurrent(total, c.hits[0].page, c.hits[0].hit, 'previous from the first hit wraps to the last')
    await window.click('button[aria-label="Next match"]')
    await expectCurrent(1, 1, 0, 'next from the last hit wraps to the first')
    console.log(`    wrapped both ways (${total} / ${total} on page ${c.hits[0].page})`)
    await shot('08b-search-hits')
    // A new search after clearing the old one still scrolls to its first hit.
    // The focus nonce used to restart after a clear, so the second identical
    // first-hit focus on page 1 was treated as already revealed.
    // "BLEU" first appears mid-page 1 (abstract), below the fold at this zoom,
    // so only the in-page reveal brings it into view.
    await window.press(SEARCH, 'Escape')
    await window.fill(SEARCH, 'BLEU')
    await window.press(SEARCH, 'Enter')
    await expectCurrent(1, 1, 0, 'search after clearing')
    await window.press(SEARCH, 'Escape')
    await window.evaluate((sel) => { const vp = document.querySelector(sel); vp.scrollTop = vp.scrollHeight / 3 }, VIEWPORT)
    await window.waitForTimeout(400)
    await window.fill(SEARCH, 'BLEU')
    await window.press(SEARCH, 'Enter')
    await expectCurrent(1, 1, 0, 'search again after clearing and scrolling away')
    console.log('    a search after clearing scrolls back to its first hit')
    await window.press(SEARCH, 'Escape')
    await window.locator(VIEWPORT).focus()
    await window.keyboard.press('Control+0')
    await window.waitForTimeout(400)

    // 9. Position + zoom survive switching to another paper's tab and back;
    // tabs close.
    await window.locator(VIEWPORT).focus()
    await window.keyboard.press('Control+=')
    await window.click('button[aria-label="Next page"]')
    await window.waitForTimeout(400)
    const saved = await state(window)
    const other = await window.evaluate((p) => window.vellum.ingest(p), path.join(ROOT, 'core/ingest/fixtures/sample.pdf'))
    await window.click('nav button:has-text("Library")')
    // dispatchEvent: long path titles in the Library grid can overlap the
    // neighbouring card's trash button (library layout, out of scope here).
    await window.locator(`button:has-text(${JSON.stringify(other.title.slice(0, 30))})`).first().dispatchEvent('click')
    await window.waitForSelector('[data-page-slot] canvas')
    await window.waitForTimeout(800)
    const tabs = window.locator('[role="tablist"][aria-label="Open papers"] [role="tab"]')
    assert.strictEqual(await tabs.count(), 2, 'two paper tabs open')
    await tabs.first().click()
    await window.waitForSelector('[data-page-slot] canvas')
    await window.waitForTimeout(1000)
    const restored = await state(window)
    console.log(`9. tab switch: ${saved.indicator} @ ${saved.zoom} (scrollTop ${saved.scrollTop}) -> ${restored.indicator} @ ${restored.zoom} (scrollTop ${restored.scrollTop})`)
    assert.strictEqual(restored.zoom, saved.zoom, 'zoom restored after tab switch')
    assert.strictEqual(restored.indicator, saved.indicator, 'page restored after tab switch')
    assert(Math.abs(restored.scrollTop - saved.scrollTop) <= 2, 'scroll position restored after tab switch')
    await window.click('[role="tablist"][aria-label="Open papers"] button[aria-label^="Close"]')
    await window.waitForTimeout(400)
    assert.strictEqual(await tabs.count(), 1, 'closing a tab removes it')
    assert.strictEqual(await tabs.first().getAttribute('aria-selected'), 'true', 'remaining tab becomes active')
    await window.click('[role="tablist"][aria-label="Open papers"] button[aria-label^="Close"]')
    await window.getByText('No paper open').waitFor()
    await shot('09-all-tabs-closed')

    assertNoConsoleErrors(consoleLines, [])
    passed = true
    console.log(`\n=== READER SCROLL/ZOOM GATE PASSED === screenshots: ${shotsDir}`)
  } catch (err) {
    await captureFailureArtifacts('reader-scroll-zoom', { window, consoleLines })
    console.error('\nGATE FAILED:', err)
    process.exitCode = 1
  } finally {
    await cleanupIsolatedApp(app, dataDir)
    if (!passed) process.exitCode = 1
  }
}

run()
