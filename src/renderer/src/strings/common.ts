/** Locale for numbers and dates shown next to the interface text. */
export const LOCALE = 'tr-TR'

export function formatCount(count: number): string {
  return count.toLocaleString(LOCALE)
}

/** A moment as a short date and time ("15.11.2026 17:30"). */
export function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' })
}

/** Words and actions shared by many screens; one wording each. */
export const common = {
  locale: LOCALE,
  retry: 'Tekrar Dene',
  cancel: 'Vazgeç',
  close: 'Kapat',
  back: 'Geri',
  goBack: 'Geri Dön',
  refresh: 'Yenile',
  delete: 'Sil',
  reset: 'Sıfırla',
  saving: 'Kaydediliyor…',
  dismissNotice: 'Bildirimi kapat',
  search: 'Ara',
  addSource: 'Kaynak Ekle',
  sourceSettings: 'Kaynak Ayarları',
  live: 'Canlı',
  unknown: 'Bilinmiyor',
  selectPlaceholder: 'Seç…',
  /** Accessible name of a dialog without a title. */
  dialog: 'Pencere',
  technicalDetail: 'Teknik ayrıntı',
  resultCount: (count: number) => `${formatCount(count)} sonuç`,
  /** One item's play button: "<name> oynat". */
  playItem: (name: string) => `${name} oynat`,
  addToFavorites: 'Favorilere ekle',
  removeFromFavorites: 'Favorilerden çıkar',
  addToFavoritesButton: 'Favorilere Ekle',
  removeFromFavoritesButton: 'Favorilerden Çıkar',
  /** "Favorilere ekle: <name>" — a grid of stars is not a list of identical names. */
  favoriteActionFor: (action: string, name: string) => `${action}: ${name}`,
  qualityTitle: (label: string) => `Kalite: ${label}`
}
