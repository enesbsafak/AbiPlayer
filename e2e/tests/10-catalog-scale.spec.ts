// Responsiveness of the catalog pages with large catalogs (F4-03, F4-07,
// F2-12): typing in search and scrolling the grid with the mock provider's
// 50,000 and 200,000 item presets. A measurement, not a regression gate: it
// runs only with ABI_E2E_SCALE=1 (a full 200,000 item sync takes minutes) and
// records its figures as test annotations ("observation").
//
//   ABI_E2E_SCALE=1 npx playwright test -c e2e/playwright.config.ts tests/10-catalog-scale.spec.ts

import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures.ts'
import { CATALOG_PRESETS, type CatalogPreset } from '../mock-provider/catalog.ts'
import { addXtreamSource, expectHomeWithContent, openRoute } from '../support/flows.ts'
import { observe } from '../support/known-bugs.ts'
import { grid } from '../support/catalog.ts'

interface InputTiming {
  /** Longest Event Timing entry (input to next paint) per event name, ms. */
  maxEventDuration: Record<string, number>
  longTasks: number[]
}

async function startInputProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as { __abiScaleProbe?: { events: Array<{ name: string; duration: number }>; longTasks: number[]; observers: PerformanceObserver[] } }
    scope.__abiScaleProbe?.observers.forEach((observer) => observer.disconnect())
    const probe = { events: [] as Array<{ name: string; duration: number }>, longTasks: [] as number[], observers: [] as PerformanceObserver[] }
    const events = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.events.push({ name: entry.name, duration: entry.duration })
    })
    events.observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit)
    const tasks = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.longTasks.push(Math.round(entry.duration))
    })
    tasks.observe({ type: 'longtask' })
    probe.observers.push(events, tasks)
    scope.__abiScaleProbe = probe
  })
}

async function stopInputProbe(page: Page): Promise<InputTiming> {
  return page.evaluate(() => {
    const scope = window as unknown as { __abiScaleProbe: { events: Array<{ name: string; duration: number }>; longTasks: number[]; observers: PerformanceObserver[] } }
    const probe = scope.__abiScaleProbe
    probe.observers.forEach((observer) => observer.disconnect())
    const maxEventDuration: Record<string, number> = {}
    for (const event of probe.events) maxEventDuration[event.name] = Math.max(maxEventDuration[event.name] ?? 0, Math.round(event.duration))
    return { maxEventDuration, longTasks: probe.longTasks }
  })
}

/** Scrolls the grid's container by `step` px every frame for `ms` and reports frame gaps. */
async function scrollFrames(page: Page, gridName: string, step: number, ms: number) {
  return grid(page, gridName).evaluate(
    (element, { step, ms }) =>
      new Promise<{ frames: number; over33: number; maxGap: number; distance: number; renderedCards: number }>((resolve) => {
        let scroller = element.parentElement
        while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
        const target = scroller!
        const start = performance.now()
        const startTop = target.scrollTop
        let last = start
        let frames = 0
        let over33 = 0
        let maxGap = 0
        let renderedCards = 0
        const tick = (now: number) => {
          const gap = now - last
          last = now
          frames += 1
          if (gap > 33) over33 += 1
          maxGap = Math.max(maxGap, gap)
          renderedCards = Math.max(renderedCards, element.querySelectorAll('[data-roving-index]').length)
          target.scrollTop += step
          if (now - start < ms) requestAnimationFrame(tick)
          else resolve({ frames, over33, maxGap: Math.round(maxGap), distance: Math.round(target.scrollTop - startTop), renderedCards })
        }
        requestAnimationFrame(tick)
      }),
    { step, ms }
  )
}

/** Types `text` key by key and waits until the shown result count matches the final query. */
async function typeAndTime(page: Page, input: ReturnType<Page['getByPlaceholder']>, text: string, settled: () => Promise<unknown>) {
  await input.click()
  await input.fill('')
  await startInputProbe(page)
  const started = Date.now()
  await input.pressSequentially(text, { delay: 120 })
  const typed = Date.now()
  await settled()
  const done = Date.now()
  const timing = await stopInputProbe(page)
  return { typingMs: typed - started, settleAfterLastKeyMs: done - typed, ...timing }
}

