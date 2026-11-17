import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPartialize, useStore, type AppStore } from '@/store'
import { summarizeManifest } from '@/addons/manifest'
import {
  CATALOG_BASE,
  CATALOG_MANIFEST,
  SECRET_SEGMENT,
  STREAM_BASE,
  STREAM_MANIFEST,
  catalogSource,
  streamSource
} from '@/addons/testing/fixtures'
import { XtreamRequestError } from '@/services/xtream-errors'
import type { AddonManifestSummary } from '@/types/addon'
import type { PlaylistSource } from '@/types/playlist'
import { strings } from '@/strings'
import { defined } from '../../../../shared/checked'
import {
  addonAddressMessage,
  addonOfferLabels,
  addonOfferLines,
  addonOfferNotes,
  addonSourceFor,
  canChooseAsActive,
  checkAddonAddressFor,
  checkNewAddon,
  describeAddonOffer,
  findInstalledAddon,
  notChoosableReason,
  placeAddonError,
  shouldActivateNewAddon,
  type AddonCheckResult
} from './addon-entry'
import { addonFormReducer, initialAddonFormState } from './AddonForm'
import { saveSourceSecret } from './source-secret'

const { validation, addon: text, manager } = strings.sources

const catalogSummary = defined(summarizeManifest(CATALOG_MANIFEST))
const streamSummary = defined(summarizeManifest(STREAM_MANIFEST))
const subtitlesSummary = defined(
  summarizeManifest({ id: 'org.ornek.altyazi', name: 'Örnek Altyazı', version: '1.0.0', resources: ['subtitles'], types: ['movie'], catalogs: [] })
)

/** What the user would see: every message of a failed check. */
function messagesOf(result: AddonCheckResult): string {
  return result.ok ? '' : result.error.message
}

function expectNoAddress(text: string) {
  for (const secret of [CATALOG_BASE, STREAM_BASE, SECRET_SEGMENT]) expect(text).not.toContain(secret)
}

const noCertificate = async (error: unknown) => error

function manifestFetch(summary: AddonManifestSummary) {
  return vi.fn(async (_base: string) => summary)
}

function failingFetch(error: unknown) {
  return vi.fn(async (_base: string): Promise<AddonManifestSummary> => Promise.reject(error))
}

afterEach(() => {
  useStore.setState({ sources: [], activeSourceId: null, sourceErrors: {}, addonSessions: {}, legacySecretSourceIds: [], connectRetryToken: 0 })
})

describe('the address the user typed', () => {
  it('has a sentence for every problem', () => {
    expect(addonAddressMessage('empty')).toBe(validation.emptyAddonUrl)
    expect(addonAddressMessage('invalid')).toBe(validation.invalidAddonUrl)
    expect(addonAddressMessage('unsupported-protocol')).toBe(validation.httpOnlyAddon)
    expect(addonAddressMessage('too-long')).toBe(validation.addonUrlTooLong)
  })

  it('is refused beside the field before anything is fetched', async () => {
    const fetchManifest = manifestFetch(catalogSummary)
    expect(await checkNewAddon('  ', [], { fetchManifest })).toEqual({ ok: false, error: { field: 'url', message: validation.emptyAddonUrl } })
    expect(await checkNewAddon('ftp://addon.example/manifest.json', [], { fetchManifest })).toEqual({
      ok: false,
      error: { field: 'url', message: validation.httpOnlyAddon }
    })
    expect(fetchManifest).not.toHaveBeenCalled()
  })

  it('accepts a manifest link, a stremio:// link and a bare host as the same base', async () => {
    const fetchManifest = manifestFetch(catalogSummary)
    for (const input of [`${CATALOG_BASE}/manifest.json`, `stremio://addon.example/${SECRET_SEGMENT}/manifest.json`, `addon.example/${SECRET_SEGMENT}`]) {
      const result = await checkNewAddon(input, [], { fetchManifest, certificateAware: noCertificate })
      expect(result).toMatchObject({ ok: true, addon: { base: CATALOG_BASE, host: 'addon.example' } })
    }
    expect(fetchManifest.mock.calls.map(([base]) => base)).toEqual([CATALOG_BASE, CATALOG_BASE, CATALOG_BASE])
  })
})

