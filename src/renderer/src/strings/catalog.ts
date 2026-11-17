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
    offlineBanner: (when: string) => `Çevrimdışı kopya, ${when} tarihinde güncellendi`,
    categoryListFailed: 'Kategori listesi alınamadı.',
    categoryLoading: 'Seçili kategori yükleniyor...',
    contentSyncFailed: 'İçerik senkronizasyonu başarısız oldu.',
    checkSourceSettings: ' Kaynak bilgilerini Ayarlar bölümünden kontrol et.'
  },

  /** An add-on as the active source: its catalogues load page by page; it has no live TV. */
  addon: {
    pageLoading: 'Katalog yükleniyor...',
    loadingMore: 'Daha fazlası yükleniyor…',
    loadMore: 'Daha fazlasını yükle',
    pageFailed: 'Sonraki sayfa yüklenemedi',
    end: 'Katalogun sonuna geldin',
    /** Under the result count: the box searches what has been loaded, not the add-on. */
    searchLoadedOnly: (count: number) =>
      `Arama yalnızca bu katalogdan şimdiye kadar yüklenen ${formatCount(count)} öğede yapılır.`,
    noCatalogs: (noun: string) => `Bu eklentide ${noun} kataloğu yok`,
    noCatalogsHint: (otherSection: string) => `Eklentinin sunduklarına ${otherSection} bölümünden göz atabilirsin.`,
    noLive: 'Bu kaynakta canlı TV yok',
    noLiveHint:
      'Eklentiler film ve dizi sunar. Canlı kanallar ve yayın akışı için Xtream ya da M3U kaynaklarından birine geç.',
    openFilms: 'Filmlere göz at',
    /** Season 0 of an add-on series. */
    specials: 'Özel bölümler',
    specialEpisodeLabel: (episode: number) => `Özel bölüm ${episode}`,
    episodesUnavailable: 'Bu eklenti dizinin bölüm listesini vermiyor; bölümler gösterilemiyor.',
    episodesFailed: 'Bölüm listesi alınamadı.',
    /** In place of the result count while the box asks the source (the TMDB catalogue, an add-on that searches). */
    searching: 'Aranıyor…'
  },

  /** The built-in TMDB catalogue's pages and details. */
  tmdb: {
    /** "İzle" on a title TMDB has no IMDb id for. */
    noStreamId:
      "TMDB'de bu başlığın IMDb kimliği yok. Yayın eklentileri başlıkları IMDb kimliğiyle sorduğundan bu başlık için yayın aranamıyor.",
    seasonLoading: 'Bölümler yükleniyor…',
    seasonFailed: 'Bu sezonun bölümleri alınamadı.',
    airDate: (date: string) => `Yayın: ${date}`,
    idleHint: "Yarım kalan bir şey yok. TMDB Kataloğu'na göz at.",
    noLiveHint:
      'TMDB Kataloğu film ve dizi sunar. Canlı kanallar ve yayın akışı için Xtream ya da M3U kaynaklarından birine geç.',
  },

  /** Canlı TV: the channel rows and the panel of the channel in focus. */
  live: {
    panelLabel: 'Seçili kanal',
    watch: 'Bu kanalı izle',
    next: 'Sırada',
    range: (start: string, end: string) => `${start} – ${end}`,
    programmeShare: (percent: number) => `Programın yüzde ${percent} kadarı geçti`,
    /** No guide in memory for the source (it is loaded on the Yayın Akışı screen). */
    noGuide: 'Program bilgisi yok. Yayın akışı yüklendiğinde burada görünür.',
    hint: 'Ok tuşlarıyla kanallar arasında gez, Enter ile izle.'
  },

  categories: {
    label: 'Kategoriler',
    /** A category pill's item count, read after its name. */
    count: (count: number) => `${formatCount(count)} öğe`,
    hide: (name: string) => `${name} kategorisini gizle`,
    hideTitle: 'Bu kategoriyi gizle',
    loading: 'Kategoriler yükleniyor...',
    loadFailed: 'Kategoriler yüklenemedi',
    hiddenHint: (count: number) =>
      `${formatCount(count)} kategori gizli. ${settingsPath('catalog')} bölümünden geri getirebilirsin.`
  },

  cards: {
    liveBadgeLabel: 'Canlı yayın',
    liveFallbackGroup: 'Yayın',
    mediaFallbackGroup: 'Medya',
    filmFallbackGroup: 'Film',
    seriesFallbackGroup: 'Dizi',
    noChannels: 'Kanal bulunamadı',
    noChannelsHint: 'Farklı bir kategori seçmeyi ya da kaynak eklemeyi dene',
    noContent: 'İçerik bulunamadı',
    contentGrid: 'İçerikler'
  },

  search: {
    label: 'Tüm içeriklerde ara',
    placeholder: 'Tüm kanal, film ve dizilerde ara...',
    results: 'Arama sonuçları',
    found: (query: string, total: number) => `"${query}" için ${formatCount(total)} sonuç bulundu`,
    capped: (shown: number) => ` (ilk ${formatCount(shown)} gösteriliyor)`,
    idleTitle: 'Tüm kaynaklarda ara',
    idleHint: (minLength: number) => `Başlamak için en az ${minLength} karakter yaz`
  },

  favorites: {
    title: 'Favoriler',
    empty: 'Henüz favori yok',
    emptyHint: 'Kanal, film ve dizilerdeki yıldıza basarak favorilere ekle',
    browseLive: 'Kanallara göz at'
  },

  /** Headings of the grouped lists on Favoriler and Arama, with their counts. */
  groups: {
    live: 'Kanallar',
    vod: 'Filmler',
    series: 'Diziler',
    count: (count: number) => formatCount(count)
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
    stages: {
      idle: 'İçerikler taranıyor...',
      categories: 'Kategoriler yükleniyor...',
      preview: 'Ön izleme yükleniyor...',
      catalog: 'Tam katalog arka planda yükleniyor...'
    },
    offlineCopy: (when: string) =>
      `Kaynağa bağlanılamadı: çevrimdışı kopya gösteriliyor (${when} tarihinde güncellendi). Bağlantı otomatik olarak yeniden denenecek.`,
    typeLoadFailed: 'İçerikler yüklenemedi.',
    loadFailed: 'Ana sayfa içerikleri yüklenemedi.',
    /** `labels`: the types that failed, comma-separated. */
    partialFailure: (labels: string, reasons: string) => `${labels} yüklenemedi. ${reasons}`,
    autoRetry: 'Bağlantı otomatik olarak yeniden denenecek.',
    /** The home screen's visually hidden page title. */
    pageTitle: 'Ana Sayfa',
    syncLoading: (done: number, total: number, typeLabel: string) => `${done}/${total} — ${typeLabel} yükleniyor`,
    rowLoading: (title: string) => `${title} yükleniyor`,

    /** The large tile: the most recent unfinished film or episode. */
    continueWatching: 'Kaldığın yerden',
    resumeAction: 'Devam et',
    resume: (name: string) => `${name} — kaldığın yerden devam et`,
    restartAction: 'Baştan başlat',
    restart: (name: string) => `${name} — baştan başlat`,
    removeFromList: (name: string) => `${name} içeriğini listeden kaldır`,
    removeFromListTitle: 'Listeden kaldır',
    watchedShare: (percent: number) => `Yüzde ${percent} kadarı izlendi`,
    kindFilm: 'Film',
    kindEpisode: 'Dizi',
    duration: (minutes: number) => {
      if (minutes < 60) return `${minutes} dk`
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return rest === 0 ? `${hours} sa` : `${hours} sa ${rest} dk`
    },
    remaining: (minutes: number) => {
      if (minutes < 1) return 'Az kaldı'
      if (minutes < 60) return `${minutes} dk kaldı`
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return rest === 0 ? `${hours} sa kaldı` : `${hours} sa ${rest} dk kaldı`
    },

    /** The large tile when nothing is unfinished: the newest film. */
    newestBadge: 'Yeni eklenen',
    firstInListBadge: 'Listeden bir film',
    playAction: 'İzle',
    browseFilms: 'Filmlere göz at',
    /** …and when there is no film either. */
    idleBadge: 'Hazır',
    idleTitle: 'İzlemeye hazır',
    idleHint: 'Yarım kalan bir şey yok. Bir kanal aç ya da yayın akışına bak.',
    openLive: 'Canlı TV’yi aç',

    /** One line of what each destination tile holds. */
    tiles: {
      liveNow: (title: string, channel: string) => `Şimdi: ${title} · ${channel}`,
      liveCount: (count: number) => `${formatCount(count)} kanal`,
      guideNext: (time: string, title: string, channel: string) => `${time} ${title} · ${channel}`,
      /** Turkish counts take the singular noun: "1.204 kanalın", never a plural. */
      guideCount: (count: number) => `${formatCount(count)} kanalın yayın akışı var`,
      guideIdle: 'Şimdi ve sıradaki yayınlar',
      vodNewest: (name: string) => `Yeni: ${name}`,
      vodCount: (count: number) => `${formatCount(count)} film`,
      seriesNewest: (name: string) => `Son güncellenen: ${name}`,
      seriesCount: (count: number) => `${formatCount(count)} dizi`,
      loading: 'Yükleniyor…',
      noSource: 'Önce bir kaynak ekle',
      waiting: 'Kaynak bekleniyor',
      empty: (noun: string) => `Bu kaynakta ${noun} yok`,
      /** An add-on source: how many catalogues of the type it has (their sizes are unknown). */
      catalogCount: (count: number) => `${formatCount(count)} katalog`,
      noLive: 'Bu kaynakta canlı TV yok',
      noGuide: 'Bu kaynakta yayın akışı yok'
    },

    /** An add-on source's rows: the first page of its first catalogue of each type. */
    addonRow: (section: string, catalogName: string) => `${section}: ${catalogName}`,
    /** The large tile of an add-on source with nothing unfinished and no film to suggest. */
    addonIdleTitle: 'Göz atmaya hazır',
    addonIdleHint: 'Yarım kalan bir şey yok. Eklentinin kataloglarına göz at.',
    browseSeries: 'Dizilere göz at',

    /** The rows under the tiles, shown as the window's height allows. */
    viewAll: 'Tümünü gör',
    newestFilms: 'Son eklenen filmler',
    /** The same row for a list that carries no dates (M3U): its first films, not its newest. */
    listFilms: 'Listedeki filmler',
    newestSeries: 'Son güncellenen diziler',
    listSeries: 'Listedeki diziler',
    favoritesRow: 'Favorilerin',
    continueRow: 'İzlemeye devam et',
    channelsRow: 'Canlı kanallar',

    /** The channel panel a wide window adds beside the tiles. */
    channels: {
      title: 'Kanallar',
      favoriteHint: 'Bir kanalın yıldızına basınca burada en üstte görünür.',
      openLive: 'Canlı TV’yi aç',
      now: (title: string) => `Şimdi: ${title}`
    },

    /** The active source, bottom right. */
    source: {
      connected: (name: string) => `${name} bağlı`,
      ready: (name: string) => `${name} hazır`,
      connecting: (name: string) => `${name} bağlanıyor`,
      failed: (name: string) => `${name}: bağlantı yok`,
      offline: (name: string) => `${name}: çevrimdışı kopya`
    },

    /** Keyboard hints, bottom right. */
    keys: {
      label: 'Klavye kısayolları',
      arrows: 'Ok tuşları',
      arrowsAction: 'gez',
      enter: 'Enter',
      enterAction: 'aç',
      searchAction: 'ara'
    }
  },

  detail: {
    playFilm: 'İzle',
    resume: 'Devam et',
    watched: (percent: number) => `Yüzde ${percent} kadarı izlendi`,
    seasons: 'Sezonlar',
    episodes: 'Bölümler',
    /** The series' primary action: the episode it starts. */
    playEpisodeLabel: (season: number, episode: number) => `${season}. sezon ${episode}. bölüm`,
    director: (name: string) => `Yönetmen: ${name}`,
    cast: (names: string) => `Oyuncular: ${names}`,
    releaseDate: (date: string) => `Yayın Tarihi: ${date}`,
    rating: (value: string) => `Puan: ${value}`,
    minutes: (minutes: number) => `${minutes} dk`,
    seriesLabel: 'Dizi ayrıntısı',
    /** The row of other titles from the same category, under a detail. */
    moreInCategory: 'Aynı kategoriden',
    seriesLoadFailed: 'Dizi ayrıntıları yüklenemedi.',
    seriesNoCredentials: 'Bu kaynak için Xtream giriş bilgileri bulunamadı',
    seriesCredentialsPending: 'Giriş bilgileri hazırlanıyor, biraz bekle…',
    season: (number: number) => `Sezon ${number}`,
    episode: (number: number, title: string) => `E${number}. ${title}`,
    /** The player's title for an episode. */
    episodeTitle: (series: string, season: number, episode: number, title: string) =>
      `${series} - S${season}E${episode} - ${title}`
  }
}
