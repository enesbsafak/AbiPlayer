// The demo catalog: a small, made-up provider for the README screenshots
// (`npm run shots`). Every channel, title, programme and plot here is
// invented; the posters and stills in e2e/demo-assets were made for it. Real
// panels' quirks are left out on purpose: this one only has to look right.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Catalog, CategoryRecord, JsonObject } from './catalog.ts'
import { REPO_ROOT } from '../support/paths.ts'
import { itemAt } from '../../src/shared/checked.ts'

export const DEMO_ASSETS_DIR = join(REPO_ROOT, 'e2e', 'demo-assets')

/** Names the screenshot script relies on. */
export const DEMO = {
  sourceName: 'Ev Sunucusu',
  liveCategory: 'Spor',
  playerChannel: 'Spor Arena HD',
  focusChannel: 'Belgesel 4K',
  film: 'Kayıp Şehir',
  filmId: 100_001,
  playerStill: 'sahne-stadyum.jpg'
} as const

interface DemoChannel {
  name: string
  category: string
  logo: { label: string; background: string; ink: string }
  /** Programmes in the order they repeat: title, minutes, one line about it. */
  programmes: Array<[string, number, string]>
}

const LIVE_CATEGORIES = ['Ulusal', 'Haber', 'Spor', 'Belgesel', 'Çocuk', 'Sinema', 'Müzik ve Yaşam']