describe('a failed manifest request', () => {
  it('says the add-on refused the address, not a user name and password', () => {
    const refused = new XtreamRequestError('http', 'Sunucu isteği reddetti (HTTP 401).', { status: 401, host: 'addon.example' })
    expect(placeAddonError(refused, text.checkFailed)).toEqual({ field: 'url', message: validation.addonRefused })
    const forbidden = new XtreamRequestError('http', 'Sunucu isteği reddetti (HTTP 403).', { status: 403, host: 'addon.example' })
    expect(placeAddonError(forbidden, text.checkFailed).message).toBe(validation.addonRefused)
    expect(validation.addonRefused).not.toMatch(/kullanıcı adı|şifre/i)
  })

  it('reads a missing or malformed manifest as "no add-on here"', () => {
    const missing = new XtreamRequestError('http', 'Sunucu isteği reddetti (HTTP 404).', { status: 404, host: 'addon.example' })
    expect(placeAddonError(missing, text.checkFailed)).toEqual({ field: 'url', message: validation.notAnAddon })
    const malformed = new XtreamRequestError('bad-response', 'Sunucudan beklenmeyen bir yanıt geldi.', { host: 'addon.example' })
    expect(placeAddonError(malformed, text.checkFailed)).toEqual({ field: 'url', message: validation.notAnAddon })
  })

  it('puts network failures beside the address and unknown ones under the form', () => {
    const offline = new XtreamRequestError('network', 'Sunucuya ulaşılamadı.', { host: 'addon.example' })
    expect(placeAddonError(offline, text.checkFailed).field).toBe('url')
    expect(placeAddonError(new Error('boom'), text.checkFailed)).toEqual({ field: null, message: text.checkFailed })
  })

  it('never shows the address, whatever failed', async () => {
    const failures = [
      new XtreamRequestError('http', 'x', { status: 401, host: 'addon.example' }),
      new XtreamRequestError('http', 'x', { status: 500, host: 'addon.example' }),
      new XtreamRequestError('network', 'x', { host: 'addon.example' }),
      new XtreamRequestError('timeout', 'x', { host: 'addon.example' }),
      new Error(`${CATALOG_BASE}/manifest.json failed`)
    ]
    for (const failure of failures) {
      const result = await checkNewAddon(`${CATALOG_BASE}/manifest.json`, [], { fetchManifest: failingFetch(failure), certificateAware: noCertificate })
      expect(result.ok).toBe(false)
      expectNoAddress(messagesOf(result))
    }
  })

  it('asks main about a refused certificate', async () => {
    const offline = new XtreamRequestError('network', 'x', { host: 'addon.example' })
    const certificate = new XtreamRequestError('certificate', 'sertifika', { host: 'addon.example' })
    const certificateAware = vi.fn(async () => certificate)
    const result = await checkNewAddon(CATALOG_BASE, [], { fetchManifest: failingFetch(offline), certificateAware })
    expect(certificateAware).toHaveBeenCalledWith(offline)
    expect(result).toEqual({ ok: false, error: { field: 'url', message: strings.errors.kinds.certificate } })
  })
})

describe('what an add-on provides', () => {
  it('counts the catalogues the app shows and those it does not', () => {
    expect(describeAddonOffer(catalogSummary)).toEqual({
      movieCatalogs: 1,
      seriesCatalogs: 1,
      streams: false,
      subtitles: false,
      // A search-only film catalogue and a TV catalogue.
      unusedCatalogs: 2,
      canBeActive: true,
      usable: true
    })
    expect(describeAddonOffer(streamSummary)).toMatchObject({ movieCatalogs: 0, streams: true, canBeActive: false, usable: true })
    expect(describeAddonOffer(subtitlesSummary)).toMatchObject({ subtitles: true, usable: false })
  })

  it('is said in plain words, with what the app does not use yet', () => {
    const catalogue = describeAddonOffer(catalogSummary)
    expect(addonOfferLines(catalogue)).toEqual([text.movieCatalogs(1), text.seriesCatalogs(1)])
    expect(addonOfferNotes(catalogue, false)).toEqual([text.unusedCatalogs(2), text.catalogOnly])
    expect(addonOfferNotes(catalogue, true)).toContain(text.adult)

    const stream = describeAddonOffer(streamSummary)
    expect(addonOfferLines(stream)).toEqual([text.streams])
    expect(addonOfferNotes(stream, false)).toEqual([text.streamOnly])
    expect(addonOfferLabels(stream)).toEqual([manager.addonLabels.streams])
    expect(addonOfferLabels(catalogue)).toEqual([manager.addonLabels.movieCatalogs, manager.addonLabels.seriesCatalogs])
  })

  it('refuses an add-on that provides nothing the app uses', async () => {
    const result = await checkNewAddon('altyazi.addon.example', [], { fetchManifest: manifestFetch(subtitlesSummary) })
    expect(result).toEqual({ ok: false, error: { field: 'url', message: validation.addonUnusable('Örnek Altyazı') } })
  })
})

