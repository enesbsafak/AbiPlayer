/**
 * Text the main process shows the user: dialogs, update states, file and
 * player errors, and IPC refusals (which the renderer shows as they are,
 * because they read as Turkish). Same style and term choices as the
 * renderer's dictionary (src/renderer/src/strings), which main cannot import.
 * Lives in src/shared so the renderer can recognise a few of these messages
 * by their text without keeping a second copy.
 */
export const mainStrings = {
  app: {
    unresponsive: {
      title: 'Uygulama yanıt vermiyor',
      message: (appName: string) => `${appName} bir süredir yanıt vermiyor.`,
      detail: 'Oynatma durduruldu. Pencereyi yeniden yükleyebilir ya da beklemeyi sürdürebilirsin.',
      reload: 'Yeniden Yükle',
      wait: 'Bekle'
    },
    untrustedSender: 'Bu işlem yalnızca uygulama penceresinden çağrılabilir'
  },

  updates: {
    unsupported: 'Otomatik güncelleme yalnızca kurulu uygulamada çalışır',
    unknownError: 'Güncelleme sırasında bilinmeyen bir hata oluştu',
    installFailed: 'Güncelleme kurulamadı. Tekrar dene.',
    installBlocked: (version: string) => `${version} sürümünün kurulumu başlatıldı ama tamamlanmadı.`,
    network: 'Güncelleme sunucusuna ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.',
    corrupt: 'İndirilen güncelleme dosyası bozuk çıktı. Tekrar dene.',
    serverBusy: 'Güncelleme sunucusu şu an yanıt vermiyor. Biraz sonra tekrar dene.',
    idle: 'Güncelleme sistemi hazır',
    checking: 'Güncellemeler kontrol ediliyor...',
    found: (version: string | null) => `Yeni sürüm bulundu${version ? ` (${version})` : ''}. İndiriliyor...`,
    foundDeferred: (version: string | null) =>
      `Yeni sürüm bulundu${version ? ` (${version})` : ''}. İndirme birazdan başlayacak.`,
    downloading: (percent: number) => `Güncelleme indiriliyor... %${percent}`,
    notAvailable: 'Uygulama güncel',
    downloaded: 'Güncelleme hazır. Yeniden başlatarak kurabilirsin.',
    dialog: {
      title: 'Güncelleme Hazır',
      message: (appName: string, version: string | null) => `${appName}${version ? ` ${version}` : ''} indirildi`,
      detail: 'Güncellemeyi tamamlamak için uygulama yeniden başlatılacak.',
      install: 'Yeniden Başlat ve Kur',
      later: 'Daha Sonra'
    }
  },

  files: {
    playlistFilter: 'Oynatma Listesi Dosyaları',
    subtitleFilter: 'Altyazı Dosyaları',
    allFilter: 'Tüm Dosyalar',
    tooLarge: (size: string, limit: string) =>
      `Dosya çok büyük (${size} MB). En fazla ${limit} MB boyutundaki dosyalar açılabilir.`,
    notFound: (name: string) => `Dosya bulunamadı: ${name}`,
    /** The renderer recognises this one (`useAutoConnect`). */
    notPicked: 'Bu dosyayı okuma izni yok. Dosyayı yeniden seç.',
    subtitleNotPicked: 'Altyazı dosyası yalnızca dosya seçme penceresinden eklenebilir'
  },

  credentials: {
    unavailable: 'Giriş bilgilerini güvenli saklama bu sistemde kullanılamıyor',
    lockTimeout: 'Giriş bilgileri kilidi zaman aşımına uğradı'
  },

  mpv: {
    startFailed: 'mpv başlatılamadı.',
    openFailed: 'Yayın açılamadı.',
    openFailedWith: (detail: string) => `Yayın açılamadı: ${detail}`,
    loadingFailed: 'Yayın açılamadı. Kaynak yanıt vermiyor veya adres geçersiz.',
    unrecognizedFormat: 'Yayın biçimi tanınmadı.',
    unknownError: 'Yayın açılırken bilinmeyen bir hata oluştu.',
    unexpectedExit: 'Oynatıcı beklenmedik biçimde kapandı.',
    binaryMissing: 'mpv çalıştırılabilir dosyası bulunamadı',
    ipcClosed: 'mpv bağlantısı kesildi',
    ipcMissing: 'mpv bağlantısı yok',
    ipcConnectFailed: 'mpv bağlantısı kurulamadı',
    commandTimeout: 'mpv komutu zaman aşımına uğradı',
    sessionClosed: 'mpv oturumu kapatıldı',
    sessionReused: 'mpv oturumu yeniden başlatılamaz',
    exitedDuringStart: (code: number | null) =>
      `mpv başlatılırken kapandı${code !== null ? ` (çıkış kodu ${code})` : ''}`,
    spawnFailed: (reason: string) => `mpv başlatılamadı: ${reason}`
  },

  media: {
    /** The renderer recognises a cancelled probe or extraction by this text. */
    cancelled: 'Medya işi iptal edildi',
    timeout: (ms: number) => `İşlem zaman aşımına uğradı (${ms} ms)`,
    outputTooLarge: 'İşlem çıktısı izin verilen boyutu aştı',
    exited: (tool: string, code: number | null) => `${tool} ${code ?? 'bilinmeyen'} koduyla sonlandı`,
    ffmpegMissing: 'ffmpeg çalıştırılabilir dosyası bulunamadı'
  },

  tls: {
    neverRelaxable: 'Bu sunucunun sertifikası güvenlik gereği hiçbir koşulda gevşetilemez.',
    nothingToTrust: 'Bu sunucu için onaylanacak bir sertifika hatası yok. Bağlantıyı yeniden dene.',
    changed: 'Sunucunun güvenlik sertifikası, güvendiğin sertifikadan farklı. Yeniden onaylamadan bağlanılmıyor.'
  },

  /** Refused IPC arguments: the renderer sent something it should not have. */
  invalid: {
    sourceId: 'Geçersiz kaynak kimliği',
    secret: 'Geçersiz giriş bilgisi verisi',
    tmdbKey: 'Geçersiz TMDB anahtarı',
    displaySleep: 'Geçersiz ekran uyku değeri',
    fileFilter: 'Geçersiz dosya filtresi',
    filePath: 'Geçersiz dosya yolu',
    mediaJobOptions: 'Geçersiz medya işi seçenekleri',
    mediaJobId: 'Geçersiz medya işi kimliği',
    mediaJobTimeout: 'Geçersiz medya işi süresi',
    streamUrl: 'Geçersiz yayın adresi',
    subtitleStreamIndex: 'Geçersiz altyazı akışı numarası',
    playbackRequest: 'Geçersiz oynatma isteği',
    playbackId: 'Geçersiz oynatma kimliği',
    playbackTuning: 'Geçersiz oynatma ayarı',
    pause: 'Geçersiz duraklatma değeri',
    seek: 'Geçersiz sarma değeri',
    seekTarget: 'Geçersiz hedef zaman',
    mute: 'Geçersiz sessiz değeri',
    volume: 'Geçersiz ses seviyesi',
    audioTrack: 'Geçersiz ses kanalı kimliği',
    videoTrack: 'Geçersiz görüntü kalitesi kimliği',
    subtitleTrack: 'Geçersiz altyazı kimliği',
    subtitlePath: 'Geçersiz altyazı dosyası yolu',
    fullscreen: 'Geçersiz tam ekran değeri',
    hardwareDecoding: 'Geçersiz donanım hızlandırma değeri',
    passthrough: 'Geçersiz doğrudan ses aktarımı değeri',
    subtitleStyle: 'Geçersiz altyazı stili',
    subtitleInset: 'Geçersiz altyazı konumu',
    margin: 'Geçersiz kenar boşluğu değeri',
    videoRect: 'Geçersiz görüntü alanı',
    trustRequest: 'Geçersiz sertifika onayı',
    serverAddress: 'Geçersiz sunucu adresi',
    trustRecord: 'Geçersiz sertifika kaydı',
    legalNotice: 'Geçersiz lisans belgesi'
  }
}
