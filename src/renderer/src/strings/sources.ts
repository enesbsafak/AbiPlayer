import { settingsPath } from './settings'

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
    password: 'Şifre'
  },

  /** One line under each field: what it is and where to find it. */
  fieldHelp: {
    serverUrl: 'Sağlayıcının gönderdiği adres, çoğunlukla sonunda bir port numarasıyla (ör. :8080).',
    username: 'Sağlayıcının hesabın için verdiği kullanıcı adı.',
    password: 'Sağlayıcının mesajında kullanıcı adının yanında yazan şifre.',
    xtreamName: 'Kaynak listesinde bu adla görünür; boş bırakırsan kullanıcı adı ve sunucudan bir ad konur.',
    playlistUrl: 'Sağlayıcının verdiği, çoğunlukla .m3u, .m3u8 ya da get.php içeren bağlantı.',
    playlistName: 'Kaynak listesinde bu adla görünür; boş bırakırsan adresten ya da dosya adından bir ad konur.',
    file: 'Bilgisayarındaki .m3u, .m3u8 ya da .txt uzantılı liste dosyası.'
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
    credentialsRefused: 'Kullanıcı adı veya şifre kabul edilmedi. İkisini de sağlayıcının mesajındakiyle karşılaştır.'
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
    reassurance: 'Giriş bilgilerin şifrelenerek yalnızca bu bilgisayarda, işletim sisteminin güvenli deposunda saklanır.',
    fileReassurance: 'Dosya bilgisayarında kalır; uygulama yalnızca senin seçtiğin dosyayı okur.'
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
    refreshFailed: 'Yenileme başarısız oldu.'
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
