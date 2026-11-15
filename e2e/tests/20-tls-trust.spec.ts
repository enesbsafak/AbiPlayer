// F3-01 (K2): TLS is strict by default; a provider with a self-signed
// certificate works only after the user trusts that exact certificate.
// The mock provider runs in HTTPS mode with a certificate made at test time.

import type { Page } from '@playwright/test'
import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import { generateSelfSignedCertificate } from '../../src/main/tls/testing/self-signed.ts'
import { addXtreamSource, cardButton, expectHomeWithContent, leavePlayer, openRoute, playLiveChannel, waitForMpvProgress } from '../support/flows.ts'

const FILM_PATH = '/100001.mp4'

test.use({ mockOptions: { tls: true } })

function trustDialog(page: Page) {
  return page.getByRole('dialog')
}

/** Closes the mini player left after leaving the player, so nothing keeps the provider busy. */
async function stopMiniPlayer(page: Page): Promise<void> {
  const mini = page.getByRole('region', { name: 'Mini oynatıcı' })
  await expect(mini).toBeVisible()
  await mini.getByRole('button', { name: /^Oynatmayı (durdur|kapat)$/ }).click()
  await expect(mini).toHaveCount(0)
}

async function trustedHosts(page: Page) {
  return page.evaluate(() => window.electron!.tlsListTrusted())
}

test.describe('TLS sertifika politikası', () => {
  test('kendinden imzalı HTTPS kaynak: önce reddedilir, onaydan sonra giriş, katalog, canlı kanal ve film çalışır', async ({ launch, mock }) => {
    expect(mock.url).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/)
    const app = await launch()
    const { page } = app
    const port = new URL(mock.url).port

    await addXtreamSource(page, mock)
    const dialog = trustDialog(page)
    await expect(dialog.getByRole('heading', { name: 'Sunucunun sertifikası doğrulanamadı' })).toBeVisible()
    await expect(dialog).toContainText(`127.0.0.1:${port}`)
    await expect(dialog).toContainText(mock.certificate!.fingerprint256)
    // Nothing was let through before consent: no login reached the provider.
    expect(mock.stats().counts.auth ?? 0).toBe(0)
    expect(await trustedHosts(page)).toEqual([])
    await app.shot('trust-dialog')

    await dialog.getByRole('button', { name: 'Bu sunucuya güven' }).click()
    await expect(dialog).toBeHidden()
    // The add-source form is submitted again and the login goes through.
    await expectHomeWithContent(page)
    expect(mock.stats().counts.auth ?? 0).toBeGreaterThanOrEqual(1)
    expect(await trustedHosts(page)).toMatchObject([
      { host: '127.0.0.1', port: Number(port), fingerprint256: mock.certificate!.fingerprint256 }
    ])

    // Film through mpv: verified against a CA file holding the pin.
    await openRoute(page, '/vod')
    await page.getByPlaceholder('Kanal ara...').fill('Kayıp Şehir')
    await cardButton(page, KNOWN.film).click()
    await page.getByRole('button', { name: 'Filmi Oynat' }).click()
    await expect(page).toHaveURL(/#\/player/)
    await waitForMpvProgress(page, { pathIncludes: FILM_PATH, advanceBy: 2, timeout: 45_000 })
    await app.shot('film-playing')
    await leavePlayer(page)
    await stopMiniPlayer(page)

    // Live channel (HLS: playlist and segments are verified the same way).
    await playLiveChannel(page, KNOWN.liveCategory, KNOWN.liveChannels[0])
    const live = await waitForMpvProgress(page, { pathIncludes: '/1.m3u8', advanceBy: 2, timeout: 45_000 })
    expect(live.last.error).toBeNull()
    await leavePlayer(page)
    await stopMiniPlayer(page)

    // The same server under a name that is not one of the sources: refused,
    // recorded, and never put in front of the user.
    const otherHost = mock.url.replace('127.0.0.1', 'localhost')
    const fetched = await page.evaluate(async (url) => {
      try {
        await fetch(`${url}/__mock/health`, { cache: 'no-store' })
        return 'ok'
      } catch {
        return 'failed'
      }
    }, otherHost)
    expect(fetched).toBe('failed')
    await expect
      .poll(async () => (await page.evaluate(() => window.electron!.tlsListUntrusted())).map((notice) => notice.host))
      .toContain('localhost')
    await page.waitForTimeout(1500)
    await expect(trustDialog(page)).toHaveCount(0)

    // TMDB and GitHub hosts cannot be trusted, whatever asks.
    for (const host of ['api.themoviedb.org', 'image.tmdb.org', 'github.com', 'objects.githubusercontent.com']) {
      const outcome = await page.evaluate(
        async ({ host, fingerprint256 }) => {
          try {
            await window.electron!.tlsTrust({ host, port: 443, fingerprint256 })
            return 'trusted'
          } catch (error) {
            return String(error)
          }
        },
        { host, fingerprint256: mock.certificate!.fingerprint256 }
      )
      expect(outcome).toContain('hiçbir koşulda gevşetilemez')
    }
    expect((await trustedHosts(page)).map((pin) => pin.host)).toEqual(['127.0.0.1'])
  })

  test('sertifika değişince yeniden sorulur; güven kaldırılınca hemen sıkı olur', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    await addXtreamSource(page, mock)
    await trustDialog(page).getByRole('button', { name: 'Bu sunucuya güven' }).click()
    await expectHomeWithContent(page)
    const original = mock.certificate!

    // The provider (or someone in between) now presents another certificate.
    // The next requests to the host (the Live TV page's logos) are refused
    // and the user is told it changed.
    const replacement = generateSelfSignedCertificate({ altNames: ['127.0.0.1', 'localhost'] })
    mock.setCertificate(replacement)
    await openRoute(page, '/live')
    const dialog = trustDialog(page)
    await expect(dialog.getByRole('heading', { name: 'Sunucunun sertifikası değişti' })).toBeVisible({ timeout: 30_000 })
    await expect(dialog).toContainText(replacement.fingerprint256)
    await app.shot('changed-certificate')

    // mpv, verifying against the old pin, refuses the new certificate too.
    const liveUrl = `${mock.url}/live/${mock.username}/${mock.password}/2.m3u8`
    await page.evaluate((url) => window.electron!.mpvOpen(url), liveUrl)
    await expect.poll(async () => (await app.mpvState()).error, { timeout: 30_000 }).not.toBeNull()
    expect((await app.mpvState()).timePos ?? 0).toBe(0)
    await page.evaluate(() => window.electron!.mpvStop())

    await dialog.getByRole('button', { name: 'Bu sunucuya güven' }).click()
    await expect(dialog).toBeHidden()
    expect((await trustedHosts(page)).map((pin) => pin.fingerprint256)).toEqual([replacement.fingerprint256])
    expect(replacement.fingerprint256).not.toBe(original.fingerprint256)
    await playLiveChannel(page, KNOWN.liveCategory, KNOWN.liveChannels[1])
    await waitForMpvProgress(page, { pathIncludes: '/2.m3u8', advanceBy: 2, timeout: 45_000 })
    await leavePlayer(page)
    await stopMiniPlayer(page)

    // Revoke from Settings > Kaynaklar: the next request fails at once, with
    // no restart (Chromium asks per request; pooled sockets are closed).
    const probe = (url: string) =>
      page.evaluate(async (target) => {
        try {
          await fetch(`${target}/__mock/health?${Math.random()}`, { cache: 'no-store' })
          return 'ok'
        } catch {
          return 'failed'
        }
      }, url)
    expect(await probe(mock.url)).toBe('ok')
    await openRoute(page, '/settings')
    const list = page.getByRole('list', { name: 'Güvenilen sunucular' })
    await expect(list).toContainText(`127.0.0.1:${new URL(mock.url).port}`)
    await list.getByRole('button', { name: /güveni kaldır/ }).click()
    // The list empties once the revoke has completed (pin gone, connections closed).
    await expect(list).toHaveCount(0)
    expect(await trustedHosts(page)).toEqual([])
    expect(await probe(mock.url)).toBe('failed')
    // The refusal is offered again, from the dialog, for the source host.
    await expect(trustDialog(page).getByRole('heading', { name: 'Sunucunun sertifikası doğrulanamadı' })).toBeVisible()
  })
})

