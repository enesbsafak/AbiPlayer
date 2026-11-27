import { formatCount } from './common'

/** Turkish locative suffix of a word by its last vowel and consonant ("21:30'da", "20:15'te"). */
const UNIT_SUFFIX = ['da', 'de', 'de', 'te', 'te', 'te', 'da', 'de', 'de', 'da'] as const
const TENS_SUFFIX: Record<number, string> = { 0: 'da', 10: 'da', 20: 'de', 30: 'da', 40: 'ta', 50: 'de' }

/**
 * The suffix a clock time takes when read aloud: "21:30" is read "yirmi bir
 * otuz" and takes "da"; a full hour is read by its hour ("21:00", "yirmi bir",
 * takes "de"; "00:00", "sıfır", takes "da").
 */
export function clockLocativeSuffix(hour: number, minute: number): string {
  const spoken = minute === 0 ? hour : minute
  const unit = spoken % 10
  return (unit ? UNIT_SUFFIX[unit] : TENS_SUFFIX[spoken]) ?? 'da'
}

/** "45 dk", "1 sa", "2 sa 5 dk". */
function duration(minutes: number): string {
  const whole = Math.max(1, Math.round(minutes))
  const hours = Math.floor(whole / 60)
  const rest = whole % 60
  if (!hours) return `${rest} dk`
  return rest ? `${hours} sa ${rest} dk` : `${hours} sa`
}

export const epg = {
  title: 'Yayın Akışı',
  categoryLabel: 'Kategori',
  allChannels: 'Tüm kanallar',
  searchLabel: 'Yayın akışındaki kanallarda ara',
  searchPlaceholder: 'Kanal ara',
  clearSearch: 'Aramayı temizle',
  channelCount: (count: number) => `${formatCount(count)} kanal`,
  loading: 'Yayın akışı yükleniyor…',
  loadingHint: 'Büyük bir akışın ilk yüklenişi biraz sürebilir.',
  loadFailedTitle: 'Yayın akışı alınamadı',
  noSearchMatch: 'Aramayla eşleşen kanal yok',
  noSearchMatchHint: 'Başka bir kanal adı dene ya da aramayı temizle.',
  noGuideInCategory: 'Bu kategoride yayın akışı olan kanal yok',
  noGuideInCategoryHint: 'Tüm kanallara dön ya da başka bir kategori seç.',
  noSource: 'Yayın akışı için önce bir kaynak ekle',
  noSourceHint: 'Akış, eklediğin kaynağın kanallarıyla birlikte gelir.',
  listLabel: 'Kanal yayın akışı',

  // The timeline.
  timelineLabel: 'Zaman çizelgesi',
  today: 'Bugün',
  tomorrow: 'Yarın',
  yesterday: 'Dün',
  nowMarker: 'Şu an',
  jumpToNow: 'Şimdi',
  jumpToNowHint: 'Şu an yayında olan programlara dön',
  noGuideData: 'Akış bilgisi yok',
  favorite: 'Favori',
  favoriteChannel: 'Favori kanal',
  /** A programme block's accessible name. */
  programLabel: (channel: string, title: string, time: string, live: boolean) =>
    `${channel}, ${title}, ${time}${live ? ', şimdi yayında' : ''}`,
  timeRange: (start: string, end: string) => `${start}–${end}`,

  // The focused programme's strip.
  onNow: 'Şimdi yayında',
  upNext: 'Sırada',
  ended: 'Bitti',
  watch: 'İzle',
  openChannel: 'Kanalı aç',
  /** A programme that has been on, from the panel's archive. */
  watchRecording: 'Kaydı izle',
  /** A programme still on, from its start. */
  watchFromStart: 'Baştan izle',
  /** The player's title for a programme from the archive: "Ana Haber · TRT 1". */
  archiveTitle: (program: string, channel: string) => `${program} · ${channel}`,
  progress: (title: string) => `${title} ilerlemesi`,
  timeLeft: (minutes: number) => `${duration(minutes)} kaldı`,
  startsIn: (minutes: number) => `${duration(minutes)} sonra`,
  /** "21:30'da başlıyor"; a 12-hour time ("9:30 ÖS") is not read with a suffix. */
  startsAt: (time: string, suffix: string | null) => (suffix ? `${time}'${suffix} başlıyor` : `Başlangıç ${time}`),

  // The key hints under the guide.
  keysLabel: 'Klavye kısayolları',
  keyArrows: 'Ok tuşları',
  keyArrowsAction: 'gez',
  keyEnter: 'Enter',
  keyEnterAction: 'izle',
  keyFavorite: 'F',
  keyFavoriteAction: 'favori yap',

  // Notices about the guide data.
  updateFailed: (error: string, when: string | null) =>
    `Yayın akışı güncellenemedi: ${error}${when ? ` ${when} tarihli kopya gösteriliyor.` : ''}`,
  truncatedLimit: 'Yayın akışı çok büyük: kanal ya da program sınırına ulaşıldı, bazı kanalların programları eksik.',
  truncatedCut: 'Yayın akışının tamamı yüklenemedi: indirme yarıda kesildi, bazı kanalların programları eksik.',
  addressFailed: 'Yayın akışı adresi oluşturulamadı.',
  noPlaylistGuide: 'Bu oynatma listesi bir yayın akışı adresi (url-tvg) içermiyor.',
  loadFailed: 'Yayın akışı alınamadı.',
  cachedCopy: (when: string, loading: boolean) =>
    `${when} tarihli kayıtlı yayın akışı gösteriliyor${loading ? ', güncelleniyor…' : '.'}`
}
