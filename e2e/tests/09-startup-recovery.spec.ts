import { test, expect } from '../support/fixtures.ts'
import { addXtreamSource, anyCard, expectHomeWithContent } from '../support/flows.ts'
import { observe } from '../support/known-bugs.ts'

test.describe('açılışta kapalı sağlayıcı', () => {
  test('F1-31: açılışta erişilemeyen sağlayıcı geri gelince uygulama kendiliğinden bağlanır', async ({ launch, mock, closeApp }) => {
    const first = await launch({ label: 'first' })
    await addXtreamSource(first.page, mock, { name: 'Uyuyan Panel' })
    await expectHomeWithContent(first.page)
    await closeApp(first)

    // Every request of the provider fails while the app starts.
    mock.update({ failures: [{ route: '*', mode: 'reset' }] })
    const authBefore = mock.stats().counts.auth ?? 0
    const second = await launch({ label: 'second' })
    const { page } = second
    await expect(page.getByText('Kaynağa bağlanılamadı')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText('Bağlantı otomatik olarak yeniden denenecek.')).toBeVisible()
    await second.shot('provider-down')
    const attemptsWhileDown = (mock.stats().counts.auth ?? 0) - authBefore

    // The provider comes back; nobody touches the app.
    mock.update({ failures: [] })
    const backAt = Date.now()
    await expectHomeWithContent(page, 90_000)
    await expect(anyCard(page)).toBeVisible({ timeout: 30_000 })
    await second.shot('provider-back')
    observe(
      `provider down at start: ${attemptsWhileDown} sign-in requests while down; content ${Math.round((Date.now() - backAt) / 1000)} s after it came back, without a click`
    )
    // The cached catalog (C2c) is on screen before the provider is back; the
    // reconnect itself is the next timer retry, and it replaces the offline copy.
    await expect.poll(() => mock.stats().counts.auth ?? 0, { timeout: 90_000 }).toBeGreaterThan(authBefore + attemptsWhileDown)
    await expect(page.getByText(/çevrimdışı kopya/)).toHaveCount(0, { timeout: 60_000 })
  })
})
