// Two local fake add-ons speaking the Stremio add-on protocol, for the add-on
// source scenarios: a catalogue add-on (film and series catalogues, metas)
// and a stream add-on (streams only). Both live under one base address with a
// secret path segment, as a real add-on's personal settings are, and refuse
// any other segment with 403, so the scenarios can check the segment never
// leaves the add-on's own requests. Every answer carries
// `Access-Control-Allow-Origin: *`. Names are invented; nothing here is
// modelled on a particular add-on. Only 127.0.0.1 is ever contacted: stream
// URLs redirect to the mock provider's film file.

import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import type { Json, JsonObject } from './catalog.ts'
import { artworkPng } from './png.ts'

export type MockAddonName = 'katalog' | 'yayin'

/** What a scenario can flip per add-on. */
export interface MockAddonSwitches {
  /** Every request of this add-on answers 500 (with the CORS header, as a broken add-on behind a proxy does). */
  down: boolean
  /** Added before every answer of this add-on. */
  latencyMs: number
  /** Catalogue pages after the first (`skip` > 0) answer 500. */
  failPagesAfterFirst: boolean
}

export interface MockAddonRequest {
  /** Which add-on the path named, or null (images, wrong segment, unknown). */
  addon: MockAddonName | null
  /** manifest, catalog, meta, stream, play, img, refused, not-found, preflight. */
  route: string
  /** The path as received, query included. */
  url: string
  /** The request carried the right secret segment. */
  secretOk: boolean
  /** For catalogue requests: the catalogue id and its `skip` (0 for the first page). */
  catalog?: { type: string; id: string; skip: number }
  /** For meta and stream requests: the decoded id. */
  id?: string
  status: number
  headers: Record<string, string>
}

export interface MockAddons {
  /** `http://127.0.0.1:<port>` */
  origin: string
  /** `127.0.0.1:<port>`: what the app may show of an add-on's address. */
  host: string
  /** The secret path segment both add-ons hang under. */
  secret: string
  /** What the user pastes for the catalogue add-on (its manifest link). */
  catalogUrl: string
  /** What the user pastes for the stream add-on. */
  streamUrl: string
  /** The catalogue add-on's address with another segment: refused with 403. */
  wrongSecretUrl: string
  /** Every stream URL the stream add-on hands out (all secret). */
  candidateUrls(): string[]
  /** The random part of each stream URL: a URL with its secret cut off still holds one. */
  candidateTokens(): string[]
  /** Every string the app must never show, store or log. */
  secrets(): string[]
  /**
   * The random part of the stream URL offered for a film or episode, for
   * `waitForMpvProgress`: it is in the URL mpv opens and in the one it is
   * redirected to.
   */
  streamToken(key: StreamKey): string
  set(addon: MockAddonName, patch: Partial<MockAddonSwitches>): void
  requests(): MockAddonRequest[]
  /** `skip` values the app asked of a catalogue, in order. */
  catalogSkips(catalogId: string): number[]
  close(): Promise<void>
}

export interface MockAddonOptions {
  /**
   * Where a chosen stream URL redirects to: a playable file of the mock
   * provider. Should carry `token` (in its query, say) so the stream can be
   * told apart from the others whichever URL mpv reports.
   */
  mediaUrl: (token: string) => string
  host?: string
  port?: number
}

