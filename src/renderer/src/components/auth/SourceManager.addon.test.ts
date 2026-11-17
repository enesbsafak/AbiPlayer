import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@/store'
import { catalog } from '@/catalog/catalog-store'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { CATALOG_BASE, CATALOG_MANIFEST, SECRET_SEGMENT, catalogSource, jsonResponse, streamSource } from '@/addons/testing/fixtures'
import { strings } from '@/strings'
import { AddSource } from './AddSource'
import { SourceManager } from './SourceManager'

const { manager, add } = strings.sources

const fetchMock = vi.fn<(input: unknown) => Promise<Response>>()

function setAddons(enabled: boolean) {
  useStore.setState({ settings: { ...DEFAULT_SETTINGS, addonSourcesEnabled: enabled } })
}

/** The row's own button, which makes the source the one in use. */
function choice(name: string): RegExp {
  return new RegExp(`^${name}.*${manager.useThis}`)
}

function rowOf(name: string): HTMLElement {
  const item = screen.getByText(name).closest('li')
  if (!item) throw new Error(`no row for ${name}`)
  return item
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  catalog.reset()
  useStore.setState({
    sources: [catalogSource(), streamSource(), { id: 'xt', name: 'Panel', type: 'xtream', url: 'http://panel.example', addedAt: 3 }],
    activeSourceId: 'xt',
    addonSessions: { ek: { manifestFresh: true }, ak: { manifestFresh: false } },
    sourceErrors: {},
    credentialsHydrated: true,
    secretStoreError: null
  })
  setAddons(true)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  catalog.reset()
  useStore.setState({ sources: [], activeSourceId: null, addonSessions: {}, sourceErrors: {}, settings: DEFAULT_SETTINGS })
})

