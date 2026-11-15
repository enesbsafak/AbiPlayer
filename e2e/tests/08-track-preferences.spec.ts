import { test, expect } from '../support/fixtures.ts'
import { KNOWN } from '../mock-provider/catalog.ts'
import { addXtreamSource, cardButton, expectHomeWithContent, mpvState, openRoute, pickSetting, waitForMpvProgress } from '../support/flows.ts'
import { observe } from '../support/known-bugs.ts'

const DUAL_PATH = '/100002.mkv'

test.describe('parça tercihleri mpv ile', () => {
  // The MKV clip carries audio and subtitle tracks tagged `tur` (first) and
  // `eng`. The menus store two-letter codes, so this only works when the
  // codes are compared in one form (F1-41) and the subtitle preference is
  // applied once the track list is there (F1-02).
  test('F1-02, F1-41: tercih edilen dublaj ve altyazı dili MKV parçalarına uygulanır', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    await addXtreamSource(page, mock)
    await expectHomeWithContent(page)

    await pickSetting(page, 'playback', 'preferred-audio-language', /\(EN\)$/)
    await pickSetting(page, 'subtitles', 'preferred-subtitle-language', /\(EN\)$/)
    await app.shot('preferences')

    await openRoute(page, '/vod')
    await page.getByRole('textbox', { name: 'Film ara', exact: true }).fill('Çift Dilli')
    await cardButton(page, KNOWN.dualAudioFilm).click()
    await page.getByRole('button', { name: 'İzle', exact: true }).click()
    await expect(page).toHaveURL(/#\/player/)
    const { last } = await waitForMpvProgress(page, { pathIncludes: DUAL_PATH, advanceBy: 1, timeout: 45_000 })

    const english = (type: 'audio' | 'sub') => last.tracks.find((track) => track.type === type && track.lang === 'eng')?.id
    const englishAudio = english('audio')
    const englishSub = english('sub')
    expect(englishAudio, 'the clip has an English audio track').toBeDefined()
    expect(englishSub, 'the clip has an English subtitle track').toBeDefined()

    await expect.poll(async () => (await mpvState(page)).aid, { timeout: 10_000 }).toBe(englishAudio)
    await expect.poll(async () => (await mpvState(page)).sid, { timeout: 10_000 }).toBe(englishSub)
    const settled = await mpvState(page)
    observe(`tracks: ${settled.tracks.map((track) => `${track.type}#${track.id}:${track.lang}${track.selected ? '*' : ''}`).join(', ')}`)
    await app.shot('english-tracks')

    // The choice holds; a later poll does not switch it back.
    await page.waitForTimeout(2000)
    const later = await mpvState(page)
    expect(later.aid).toBe(englishAudio)
    expect(later.sid).toBe(englishSub)
  })
})
