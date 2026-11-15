import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import { addXtreamSource, anyCard, cardButton, expectHomeWithContent, openRoute } from '../support/flows.ts'
import { knownBug, observe } from '../support/known-bugs.ts'

test.describe('yeniden başlatma', () => {
  test('aynı profille yeniden açılınca kaynak kalır ve içerik yeniden yüklenir', async ({ launch, mock, closeApp }) => {
    const first = await launch({ label: 'first' })
    await addXtreamSource(first.page, mock, { name: 'Kalıcı Panel' })
    await expectHomeWithContent(first.page)
    const firstReport = await closeApp(first)
    expect(firstReport.exitedCleanly).toBe(true)
    // The credential store is a file in the profile, encrypted with safeStorage.
    const authBefore = mock.stats().counts.auth ?? 0

    const second = await launch({ label: 'second' })
    const { page } = second
    await expectHomeWithContent(page)
    await expect(page.getByText('Kalıcı Panel').first()).toBeVisible()
    await expect(anyCard(page)).toBeVisible()
    await second.shot('home-after-restart')
    expect(mock.stats().counts.auth ?? 0, 'the app signs in again on start').toBeGreaterThan(authBefore)

    const timeline = await second.perf()
    const homeContent = timeline.marks.find((mark) => mark.name === 'renderer:home-first-content')
    observe(`restart: dashboard content ${homeContent ? Math.round(homeContent.t) + ' ms' : 'not marked'} after process start (small catalog, no latency)`)
  })

  test('F1-42: yeniden başlatmadan sonra Favoriler hemen dolu gelir', async ({ launch, mock, closeApp }) => {
    knownBug('F1-42', 'Favoriler yeniden başlatmadan sonra "Henüz favori yok" gösteriyor')
    const first = await launch({ label: 'first' })
    await addXtreamSource(first.page, mock)
    await expectHomeWithContent(first.page)
    await openRoute(first.page, '/live')
    await first.page.getByRole('button', { name: KNOWN.liveCategory, exact: true }).click()
    const card = first.page.locator('div', { has: cardButton(first.page, KNOWN.liveChannels[0]) }).last()
    await card.getByRole('button', { name: 'Favorilere ekle' }).click()
    await openRoute(first.page, '/favorites')
    await expect(cardButton(first.page, KNOWN.liveChannels[0])).toBeVisible()
    await closeApp(first)

    // A slower provider, as real panels are: the catalog takes a moment to arrive.
    mock.update({ latencyMs: 1500 })
    const second = await launch({ label: 'second' })
    await expect(second.page.locator('aside')).toBeVisible()
    await openRoute(second.page, '/favorites')
    await second.shot('favorites-right-after-restart')
    await expect(cardButton(second.page, KNOWN.liveChannels[0])).toBeVisible({ timeout: 1000 })
  })
})
