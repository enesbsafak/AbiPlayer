import { formatCount } from './common'
import { settings, settingsPath } from './settings'

/** Adding, listing and signing in to sources. */
export const sources = {
  typeLabels: {
    xtream: 'Xtream Codes',
    m3u_url: 'M3U Adresi',
    m3u_file: 'M3U Dosyası',
    addon: 'Eklenti'
  },

  fields: {
    displayName: 'Görünen ad (isteğe bağlı)',
    serverUrl: 'Sunucu adresi',
    playlistUrl: 'Liste adresi',
    username: 'Kullanıcı adı',
    password: 'Şifre',
    addonUrl: 'Eklenti adresi'
  },

  /** One line under each field: what it is and where to find it. */
  fieldHelp: {
    serverUrl: 'Sağlayıcının gönderdiği adres, çoğunlukla sonunda bir port numarasıyla (ör. :8080).',
    username: 'Sağlayıcının hesabın için verdiği kullanıcı adı.',
    password: 'Sağlayıcının mesajında kullanıcı adının yanında yazan şifre.',
    xtreamName: 'Kaynak listesinde bu adla görünür; boş bırakırsan kullanıcı adı ve sunucudan bir ad konur.',
    playlistUrl: 'Sağlayıcının verdiği, çoğunlukla .m3u, .m3u8 ya da get.php içeren bağlantı.',
    playlistName: 'Kaynak listesinde bu adla görünür; boş bırakırsan adresten ya da dosya adından bir ad konur.',
    file: 'Bilgisayarındaki .m3u, .m3u8 ya da .txt uzantılı liste dosyası.',
    addonUrl:
      'Eklentinin kendi sayfasındaki yükleme ya da bağlantıyı kopyalama düğmesinden alınır; o sayfada yaptığın ayarlar adresin bir parçasıdır.'
  },

  validation: {
    emptyCredentials: 'Kullanıcı adı ve şifre boş bırakılamaz',
    emptyServerUrl: 'Sunucu adresi boş bırakılamaz',
    emptyPlaylistUrl: 'Liste adresi boş bırakılamaz',
    emptyUsername: 'Kullanıcı adını gir.',
    emptyPassword: 'Şifreyi gir.',
    invalidServerUrl: 'Geçersiz sunucu adresi',
    invalidPlaylistUrl: 'Geçersiz liste adresi',
    httpOnly: 'Yalnızca HTTP/HTTPS adresleri destekleniyor',
    httpOnlyServer: 'Yalnızca HTTP/HTTPS sunucu adresleri destekleniyor',
    httpOnlyPlaylist: 'Yalnızca HTTP/HTTPS oynatma listesi adresleri destekleniyor',
    duplicateXtream: (name: string) => `Bu sunucu ve kullanıcı adı zaten "${name}" olarak ekli`,
    duplicatePlaylistUrl: (name: string) => `Bu liste adresi zaten "${name}" olarak ekli`,
    duplicateFile: (name: string) => `Bu dosya zaten "${name}" olarak ekli`,
    authFailed: 'Kimlik doğrulama başarısız oldu',
    /** Shown beside the password when the panel refuses the sign-in. */
    credentialsRefused: 'Kullanıcı adı veya şifre kabul edilmedi. İkisini de sağlayıcının mesajındakiyle karşılaştır.',
    emptyAddonUrl: 'Eklenti adresini gir.',
    invalidAddonUrl: 'Geçersiz eklenti adresi',
    httpOnlyAddon: 'Yalnızca https://, http:// ya da stremio:// ile başlayan eklenti adresleri destekleniyor',
    addonUrlTooLong: 'Eklenti adresi çok uzun',
    duplicateAddon: (name: string) => `Bu eklenti bu adresle zaten "${name}" olarak ekli`,
    /** An add-on answered 401/403: it has no user name or password, its address was refused. */
    addonRefused:
      'Eklenti bu adresi kabul etmedi. Adresi eklentinin sayfasından yeniden kopyala; içindeki kişisel anahtar değişmiş ya da süresi dolmuş olabilir.',
    notAnAddon: 'Bu adreste bir eklenti bulunamadı. Eklentinin sayfasındaki bağlantıyı olduğu gibi yapıştır.',
    addonUnusable: (name: string) =>
      `"${name}" uygulamanın kullanabildiği bir film ya da dizi kataloğu veya yayın sağlamıyor.`,
    otherAddon: (name: string) => `Bu adres başka bir eklentiye ait ("${name}"). Bu kaynağın kendi eklentisinin adresini gir.`
  },

  /** The guided step that adds a source. */
  add: {
    title: 'Kaynak ekle',
    firstTitle: 'İlk kaynağını ekle',
    firstIntro: 'Sağlayıcının sana verdiği bilgilerle bağlan; kanallar, filmler ve diziler kendiliğinden yüklenir.',
    choiceLabel: 'Elinde hangisi var?',
    xtreamChoice: 'Xtream hesabım var',
    xtreamChoiceHint: 'Sunucu adresi, kullanıcı adı ve şifre',
    m3uChoice: 'M3U listem var',
    m3uChoiceHint: 'Bir liste bağlantısı ya da dosyası',
    addonChoice: 'Eklenti adresim var',
    addonChoiceHint: 'Bir eklentinin kendi sayfasından aldığın bağlantı',
    reassurance: 'Giriş bilgilerin şifrelenerek yalnızca bu bilgisayarda, işletim sisteminin güvenli deposunda saklanır.',
    fileReassurance: 'Dosya bilgisayarında kalır; uygulama yalnızca senin seçtiğin dosyayı okur.',
    addonReassurance:
      'Adres eklentideki ayarlarını ve kişisel bir anahtarı içerebilir. Şifrelenerek yalnızca bu bilgisayarda saklanır ve uygulamada hiçbir yerde gösterilmez.'
  },

  /** The add step's add-on form: check the address, review what was found, add. */
  addon: {
    title: 'Eklenti',
    urlPlaceholder: 'https://addon.example/manifest.json',
    checking: 'Kontrol ediliyor…',
    check: 'Eklentiyi kontrol et',
    checkFailed: 'Eklenti kontrol edilemedi.',
    foundLabel: 'Bulunan eklenti',
    version: (version: string) => `Sürüm ${version}`,
    provides: 'Sağladıkları',
    movieCatalogs: (count: number) => `${formatCount(count)} film kataloğu`,
    seriesCatalogs: (count: number) => `${formatCount(count)} dizi kataloğu`,
    streams: 'Film ve dizi yayınları',
    subtitles: 'Altyazılar',
    unusedCatalogs: (count: number) =>
      `Bu eklentinin ${formatCount(count)} kataloğu uygulamada henüz kullanılmıyor; yalnızca film ve dizi katalogları gösterilir.`,
    unusedSubtitles: 'Bu eklentinin altyazıları uygulamada henüz kullanılmıyor.',
    streamOnly:
      'Bu eklenti yalnızca yayın sağlar: katalog eklentilerinden açtığın film ve bölümler için oynatılacak yayını bulur. İçeriklere göz atmak için bir katalog eklentisi de eklemen gerekir.',
    catalogOnly: 'Bu eklenti yayın sağlamaz: içeriklerini oynatmak için yayın sağlayan bir eklenti de eklemen gerekir.',
    adult: `Eklenti içeriğini yetişkin içeriği olarak işaretliyor; ${settingsPath('catalog')} bölümünde yetişkin içeriği kapalıyken görünmez.`,
    add: 'Eklentiyi ekle',
    adding: 'Ekleniyor…',
    addFailed: 'Eklenti eklenemedi.',
    added: (name: string) => `"${name}" eklendi.`
  },

  /**
   * The built-in TMDB catalogue: a source the app builds itself from TMDB,
   * with the user's own TMDB key, added under Deneysel.
   */
  tmdbCatalog: {
    name: 'TMDB Kataloğu',
    /** Its type in the source list, where an add-on would say "Eklenti". */
    typeLabel: 'Yerleşik katalog',
    hint:
      "Filmleri ve dizileri TMDB'den, kendi TMDB anahtarınla listeler. Açtığın film ve bölümlerin yayınlarını eklediğin yayın eklentilerine sorar.",
    needsKey: `Eklemek için önce ${settingsPath('general')} → ${settings.general.tmdbGroup} bölümüne bir TMDB anahtarı gir.`,
    enterKey: 'Anahtarı gir',
    add: 'Kataloğu ekle',
    adding: 'Ekleniyor…',
    /** The add action once it is in the source list. */
    alreadyAdded: 'Kaynaklarında',
    addFailed: 'TMDB Kataloğu eklenemedi.',
    /** Status suffix when the catalogue list could not be refreshed in this session. */
    unreachable: "TMDB'ye ulaşılamadı, kayıtlı katalog listesi kullanılıyor",
    refresh: (name: string) => `${name} katalog listesini yenile`,
    /** The catalogues, as categories on Filmler and Diziler; the genres follow with TMDB's own names. */
    catalogs: {
      trending: 'Bu hafta trend',
      popular: 'Popüler',
      nowPlaying: 'Vizyondakiler',
      upcoming: 'Yakında',
      topRated: 'En yüksek puanlı',
      onTheAir: 'Yayında',
      search: 'Arama'
    },
    /** Beside TMDB's logo where its data is shown (TMDB's terms ask for the credit). */
    attribution: "Film ve dizi bilgileri TMDB'den alınır",
    logoAlt: 'TMDB'
  },

  xtream: {
    title: 'Xtream Codes',
    subtitle: 'Xtream Codes sunucusuna bağlan',
    namePlaceholder: 'Benim kaynağım',
    urlPlaceholder: 'http://example.com:8080',
    usernamePlaceholder: 'kullanıcı_adı',
    passwordPlaceholder: 'şifre',
    connecting: 'Bağlanılıyor…',
    connect: 'Bağlan ve yüklemeye başla',
    connectFailed: 'Bağlantı başarısız oldu.'
  },

  m3u: {
    title: 'M3U Oynatma Listesi',
    subtitle: 'Bir adresten veya yerel dosyadan içe aktar',
    modeLabel: 'Liste nerede?',
    modeUrl: 'Bağlantı adresi',
    modeFile: 'Bilgisayardaki dosya',
    namePlaceholder: 'Benim listem',
    urlPlaceholder: 'https://example.com/playlist.m3u',
    importing: 'Yükleniyor…',
    import: 'Listeyi yükle',
    reading: 'Okunuyor…',
    pickFile: 'Dosya seç ve yükle',
    importFailed: 'İçe aktarma başarısız oldu.',
    fileFilter: 'Oynatma Listesi Dosyaları',
    localListName: 'Yerel Liste'
  },

  manager: {
    heading: 'Kaynakların',
    count: (count: number) => `${count} kaynak`,
    empty: 'Henüz kaynak eklenmedi.',
    emptyHint: 'Başlamak için bir Xtream Codes sunucusu veya M3U listesi ekle.',
    connected: 'Bağlı',
    disconnected: 'Bağlı değil',
    reconnecting: 'yeniden bağlanıyor...',
    connecting: 'bağlanıyor...',
    statusSuffix: (status: string) => ` - ${status}`,
    inUse: 'Kullanılıyor',
    useThis: 'Bu kaynağa geç',
    enterCredentials: 'Bilgileri Gir',
    enterAddress: 'Adresi Gir',
    repickFile: 'Dosyayı Yeniden Seç',
    refresh: (name: string) => `${name} kaynağını yenile`,
    remove: (name: string) => `${name} kaynağını sil`,
    removeConfirmTitle: 'Kaynak silinsin mi?',
    removeConfirmBody:
      ' kaynağı, kanalları ve kategorileriyle birlikte kaldırılacak. Bu işlem geri alınamaz; yeniden kullanmak için kaynağı tekrar eklemen gerekir.',
    removedButSecretKept: (name: string, reason: string) =>
      `"${name}" kaldırıldı, ancak kayıtlı giriş bilgisi güvenli depodan silinemedi: ${reason}`,
    noCredentials: 'Giriş bilgileri bulunamadı',
    reloadedDuringLoad: 'Liste yüklenirken kaynak yeniden yüklendi. Tekrar dene.',
    refreshFailed: 'Yenileme başarısız oldu.',
    refreshAddon: (name: string) => `${name} eklentisinin bilgilerini yenile`,
    /** Status suffix of an add-on whose manifest could not be fetched in this session. */
    addonUnreachable: 'eklentiye ulaşılamadı, kayıtlı bilgileri kullanılıyor',
    streamOnlyNotActive:
      'Yalnızca yayın sağlar, bu yüzden kullanılan kaynak olamaz; katalog eklentilerinden açtığın içerikler için yayın bulur.',
    addonsOff: `Eklenti kaynakları kapalı. ${settingsPath('sources')} → ${settings.sources.experimentalGroup} bölümünden açabilirsin.`,
    addonLabelsName: 'Sağladıkları',
    addonLabels: {
      movieCatalogs: 'Film kataloğu',
      seriesCatalogs: 'Dizi kataloğu',
      streams: 'Yayın',
      subtitles: 'Altyazı'
    }
  },

  secretForm: {
    label: (name: string) => `${name} bilgilerini yeniden gir`,
    hint: 'Kaynak silinmeden bilgileri yenilenir; favorilerin, izleme geçmişin ve gizlediğin kategoriler korunur.',
    saveFailed: (reason: string) => `Bilgiler güvenli depoya kaydedilemedi: ${reason}`,
    saving: 'Kaydediliyor…',
    save: 'Kaydet ve bağlan'
  },

  /** Connecting a saved source, at start-up or on a retry. */
  connect: {
    failed: 'Kaynağa bağlanılamadı.',
    /** `details`: each source's "name: reason", joined with " · ". */
    summary: (count: number, details: string) => `${count} kaynağa bağlanılamadı — ${details}`,
    secretsUnavailable: 'Kayıtlı giriş bilgileri şu an okunamıyor; uygulama yeniden deneyecek.',
    missingXtreamSecret: `Kayıtlı kullanıcı adı ve şifre bulunamadı. ${settingsPath('sources')} bölümünden bu kaynağın bilgilerini yeniden gir.`,
    missingM3uUrl: `Kayıtlı liste adresi bulunamadı. ${settingsPath('sources')} bölümünden bu kaynağın adresini yeniden gir.`,
    missingAddonUrl: `Kayıtlı eklenti adresi bulunamadı. ${settingsPath('sources')} bölümünden bu eklentinin adresini yeniden gir.`,
    missingCredentials: 'Kayıtlı giriş bilgileri bulunamadı.',
    missingUrl: 'Kayıtlı liste adresi bulunamadı.',
    missingFilePath: 'Liste dosyasının yolu kayıtlı değil. Dosyayı yeniden seç.',
    fileReadFailed: 'Liste dosyası okunamadı.',
    /** Appended to a read failure that does not already ask for it. */
    repickFile: 'Dosyayı yeniden seç.',
    fileCopyKept: (when: string) => `Dosyanın ${when} tarihinde okunan kopyası gösteriliyor.`,
    fileNotPicked: (when: string | null) =>
      `Uygulama yalnızca senin seçtiğin dosyaları okuyabildiği için bu liste dosyasını ${settingsPath('sources')} bölümünde "Dosyayı Yeniden Seç" ile bir kez yeniden seç` +
      (when ? `; o zamana kadar dosyanın ${when} tarihinde okunan kopyası gösteriliyor.` : '.'),
    reloadedRetrying: 'Liste yüklenirken kaynak yeniden yüklendi. Yeniden denenecek.',
    secretsLoadFailed: 'Bu kaynağın giriş bilgileri yüklenemedi.',
    secretMigrationFailed:
      'Kayıtlı giriş bilgileri güvenli depoya taşınamadı. Bilgiler kaybolmasın diye şimdilik eski yerinde duruyor; uygulama her açılışta yeniden deneyecek.',
    secretStoreUnreadable:
      'Kayıtlı giriş bilgileri şu an okunamıyor. Bilgiler silinmedi; uygulama okumayı kendiliğinden yeniden deneyecek.'
  },

  credentials: {
    lossTitle: 'Kayıtlı giriş bilgileri okunamadı',
    lossMessage: (quarantinedAs: string | null) =>
      'Giriş bilgilerinin saklandığı şifreli dosya bu bilgisayarda açılamadı, bu yüzden kayıtlı Xtream şifreleri, M3U liste adresleri ve TMDB anahtarı kullanılamıyor. ' +
      `${settingsPath('sources')} bölümünde her kaynağın bilgilerini "Bilgileri Gir" (M3U listelerinde "Adresi Gir") ile yeniden gir; kaynakları silme, böylece favorilerin, izleme geçmişin ve gizlediğin kategoriler korunur.` +
      (quarantinedAs ? ` Okunamayan dosya "${quarantinedAs}" adıyla saklandı.` : ''),
    lossAction: 'Bilgileri Yeniden Gir',
    storeTitle: 'Kayıtlı giriş bilgileri okunamıyor',
    migrationTitle: 'Giriş bilgileri taşınamadı'
  }
}
