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
      knownBug('F1-45', 'En sık hatalar ham İngilizce görünüyor: "Failed to fetch"')
      const app = await launch()
      await addXtreamSource(app.page, mock)
      await expect(loginError(app.page)).toBeVisible()
      observe(`connection reset during login, message: "${await loginError(app.page).innerText()}"`)
      await app.shot('connection-reset')
      await expect(loginError(app.page)).not.toContainText('Failed to fetch')
    })
  })

  test.describe('auth alanını metin olarak gönderen panel', () => {
    test.use({ mockOptions: { auth: 'auth-as-string' } })

    test('F1-55: auth "1" olan panelde giriş başarılı olur', async ({ launch, mock }) => {
      knownBug('F1-55', 'Xtream girişinde auth alanı metin olarak "1" gelirse giriş reddediliyor')
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
      knownBug('F1-43', 'Ana sayfa ön yüklemesi tüm hataları yutuyor; "toplam 0 içerik hazır" görünüyor')
      const app = await launch()
      await addXtreamSource(app.page, mock)
      await app.page.waitForTimeout(5000)
      await app.shot('catalog-requests-failed')
      observe(`all catalog requests HTTP 500, dashboard text: "${(await app.page.getByRole('main').innerText()).replace(/\s+/g, ' ').slice(0, 200)}"`)
      await expect(app.page.getByRole('button', { name: 'Yeniden Dene' })).toBeVisible({ timeout: 5000 })
    })
  })

  test.describe('liste yerine nesne döndüren panel', () => {
    test.use({ mockOptions: { failures: [{ route: 'get_live_streams', mode: 'wrong-shape' }] } })

    test('F1-29: Canlı TV sayfası {} yanıtında çökmeden açılır', async ({ launch, mock }) => {
      knownBug('F1-29', 'Xtream yanıtları as ile güveniliyor: {} dönen panel çökertiyor')
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

    // Timing-dependent today: in some runs the error survives and the button
    // shows, in others it is wiped (F1-05). Recorded, not asserted, until fixed.
    test('ölü kanal: oynatıcının bugünkü davranışı kaydedilir', async ({ launch, mock }) => {
      const app = await launch()
      await addXtreamSource(app.page, mock)
      await expectHomeWithContent(app.page)
      await playLiveChannel(app.page, KNOWN.liveCategory, KNOWN.liveChannels[0])
      await app.page.waitForTimeout(8000)
      await app.shot('dead-channel')
      const state = await app.mpvState()
      const button = await app.page.getByRole('button', { name: 'Yeniden Bağlan' }).count()
      observe(`F1-05 dead channel after 8 s: mpv error=${JSON.stringify(state.error)}, running=${state.running}, "Yeniden Bağlan" shown=${button > 0}, playlist requests=${mock.stats().counts['live-hls'] ?? 0}`)
    })

    test.fixme('F1-05: yayın açılamayınca oynatıcı hata gösterir (zamanlamaya bağlı; düzeltilince açılacak)', async ({ launch, mock }) => {
      const app = await launch()
      await addXtreamSource(app.page, mock)
      await expectHomeWithContent(app.page)
      await playLiveChannel(app.page, KNOWN.liveCategory, KNOWN.liveChannels[0])
      // Run it several times when enabling: the bug only shows in some runs.
      await expect(app.page.getByRole('button', { name: 'Yeniden Bağlan' })).toBeVisible({ timeout: 10_000 })
      await app.page.waitForTimeout(5000)
      await expect(app.page.getByRole('button', { name: 'Yeniden Bağlan' })).toBeVisible()
    })
  })

  test.describe('şifresinde # olan hesap', () => {
    test.use({ mockOptions: { password: 'Sifre#2026' } })

    test('F1-37: yayın adresinde şifre kodlanır ve kanal oynar', async ({ launch, mock }) => {
      knownBug('F1-37', 'Yayın adreslerinde kullanıcı adı ve şifre kodlanmıyor; # içeren şifre oynatmayı bozuyor')
      const app = await launch()
      await addXtreamSource(app.page, mock)
      await expectHomeWithContent(app.page)
      await expect(anyCard(app.page)).toBeVisible()
      await playLiveChannel(app.page, KNOWN.liveCategory, KNOWN.liveChannels[0])
      await waitForMpvProgress(app.page, { pathIncludes: '/1.m3u8', advanceBy: 1, timeout: 15_000 })
    })
  })
})