describe('add-on rows in the source list', () => {
  it('show the name, "Eklenti", the host and what the add-on provides, never the address', () => {
    const { container } = render(createElement(SourceManager))
    const row = rowOf('Örnek Katalog')
    expect(row.textContent).toContain(`${strings.sources.typeLabels.addon} · addon.example`)
    expect(within(row).getByRole('list', { name: manager.addonLabelsName }).textContent).toBe(
      manager.addonLabels.movieCatalogs + manager.addonLabels.seriesCatalogs
    )
    expect(container.innerHTML).not.toContain(SECRET_SEGMENT)
  })

  it('make a catalogue add-on a choice, but not a stream-only one, which says why', () => {
    render(createElement(SourceManager))
    fireEvent.click(within(rowOf('Örnek Katalog')).getByRole('button', { name: choice('Örnek Katalog') }))
    expect(useStore.getState().activeSourceId).toBe('ek')

    const stream = rowOf('Örnek Akış')
    expect(within(stream).queryByRole('button', { name: choice('Örnek Akış') })).toBeNull()
    expect(stream.textContent).toContain(manager.streamOnlyNotActive)
    expect(stream.textContent).toContain(manager.addonUnreachable)
  })

  it('offer refreshing the manifest and removing, nothing Xtream- or M3U-only', () => {
    render(createElement(SourceManager))
    const row = rowOf('Örnek Katalog')
    expect(within(row).getByRole('button', { name: manager.refreshAddon('Örnek Katalog') })).toBeTruthy()
    expect(within(row).getByRole('button', { name: manager.remove('Örnek Katalog') })).toBeTruthy()
    expect(within(row).queryByText(manager.repickFile)).toBeNull()
    expect(within(row).queryByText(manager.enterAddress)).toBeNull()
  })

  it('offer entering the address again when it is missing', () => {
    useStore.setState({ sources: [catalogSource({ url: undefined })], activeSourceId: 'ek' })
    render(createElement(SourceManager))
    const row = rowOf('Örnek Katalog')
    expect(within(row).getByRole('button', { name: manager.enterAddress })).toBeTruthy()
    // Nothing to fetch the manifest with.
    expect(within(row).queryByRole('button', { name: manager.refreshAddon('Örnek Katalog') })).toBeNull()
  })

  it('refresh the manifest and its categories', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...CATALOG_MANIFEST, version: '9.0.0' }))
    render(createElement(SourceManager))
    fireEvent.click(screen.getByRole('button', { name: manager.refreshAddon('Örnek Katalog') }))
    await waitFor(() => {
      expect(useStore.getState().sources[0]?.addon?.version).toBe('9.0.0')
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${CATALOG_BASE}/manifest.json`)
    expect(catalog.getCategories('ek', 'vod').map((category) => category.name)).toEqual(['Popüler Filmler'])
  })

  it('say a refused address in the add-on’s own words', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 403 }))
    render(createElement(SourceManager))
    fireEvent.click(screen.getByRole('button', { name: manager.refreshAddon('Örnek Katalog') }))
    expect((await screen.findByRole('alert')).textContent).toBe(strings.sources.validation.addonRefused)
    // A new address can be entered in place, keeping the source's id.
    fireEvent.click(within(rowOf('Örnek Katalog')).getByRole('button', { name: manager.enterAddress }))
    expect((screen.getByLabelText<HTMLInputElement>(strings.sources.fields.addonUrl)).value).toBe('')
  })

  it('while add-on sources are off, stay listed and removable and nothing more', () => {
    setAddons(false)
    render(createElement(SourceManager))
    const row = rowOf('Örnek Katalog')
    expect(within(row).queryByRole('button', { name: choice('Örnek Katalog') })).toBeNull()
    expect(within(row).queryByRole('button', { name: manager.refreshAddon('Örnek Katalog') })).toBeNull()
    expect(within(row).getByRole('button', { name: manager.remove('Örnek Katalog') })).toBeTruthy()
    expect(row.textContent).toContain(manager.addonsOff)
  })
})

describe('the add step', () => {
  function renderAddSource() {
    return render(createElement(MemoryRouter, null, createElement(AddSource, { first: false })))
  }

  it('has no add-on choice while add-on sources are off', () => {
    setAddons(false)
    renderAddSource()
    expect(screen.queryByRole('button', { name: new RegExp(add.addonChoice) })).toBeNull()
  })

  it('offers the add-on form as a third choice while they are on', () => {
    renderAddSource()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(add.addonChoice) }))
    expect(screen.getByLabelText(strings.sources.fields.addonUrl)).toBeTruthy()
  })

  it('checks the address, shows what was found, and adds it as the source in use when none is', async () => {
    useStore.setState({ sources: [streamSource()], activeSourceId: null, addonSessions: {} })
    fetchMock.mockResolvedValue(jsonResponse(CATALOG_MANIFEST))
    const { container } = renderAddSource()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(add.addonChoice) }))
    const field = screen.getByLabelText<HTMLInputElement>(strings.sources.fields.addonUrl)
    fireEvent.change(field, { target: { value: `stremio://addon.example/${SECRET_SEGMENT}/manifest.json` } })
    fireEvent.click(screen.getByRole('button', { name: strings.sources.addon.check }))

    const found = await screen.findByRole('region', { name: strings.sources.addon.foundLabel })
    expect(found.textContent).toContain('Örnek Katalog')
    expect(found.textContent).toContain('Sürüm 1.2.0 · addon.example')
    expect(found.textContent).toContain(strings.sources.addon.movieCatalogs(1))
    // The address is in its own field and nowhere else on the screen.
    const shown = container.cloneNode(true) as HTMLElement
    shown.querySelectorAll('input').forEach((input) => input.remove())
    expect(shown.innerHTML).not.toContain(SECRET_SEGMENT)
    expect(useStore.getState().sources).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: strings.sources.addon.add }))
    await waitFor(() => {
      expect(useStore.getState().sources).toHaveLength(2)
    })
    const added = useStore.getState().sources[1]
    expect(added).toMatchObject({ type: 'addon', name: 'Örnek Katalog', url: CATALOG_BASE })
    expect(useStore.getState().activeSourceId).toBe(added?.id)
    expect(useStore.getState().addonSessions[added?.id ?? '']).toEqual({ manifestFresh: true })
    expect(catalog.getCategories(added?.id ?? '', 'series').map((category) => category.name)).toEqual(['Yeni Diziler'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses the same add-on at the same address', async () => {
    fetchMock.mockResolvedValue(jsonResponse(CATALOG_MANIFEST))
    renderAddSource()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(add.addonChoice) }))
    fireEvent.change(screen.getByLabelText(strings.sources.fields.addonUrl), { target: { value: `${CATALOG_BASE}/manifest.json` } })
    fireEvent.click(screen.getByRole('button', { name: strings.sources.addon.check }))
    expect((await screen.findByRole('alert')).textContent).toBe(strings.sources.validation.duplicateAddon('Örnek Katalog'))
    expect(screen.queryByRole('button', { name: strings.sources.addon.add })).toBeNull()
  })
})
