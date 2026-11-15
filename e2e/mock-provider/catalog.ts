// Deterministic synthetic catalog for the mock Xtream panel.
//
// Real panels are inconsistent about types: ids arrive as numbers or strings,
// flags as 0, "0" or "1", icons as a URL, "" or null. The generator reproduces
// that mix on purpose (see `quirk`), so the app is exercised against what it
// will meet in the field rather than against a tidy schema.

export interface CatalogSize {
  live: number
  vod: number
  series: number
}

export const CATALOG_PRESETS = {
  // 2,000 / 50,000 / 200,000 items in total.
  small: { live: 1000, vod: 700, series: 300 },
  medium: { live: 15000, vod: 25000, series: 10000 },
  large: { live: 50000, vod: 110000, series: 40000 }
} satisfies Record<string, CatalogSize>

export type CatalogPreset = keyof typeof CATALOG_PRESETS

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }

export interface CategoryRecord extends JsonObject {
  category_id: string | number
  category_name: string
  parent_id: number
}

export interface Catalog {
  size: CatalogSize
  liveCategories: CategoryRecord[]
  vodCategories: CategoryRecord[]
  seriesCategories: CategoryRecord[]
  live: JsonObject[]
  vod: JsonObject[]
  series: JsonObject[]
  /** Category id (as a string) for each item, parallel to the arrays above. */
  liveCategoryOf: string[]
  vodCategoryOf: string[]
  seriesCategoryOf: string[]
}

/** Names the tests rely on. Everything else is generated. */
export const KNOWN = {
  liveCategory: 'TR | ULUSAL',
  liveChannels: ['TR: TRT 1 HD', 'TR: Show TV HD', 'TR: Kanal D HD', 'TR: Star TV HD', 'TR: ATV HD'],
  vodCategory: 'VOD | Yerli Filmler',
  film: 'Kayıp Şehir (2024)',
  dualAudioFilm: 'Çift Dilli Gece (2023)',
  seriesCategory: 'DİZİ | Yerli Diziler',
  series: 'Sessiz Liman (2021)'
} as const

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]
}

/** Every n-th record gets the "other" representation, as real panels do. */
function quirk<A, B>(index: number, every: number, usual: A, odd: B): A | B {
  return index % every === every - 1 ? odd : usual
}

const LIVE_COUNTRIES = ['TR', 'TR', 'TR', 'UK', 'DE', 'FR', 'NL', 'AZ', 'US', 'AR']
const LIVE_GENRES: Record<string, string[]> = {
  TR: ['ULUSAL', 'HABER', 'SPOR', 'BELGESEL', 'ÇOCUK', 'MÜZİK', 'SİNEMA', 'YEREL', 'DİNİ', 'EĞLENCE'],
  UK: ['NEWS', 'SPORTS', 'ENTERTAINMENT', 'KIDS', 'DOCUMENTARY'],
  DE: ['NACHRICHTEN', 'SPORT', 'UNTERHALTUNG', 'KINDER'],
  FR: ['INFO', 'SPORT', 'CINÉMA', 'JEUNESSE'],
  NL: ['NIEUWS', 'SPORT', 'ALGEMEEN'],
  AZ: ['ÜMUMİ', 'XƏBƏR'],
  US: ['NEWS', 'SPORTS', 'MOVIES', 'NETWORK'],
  AR: ['أخبار', 'رياضة', 'عام']
}
const LIVE_BASES = [
  'Spor', 'Haber', 'Sinema', 'Belgesel', 'Müzik', 'Çocuk', 'Aile', 'Dizi', 'Yaşam', 'Gündem',
  'Sports', 'News', 'Movies', 'Kids', 'Music', 'Planet', 'Arena', 'Max', 'Plus', 'One'
]
const QUALITY_SUFFIXES = ['HD', 'FHD', 'SD', '4K', 'HEVC', 'HD', 'HD', '']
const FAMOUS_TR = ['TRT 1', 'Show TV', 'Kanal D', 'Star TV', 'ATV', 'NTV', 'TV8', 'Habertürk', 'CNN Türk', 'TRT Spor', 'beIN Sports 1', 'beIN Sports 2', 'TRT Çocuk', 'TRT Belgesel', 'Kanal 7', 'Beyaz TV', 'TV 100', 'Halk TV', 'Sözcü TV', 'A Spor']