test.describe('TLS: süresi dolmuş sertifika', () => {
  // A CA file cannot vouch for an expired certificate, so after consent mpv
  // plays this host with verification off for that load only, once main has
  // seen the pinned certificate there.
  test.use({
    mockOptions: {
      tls: generateSelfSignedCertificate({
        altNames: ['127.0.0.1', 'localhost'],
        notBefore: new Date(Date.now() - 60 * 86_400_000),
        notAfter: new Date(Date.now() - 30 * 86_400_000)
      })
    }
  })

  test('onaydan sonra film oynar; uygulama kapanınca geride süreç kalmaz', async ({ launch, mock, closeApp }) => {
    const app = await launch()
    const { page } = app
    await addXtreamSource(page, mock)
    const dialog = trustDialog(page)
    await expect(dialog).toContainText('süresi')
    await expect(dialog).toContainText('dolmuş')
    await dialog.getByRole('button', { name: 'Bu sunucuya güven' }).click()
    await expectHomeWithContent(page)

    await openRoute(page, '/vod')
    await page.getByPlaceholder('Kanal ara...').fill('Kayıp Şehir')
    await cardButton(page, KNOWN.film).click()
    await page.getByRole('button', { name: 'Filmi Oynat' }).click()
    await waitForMpvProgress(page, { pathIncludes: FILM_PATH, advanceBy: 2, timeout: 45_000 })

    const report = await closeApp(app)
    expect(report.strays, 'no mpv, ffmpeg or ffprobe left behind').toEqual([])
  })
})