const CHANNELS: DemoChannel[] = [
  {
    name: 'Ulusal 1 HD',
    category: 'Ulusal',
    logo: { label: 'U1', background: '#FF6B4A', ink: '#17131F' },
    programmes: [
      ['Sabah Keyfi', 90, 'Güne müzik, sohbet ve hava durumuyla başlayan canlı kuşak.'],
      ['Gündüz Kuşağı', 60, 'Konuklar, tarifler ve günün merak edilen konuları.'],
      ['Ana Haber', 60, 'Günün gelişmeleri, stüdyo bağlantıları ve hava durumu.'],
      ['Sessiz Liman', 90, 'Fener bekçisinin kızı, kasabaya dönen eski bir dostla karşılaşır.'],
      ['Bil Bakalım', 60, 'Dört yarışmacı, beş tur ve tek bir büyük ödül.'],
      ['Gece Sohbetleri', 60, 'Gecenin konuğuyla uzun ve samimi bir söyleşi.']
    ]
  },
  {
    name: 'Kanal 2',
    category: 'Ulusal',
    logo: { label: 'K2', background: '#7DB8FF', ink: '#17131F' },
    programmes: [
      ['Bahar Sofrası', 60, 'Aynı bahçeyi paylaşan iki komşunun bitmeyen yarışı.'],
      ['Mutfakta Bir Gün', 30, 'Mevsimin sebzeleriyle kolay ve hızlı tarifler.'],
      ['Akşam Bülteni', 30, 'Günün özeti, kısa ve net.'],
      ['Kış Uykusu', 90, 'Karla kapanan dağ evinde kalabalık bir aile.'],
      ['Hafta Sonu Sineması', 120, 'Bu hafta: Kırmızı Balon.']
    ]
  },
  {
    name: 'Şehir TV',
    category: 'Ulusal',
    logo: { label: 'ŞTV', background: '#2A2433', ink: '#FFC83D' },
    programmes: [
      ['Şehrin Sesi', 60, 'Mahallelerden haberler ve sokak röportajları.'],
      ['Trafik ve Hava', 30, 'Yollar, köprüler ve hafta sonu hava durumu.'],
      ['Semt Semt', 60, 'Bir semtin tarihi, esnafı ve lezzetleri.'],
      ['Yerel Gündem', 30, 'Belediye, ulaşım ve kültür etkinlikleri.']
    ]
  },
  {
    name: 'Haber 24',
    category: 'Haber',
    logo: { label: '24', background: '#FFC83D', ink: '#17131F' },
    programmes: [
      ['Gün Ortası', 60, 'Öğle saatlerinin canlı haber yayını.'],
      ['Ekonomi Masası', 30, 'Piyasalar, döviz ve haftanın verileri.'],
      ['Ana Haber', 60, 'Günün gelişmeleri, muhabirlerden son bilgiler.'],
      ['Dünya Gündemi', 30, 'Dünyadan öne çıkan başlıklar.'],
      ['Gece Bülteni', 30, 'Günün son haberleri.']
    ]
  },
  {
    name: 'Haber Merkez',
    category: 'Haber',
    logo: { label: 'HM', background: '#2A2433', ink: '#FF6B4A' },
    programmes: [
      ['Haber Merkezi', 60, 'Saat başı haberler ve canlı bağlantılar.'],
      ['Tartışma Masası', 90, 'Haftanın konuları, dört konuk ve bol soru.'],
      ['Spor Bülteni', 30, 'Sonuçlar, puan durumu ve transfer haberleri.']
    ]
  },
  {
    name: 'Spor Arena HD',
    category: 'Spor',
    logo: { label: 'SA', background: '#5BE0B3', ink: '#17131F' },
    programmes: [
      ['Maç Önü', 30, 'Kadrolar, istatistikler ve stattan ilk görüntüler.'],
      ['Canlı: Futbol Gecesi', 120, 'Ligin zirvesindeki iki takım karşı karşıya.'],
      ['Lig Özeti', 60, 'Haftanın bütün golleri ve kritik anları.'],
      ['Spor Gündemi', 30, 'Günün spor haberleri.']
    ]
  },
  {
    name: 'Spor Arena 2',
    category: 'Spor',
    logo: { label: 'SA2', background: '#5BE0B3', ink: '#17131F' },
    programmes: [
      ['Ralli Dünyası', 60, 'Toprak etaplardan en iyi dakikalar.'],
      ['Boks Gecesi', 90, 'Ağır siklette unvan maçı, tekrar yayın.'],
      ['Spor Klasikleri', 60, 'Unutulmayan maçlar yeniden ekranda.']
    ]
  },
  {
    name: 'Belgesel 4K',
    category: 'Belgesel',
    logo: { label: 'BLG', background: '#7DB8FF', ink: '#17131F' },
    programmes: [
      ['Mavi Derinlikler', 60, 'Mantaların peşinde, açık denizde bir yıl.'],
      ['Kuşların Göçü', 60, 'Binlerce kilometrelik yolculuğun durakları.'],
      ['Kayıp Uygarlıklar', 60, 'Ormanın yuttuğu şehirlerin izinde.'],
      ['Dağların Sessizliği', 60, 'Zirvede bir kış, kamera kayıtta.']
    ]
  },
  {
    name: 'Doğa TV',
    category: 'Belgesel',
    logo: { label: 'DT', background: '#2A2433', ink: '#5BE0B3' },
    programmes: [
      ['Vahşi Kıyılar', 60, 'Gelgitle değişen kıyıların sakinleri.'],
      ['Ormanın Kalbi', 60, 'Yağmur ormanında bir gün.'],
      ['Kutup Gecesi', 60, 'Güneşin hiç doğmadığı aylar.']
    ]
  },
  {
    name: 'Çocuk TV',
    category: 'Çocuk',
    logo: { label: 'ÇTV', background: '#FFC83D', ink: '#17131F' },
    programmes: [
      ['Minik Kaşifler', 30, 'Üç arkadaş, bir harita ve bitmeyen sorular.'],
      ['Robot Kardeşler', 30, 'Çayırda yaşayan iki küçük robotun maceraları.'],
      ['Masal Saati', 30, 'Her akşam yeni bir masal.'],
      ['Renkli Bahçe', 30, 'Şarkılar, oyunlar ve renkler.']
    ]
  },
  {
    name: 'Minik Ekran',
    category: 'Çocuk',
    logo: { label: 'ME', background: '#FF6B4A', ink: '#17131F' },
    programmes: [
      ['Oyun Vakti', 30, 'Evde oynanacak kolay oyunlar.'],
      ['Şarkılarla Sayılar', 30, 'Sayıları şarkılarla öğreniyoruz.'],
      ['Uykudan Önce', 30, 'Sakin bir masal ve ninni.']
    ]
  },
  {
    name: 'Sinema 1 HD',
    category: 'Sinema',
    logo: { label: 'S1', background: '#FF6B4A', ink: '#17131F' },
    programmes: [
      ['Altın Saat', 120, 'Kusursuz planlanmış bir soygun, tek bir eksik parça.'],
      ['Gece Yarısı Treni', 120, 'Viyadükte duran trende kaybolan bir yolcu.'],
      ['Son Viraj', 120, 'Emekliliğin eşiğindeki bir pilotun son yarışı.']
    ]
  },
  {
    name: 'Sinema Klasik',
    category: 'Sinema',
    logo: { label: 'SK', background: '#2A2433', ink: '#FF6B4A' },
    programmes: [
      ['Yolun Sonu', 120, 'Eski bir karavanla sahil boyunca bir veda yolculuğu.'],
      ['Uzak Kıyılar', 90, 'Şafakta denize açılan bir balıkçının hikâyesi.'],
      ['Çöl Yıldızı', 120, 'Samanyolu altında çölü geçen bir kervan.']
    ]
  },
  {
    name: 'Müzik Kutusu',
    category: 'Müzik ve Yaşam',
    logo: { label: 'MK', background: '#FFC83D', ink: '#17131F' },
    programmes: [
      ['Sabah Ritmi', 60, 'Güne enerjik şarkılarla başlayın.'],
      ['Listenin Zirvesi', 60, 'Haftanın en çok dinlenenleri.'],
      ['Akustik Akşam', 60, 'Stüdyoda canlı ve sade performanslar.'],
      ['Gece Seansı', 60, 'Gece yarısına doğru sakin parçalar.']
    ]
  },
  {
    name: 'Yaşam TV',
    category: 'Müzik ve Yaşam',
    logo: { label: 'YT', background: '#7DB8FF', ink: '#17131F' },
    programmes: [
      ['Evde Kahvaltı', 60, 'Hafta sonu sofraları için fikirler.'],
      ['Bahçe Saati', 30, 'Balkon ve bahçede mevsim hazırlığı.'],
      ['Yol Hikâyeleri', 60, 'Az bilinen kasabalara kısa yolculuklar.'],
      ['Sağlıklı Yaşam', 30, 'Uyku, hareket ve beslenme üzerine.']
    ]
  }
]

