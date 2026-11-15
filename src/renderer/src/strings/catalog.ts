import { formatCount } from './common'
import { settingsPath } from './settings'

/** One wording per content type, used by the pages, the category list, the player list and the home rows. */
const types = {
  live: {
    section: 'Canlı TV',
    plural: 'Kanallar',
    all: 'Tüm Kanallar',
    noun: 'kanal',
    search: 'Kanal ara',
    searchPlaceholder: 'Kanal ara...',
    loading: 'Kanallar yükleniyor...',
    previewLoading: 'Kanallar hızlı ön izleme listesiyle açılıyor...',
    loadFailed: 'Kanallar yüklenemedi'
  },
  vod: {
    section: 'Filmler',
    plural: 'Filmler',
    all: 'Tüm Filmler',
    noun: 'film',
    search: 'Film ara',
    searchPlaceholder: 'Film ara...',
    loading: 'Filmler yükleniyor...',
    previewLoading: 'Filmler hızlı ön izleme listesiyle açılıyor...',
    loadFailed: 'Filmler yüklenemedi'
  },
  series: {
    section: 'Diziler',
    plural: 'Diziler',
    all: 'Tüm Diziler',
    noun: 'dizi',
    search: 'Dizi ara',
    searchPlaceholder: 'Dizi ara...',
    loading: 'Diziler yükleniyor...',
    previewLoading: 'Diziler hızlı ön izleme listesiyle açılıyor...',
    loadFailed: 'Diziler yüklenemedi'
  }
}

export const catalog = {
  types,

  page: {
    contentLoading: 'İçerikler yükleniyor...',
    clearSearch: 'Aramayı temizle',
    offlineDetail: 'Kaynağa şu an ulaşılamıyor; liste kayıtlı kopyadan gösteriliyor.',
    previewSyncing: (noun: string) => `Ön izleme listesi gösteriliyor, tam ${noun} listesi arka planda yükleniyor`,
    previewFirst: 'Bu sayfa önce hızlı bir ön izleme listesiyle açılıyor',
    previewIncomplete: 'Tam liste gelene kadar arama ve sonuç sayısı eksik olabilir.',
    syncFailed: (noun: string) => `Tam ${noun} listesi yüklenemedi`,
    partialShown: 'Şimdilik yalnızca yüklenen kısım gösteriliyor; arama ve sonuç sayısı eksik.',
    listEmpty: 'Liste şu an boş.',
    checkSourceSettings: ' Kaynak bilgilerini Ayarlar bölümünden kontrol edin.'
  },

  categories: {
    label: 'Kategoriler',
    hide: (name: string) => `${name} kategorisini gizle`,
    hideTitle: 'Bu kategoriyi gizle',
    loading: 'Kategoriler yükleniyor...',
    loadFailed: 'Kategoriler yüklenemedi',
    hiddenHint: (count: number) =>
      `${formatCount(count)} kategori gizli. ${settingsPath('catalog')} bölümünden geri getirebilirsiniz.`
  },

  cards: {
    liveBadgeLabel: 'Canlı yayın',
    liveFallbackGroup: 'Yayın',
    mediaFallbackGroup: 'Medya',
    filmFallbackGroup: 'Film',
    seriesFallbackGroup: 'Dizi',
    noChannels: 'Kanal bulunamadı',
    noChannelsHint: 'Farklı bir kategori seçmeyi veya kaynak eklemeyi deneyin',
    noContent: 'İçerik bulunamadı',
    contentGrid: 'İçerikler'
  },

  search: {
    label: 'Tüm içeriklerde ara',
    placeholder: 'Tüm kanal, film ve dizilerde ara...',
    results: 'Arama sonuçları',
    found: (query: string, total: number) => `"${query}" için ${formatCount(total)} sonuç bulundu`,
    capped: (shown: number) => ` (ilk ${formatCount(shown)} gösteriliyor)`,
    idleTitle: 'Tüm kaynaklarda arama yapın',
    idleHint: (minLength: number) => `Başlamak için en az ${minLength} karakter yazın`
  },

  favorites: {
    title: 'Favoriler',
    empty: 'Henüz favori yok',
    emptyHint: 'Kanal, film ve dizilerdeki yıldıza basarak favorilere ekleyin'
  },

  home: {
    welcome: (appName: string) => `${appName}'a Hoş Geldin`,
    betaNotice: (versionLabel: string) => `${versionLabel} sürümü test aşamasındadır.`,
    welcomeHint: 'İzlemeye başlamak için Xtream Codes sunucusuna bağlan veya bir M3U listesi içe aktar.',
    connectingSources: 'Kaynaklar bağlanıyor...',
    waitingForServer: 'Sunucu yanıtı bekleniyor',
    loadingPreview: 'Kategoriler ve ön izleme yükleniyor',
    tooSlowRetry: 'Çok uzun sürüyor, tekrar dene',
    connectFailed: 'Kaynağa bağlanılamadı',
    connectFailedFallback: 'Bağlantı kurulamadı.',
    autoRetry: 'Bağlantı otomatik olarak yeniden denenecek.',
    hubLabel: 'Yayın Merkezi',
    readyCount: (count: number) => `Canlı yayın, film ve dizilerde toplam ${formatCount(count)} içerik hazır.`,
    syncLoading: (done: number, total: number, typeLabel: string) => `${done}/${total} — ${typeLabel} yükleniyor`,
    syncDone: (done: number, total: number) => `${done}/${total} tamamlandı`,
    viewAll: 'Tümünü Gör',
    rowLoading: (title: string) => `${title} yükleniyor`,
    continueWatching: 'Devam Et',
    resume: (name: string) => `${name} — kaldığın yerden devam et`,
    removeFromList: (name: string) => `${name} içeriğini listeden kaldır`,
    removeFromListTitle: 'Listeden kaldır',
    remaining: (minutes: number) => {
      if (minutes < 1) return 'Az kaldı'
      if (minutes < 60) return `${minutes} dk kaldı`
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return rest === 0 ? `${hours} sa kaldı` : `${hours} sa ${rest} dk kaldı`
    }
  },

  detail: {
    playFilm: 'Filmi Oynat',
    director: (name: string) => `Yönetmen: ${name}`,
    cast: (names: string) => `Oyuncular: ${names}`,
    releaseDate: (date: string) => `Yayın Tarihi: ${date}`,
    rating: (value: string) => `Puan: ${value}`,
    minutes: (minutes: number) => `${minutes} dk`,
    seriesLabel: 'Dizi ayrıntısı',
    seriesLoadFailed: 'Dizi ayrıntıları yüklenemedi.',
    seriesNoCredentials: 'Bu kaynak için Xtream giriş bilgileri bulunamadı',
    seriesCredentialsPending: 'Giriş bilgileri hazırlanıyor, lütfen bekleyin...',
    season: (number: number) => `Sezon ${number}`,
    episode: (number: number, title: string) => `E${number}. ${title}`,
    /** The player's title for an episode. */
    episodeTitle: (series: string, season: number, episode: number, title: string) =>
      `${series} - S${season}E${episode} - ${title}`
  }
}