describe('an add-on already installed', () => {
  it('is the same manifest id at the same address', () => {
    const sources = [catalogSource()]
    expect(findInstalledAddon(sources, catalogSummary, CATALOG_BASE)?.id).toBe('ek')
    // Another address is another configuration of the add-on.
    expect(findInstalledAddon(sources, catalogSummary, 'https://addon.example/baska-ayar')).toBeUndefined()
    expect(findInstalledAddon(sources, streamSummary, CATALOG_BASE)).toBeUndefined()
    expect(findInstalledAddon(sources, catalogSummary, CATALOG_BASE, 'ek')).toBeUndefined()
  })

  it('is refused with its name', async () => {
    const result = await checkNewAddon(`${CATALOG_BASE}/manifest.json`, [catalogSource()], { fetchManifest: manifestFetch(catalogSummary) })
    expect(result).toEqual({ ok: false, error: { field: 'url', message: validation.duplicateAddon('Örnek Katalog') } })
  })
})

describe('the source in use', () => {
  const xtream: PlaylistSource = { id: 'xt', name: 'Panel', type: 'xtream', url: 'http://panel.example', addedAt: 1 }

  it('becomes a new catalogue add-on only when nothing is in use', () => {
    const fresh = catalogSource({ id: 'yeni' })
    expect(shouldActivateNewAddon(fresh, { sources: [], activeSourceId: null })).toBe(true)
    expect(shouldActivateNewAddon(fresh, { sources: [streamSource()], activeSourceId: null })).toBe(true)
    expect(shouldActivateNewAddon(fresh, { sources: [xtream], activeSourceId: 'xt' })).toBe(false)
    expect(shouldActivateNewAddon(fresh, { sources: [xtream], activeSourceId: 'gone' })).toBe(true)
  })

  it('is never a stream-only add-on, not even as the first source', () => {
    expect(shouldActivateNewAddon(streamSource(), { sources: [], activeSourceId: null })).toBe(false)
  })

  it('can be picked among catalogue add-ons only while add-on sources are on, and says why not', () => {
    expect(canChooseAsActive(xtream, false)).toBe(true)
    expect(canChooseAsActive(catalogSource(), true)).toBe(true)
    expect(canChooseAsActive(catalogSource(), false)).toBe(false)
    expect(canChooseAsActive(streamSource(), true)).toBe(false)
    expect(notChoosableReason(xtream, false)).toBeNull()
    expect(notChoosableReason(streamSource(), true)).toBe(manager.streamOnlyNotActive)
    expect(notChoosableReason(catalogSource(), false)).toBe(manager.addonsOff)
  })
})

describe('the new source', () => {
  it('takes the add-on’s name and keeps the address only in memory', () => {
    const source = addonSourceFor({ base: CATALOG_BASE, host: 'addon.example', summary: catalogSummary, offer: describeAddonOffer(catalogSummary) }, 5)
    expect(source).toEqual({ id: 'addon_5', name: 'Örnek Katalog', type: 'addon', url: CATALOG_BASE, addon: catalogSummary, addedAt: 5 })
    useStore.setState({ sources: [source] })
    expectNoAddress(JSON.stringify(createPartialize()(useStore.getState() as AppStore)))
  })
})