interface DemoTitle {
  slug: string
  name: string
  category: string
  year: number
  rating: string
  minutes: number
  plot: string
}

const VOD_CATEGORIES = ['Macera', 'Aksiyon', 'Bilim Kurgu', 'Dram', 'Gerilim', 'Aile', 'Belgesel']

/** Newest first: the order "Son eklenen filmler" shows them in. */
const FILMS: DemoTitle[] = [
  { slug: 'kayip-sehir', name: 'Kayıp Şehir', category: 'Macera', year: 2024, rating: '7.8', minutes: 118, plot: 'Genç bir haritacı, ormanın derinliklerinde yitip gitmiş bir şehrin izini sürerken yüzyıllardır saklanan bir sırla karşılaşır.' },
  { slug: 'altin-saat', name: 'Altın Saat', category: 'Aksiyon', year: 2025, rating: '7.4', minutes: 112, plot: 'Emekli bir kasa ustası, eski ekibini son bir iş için toplar: bir müzeden tek bir cep saati.' },
  { slug: 'neon-sokak', name: 'Neon Sokak', category: 'Bilim Kurgu', year: 2023, rating: '7.1', minutes: 104, plot: 'Hiç uyumayan bir şehirde, hafızasını satan insanların izini süren bir dedektif.' },
  { slug: 'kucuk-dev', name: 'Küçük Dev', category: 'Aile', year: 2024, rating: '8.2', minutes: 94, plot: 'Bir çayırda uyanan minik robot, eve dönmek için kendinden büyük bir yolculuğa çıkar.' },
  { slug: 'gece-treni', name: 'Gece Yarısı Treni', category: 'Gerilim', year: 2022, rating: '7.6', minutes: 109, plot: 'Viyadükte duran gece treninde bir yolcu kaybolur ve herkesin bir bahanesi vardır.' },
  { slug: 'sessiz-gezegen', name: 'Sessiz Gezegen', category: 'Bilim Kurgu', year: 2025, rating: '7.9', minutes: 126, plot: 'İki ayın aydınlattığı ıssız bir gezegende tek başına kalan bir astronot.' },
  { slug: 'son-viraj', name: 'Son Viraj', category: 'Aksiyon', year: 2023, rating: '6.9', minutes: 101, plot: 'Emekliliğin eşiğindeki bir ralli pilotu, kızıyla birlikte son yarışına hazırlanır.' },
  { slug: 'kirmizi-balon', name: 'Kırmızı Balon', category: 'Aile', year: 2021, rating: '7.7', minutes: 88, plot: 'Çatıların üzerinde süzülen kırmızı bir balon, bir mahalleyi yeniden bir araya getirir.' },
  { slug: 'col-yildizi', name: 'Çöl Yıldızı', category: 'Macera', year: 2022, rating: '7.3', minutes: 115, plot: 'Samanyolu altında çölü geçen bir deveci, yolunu yıldızlarla bulmayı öğrenir.' },
  { slug: 'demir-yumruk', name: 'Demir Yumruk', category: 'Dram', year: 2021, rating: '7.0', minutes: 121, plot: 'Ringe geri dönmeye karar veren bir boksörün kendi geçmişiyle hesaplaşması.' },
  { slug: 'yolun-sonu', name: 'Yolun Sonu', category: 'Dram', year: 2020, rating: '7.5', minutes: 99, plot: 'İki kardeş, babalarının eski karavanıyla sahil boyunca bir veda yolculuğuna çıkar.' },
  { slug: 'derin-mavi', name: 'Derin Mavi', category: 'Belgesel', year: 2024, rating: '8.4', minutes: 86, plot: 'Bir dalgıç ve bir manta: açık denizde geçen bir yılın sessiz dostluğu.' }
]