/** Names and counts the scenarios refer to. */
export const ADDON_KNOWN = {
  catalogName: 'Örnek Katalog',
  catalogVersion: '1.2.0',
  streamName: 'Örnek Yayın',
  streamVersion: '0.9.1',
  popularCatalog: 'Popüler Filmler',
  popularCount: 120,
  pageSize: 50,
  shortCatalog: 'Kısa Liste',
  seriesCatalog: 'Örnek Diziler',
  /** Catalogues of the manifest the app does not show: a channel list and a genre-only one. */
  ignoredCatalogs: ['Örnek Kanallar', 'Türe Göre'],
  /** Two playable candidates, a peer-to-peer one and an external link (never shown). */
  film: 'Deniz Feneri',
  /** Its meta id, which is also its video id (what watch progress is keyed by). */
  filmId: 'tt9100001',
  filmPlot: 'Bir deniz feneri bekçisi, sisli bir gecede kıyıya vuran bir sandığın peşine düşer.',
  /** The stream add-on has nothing for it. */
  filmNoStreams: 'Boş Sahne',
  /** One playable candidate. */
  filmOneStream: 'Gece Yolu',
  /** Its meta answers 404: the detail shows what the card knows. */
  filmNoMeta: 'Kayıp Kayıt',
  series: 'Sisli Vadi',
  /** Season 1, in order. */
  seasonOne: ['Sis Çöküyor', 'Kayıp İz', 'Fener'],
  seasonTwo: ['Yeni Başlangıç', 'Dönüş'],
  special: 'Kamera Arkası',
  /** The two film candidates as the picker shows them. */
  candidates: [
    { name: 'Örnek Akış 1080p', detail: 'WEB-DL', size: '1,4 GB' },
    { name: 'Örnek Akış 720p', detail: 'WEB · hafif' }
  ],
  /** Texts of candidates the app must drop. */
  droppedCandidates: ['Eş ağı kaydı', 'Dış bağlantı'],
  popularFilm(index: number): string {
    return `Popüler Film ${String(index).padStart(3, '0')}`
  }
} as const

export type StreamKey =
  | 'film-1080'
  | 'film-720'
  | 'film-one'
  | `episode-${number}-${number}`

const DEFAULT_SWITCHES: MockAddonSwitches = { down: false, latencyMs: 0, failPagesAfterFirst: false }

const ID = {
  film: ADDON_KNOWN.filmId,
  filmNoStreams: 'tt9100002',
  filmOneStream: 'tt9100003',
  filmNoMeta: 'tt9100004',
  filmQuiet: 'tt9100005',
  series: 'tt9300001',
  seriesBare: 'tt9300002'
} as const

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function popularId(index: number): string {
  return `tt92${String(index).padStart(5, '0')}`
}

