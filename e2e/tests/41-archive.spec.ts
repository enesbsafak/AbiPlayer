import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import { addXtreamSource, expectHomeWithContent, openRoute, waitForMpvProgress } from '../support/flows.ts'
import { observe } from '../support/known-bugs.ts'

// The mock keeps an archive for every 17th channel from the fourth on; the
// fourth is one of the known ones. Its guide has an hour-long programme for
// every hour from two hours ago, and its clock is Istanbul's.
const ARCHIVE_CHANNEL = KNOWN.liveChannels[3]
const ARCHIVE_STREAM_ID = '4'

test.describe('geriye dönük izleme', () => {
  test('Yayın Akışı: bitmiş bir program panelin arşivinden izlenir', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    await addXtreamSource(page, mock)
    await expectHomeWithContent(page)

    await openRoute(page, '/epg')
    const cells = page.getByRole('button', { name: new RegExp(`^${ARCHIVE_CHANNEL}, `) })
    await expect(cells.first()).toBeVisible({ timeout: 60_000 })
    const labels = await cells.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? ''))
    const liveIndex = labels.findIndex((label) => label.endsWith('şimdi yayında'))
    expect(liveIndex, `the channel's programme on now, among ${JSON.stringify(labels)}`).toBeGreaterThan(0)

    // The programme before the one on now has ended: it is watched from the archive.
    await cells.nth(liveIndex - 1).click()
    const watch = page.getByRole('button', { name: 'Kaydı izle', exact: true })
    await expect(watch).toBeVisible()
    await expect(page.getByRole('button', { name: 'Kanalı aç', exact: true })).toBeVisible()
    await app.shot('guide-archive-programme')
    await watch.click()

    await expect(page).toHaveURL(/#\/player/)
    const { last } = await waitForMpvProgress(page, { pathIncludes: '/timeshift/', advanceBy: 2, timeout: 45_000 })
    expect(last.error).toBeNull()
    const request = mock.stats().recent.filter((entry) => entry.route === 'timeshift').at(-1)
    // The whole hour of that programme, named on the panel's clock.
    expect(request?.archive).toMatchObject({ streamId: ARCHIVE_STREAM_ID, minutes: 60 })
    expect(request?.archive?.start).toMatch(/^\d{4}-\d{2}-\d{2}:\d{2}-00$/)
    observe(`archive request: ${JSON.stringify(request?.archive)}`)
    // Shown as something with an end: the seek bar is there.
    await expect(page.getByRole('slider', { name: 'Oynatma ilerlemesi', exact: true })).toBeAttached()
    await app.shot('archive-playing')
  })
})