const SERIES_CATEGORIES = ['Dram', 'Gizem', 'Komedi']

/** Most recently updated first. */
const SERIES: DemoTitle[] = [
  { slug: 'sessiz-liman', name: 'Sessiz Liman', category: 'Dram', year: 2024, rating: '8.1', minutes: 50, plot: 'Fener bekçisinin kızı, yıllar sonra döndüğü liman kasabasında ailesinin unutulmuş bir sırrını açığa çıkarır.' },
  { slug: 'sis-vadisi', name: 'Sis Vadisi', category: 'Gizem', year: 2025, rating: '7.9', minutes: 45, plot: 'Sisin hiç kalkmadığı bir vadide, fenerle ormana giren herkes başka bir yıla çıkar.' },
  { slug: 'bahar-sofrasi', name: 'Bahar Sofrası', category: 'Komedi', year: 2023, rating: '7.2', minutes: 40, plot: 'Aynı bahçeyi paylaşan iki komşu, her bahar daha büyük bir sofra kurmak için yarışır.' },
  { slug: 'kuzey-isigi', name: 'Kuzey Işığı', category: 'Dram', year: 2022, rating: '8.0', minutes: 55, plot: 'Kutup ışıklarının altındaki bir kulübede kışı geçiren üç yabancının hikâyesi.' },
  { slug: 'kis-uykusu', name: 'Kış Uykusu', category: 'Komedi', year: 2024, rating: '7.4', minutes: 35, plot: 'Karla kapanan dağ evinde mahsur kalan kalabalık bir ailenin bitmeyen kışı.' },
  { slug: 'uzak-kiyilar', name: 'Uzak Kıyılar', category: 'Dram', year: 2021, rating: '7.6', minutes: 50, plot: 'Şafakta denize açılan bir balıkçı teknesi ve kıyıda bekleyenler.' }
]

