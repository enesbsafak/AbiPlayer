import { formatCount } from './common'

const tabs = {
  sources: { label: 'Kaynaklar', description: 'Xtream ve M3U kaynaklarınızı yönetin' },
  playback: {
    label: 'Oynatma',
    description: 'Dublaj dili, canlı yayın biçimi, donanım hızlandırma ve doğrudan ses aktarımı'
  },
  subtitles: { label: 'Altyazı', description: 'Altyazı dili ve görünümü' },
  catalog: { label: 'Katalog', description: 'Hangi kategorilerin listelerde görüneceği' },
  general: { label: 'Genel', description: 'Saat, yayın akışı, TMDB ve sıfırlama' },
  updates: { label: 'Güncelleme', description: 'Sürüm bilgisi ve güncelleme kontrolü' },
  support: { label: 'Destek', description: 'Projeye katkı, geri bildirim ve sürüm notları' }
}

export type SettingsTabKey = keyof typeof tabs

/** Where a text sends the user: "Ayarlar → Katalog". */
export function settingsPath(tab: SettingsTabKey): string {
  return `Ayarlar → ${tabs[tab].label}`
}

export const settings = {
  title: 'Ayarlar',
  tabsLabel: 'Ayar bölümleri',
  tabs,

  playback: {
    audioLanguage: 'Tercih Edilen Dublaj Dili',
    audioLanguagePlaceholder: 'Tercih edilen dublaj dili',
    audioLanguageAuto: 'Otomatik (yayın varsayılanı)',
    audioLanguageHint: 'Yayında bu dilde bir ses kanalı varsa kendiliğinden seçilir.',
    liveFormat: 'Canlı yayın biçimi',
    liveFormatHint:
      'Xtream canlı kanallarının mpv ile hangi biçimde isteneceği. Hesabın izin vermediği biçim ' +
      'istenmez. HLS ya da MPEG-TS seçiliyken o biçimde açılmayan kanal bir kez diğer biçimle ' +
      'denenir. Yedek oynatıcı (mpv yokken) her zaman HLS kullanır.',
    liveFormatAuto: 'Otomatik (hesap izin veriyorsa HLS)',
    liveFormatHls: 'HLS',
    liveFormatTs: 'MPEG-TS',
    hardwareDecoding: 'Donanım hızlandırmalı video çözme',
    hardwareDecodingHint:
      'Video çözmeyi ekran kartına devreder; işlemci kullanımını belirgin şekilde düşürür. ' +
      'Görüntü siyah geliyor veya takılıyorsa kapatın.',
    passthrough: 'Doğrudan ses aktarımı (passthrough: AC3 / DTS / E-AC3 / TrueHD)',
    passthroughHint:
      'Sesi çözmeden doğrudan ses sisteminize gönderir. Yalnızca bu biçimleri kendisi ' +
      'çözebilen bir amfi veya ses sistemi bağlıysa işe yarar.',
    passthroughActive: 'Şu anki yayında etkin.',
    passthroughInactive:
      'Şu anki yayında kullanılmıyor; ses normal şekilde çalınıyor. Cihazınız bu biçimi desteklemiyorsa veya yayın bu biçimlerde değilse beklenen durumdur.',
    cornerPlayer: 'Oynatıcıdan çıkınca köşede oynatmaya devam et (deneysel)',
    cornerPlayerHint:
      'Gezinirken yayın pencerenin sağ alt köşesinde küçük olarak sürer. Yalnızca mpv ile ' +
      'çalışır; kapalıyken oynatıcıdan çıkmak yayını duraklatır.'
  },

  subtitles: {
    language: 'Tercih Edilen Altyazı Dili',
    languagePlaceholder: 'Tercih edilen altyazı dili',
    languageOff: 'Varsayılan kapalı',
    languageAuto: 'Otomatik (ilk uygun)',
    languageHint: 'Yayında bu dilde altyazı varsa kendiliğinden açılır.',
    appearance: 'Görünüm',
    fontSize: 'Yazı Boyutu',
    color: 'Yazı Rengi',
    backgroundOpacity: 'Arka Plan Opaklığı',
    preview: 'Ön izleme',
    previewText: 'Bu bir altyazı ön izlemesidir.'
  },

  catalog: {
    adultContent: 'Yetişkin içeriği göster',
    adultContentHint:
      'Kapalıyken yetişkin içerik olarak tanınan kanallar, filmler, diziler ve kategoriler ' +
      'listelerde, aramada ve ana sayfada görünmez. Açıkken listelerin sonunda gösterilir.',
    noSources: 'Kategori yönetimi için önce bir kaynak ekleyin.',
    visibility: 'Kategori Görünürlüğü',
    visibilityHint: 'Gizlediğiniz kategoriler listelerden tamamen çıkar; içindeki kanallar, filmler ve diziler de görünmez.',
    source: 'Kaynak',
    sourcePlaceholder: 'Kaynak seç',
    filterPlaceholder: 'Kategori ara...',
    filterLabel: 'Kategori ara',
    noMatch: 'Aramayla eşleşen kategori yok.',
    noCategories: 'Bu tür için kategori bulunamadı. Kaynak taraması tamamlanmamış olabilir.',
    adultBadge: '18+',
    hidden: 'Gizli',
    visible: 'Görünür',
    showAllHidden: 'Bu kaynaktaki gizlileri geri getir',
    hiddenCount: (count: number) => (count > 0 ? `${formatCount(count)} kategori gizli` : 'Gizli kategori yok')
  },

  general: {
    timeFormat: 'Saat Biçimi',
    timeFormatPlaceholder: 'Saat biçimi',
    timeFormat24: '24 Saat',
    timeFormat12: '12 Saat',
    epgInterval: 'Yayın Akışı Yenileme Aralığı (dakika)',
    epgIntervalHint: (min: number, max: number) => `${min} ile ${max} dakika arasında bir değer girin.`,
    tmdbKey: 'TMDB API Anahtarı (opsiyonel)',
    tmdbKeyPlaceholder: 'TMDB v3 anahtarını veya v4 erişim jetonunu (bearer token) girin',
    tmdbKeyHint:
      'Film ve dizi ayrıntılarını ve bölüm adlarını zenginleştirmek için kullanılır. Kaynak şifreleriyle birlikte ' +
      'şifreli olarak saklanır.',
    tmdbKeySaved: 'Anahtar güvenli depoya kaydedildi.',
    tmdbKeySaveFailed: (reason: string) => `Anahtar kaydedilemedi: ${reason}`,
    tmdbKeyInvalid: 'Geçersiz TMDB anahtarı: boşluk ya da özel karakter içermemeli.',
    history: 'İzleme Geçmişi',
    historyCount: (count: number) =>
      count > 0 ? `${formatCount(count)} içerik için kaldığınız yer kayıtlı.` : 'Kaldığınız yer kaydedilen bir içerik yok.',
    clearHistory: 'İzleme Geçmişini Temizle',
    resetAll: 'Tüm Ayarları Sıfırla',
    resetAllHint:
      'Ayarlar varsayılana döner. Kaynaklarınız, favorileriniz, gizlediğiniz kategoriler ve ' +
      'TMDB anahtarınız etkilenmez.',
    resetConfirmTitle: 'Ayarlar sıfırlansın mı?',
    resetConfirmBody: 'Oynatma, altyazı, yayın akışı ve saat ayarları varsayılan değerlerine döner. Bu işlem geri alınamaz.',
    resetConfirmKept: 'TMDB anahtarınız, kaynaklarınız, favorileriniz ve gizlediğiniz kategoriler korunur.'
  },

  updates: {
    neverChecked: 'Henüz kontrol edilmedi',
    status: {
      unsupported: 'Bu ortamda otomatik güncelleme desteklenmiyor',
      idle: 'Güncelleme sistemi hazır',
      checking: 'Güncellemeler kontrol ediliyor...',
      available: 'Yeni sürüm bulundu, indirme başlatıldı',
      downloading: 'Güncelleme indiriliyor...',
      downloaded: 'Güncelleme indirildi, kurulum için yeniden başlatın',
      notAvailable: 'Uygulama güncel',
      error: 'Güncelleme kontrolünde hata oluştu',
      unknown: 'Güncelleme durumu alınıyor...'
    },
    version: (current: string | undefined) => `Sürüm ${current ?? '...'}`,
    percent: (fraction: number) => `%${Math.round(fraction * 100)}`,
    perSecond: (size: string) => `${size}/sn`,
    lastChecked: (when: string) => `Son kontrol: ${when}`,
    checking: 'Kontrol ediliyor...',
    check: 'Güncellemeleri Kontrol Et',
    restarting: 'Yeniden başlatılıyor...',
    restartAndInstall: 'Yeniden Başlat ve Kur',
    checkFailed: 'Güncellemeler kontrol edilemedi.',
    installFailed: 'Güncelleme kurulamadı.',
    releaseDate: (when: string) => `Yeni sürüm tarihi: ${when}`
  },

  support: {
    noNotes: 'Bu sürüm için not yazılmamış.',
    notesFailed: 'Sürüm notları alınamadı.',
    notesLoading: 'Sürüm notları yükleniyor...',
    openOnGithub: "GitHub'da aç",
    viewOnGithub: "GitHub'da görüntüle",
    installedVersion: 'Kurulu sürüm',
    supportTitle: 'Projeyi destekleyin',
    supportText: (appName: string) =>
      `${appName} ücretsiz ve açık kaynak. GitHub'da yıldız vermeniz projenin daha çok kişiye ulaşmasına yardımcı olur.`,
    star: "GitHub'da yıldız ver",
    reportIssue: 'Hata bildir veya öneri gönder',
    releaseNotes: 'Sürüm notları',
    allReleases: 'Tümü'
  }
}
