import { formatCount } from './common'

export const epg = {
  title: 'Yayın Akışı',
  categories: 'Kategoriler',
  allChannels: 'Tüm Kanallar',
  searchLabel: 'Yayın akışındaki kanallarda ara',
  searchPlaceholder: 'Kanal ara...',
  clearSearch: 'Aramayı temizle',
  channelCount: (count: number) => `${formatCount(count)} kanal`,
  now: 'Şimdi',
  progress: (title: string) => `${title} ilerlemesi`,
  noProgram: 'Program bilgisi yok',
  noUpcoming: 'Sonraki program yok',
  loading: 'Yayın akışı yükleniyor…',
  retryHint: 'Yenile düğmesiyle tekrar deneyebilirsiniz',
  noSearchMatch: 'Aramayla eşleşen kanal bulunamadı',
  noGuideInCategory: 'Bu kategoride yayın akışı olan kanal yok',
  listLabel: 'Kanal yayın akışı',
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