const EPISODE_TITLES = ['Dönüş', 'Eski Bir Dost', 'Mektup', 'Fırtına Gecesi', 'Sır', 'Yeni Bir Sabah']

function categories(names: readonly string[], firstId: number): CategoryRecord[] {
  return names.map((name, index) => ({ category_id: String(firstId + index), category_name: name, parent_id: 0 }))
}

function categoryIdOf(list: readonly CategoryRecord[], name: string): string {
  const found = list.find((category) => category.category_name === name)
  if (!found) throw new Error(`no demo category ${name}`)
  return String(found.category_id)
}

const ADDED_BASE = 1_794_700_000
const hours = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`

export function generateDemoCatalog(baseUrl: string): Catalog {
  for (const title of [...FILMS, ...SERIES]) {
    if (!readdirSync(DEMO_ASSETS_DIR).includes(`afis-${title.slug}.jpg`)) throw new Error(`missing poster afis-${title.slug}.jpg`)
  }
  const poster = (slug: string) => `${baseUrl}/img/demo/afis-${slug}.jpg`
  const liveCategories = categories(LIVE_CATEGORIES, 1)
  const vodCategories = categories(VOD_CATEGORIES, 1001)
  const seriesCategories = categories(SERIES_CATEGORIES, 2001)

  const live: JsonObject[] = CHANNELS.map((channel, index) => ({
    num: index + 1,
    name: channel.name,
    stream_type: 'live',
    stream_id: index + 1,
    stream_icon: `${baseUrl}/img/demo-logo/${index + 1}.svg`,
    epg_channel_id: `demo${index + 1}.tv`,
    added: String(ADDED_BASE - index * 3600),
    is_adult: '0',
    category_id: categoryIdOf(liveCategories, channel.category),
    category_ids: [Number(categoryIdOf(liveCategories, channel.category))],
    custom_sid: '',
    tv_archive: 0,
    direct_source: '',
    tv_archive_duration: 0
  }))

  const vod: JsonObject[] = FILMS.map((film, index) => ({
    num: index + 1,
    name: film.name,
    stream_type: 'movie',
    stream_id: 100_001 + index,
    stream_icon: poster(film.slug),
    rating: film.rating,
    rating_5based: Number((Number(film.rating) / 2).toFixed(1)),
    added: String(ADDED_BASE - index * 86_400),
    is_adult: '0',
    category_id: categoryIdOf(vodCategories, film.category),
    category_ids: [Number(categoryIdOf(vodCategories, film.category))],
    container_extension: 'mp4',
    custom_sid: '',
    direct_source: '',
    // Not in a real list record; get_vod_info answers with them.
    plot: film.plot,
    genre: film.category,
    year: String(film.year),
    duration: hours(film.minutes)
  }))

  const series: JsonObject[] = SERIES.map((show, index) => ({
    num: index + 1,
    name: show.name,
    series_id: 500_001 + index,
    cover: poster(show.slug),
    plot: show.plot,
    cast: '',
    director: '',
    genre: show.category,
    release_date: `${show.year}-09-1${index}`,
    last_modified: String(ADDED_BASE - index * 86_400),
    rating: show.rating,
    rating_5based: Number((Number(show.rating) / 2).toFixed(1)),
    backdrop_path: [],
    youtube_trailer: '',
    episode_run_time: String(show.minutes),
    category_id: categoryIdOf(seriesCategories, show.category),
    category_ids: [Number(categoryIdOf(seriesCategories, show.category))]
  }))

  return {
    size: { live: live.length, vod: vod.length, series: series.length },
    demo: true,
    liveCategories,
    vodCategories,
    seriesCategories,
    live,
    vod,
    series,
    liveCategoryOf: CHANNELS.map((channel) => categoryIdOf(liveCategories, channel.category)),
    vodCategoryOf: FILMS.map((film) => categoryIdOf(vodCategories, film.category)),
    seriesCategoryOf: SERIES.map((show) => categoryIdOf(seriesCategories, show.category))
  }
}

/** get_series_info for a demo series: two seasons of six episodes. */
export function demoSeriesInfo(catalog: Catalog, seriesId: number): JsonObject | null {
  const index = seriesId - 500_001
  const series = catalog.series[index]
  const show = SERIES[index]
  if (!series || !show) return null
  const seasons: JsonObject[] = []
  const episodes: Record<string, JsonObject[]> = {}
  for (let season = 1; season <= 2; season += 1) {
    seasons.push({ season_number: season, name: `Sezon ${season}`, episode_count: 6, cover: series.cover ?? '', air_date: `${show.year - 2 + season}-09-10` })
    episodes[String(season)] = EPISODE_TITLES.map((title, episode) => ({
      id: String(seriesId * 100 + season * 10 + episode + 1),
      episode_num: episode + 1,
      title,
      container_extension: 'mp4',
      info: {
        movie_image: series.cover ?? '',
        plot: '',
        duration_secs: show.minutes * 60,
        duration: hours(show.minutes),
        rating: show.rating,
        name: title,
        season
      },
      custom_sid: '',
      added: String(ADDED_BASE),
      season,
      direct_source: ''
    }))
  }
  return { seasons, info: series, episodes }
}

/** get_vod_info for a demo film. */
export function demoVodInfo(catalog: Catalog, vodId: number): JsonObject | null {
  const vod = catalog.vod[vodId - 100_001]
  if (!vod) return null
  return {
    info: {
      movie_image: vod.stream_icon ?? '',
      tmdb_id: '',
      plot: vod.plot ?? '',
      cast: '',
      director: '',
      genre: vod.genre ?? '',
      release_date: '',
      duration: vod.duration ?? '',
      duration_secs: 0,
      rating: vod.rating ?? null,
      name: vod.name ?? '',
      year: vod.year ?? ''
    },
    movie_data: {
      stream_id: vodId,
      name: vod.name ?? '',
      added: vod.added ?? null,
      category_id: vod.category_id ?? null,
      container_extension: 'mp4'
    }
  }
}

/** A channel's logo: its short name on its colour, as a rounded square. */
export function demoLogoSvg(channelNumber: number): string | null {
  const channel = CHANNELS[channelNumber - 1]
  if (!channel) return null
  const { label, background, ink } = channel.logo
  const size = label.length >= 3 ? 92 : 118
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">' +
    `<rect width="256" height="256" rx="64" fill="${background}"/>` +
    `<text x="128" y="${128 + size * 0.35}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="${size}" letter-spacing="-4" fill="${ink}">${label}</text>` +
    '</svg>'
  )
}

export interface DemoProgramme {
  channel: string
  start: number
  stop: number
  title: string
  desc: string
}

/**
 * Programmes from four hours ago to ten hours ahead, on the half hour, each
 * channel starting at a different point of its own list so the rows differ.
 */
export function demoGuide(now: number): DemoProgramme[] {
  const halfHour = 30 * 60_000
  const from = Math.floor(now / halfHour) * halfHour - 4 * 3600_000
  const until = now + 10 * 3600_000
  const programmes: DemoProgramme[] = []
  CHANNELS.forEach((channel, index) => {
    let start = from - (index % 3) * halfHour
    let slot = index
    while (start < until) {
      const [title, minutes, desc] = itemAt(channel.programmes, slot % channel.programmes.length)
      const stop = start + minutes * 60_000
      programmes.push({ channel: `demo${index + 1}.tv`, start, stop, title, desc })
      start = stop
      slot += 1
    }
  })
  return programmes
}