const VOD_GENRES = ['Yerli Filmler', 'Aksiyon', 'Dram', 'Komedi', 'Korku', 'Bilim Kurgu', 'Belgesel', 'Animasyon', 'Gerilim', 'Romantik', 'Macera', 'Suç', 'Savaş', 'Tarih', 'Aile']
const VOD_PREFIXES = ['VOD', 'VOD', 'VOD', '4K', 'MULTI-SUB', 'EN', 'DE']
const TITLE_ADJECTIVES = ['Karanlık', 'Sessiz', 'Son', 'Kayıp', 'Büyük', 'Gizli', 'Kırık', 'Soğuk', 'Uzak', 'Yalnız', 'Öfkeli', 'Çılgın', 'İlk', 'Derin', 'Şanslı', 'Görünmez', 'The Last', 'Silent', 'Broken', 'Hidden']
const TITLE_NOUNS = ['Gece', 'Şehir', 'Yolculuk', 'Sır', 'Ada', 'Rüya', 'Savaşçı', 'Gölge', 'Deniz', 'Liman', 'Köprü', 'Hikâye', 'Ateş', 'Kış', 'Çığlık', 'Ağaç', 'Kuzey', 'River', 'Kingdom', 'Signal']
const SERIES_GENRES = ['Yerli Diziler', 'Yabancı Diziler', 'Netflix', 'Kore Dizileri', 'Belgesel Dizileri', 'Animasyon Dizileri', 'Polisiye', 'Tarihi Diziler']
const CONTAINERS = ['mp4', 'mp4', 'mp4', 'mp4', 'mkv', 'mp4', 'mkv', 'mp4', 'mp4', 'mp4', 'mp4', 'mp4', 'mp4', 'mp4', 'mp4', 'mp4', 'mp4', 'mp4', 'ts', 'avi']

function categoryCount(items: number, perCategory: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(items / perCategory)))
}

function buildCategories(
  count: number,
  firstId: number,
  first: string,
  nameFor: (index: number) => string
): CategoryRecord[] {
  const seen = new Map<string, number>()
  const categories: CategoryRecord[] = []
  for (let index = 0; index < count; index += 1) {
    let name = index === 0 ? first : nameFor(index)
    const repeats = seen.get(name) ?? 0
    seen.set(name, repeats + 1)
    if (repeats > 0) name = `${name} ${repeats + 1}`
    const id = firstId + index
    categories.push({
      // Category ids are strings in the Xtream schema; a few panels send numbers.
      category_id: quirk(index, 13, String(id), id),
      category_name: name,
      parent_id: 0
    })
  }
  return categories
}

/** Spreads items over categories unevenly: the first few are much larger, like real panels. */
function assignCategory(index: number, total: number, categories: readonly CategoryRecord[], random: () => number): string {
  if (categories.length === 1) return String(categories[0].category_id)
  // First 2% of items always go to the first category so tests find known titles there.
  if (index < Math.max(5, Math.floor(total * 0.02))) return String(categories[0].category_id)
  const skewed = Math.floor(Math.pow(random(), 1.6) * categories.length)
  return String(categories[Math.min(categories.length - 1, skewed)].category_id)
}

function addedTimestamp(random: () => number): string {
  const now = 1_794_700_000 // fixed so output is reproducible
  return String(now - Math.floor(random() * 3 * 365 * 86_400))
}