describe('entering an add-on’s address again', () => {
  it('must still be the same add-on', async () => {
    const source = catalogSource({ url: undefined })
    const same = await checkAddonAddressFor(source, `${CATALOG_BASE}/manifest.json`, [source], { fetchManifest: manifestFetch(catalogSummary) })
    expect(same).toMatchObject({ ok: true, addon: { base: CATALOG_BASE, summary: catalogSummary } })
    const other = await checkAddonAddressFor(source, STREAM_BASE, [source], { fetchManifest: manifestFetch(streamSummary) })
    expect(other).toEqual({ ok: false, error: { field: 'url', message: validation.otherAddon('Örnek Akış') } })
    expectNoAddress(messagesOf(other))
  })

  it('accepts any add-on when the stored summary was unreadable', async () => {
    const source = catalogSource({ url: undefined, addon: { ...catalogSummary, id: 'unknown' } })
    const result = await checkAddonAddressFor(source, STREAM_BASE, [source], { fetchManifest: manifestFetch(streamSummary) })
    expect(result.ok).toBe(true)
  })

  it('refuses the address of another source of the same add-on', async () => {
    const lost = catalogSource({ id: 'kayip', url: undefined })
    const result = await checkAddonAddressFor(lost, CATALOG_BASE, [lost, catalogSource()], { fetchManifest: manifestFetch(catalogSummary) })
    expect(result).toEqual({ ok: false, error: { field: 'url', message: validation.duplicateAddon('Örnek Katalog') } })
  })

  it('stores it first, then puts it and the fresh summary on the source in place', async () => {
    useStore.setState({
      sources: [catalogSource({ url: undefined })],
      sourceErrors: { ek: { kind: 'missing-secret', message: 'yok', retryAt: null } },
      connectRetryToken: 1
    })
    const setAddonUrl = vi.fn().mockResolvedValue(undefined)
    const fresh = { ...catalogSummary, version: '2.0.0' }
    await saveSourceSecret('ek', { addonUrl: CATALOG_BASE, addon: fresh }, { setAddonUrl })
    expect(setAddonUrl).toHaveBeenCalledWith('ek', CATALOG_BASE)
    const state = useStore.getState()
    expect(state.sources[0]).toMatchObject({ id: 'ek', url: CATALOG_BASE, addon: fresh })
    expect(state.sourceErrors).toEqual({})
    expect(state.connectRetryToken).toBe(2)
    expectNoAddress(JSON.stringify(createPartialize()(state as AppStore)))
  })
})

describe('the add-on form', () => {
  const found = { base: CATALOG_BASE, host: 'addon.example', summary: catalogSummary, offer: describeAddonOffer(catalogSummary) }

  it('checks, shows what was found and empties the field once saved', () => {
    let state = addonFormReducer(initialAddonFormState, { type: 'setAddress', value: CATALOG_BASE })
    state = addonFormReducer(state, { type: 'checkStart' })
    expect(state.phase).toBe('checking')
    state = addonFormReducer(state, { type: 'checkDone', found })
    expect(state).toMatchObject({ phase: 'review', found })
    state = addonFormReducer(state, { type: 'saveStart' })
    expect(state.phase).toBe('saving')
    state = addonFormReducer(state, { type: 'saved', name: 'Örnek Katalog' })
    expect(state).toEqual({ ...initialAddonFormState, added: 'Örnek Katalog' })
  })

  it('drops what was found when the address changes or the user steps back', () => {
    const review = addonFormReducer({ ...initialAddonFormState, address: CATALOG_BASE }, { type: 'checkDone', found })
    expect(addonFormReducer(review, { type: 'setAddress', value: `${CATALOG_BASE}x` })).toMatchObject({ phase: 'edit', found: null })
    expect(addonFormReducer(review, { type: 'back' })).toMatchObject({ phase: 'edit', found: null, address: CATALOG_BASE })
  })

  it('keeps the review after a failed save and the address after a failed check', () => {
    const review = addonFormReducer({ ...initialAddonFormState, address: CATALOG_BASE }, { type: 'checkDone', found })
    const failedSave = addonFormReducer(addonFormReducer(review, { type: 'saveStart' }), {
      type: 'saveFailed',
      error: { field: null, message: text.addFailed }
    })
    expect(failedSave).toMatchObject({ phase: 'review', found, error: { message: text.addFailed } })
    const failedCheck = addonFormReducer(addonFormReducer(review, { type: 'checkStart' }), {
      type: 'checkFailed',
      error: { field: 'url', message: validation.notAnAddon }
    })
    expect(failedCheck).toMatchObject({ phase: 'edit', address: CATALOG_BASE, found: null })
  })

  it('does not save without a checked add-on', () => {
    expect(addonFormReducer(initialAddonFormState, { type: 'saveStart' })).toBe(initialAddonFormState)
  })
})