for (const size of ['medium', 'large'] as CatalogPreset[]) {
  test.describe(`büyük katalog: ${size}`, () => {
    // Skipped before any fixture runs: generating the catalog alone takes a while.
    test.skip(process.env.ABI_E2E_SCALE !== '1', 'ölçüm: ABI_E2E_SCALE=1 ile çalışır')
    test.use({ mockOptions: { size } })

    test(`arama ve kaydırma ${size} katalogda akıcı kalır`, async ({ launch, mock }) => {
      test.setTimeout(600_000)
      const preset = CATALOG_PRESETS[size]
      const app = await launch()
      const { page } = app
      await addXtreamSource(page, mock)
      await expectHomeWithContent(page, 120_000)

      // Films: the largest list (25,000 / 110,000).
      await openRoute(page, '/vod')
      // The page is drawn (its chunk loads lazily) before the banner can tell anything.
      await expect(page.getByRole('button', { name: 'Tüm Filmler', exact: true })).toBeVisible()
      const syncStarted = Date.now()
      await expect(page.getByText(/Ön izleme listesi gösteriliyor|ön izleme listesiyle açılıyor/)).toHaveCount(0, { timeout: 480_000 })
      const fullListWaitMs = Date.now() - syncStarted
      const categoryButtons = await page.getByRole('group', { name: 'Kategoriler' }).locator('[data-roving-index]').count()
      const categoryTotal = mock.catalog.vodCategories.length

      const search = page.getByPlaceholder('Kanal ara...')
      const filmSearch = await typeAndTime(page, search, 'gece', () =>
        expect(page.getByText(/^[\d.]+ sonuç/)).toBeVisible({ timeout: 30_000 })
      )
      const matches = await page.getByText(/^[\d.]+ sonuç/).innerText()
      await search.fill('')
      await expect(page.getByText(/^[\d.]+ sonuç/)).toHaveCount(0)
      const filmScroll = await scrollFrames(page, 'Filmler', 120, 3000)
      await app.shot(`${size}-vod-after-scroll`)

      // Global search over every type.
      await openRoute(page, '/search')
      const global = page.getByPlaceholder('Tüm kanal, film ve dizilerde ara...')
      const globalSearch = await typeAndTime(page, global, 'gece', () =>
        expect(page.getByText(/için [\d.]+ sonuç bulundu/)).toContainText('"gece"', { timeout: 30_000 })
      )
      const globalText = await page.getByText(/için [\d.]+ sonuç bulundu/).innerText()

      observe(
        `${size} (${(preset.live + preset.vod + preset.series).toLocaleString('tr-TR')} öğe, ${preset.vod.toLocaleString('tr-TR')} film): ` +
          `film araması "gece" → ${matches}; tuş başına en uzun olay ${JSON.stringify(filmSearch.maxEventDuration)} ms, ` +
          `uzun görevler ${JSON.stringify(filmSearch.longTasks)} ms, son tuştan sonuca ${filmSearch.settleAfterLastKeyMs} ms`
      )
      observe(
        `${size}: film ızgarası 3 sn kaydırma (kare başına 120 px): ${filmScroll.frames} kare, 33 ms üstü ${filmScroll.over33}, ` +
          `en uzun kare arası ${filmScroll.maxGap} ms, ${filmScroll.distance} px, DOM'da en çok ${filmScroll.renderedCards} kart; ` +
          `kategori listesi DOM'da ${categoryButtons} satır / ${categoryTotal} kategori; Filmler açıldıktan sonra tam liste için beklenen ${fullListWaitMs} ms`
      )
      observe(
        `${size}: genel arama "gece" → ${globalText}; tuş başına en uzun olay ${JSON.stringify(globalSearch.maxEventDuration)} ms, ` +
          `uzun görevler ${JSON.stringify(globalSearch.longTasks)} ms, son tuştan sonuca ${globalSearch.settleAfterLastKeyMs} ms`
      )
      for (const annotation of test.info().annotations) {
        if (annotation.type === 'observation') console.log(`[scale] ${annotation.description}`)
      }
    })
  })
}
