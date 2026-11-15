import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import { addXtreamSource, anyCard, expectHomeWithContent, openRoute, playLiveChannel, waitForMpvProgress } from '../support/flows.ts'
import { knownBug, observe } from '../support/known-bugs.ts'

const loginError = (page: import('@playwright/test').Page) => page.locator('form p.text-red-400')

test.describe('sağlayıcı hataları', () => {
  test('yanlış şifre girişte reddedilir ve kaynak eklenmez', async ({ launch, mock }) => {
    const app = await launch()
    await addXtreamSource(app.page, mock, { password: 'yanlis-sifre' })
    await expect(loginError(app.page)).toBeVisible()
    observe(`wrong password message: "${await loginError(app.page).innerText()}"`)
    await expect(app.page).toHaveURL(/#\/settings/)
    await app.shot('wrong-password')
  })

  test.describe('CORS başlığı göndermeyen panel', () => {
    test.use({ mockOptions: { cors: false } })

    // K7 assumed such panels might not work because requests come from the
    // renderer. Measured: they do. This pins that down for whoever moves the
    // requests (F4-09) or tightens web security.
    test('giriş ve katalog CORS başlığı olmadan da çalışır (K7)', async ({ launch, mock }) => {
      const app = await launch()
      await addXtreamSource(app.page, mock)
      await expectHomeWithContent(app.page)
      await expect(anyCard(app.page)).toBeVisible()
      expect(mock.stats().counts.preflight ?? 0, 'no preflight requests').toBe(0)
      await app.shot('no-cors-home')
    })
  })

  test.describe('bağlantıyı koparan sunucu', () => {
    test.use({ mockOptions: { failures: [{ route: 'auth', mode: 'reset' }] } })

    test('F1-45: ağ hatası Türkçe bir mesajla gösterilir', async ({ launch, mock }) => {
      const app = await launch()
      await addXtreamSource(app.page, mock)
      await expect(loginError(app.page)).toBeVisible()
      observe(`connection reset during login, message: "${await loginError(app.page).innerText()}"`)
      await app.shot('connection-reset')
      await expect(loginError(app.page)).not.toContainText(/Failed to fetch|signal is aborted|Error invoking remote method/i)
    })
  })

  test.describe('auth alanını metin olarak gönderen panel', () => {
    test.use({ mockOptions: { auth: 'auth-as-string' } })

    test('F1-55: auth "1" olan panelde giriş başarılı olur', async ({ launch, mock }) => {
      const app = await launch()
      await addXtreamSource(app.page, mock)
      await expectHomeWithContent(app.page, 15_000)
    })
  })

  test.describe('kategori ve liste istekleri başarısız', () => {
    test.use({
      mockOptions: {
        failures: ['get_live_categories', 'get_vod_categories', 'get_series_categories', 'get_live_streams', 'get_vod_streams', 'get_series'].map(
          (route) => ({ route, mode: 'http-500' as const })
        )
      }
    })

    test('F1-43: ana sayfa hata ve "Yeniden Dene" gösterir', async ({ launch, mock }) => {
      knownBug('F1-43', 'Ana sayfa ön yüklemesi tüm hataları yutuyor; hata ve yeniden deneme gösterilmiyor')
      const app = await launch()
      await addXtreamSource(app.page, mock)
      // Requests are retried with backoff; give the bootstrap time to give up
      // before judging what the dashboard ends up showing.
      const loading = app.page.getByRole('main').getByRole('progressbar')
      await loading.waitFor({ timeout: 15_000 }).catch(() => undefined)
      await loading.waitFor({ state: 'detached', timeout: 45_000 }).catch(() => undefined)
      await app.shot('catalog-requests-failed')
      observe(`all catalog requests HTTP 500, dashboard text: "${(await app.page.getByRole('main').innerText()).replace(/\s+/g, ' ').slice(0, 200)}"`)
      // Exact: the loading panel's "Çok uzun sürüyor, yeniden dene" is not the error panel.
      await expect(app.page.getByRole('button', { name: 'Yeniden Dene', exact: true })).toBeVisible({ timeout: 5000 })
      await expect(app.page.getByText('Kaynağa bağlanılamadı')).toBeVisible()
    })
  })

  test.describe('liste yerine nesne döndüren panel', () => {
    test.use({ mockOptions: { failures: [{ route: 'get_live_streams', mode: 'wrong-shape' }] } })

    test('F1-29: Canlı TV sayfası {} yanıtında çökmeden açılır', async ({ launch, mock }) => {
      const app = await launch()
      await addXtreamSource(app.page, mock)
      await app.page.waitForTimeout(3000)
      await openRoute(app.page, '/live')
      await app.page.waitForTimeout(2000)
      await app.shot('wrong-shape-live')
      const errors = app.logs.filter((line) => line.includes('pageerror') || line.includes('[renderer:error]'))
      observe(`get_live_streams returns {}: ${errors.length} renderer errors; first: ${errors[0]?.slice(0, 160) ?? 'none'}`)
      await expect(app.page.getByRole('button', { name: 'Tüm Kanallar' })).toBeVisible({ timeout: 3000 })
      expect(errors).toEqual([])
    })
  })

  test.describe('ölü kanal', () => {
    test.use({ mockOptions: { failures: [{ route: 'live-hls', mode: 'http-404' }] } })

    test('F1-05, F1-01: ölü kanal hata gösterir; yayın düzelince "Yeniden Bağlan" gerçekten yeniden yükler', async ({ launch, mock }) => {
      const app = await launch()
      const { page } = app
      await addXtreamSource(page, mock)
      await expectHomeWithContent(page)
      await playLiveChannel(page, KNOWN.liveCategory, KNOWN.liveChannels[0])

      // F1-05: the load error is not wiped; the error panel shows, and live
      // channels try to reconnect on their own.
      const reconnect = page.getByRole('button', { name: 'Yeniden Bağlan', exact: true })
      await expect(reconnect).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText(/yeniden bağlanılıyor/)).toBeVisible({ timeout: 15_000 })
      await app.shot('dead-channel')

      // The automatic attempts run out and leave a final message that stays.
      await expect(page.getByText(/yeniden bağlanılıyor/)).toHaveCount(0, { timeout: 60_000 })
      for (let sample = 0; sample < 12; sample += 1) {
        await expect(reconnect).toBeVisible({ timeout: 100 })
        await page.waitForTimeout(250)
      }
      const finalMessage = (await page.locator('[data-player-container] p.text-red-400').innerText()).trim()
      observe(`F1-05 dead channel: final message "${finalMessage}", playlist requests ${mock.stats().counts['live-hls'] ?? 0}`)

      // The provider recovers. Nothing reloads by itself any more...
      mock.update({ failures: [] })
      await page.waitForTimeout(3000)
      const idle = await app.mpvState()
      expect(idle.phase, 'mpv is still on the failed load').toBe('error')
      expect(idle.timePos).toBe(0)

      // ...so playback coming back proves the button reloads (F1-01).
      const requestsBefore = mock.stats().counts['live-hls'] ?? 0
      await reconnect.click()
      const playing = await waitForMpvProgress(page, { pathIncludes: '/1.m3u8', advanceBy: 2, timeout: 45_000 })
      expect(playing.last.error).toBeNull()
      expect(mock.stats().counts['live-hls'] ?? 0).toBeGreaterThan(requestsBefore)
      await expect(reconnect).toHaveCount(0)
      await app.shot('after-reconnect')
    })
  })

  test.describe('şifresinde # olan hesap', () => {
    test.use({ mockOptions: { password: 'Sifre#2026' } })

    test('F1-37: yayın adresinde şifre kodlanır ve kanal oynar', async ({ launch, mock }) => {
      const app = await launch()
      await addXtreamSource(app.page, mock)
      await expectHomeWithContent(app.page)
      await expect(anyCard(app.page)).toBeVisible()
      await playLiveChannel(app.page, KNOWN.liveCategory, KNOWN.liveChannels[0])
      await waitForMpvProgress(app.page, { pathIncludes: '/1.m3u8', advanceBy: 1, timeout: 15_000 })
    })
  })
})