export function generateCatalog(size: CatalogSize, baseUrl: string, seed = 20261115): Catalog {
  const random = mulberry32(seed)
  const art = (kind: string, id: number) => `${baseUrl}/img/${kind}/${id}.png`

  // --- Live ---
  const liveCategories = buildCategories(categoryCount(size.live, 60, 10, 800), 1, KNOWN.liveCategory, () => {
    const country = pick(random, LIVE_COUNTRIES)
    return `${country} | ${pick(random, LIVE_GENRES[country])}`
  })
  if (liveCategories.length >= 10) {
    liveCategories[liveCategories.length - 1].category_name = 'XXX | Yetişkin +18'
  }
  const adultLiveCategory = liveCategories.length >= 10 ? String(liveCategories[liveCategories.length - 1].category_id) : null

  const live: JsonObject[] = []
  const liveCategoryOf: string[] = []
  const nameUse = new Map<string, number>()
  for (let index = 0; index < size.live; index += 1) {
    const id = index + 1
    const categoryId = index === size.live - 1 && adultLiveCategory ? adultLiveCategory : assignCategory(index, size.live, liveCategories, random)
    let name: string
    if (index < KNOWN.liveChannels.length) {
      name = KNOWN.liveChannels[index]
    } else if (index < FAMOUS_TR.length) {
      name = `TR: ${FAMOUS_TR[index]} ${pick(random, QUALITY_SUFFIXES)}`.trim()
    } else {
      const country = pick(random, LIVE_COUNTRIES)
      name = `${country}: ${pick(random, LIVE_BASES)} ${pick(random, LIVE_BASES)} ${pick(random, QUALITY_SUFFIXES)}`.trim()
    }
    const used = nameUse.get(name) ?? 0
    nameUse.set(name, used + 1)
    if (used > 0) name = `${name} ${used + 1}`
    if (index === 11) name = 'Adult Swim HD' // plan item F1-53: not adult content
    const isAdult = categoryId === adultLiveCategory
    const hasArchive = index % 17 === 3

    live.push({
      num: id,
      name,
      stream_type: 'live',
      stream_id: quirk(index, 37, id, String(id)),
      stream_icon: index % 23 === 7 ? '' : index % 41 === 9 ? null : art('logo', id),
      epg_channel_id: index < 300 ? `ch${id}.mock` : index % 3 === 0 ? '' : null,
      added: addedTimestamp(random),
      is_adult: isAdult ? '1' : quirk(index, 5, '0', 0),
      category_id: quirk(index, 11, categoryId, Number(categoryId)),
      category_ids: [Number(categoryId)],
      custom_sid: quirk(index, 7, '', null),
      tv_archive: hasArchive ? quirk(index, 2, 1, '1') : quirk(index, 3, 0, '0'),
      direct_source: '',
      tv_archive_duration: hasArchive ? quirk(index, 2, 3, '7') : 0
    })
    liveCategoryOf.push(categoryId)
  }

  // --- VOD ---
  const vodCategories = buildCategories(categoryCount(size.vod, 120, 8, 600), 1001, KNOWN.vodCategory, (index) => {
    return `${pick(random, VOD_PREFIXES)} | ${VOD_GENRES[index % VOD_GENRES.length]}`
  })
  const vod: JsonObject[] = []
  const vodCategoryOf: string[] = []
  for (let index = 0; index < size.vod; index += 1) {
    const id = 100_000 + index + 1
    const categoryId = assignCategory(index, size.vod, vodCategories, random)
    const year = 1975 + Math.floor(random() * 50)
    let name = `${pick(random, TITLE_ADJECTIVES)} ${pick(random, TITLE_NOUNS)} (${year})`
    let container = pick(random, CONTAINERS)
    if (index === 0) {
      name = KNOWN.film
      container = 'mp4'
    } else if (index === 1) {
      name = KNOWN.dualAudioFilm
      container = 'mkv'
    }
    const rating = (random() * 9 + 1).toFixed(1)
    vod.push({
      num: index + 1,
      name,
      stream_type: 'movie',
      stream_id: quirk(index, 29, id, String(id)),
      stream_icon: index % 19 === 5 ? '' : art('poster', id),
      rating: quirk(index, 9, rating, Number(rating)),
      rating_5based: Number((Number(rating) / 2).toFixed(1)),
      added: addedTimestamp(random),
      is_adult: quirk(index, 4, '0', 0),
      category_id: quirk(index, 11, categoryId, Number(categoryId)),
      category_ids: [Number(categoryId)],
      container_extension: container,
      custom_sid: quirk(index, 7, '', null),
      direct_source: ''
    })
    vodCategoryOf.push(categoryId)
  }

  // --- Series ---
  const seriesCategories = buildCategories(categoryCount(size.series, 80, 8, 500), 2001, KNOWN.seriesCategory, (index) => {
    return `DİZİ | ${SERIES_GENRES[index % SERIES_GENRES.length]}`
  })
  const series: JsonObject[] = []
  const seriesCategoryOf: string[] = []
  for (let index = 0; index < size.series; index += 1) {
    const id = 500_000 + index + 1
    const categoryId = assignCategory(index, size.series, seriesCategories, random)
    const year = 1995 + Math.floor(random() * 30)
    const name = index === 0 ? KNOWN.series : `${pick(random, TITLE_NOUNS)} ${pick(random, TITLE_NOUNS)} (${year})`
    const rating = (random() * 9 + 1).toFixed(1)
    series.push({
      num: index + 1,
      name,
      series_id: quirk(index, 31, id, String(id)),
      cover: index % 21 === 4 ? '' : art('poster', id),
      plot: index % 5 === 0 ? '' : `${name} için kısa özet. Bir kasabada geçen ${pick(random, TITLE_NOUNS).toLowerCase()} hikâyesi.`,
      cast: 'Oyuncu Bir, Oyuncu İki, Üçüncü Oyuncu',
      director: 'Yönetmen Adı',
      genre: pick(random, SERIES_GENRES),
      release_date: quirk(index, 6, `${year}-0${1 + (index % 9)}-15`, ''),
      last_modified: addedTimestamp(random),
      rating: quirk(index, 9, rating, Number(rating)),
      rating_5based: Number((Number(rating) / 2).toFixed(1)),
      backdrop_path: index % 4 === 0 ? [] : [art('backdrop', id)],
      youtube_trailer: '',
      episode_run_time: quirk(index, 3, '45', 45),
      category_id: quirk(index, 11, categoryId, Number(categoryId)),
      category_ids: [Number(categoryId)]
    })
    seriesCategoryOf.push(categoryId)
  }

  return {
    size,
    liveCategories,
    vodCategories,
    seriesCategories,
    live,
    vod,
    series,
    liveCategoryOf,
    vodCategoryOf,
    seriesCategoryOf
  }
}

