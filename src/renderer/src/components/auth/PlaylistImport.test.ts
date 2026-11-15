import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platform = vi.hoisted(() => ({ pickAndReadFile: vi.fn() }))
vi.mock('@/services/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/platform')>()),
  pickAndReadFile: platform.pickAndReadFile
}))

import { useStore } from '@/store'
import { catalog } from '@/catalog/catalog-store'
import { secureCredentialService } from '@/services/secure-credentials'
import { createCatalogWorkerClient, setCatalogWorkerForTests, type CatalogWorkerClient } from '@/workers/client'
import type { WorkerJobKind } from '@/workers/protocol'
import { strings } from '@/strings'
import { PlaylistImport } from './PlaylistImport'

/** The one source the form added. */
function onlySource() {
  const [source, ...rest] = useStore.getState().sources
  if (!source || rest.length > 0) throw new Error('expected exactly one source')
  return source
}

/** Jobs the catalog worker was given. */
let jobs: WorkerJobKind[] = []

function recordingWorker(): CatalogWorkerClient {
  const inner = createCatalogWorkerClient({ inPage: { backend: null } })
  return {
    ...inner,
    get isolated() {
      return inner.isolated
    },
    start: (job, handlers, signal) => {
      jobs.push(job.kind)
      return inner.start(job, handlers, signal)
    },
    run: (job, handlers, signal) => {
      jobs.push(job.kind)
      return inner.run(job, handlers, signal)
    }
  }
}

const PLAYLIST = '#EXTM3U\n#EXTINF:-1 group-title="Haber",Kanal 1\nhttp://cdn.test/1.ts\n'

function renderForm() {
  render(createElement(MemoryRouter, null, createElement(PlaylistImport)))
}

beforeEach(() => {
  jobs = []
  setCatalogWorkerForTests(recordingWorker())
  catalog.reset()
  useStore.setState({ sources: [], activeSourceId: null })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  catalog.reset()
  useStore.setState({ sources: [], activeSourceId: null })
})

describe('PlaylistImport (C2c follow-up)', () => {
  it('downloads and parses a playlist URL in the catalog worker, and adds the source once its URL is stored', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(PLAYLIST)))
    vi.stubGlobal('fetch', fetchMock)
    const setM3uUrl = vi.spyOn(secureCredentialService, 'setM3uUrl').mockResolvedValue()
    renderForm()

    fireEvent.change(screen.getByLabelText(strings.sources.fields.playlistUrl), { target: { value: 'http://panel.test/get.php?u=1' } })
    fireEvent.click(screen.getByRole('button', { name: strings.sources.m3u.import }))

    await waitFor(() => expect(useStore.getState().sources).toHaveLength(1))
    const source = onlySource()
    expect(setM3uUrl).toHaveBeenCalledWith(source.id, 'http://panel.test/get.php?u=1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Swapped in by the worker ingest, not handed back to the form.
    expect(jobs).toContain('m3u-url')
    expect(catalog.getItems(source.id, 'live').map((item) => item.name)).toEqual(['Kanal 1'])
    expect(useStore.getState().activeSourceId).toBe(source.id)
  })

  it('drops the loaded playlist when its URL cannot be stored, and adds nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(PLAYLIST))))
    vi.spyOn(secureCredentialService, 'setM3uUrl').mockRejectedValue(new Error('Güvenli depo yazılamadı'))
    renderForm()

    fireEvent.change(screen.getByLabelText(strings.sources.fields.playlistUrl), { target: { value: 'http://panel.test/get.php?u=1' } })
    fireEvent.click(screen.getByRole('button', { name: strings.sources.m3u.import }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringMatching(/Güvenli depo yazılamadı/))
    expect(useStore.getState().sources).toEqual([])
    expect(catalog.getSourceIds()).toEqual([])
  })

  it('parses a local file in the worker, not on the main thread', async () => {
    platform.pickAndReadFile.mockResolvedValue({ path: 'C:\\listeler\\a.m3u', content: PLAYLIST })
    renderForm()

    fireEvent.click(screen.getByRole('radio', { name: strings.sources.m3u.modeFile }))
    fireEvent.click(screen.getByRole('button', { name: strings.sources.m3u.pickFile }))

    await waitFor(() => expect(useStore.getState().sources).toHaveLength(1))
    const source = onlySource()
    expect(source).toMatchObject({ type: 'm3u_file', filePath: 'C:\\listeler\\a.m3u' })
    expect(catalog.getItems(source.id, 'live').map((item) => item.name)).toEqual(['Kanal 1'])
    expect(catalog.getStatus(source.id, 'live')).toMatchObject({ complete: true, fromCache: false })
    // Parsed (and cached) by the worker at import time.
    expect(jobs).toContain('m3u-text')
  })
})
