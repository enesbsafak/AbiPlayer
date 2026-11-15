import { settingsPath } from './settings'

/** Adding, listing and signing in to sources. */
export const sources = {
  typeLabels: {
    xtream: 'Xtream Codes',
    m3u_url: 'M3U Adresi',
    m3u_file: 'M3U Dosyası'
  },

  fields: {
    displayName: 'Görünen Ad (opsiyonel)',
    serverUrl: 'Sunucu Adresi',
    playlistUrl: 'Liste Adresi',
    username: 'Kullanıcı Adı',
    password: 'Şifre'
  },

  validation: {
    emptyCredentials: 'Kullanıcı adı ve şifre boş bırakılamaz',
    emptyServerUrl: 'Sunucu adresi boş bırakılamaz',
    emptyPlaylistUrl: 'Liste adresi boş bırakılamaz',
    invalidServerUrl: 'Geçersiz sunucu adresi',
    invalidPlaylistUrl: 'Geçersiz liste adresi',
    httpOnly: 'Yalnızca HTTP/HTTPS adresleri destekleniyor',
    httpOnlyServer: 'Yalnızca HTTP/HTTPS sunucu adresleri destekleniyor',
    httpOnlyPlaylist: 'Yalnızca HTTP/HTTPS oynatma listesi adresleri destekleniyor',
    duplicateXtream: (name: string) => `Bu sunucu ve kullanıcı adı zaten "${name}" olarak ekli`,
    duplicatePlaylistUrl: (name: string) => `Bu liste adresi zaten "${name}" olarak ekli`,
    duplicateFile: (name: string) => `Bu dosya zaten "${name}" olarak ekli`,
    authFailed: 'Kimlik doğrulama başarısız oldu'
  },

  xtream: {
    title: 'Xtream Codes',
    subtitle: 'Xtream Codes sunucusuna bağlan',
    namePlaceholder: 'Benim Kaynağım',
    urlPlaceholder: 'http://example.com:8080',
    usernamePlaceholder: 'kullanıcı_adı',
    passwordPlaceholder: 'şifre',
    connecting: 'Bağlanılıyor…',
    connect: 'Bağlan',
    connectFailed: 'Bağlantı başarısız oldu.'
  },

  m3u: {
    title: 'M3U Oynatma Listesi',
    subtitle: 'Bir adresten veya yerel dosyadan içe aktar',
    modeUrl: 'Adres',
    modeFile: 'Dosya',
    namePlaceholder: 'Benim Listem',
    urlPlaceholder: 'https://example.com/playlist.m3u',
    importing: 'İçe aktarılıyor…',
    import: 'Listeyi İçe Aktar',
    reading: 'Okunuyor…',
    pickFile: 'Dosya Seç',
    importFailed: 'İçe aktarma başarısız oldu.',
    fileFilter: 'Oynatma Listesi Dosyaları',
    localListName: 'Yerel Liste'
  },

  manager: {
    heading: 'Kaynaklarınız',
    empty: 'Henüz kaynak eklenmedi.',
    emptyHint: 'Başlamak için bir Xtream Codes sunucusu veya M3U listesi ekleyin.',
    connected: 'Bağlı',
    disconnected: 'Bağlı değil',
    reconnecting: 'yeniden bağlanıyor...',
    connecting: 'bağlanıyor...',
    statusSuffix: (status: string) => ` - ${status}`,
    enterCredentials: 'Bilgileri Gir',
    enterAddress: 'Adresi Gir',
    repickFile: 'Dosyayı Yeniden Seç',
    refresh: (name: string) => `${name} kaynağını yenile`,
    remove: (name: string) => `${name} kaynağını sil`,
    removeConfirmTitle: 'Kaynak silinsin mi?',
    removeConfirmBody:
      ' kaynağı, kanalları ve kategorileriyle birlikte kaldırılacak. Bu işlem geri alınamaz; yeniden kullanmak için kaynağı tekrar eklemeniz gerekir.',
    removedButSecretKept: (name: string, reason: string) =>
      `"${name}" kaldırıldı, ancak kayıtlı giriş bilgisi güvenli depodan silinemedi: ${reason}`,
    noCredentials: 'Giriş bilgileri bulunamadı',
    reloadedDuringLoad: 'Liste yüklenirken kaynak yeniden yüklendi. Tekrar deneyin.',
    refreshFailed: 'Yenileme başarısız oldu.'
  },

  secretForm: {
    label: (name: string) => `${name} bilgilerini yeniden gir`,
    hint: 'Kaynak silinmeden bilgileri yenilenir; favorileriniz, izleme geçmişiniz ve gizlediğiniz kategoriler korunur.',
    saveFailed: (reason: string) => `Bilgiler güvenli depoya kaydedilemedi: ${reason}`,
    saving: 'Kaydediliyor…',
    save: 'Kaydet ve Bağlan'
  },

  credentials: {
    lossTitle: 'Kayıtlı giriş bilgileri okunamadı',
    lossMessage: (quarantinedAs: string | null) =>
      'Giriş bilgilerinin saklandığı şifreli dosya bu bilgisayarda açılamadı, bu yüzden kayıtlı Xtream şifreleri, M3U liste adresleri ve TMDB anahtarı kullanılamıyor. ' +
      `${settingsPath('sources')} bölümünde her kaynağın bilgilerini "Bilgileri Gir" (M3U listelerinde "Adresi Gir") ile yeniden girin; kaynakları silmeyin, böylece favorileriniz, izleme geçmişiniz ve gizlediğiniz kategoriler korunur.` +
      (quarantinedAs ? ` Okunamayan dosya "${quarantinedAs}" adıyla saklandı.` : ''),
    lossAction: 'Bilgileri Yeniden Gir',
    storeTitle: 'Kayıtlı giriş bilgileri okunamıyor',
    migrationTitle: 'Giriş bilgileri taşınamadı'
  }
}
