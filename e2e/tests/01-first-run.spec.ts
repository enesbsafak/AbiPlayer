import { test, expect } from '../support/fixtures.ts'
import { addXtreamSource, anyCard, expectHomeWithContent } from '../support/flows.ts'

test.describe('ilk açılış', () => {
  test('boş profilden sahte Xtream kaynağıyla içerikli ana sayfaya', async ({ launch, mock, closeApp }) => {
    const app = await launch()
    const { page } = app

    // The profile is really the throwaway one, not the user's.
    const userData = await app.electron.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
    expect(userData).toContain('abi-e2e-profile-')

    await expect(page.getByRole('heading', { name: /Hoş Geldin/ })).toBeVisible()
    await app.shot('welcome')

    await addXtreamSource(page, mock, { name: 'Sahte Panel' })
    await expectHomeWithContent(page)
    await expect(anyCard(page)).toBeVisible()
    await app.shot('home-content')

    // The dashboard shows a film and a series row from the preview.
    await expect(page.getByRole('heading', { name: 'Filmler' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Diziler' })).toBeVisible()

    const counts = mock.stats().counts
    expect(counts.auth).toBeGreaterThanOrEqual(1)
    expect(counts.get_live_categories).toBeGreaterThanOrEqual(1)

    const report = await closeApp(app)
    expect(report.exitedCleanly).toBe(true)
  })
})
