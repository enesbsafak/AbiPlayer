import { formatCount, LOCALE } from './common'
import { settingsPath } from './settings'

const sizeFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 })

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
    /** Visible beside the icon where the dock has room; the accessible name says which item. */
    previousShort: 'Önceki',
    nextShort: 'Sonraki',
    play: 'Oynat',
    pause: 'Duraklat',
    playPauseTitle: 'Oynat/Duraklat (Boşluk)',
    seekBack: '10 saniye geri sar',
    seekForward: '10 saniye ileri sar',
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

  /** Choosing one of the streams the add-ons offer for a film or an episode. */
  addonStreams: {
    title: 'Yayın seç',
    /** The player's pill that opens the picker again. */
    open: 'Yayınlar',
    openTitle: 'Başka bir yayın seç',
    /** On the player's error card. */
    chooseAnother: 'Başka yayın seç',
    listLabel: 'Yayın adayları',
    asking: 'Eklentilere soruluyor…',
    addonAsking: 'Soruluyor…',
    addonEmpty: 'Yayın bulamadı',
    addonFailed: (reason: string) => `Yanıt vermedi. ${reason}`,
    candidateCount: (count: number) => `${formatCount(count)} yayın`,
    /** Looking for the add-on and release the viewer chose for the previous episode. */
    autoWaiting: 'Son seçtiğin yayın aranıyor…',
    noAddons: 'Yayın sağlayan bir eklenti kurulu değil',
    noAddonsHint: `Filmler ve diziler için yayın bulan bir eklentiyi ${settingsPath('sources')} bölümünden ekleyebilirsin.`,
    openSettings: 'Kaynak ayarlarına git',
    noneFound: 'Oynatılabilir bir yayın bulunamadı',
    noneFoundHint: 'Eklentiler bu içerik için doğrudan oynatılabilen bir yayın vermedi. Daha sonra tekrar dene ya da başka bir eklenti ekle.',
    allFailed: 'Eklentilerin hiçbiri yanıt vermedi',
    allFailedHint: 'İnternet bağlantını kontrol edip tekrar dene.',
    /** One line while mpv is missing and the built-in `<video>` would play the file. */
    html5Warning: 'mpv bulunamadı: yerleşik oynatıcı bu yayınların çoğunu oynatamaz.',
    unnamed: 'Adsız yayın',
    /** A file size from bytes: "1,4 GB", "700 MB". */
    size: (bytes: number) => {
      const gb = bytes / 1024 ** 3
      if (gb >= 1) return `${sizeFormat.format(gb)} GB`
      return `${sizeFormat.format(Math.max(1, Math.round(bytes / 1024 ** 2)))} MB`
    }
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