export function seriesInfo(catalog: Catalog, seriesId: number, baseUrl: string): JsonObject | null {
  const index = seriesId - 500_001
  const series = catalog.series[index]
  if (!series) return null
  const seasonCount = 1 + ((index + 2) % 3)
  const seasons: JsonObject[] = []
  const episodes: Record<string, JsonObject[]> = {}
  for (let season = 1; season <= seasonCount; season += 1) {
    seasons.push({
      season_number: season,
      name: `Sezon ${season}`,
      episode_count: 5,
      cover: `${baseUrl}/img/poster/${seriesId}.png`,
      air_date: '2021-01-01'
    })
    const list: JsonObject[] = []
    for (let episode = 1; episode <= 5; episode += 1) {
      // Episode ids are strings in the schema; unique per series/season/episode.
      const episodeId = String(seriesId * 100 + season * 10 + episode)
      list.push({
        id: episodeId,
        episode_num: quirk(episode, 4, episode, String(episode)),
        title: `${series.name} - S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`,
        container_extension: episode % 2 === 0 ? 'mkv' : 'mp4',
        info: {
          movie_image: `${baseUrl}/img/backdrop/${seriesId}.png`,
          plot: `Sezon ${season}, bölüm ${episode}.`,
          duration_secs: 600,
          duration: '00:10:00',
          rating: quirk(episode, 3, 7.5, '7.5'),
          name: `Bölüm ${episode}`,
          season
        },
        custom_sid: '',
        added: '1794700000',
        season,
        direct_source: ''
      })
    }
    episodes[String(season)] = list
  }
  return { seasons, info: series, episodes }
}

export function vodInfo(catalog: Catalog, vodId: number, baseUrl: string): JsonObject | null {
  const index = vodId - 100_001
  const vod = catalog.vod[index]
  if (!vod) return null
  const name = String(vod.name)
  const year = /\((\d{4})\)/.exec(name)?.[1] ?? '2020'
  return {
    info: {
      movie_image: `${baseUrl}/img/poster/${vodId}.png`,
      tmdb_id: '',
      plot: `${name}: sentetik test kataloğundan bir film.`,
      cast: 'Oyuncu Bir, Oyuncu İki',
      director: 'Yönetmen Adı',
      genre: 'Dram',
      release_date: `${year}-05-01`,
      duration: index === 1 ? '00:05:00' : '00:10:00',
      duration_secs: index === 1 ? 300 : 600,
      rating: vod.rating,
      name,
      year
    },
    movie_data: {
      stream_id: vodId,
      name,
      added: vod.added,
      category_id: vod.category_id,
      container_extension: vod.container_extension
    }
  }
}