export async function startMockAddons(options: MockAddonOptions): Promise<MockAddons> {
  const secret = `s3cr3t-${randomBytes(16).toString('hex')}`
  const runTag = randomBytes(4).toString('hex')
  const switches: Record<MockAddonName, MockAddonSwitches> = {
    katalog: { ...DEFAULT_SWITCHES },
    yayin: { ...DEFAULT_SWITCHES }
  }
  const sockets = new Set<Socket>()
  let log: MockAddonRequest[] = []
  let origin = ''

  const base = (addon: MockAddonName) => `${origin}/${secret}/${addon}`
  const image = (kind: 'poster' | 'backdrop', seed: number) => `${origin}/img/${kind}/${seed}.png`
  // A random part per run, so a stream URL is recognisable even with its secret cut off.
  const token = (key: StreamKey) => `${runTag}-${key}`
  const playUrl = (key: StreamKey) => `${base('yayin')}/play/${token(key)}.mp4`

  // -------------------------------------------------------------------------
  // The catalogue add-on

  const catalogManifest: JsonObject = {
    id: 'example.ornek.katalog',
    name: ADDON_KNOWN.catalogName,
    version: ADDON_KNOWN.catalogVersion,
    description: 'Uçtan uca testler için uydurma bir katalog eklentisi.',
    types: ['movie', 'series', 'tv'],
    idPrefixes: ['tt'],
    // Both forms of a resource entry: a bare name and an object.
    resources: ['catalog', { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt'] }],
    catalogs: [
      { type: 'movie', id: 'populer', name: ADDON_KNOWN.popularCatalog, extra: [{ name: 'skip' }, { name: 'genre', options: ['Dram'] }] },
      { type: 'movie', id: 'kisa', name: ADDON_KNOWN.shortCatalog },
      { type: 'series', id: 'diziler', name: ADDON_KNOWN.seriesCatalog },
      { type: 'tv', id: 'kanallar', name: 'Örnek Kanallar' },
      { type: 'movie', id: 'tur', name: 'Türe Göre', extra: [{ name: 'genre', isRequired: true, options: ['Dram'] }] }
    ],
    behaviorHints: { configurable: true }
  }

  interface Film {
    id: string
    name: string
    year: number
    seed: number
    description: string
  }

  const shortFilms: Film[] = [
    { id: ID.film, name: ADDON_KNOWN.film, year: 2023, seed: 501, description: ADDON_KNOWN.filmPlot },
    { id: ID.filmNoStreams, name: ADDON_KNOWN.filmNoStreams, year: 2021, seed: 502, description: 'Perde açılır, sahnede kimse yoktur.' },
    { id: ID.filmOneStream, name: ADDON_KNOWN.filmOneStream, year: 2019, seed: 503, description: 'Bir otobüs şoförünün son seferi.' },
    { id: ID.filmNoMeta, name: ADDON_KNOWN.filmNoMeta, year: 2020, seed: 504, description: 'Ayrıntısı olmayan bir kayıt.' },
    { id: ID.filmQuiet, name: 'Sessiz Kıyı', year: 2022, seed: 505, description: 'Bir balıkçı kasabasında geçen bir yaz.' }
  ]
  const popularFilms: Film[] = Array.from({ length: ADDON_KNOWN.popularCount }, (_unused, offset) => ({
    id: popularId(offset + 1),
    name: ADDON_KNOWN.popularFilm(offset + 1),
    year: 2000 + (offset % 25),
    seed: 600 + offset,
    description: `Uydurma katalogdaki ${offset + 1}. film.`
  }))
  const series = [
    { id: ID.series, name: ADDON_KNOWN.series, year: 2024, seed: 701, description: 'Sisli bir vadide kaybolan bir köyün hikâyesi.' },
    { id: ID.seriesBare, name: 'Uzak Ada', year: 2018, seed: 702, description: 'Bölüm listesi olmayan bir dizi.' }
  ]

  const preview = (item: Film, type: 'movie' | 'series'): JsonObject => ({
    id: item.id,
    type,
    name: item.name,
    poster: image('poster', item.seed),
    background: image('backdrop', item.seed),
    releaseInfo: String(item.year),
    imdbRating: '7.1',
    description: item.description,
    genres: ['Dram']
  })

  function catalogPage(type: string, id: string, skip: number): Json[] | null {
    if (type === 'movie' && id === 'populer') {
      return popularFilms.slice(skip, skip + ADDON_KNOWN.pageSize).map((film) => preview(film, 'movie'))
    }
    if (type === 'movie' && id === 'kisa') return skip === 0 ? shortFilms.map((film) => preview(film, 'movie')) : []
    if (type === 'series' && id === 'diziler') return skip === 0 ? series.map((item) => preview(item, 'series')) : []
    if (type === 'tv' && id === 'kanallar') return []
    return null
  }

  const episodes: Array<{ season: number; episode: number; title: string }> = [
    // Specials first in the add-on's list: the app puts them last.
    { season: 0, episode: 1, title: ADDON_KNOWN.special },
    ...ADDON_KNOWN.seasonOne.map((title, index) => ({ season: 1, episode: index + 1, title })),
    ...ADDON_KNOWN.seasonTwo.map((title, index) => ({ season: 2, episode: index + 1, title }))
  ]
  const episodeId = (season: number, episode: number) => `${ID.series}:${season}:${episode}`

  function meta(type: string, id: string): JsonObject | null {
    if (type === 'movie') {
      if (id === ID.filmNoMeta) return null
      const film = [...shortFilms, ...popularFilms].find((entry) => entry.id === id)
      if (!film) return null
      return {
        ...preview(film, 'movie'),
        cast: ['Ayşe Örnek', 'Mehmet Deneme'],
        director: ['Zeynep Uydurma'],
        runtime: '104 min'
      }
    }
    if (type === 'series') {
      const item = series.find((entry) => entry.id === id)
      if (!item) return null
      return {
        ...preview(item, 'series'),
        cast: ['Can Sınama'],
        videos:
          item.id === ID.series
            ? episodes.map(({ season, episode, title }) => ({
                id: episodeId(season, episode),
                title,
                season,
                episode,
                released: new Date(Date.UTC(2024, season, episode)).toISOString(),
                overview: `${title}: uydurma bölüm özeti.`,
                thumbnail: image('backdrop', 800 + season * 10 + episode)
              }))
            : []
      }
    }
    return null
  }

  // -------------------------------------------------------------------------
  // The stream add-on

  const streamManifest: JsonObject = {
    id: 'example.ornek.yayin',
    name: ADDON_KNOWN.streamName,
    version: ADDON_KNOWN.streamVersion,
    description: 'Uçtan uca testler için uydurma bir yayın eklentisi.',
    types: ['movie', 'series'],
    catalogs: [],
    // The object form, its id prefixes on the entry.
    resources: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }]
  }

  function streams(type: string, id: string): Json[] {
    if (type === 'movie' && id === ID.film) {
      const [best, light] = ADDON_KNOWN.candidates
      return [
        {
          name: 'Örnek Akış\n1080p',
          title: `${ADDON_KNOWN.film} (2023)\n${best.detail}`,
          url: playUrl('film-1080'),
          behaviorHints: { bingeGroup: 'ornek-akis-1080p', videoSize: 1_503_238_553, filename: 'deniz-feneri.1080p.mp4' }
        },
        // Peer-to-peer and external candidates: not playable over http, never listed.
        { name: ADDON_KNOWN.droppedCandidates[0], title: 'Yalnızca eş ağından', infoHash: '0123456789abcdef0123456789abcdef01234567', fileIdx: 0 },
        { name: ADDON_KNOWN.droppedCandidates[1], title: 'Tarayıcıda açılır', externalUrl: 'http://127.0.0.1:9/disari' },
        {
          name: 'Örnek Akış\n720p',
          description: `${ADDON_KNOWN.film} (2023)\n${light.detail}`,
          url: playUrl('film-720'),
          behaviorHints: { bingeGroup: 'ornek-akis-720p' }
        }
      ]
    }
    if (type === 'movie' && id === ID.filmOneStream) {
      return [{ name: 'Örnek Akış\n720p', title: `${ADDON_KNOWN.filmOneStream}\nWEB`, url: playUrl('film-one') }]
    }
    if (type === 'series') {
      const match = /^tt9300001:(\d+):(\d+)$/.exec(id)
      if (!match) return []
      const key: StreamKey = `episode-${Number(match[1])}-${Number(match[2])}`
      return [
        {
          name: 'Örnek Akış\n1080p',
          title: `${ADDON_KNOWN.series} S${match[1]}E${match[2]}\nWEB-DL`,
          url: playUrl(key),
          behaviorHints: { bingeGroup: 'ornek-akis-1080p' }
        }
      ]
    }
    return []
  }

  const allStreamKeys = (): StreamKey[] => [
    'film-1080',
    'film-720',
    'film-one',
    ...episodes.map(({ season, episode }): StreamKey => `episode-${season}-${episode}`)
  ]

  // -------------------------------------------------------------------------
  // HTTP

  function cors(res: ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    res.setHeader('Cache-Control', 'no-store')
  }

  function json(res: ServerResponse, record: MockAddonRequest, status: number, body: Json) {
    record.status = status
    res.statusCode = status
    cors(res)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
  }

  function plain(res: ServerResponse, record: MockAddonRequest, status: number, body: string) {
    record.status = status
    res.statusCode = status
    cors(res)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end(body)
  }

  /** `a=1&b=2` of an extra segment. */
  function parseExtra(segment: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const pair of segment.split('&')) {
      const [key, value = ''] = pair.split('=')
      if (key) out[decodeURIComponent(key)] = decodeURIComponent(value)
    }
    return out
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = req.url ?? '/'
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value
    }
    const record: MockAddonRequest = { addon: null, route: 'not-found', url: raw, secretOk: false, status: 0, headers }
    log.push(record)
    if (log.length > 2000) log = log.slice(-2000)

    if (req.method === 'OPTIONS') {
      record.route = 'preflight'
      record.status = 204
      res.statusCode = 204
      cors(res)
      res.end()
      return
    }

    const path = raw.split('?')[0] ?? '/'
    const imageMatch = /^\/img\/(poster|backdrop)\/(\d+)\.png$/.exec(path)
    if (imageMatch) {
      record.route = 'img'
      const seed = Number(imageMatch[2])
      const png = imageMatch[1] === 'poster' ? artworkPng(seed, 120, 180) : artworkPng(seed, 320, 180)
      record.status = 200
      res.statusCode = 200
      cors(res)
      res.setHeader('Content-Type', 'image/png')
      res.end(png)
      return
    }

    const parts = path.split('/').slice(1)
    const [segment, addonName, ...rest] = parts
    if (segment !== secret) {
      // Another (or no) personal segment: what an add-on does with a key it does not know.
      record.route = 'refused'
      plain(res, record, 403, 'Forbidden')
      return
    }
    record.secretOk = true
    if (addonName !== 'katalog' && addonName !== 'yayin') {
      plain(res, record, 404, 'Not found')
      return
    }
    const addon: MockAddonName = addonName
    record.addon = addon
    const state = switches[addon]
    if (state.latencyMs > 0) await sleep(state.latencyMs)
    if (state.down) {
      record.route = 'down'
      plain(res, record, 500, 'Internal Server Error')
      return
    }

    const decoded = rest.map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
    const [resource] = decoded
    const last = (decoded[decoded.length - 1] ?? '').replace(/\.json$/, '')

    if (decoded.length === 1 && resource === 'manifest.json') {
      record.route = 'manifest'
      json(res, record, 200, addon === 'katalog' ? catalogManifest : streamManifest)
      return
    }

    if (addon === 'yayin' && resource === 'play' && decoded.length === 2) {
      record.route = 'play'
      const key = (decoded[1] ?? '').replace(/\.mp4$/, '')
      // The stream URL points back at the add-on, which sends the player on to the file.
      record.status = 302
      res.statusCode = 302
      cors(res)
      res.setHeader('Location', options.mediaUrl(key))
      res.end()
      return
    }

    if (addon === 'katalog' && resource === 'catalog' && (decoded.length === 3 || decoded.length === 4)) {
      const type = decoded[1] ?? ''
      const id = decoded.length === 3 ? last : (decoded[2] ?? '')
      const extra = decoded.length === 4 ? parseExtra(rest[3]?.replace(/\.json$/, '') ?? '') : {}
      const skip = Number(extra.skip ?? 0) || 0
      record.route = 'catalog'
      record.catalog = { type, id, skip }
      if (skip > 0 && state.failPagesAfterFirst) {
        plain(res, record, 500, 'Internal Server Error')
        return
      }
      const metas = catalogPage(type, id, skip)
      if (!metas) {
        plain(res, record, 404, 'Not found')
        return
      }
      json(res, record, 200, { metas })
      return
    }

    if (addon === 'katalog' && resource === 'meta' && decoded.length === 3) {
      record.route = 'meta'
      record.id = last
      const found = meta(decoded[1] ?? '', last)
      if (!found) {
        plain(res, record, 404, 'Not found')
        return
      }
      json(res, record, 200, { meta: found })
      return
    }

    if (addon === 'yayin' && resource === 'stream' && decoded.length === 3) {
      record.route = 'stream'
      record.id = last
      json(res, record, 200, { streams: streams(decoded[1] ?? '', last) })
      return
    }

    plain(res, record, 404, 'Not found')
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) {
        res.statusCode = 500
        cors(res)
        res.end(String(error))
      } else {
        res.destroy()
      }
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  const host = `${options.host ?? '127.0.0.1'}:${address.port}`
  origin = `http://${host}`

  return {
    origin,
    host,
    secret,
    catalogUrl: `${base('katalog')}/manifest.json`,
    streamUrl: `${base('yayin')}/manifest.json`,
    wrongSecretUrl: `${origin}/s3cr3t-${randomBytes(16).toString('hex')}/katalog/manifest.json`,
    candidateUrls: () => allStreamKeys().map(playUrl),
    candidateTokens: () => allStreamKeys().map(token),
    secrets() {
      return [secret, ...allStreamKeys().map(playUrl), ...allStreamKeys().map(token)]
    },
    streamToken: token,
    set(addon, patch) {
      Object.assign(switches[addon], patch)
    },
    requests: () => log.map((entry) => ({ ...entry, headers: { ...entry.headers } })),
    catalogSkips: (catalogId) =>
      log.filter((entry) => entry.route === 'catalog' && entry.catalog?.id === catalogId).map((entry) => entry.catalog?.skip ?? 0),
    close() {
      for (const socket of sockets) socket.destroy()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
