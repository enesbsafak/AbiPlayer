export const player = {
  videoLabel: (name: string) => `${name} oynatıcı`,
  reconnect: 'Yeniden Bağlan',
  resumedFrom: (time: string) => `${time} konumundan devam ediliyor`,
  restartFromStart: 'Baştan başla',

  transport: {
    previous: (name: string) => `Önceki: ${name}`,
    noPrevious: 'Önceki içerik yok',
    next: (name: string) => `Sonraki: ${name}`,
    noNext: 'Sonraki içerik yok',
    play: 'Oynat',
    pause: 'Duraklat',
    playPauseTitle: 'Oynat/Duraklat',
    seekBack: '10 saniye geri sar',
    seekForward: '10 saniye ileri sar',
    jumpToLive: 'Canlıya dön',
    atLive: 'Canlı yayındasın',
    liveBadge: 'CANLI',
    unmute: 'Sesi Aç',
    mute: 'Sesi Kapat',
    volume: 'Ses seviyesi',
    progress: 'Oynatma ilerlemesi'
  },

  actions: {
    pictureInPicture: 'Resim İçinde Resim',
    listTitle: 'Kanal Listesi (L)',
    listLabel: 'Kanal Listesi',
    fullscreenTitle: 'Tam Ekran (F)',
    enterFullscreen: 'Tam ekran',
    exitFullscreen: 'Tam ekrandan çık',
    leaveTitle: 'Geri dön (Esc)',
    leaveLabel: 'Geri dön'
  },

  quality: {
    /** The option that lets the engine choose. */
    autoOption: 'Otomatik',
    autoShort: 'Oto',
    /** A level whose name and size say nothing: the source's own quality. */
    sourceLevel: 'Kaynak',
    title: 'Görüntü kalitesi',
    label: 'Görüntü kalitesi seç',
    heading: 'Görüntü Kalitesi',
    fallback: 'Kalite',
    auto: (active: string) => `Oto ${active}`
  },

  audio: {
    title: 'Ses kanalı',
    label: 'Ses kanalı seç',
    heading: 'Ses Kanalı',
    /** Same as the player modules name an unlabelled track. */
    fallback: (index: number) => `Ses ${index}`
  },

  subtitles: {
    title: 'Altyazı',
    label: 'Altyazı seç',
    heading: 'Altyazı',
    off: 'Kapalı',
    fallback: (id: string | number) => `Altyazı ${id}`,
    style: 'Altyazı Stili',
    fontSize: 'Yazı boyutu',
    fontSizeLabel: 'Altyazı yazı boyutu',
    color: 'Renk',
    colorLabel: 'Altyazı rengi',
    background: 'Arka plan',
    backgroundLabel: 'Altyazı arka plan opaklığı',
    preview: 'Altyazı ön izlemesi',
    loadExternal: 'Dışarıdan dosya yükle',
    fileFilter: 'Altyazı Dosyaları',
    fileReadFailed: 'Altyazı dosyası okunamadı. Dosya çok büyük ya da erişilemez olabilir.',
    fileAddFailed: 'Altyazı dosyası oynatıcıya eklenemedi.',
    fileEmpty: 'Dosyada okunabilir altyazı bulunamadı.',
    truncated: 'Altyazının yalnızca bir bölümü alınabildi; ilerleyen sahnelerde altyazı görünmeyebilir.',
    /** Label of the text track the app fills with parsed cues (it may show in the system caption menu). */
    generatedTrack: 'Abi Player altyazısı'
  },

  tuning: {
    title: 'Senkron ve Görüntü',
    label: 'Senkron ve görüntü ayarları',
    audioDelay: 'Ses gecikmesi',
    audioDelayHint: 'Ses görüntüden önce geliyorsa sağa kaydırın.',
    subtitleDelay: 'Altyazı gecikmesi',
    speed: 'Oynatma hızı',
    aspect: 'En-boy oranı',
    aspectAuto: 'Otomatik',
    scopeHint: 'Bu ayarlar yalnızca açık olan yayın için geçerlidir, başka bir içerik açılınca sıfırlanır.'
  },

  errors: {
    notPlayable: 'Seçilen içerik doğrudan oynatılamıyor.',
    engineLoadFailed: 'Oynatıcı bileşeni yüklenemedi.',
    playbackError: 'Oynatma hatası',
    mpvStartFailed: 'mpv ile oynatma başlatılamadı.',
    hlsGaveUp: (details: string) => `Oynatma başarısız: ${details}`,
    hlsFatal: (details: string) => `Oynatma hatası: ${details}`,
    connectionLost: 'Yayın bağlantısı kesildi.',
    reconnecting: (attempt: number, max: number) => `Bağlantı kesildi, yeniden bağlanılıyor... (${attempt}/${max})`,
    liveFormatFallback: (failed: string, next: string) => `Kanal ${failed} biçiminde açılamadı; ${next} ile deneniyor.`
  },

  deferred: {
    entryGone: 'Bu içerik artık oynatma listesinde bulunmuyor.',
    sourceGone: 'Bu içeriğin kaynağı artık kayıtlı değil.',
    loading: (name: string) => `“${name}” için oynatma listesi yükleniyor…`
  },

  sidebar: {
    close: 'Kanal listesini kapat',
    closeTitle: 'Kapat (L)',
    all: 'Tümü',
    empty: 'Bu kategoride içerik yok'
  },

  mini: {
    label: 'Mini oynatıcı',
    paused: 'Duraklatıldı',
    backToLive: 'Yayına geri dön',
    resume: 'Kaldığın yerden devam et',
    continue: 'Devam et',
    stop: 'Oynatmayı kapat'
  },

  corner: {
    label: 'Köşe oynatıcı',
    expand: 'Oynatıcıyı büyüt',
    expandTitle: 'Büyüt',
    stop: 'Oynatmayı kapat',
    stopTitle: 'Kapat'
  }
}
