export const player = {
  videoLabel: (name: string) => `${name} oynatıcı`,
  reconnect: 'Yeniden Bağlan',
  resumedFrom: (time: string) => `${time} konumundan devam ediliyor`,
  restartFromStart: 'Baştan başla',

  /** Shown when an episode ends and the series has another one. */
  nextEpisode: {
    /** "Sıradaki bölüm 5 sn sonra başlıyor". */
    countdown: (seconds: number) => `Sıradaki bölüm ${seconds} sn sonra başlıyor`,
    playNow: 'Şimdi oynat',
    cancel: 'Vazgeç'
  },

  transport: {
    previous: (name: string) => `Önceki: ${name}`,
    noPrevious: 'Önceki içerik yok',
    next: (name: string) => `Sonraki: ${name}`,
    noNext: 'Sonraki içerik yok',
    /** Visible beside the icon where the dock has room; the accessible name says which item. */
    previousShort: 'Önceki',
    nextShort: 'Sonraki',
    play: 'Oynat',
    pause: 'Duraklat',
    playPauseTitle: 'Oynat/Duraklat (Boşluk)',
    seekBack: (seconds: number) => `${seconds} saniye geri sar`,
    seekForward: (seconds: number) => `${seconds} saniye ileri sar`,
    jumpToLive: 'Canlıya dön',
    atLive: 'Canlı yayındasın',
    liveBadge: 'Canlı',
    unmute: 'Sesi aç',
    mute: 'Sesi kapat',
    volume: 'Ses seviyesi',
    progress: 'Oynatma ilerlemesi'
  },

  /** The dock at the bottom of the player and the row above it. */
  dock: {
    label: 'Oynatma',
    streamInfo: 'Yayın bilgisi',
    /** Time left of a film, an episode or the programme on air, in whole minutes: "1 sa 15 dk kaldı". */
    minutesLeft: (minutes: number) => {
      if (minutes < 60) return `${minutes} dk kaldı`
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return rest === 0 ? `${hours} sa kaldı` : `${hours} sa ${rest} dk kaldı`
    },
    programmeProgress: (percent: number) => `Programın yüzde ${percent} kadarı geçti`,
    /** What is next in the guide, at the end of the title line: "Sırada 21:00 · Ana Haber". */
    upNext: (time: string, title: string) => `Sırada ${time} · ${title}`
  },

  actions: {
    pictureInPicture: 'Resim içinde resim',
    listTitle: 'Kanal listesi (L)',
    listLabel: 'Kanal listesi',
    fullscreenTitle: 'Tam ekran (F)',
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
    heading: 'Görüntü kalitesi',
    fallback: 'Kalite',
    auto: (active: string) => `Oto ${active}`
  },

  audio: {
    title: 'Ses kanalı',
    label: 'Ses kanalı seç',
    heading: 'Ses kanalı',
    /** The pill's value while the engine has not said which track it plays. */
    unknown: 'Varsayılan',
    /** Same as the player modules name an unlabelled track. */
    fallback: (index: number) => `Ses ${index}`
  },

  subtitles: {
    title: 'Altyazı',
    label: 'Altyazı seç',
    heading: 'Altyazı',
    off: 'Kapalı',
    fallback: (id: string | number) => `Altyazı ${id}`,
    style: 'Altyazı stili',
    fontSize: 'Yazı boyutu',
    fontSizeLabel: 'Altyazı yazı boyutu',
    color: 'Renk',
    colorLabel: 'Altyazı rengi',
    background: 'Arka plan',
    backgroundLabel: 'Altyazı arka plan opaklığı',
    position: 'Yükseklik',
    positionLabel: 'Altyazı yüksekliği',
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
    title: 'Senkron ve görüntü',
    label: 'Senkron ve görüntü ayarları',
    /** The pill: its small label, and its value when nothing is changed. */
    pillLabel: 'Senkron',
    unchanged: 'Varsayılan',
    speedValue: (speed: number) => `${speed}x`,
    audioDelayValue: (delay: string) => `Ses ${delay}`,
    subtitleDelayValue: (delay: string) => `Altyazı ${delay}`,
    audioDelay: 'Ses gecikmesi',
    audioDelayHint: 'Ses görüntüden önce geliyorsa sağa kaydır.',
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
    empty: 'Bu kategoride içerik yok',
    emptyHint: 'Yukarıdan başka bir kategori seç.',
    category: 'Kategori seç'
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
