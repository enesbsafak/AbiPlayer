import { formatCount } from './common'

const tabs = {
  sources: { label: 'Kaynaklar', description: 'İzlediğin listeleri buradan ekle, değiştir ve yönet.' },
  playback: { label: 'Oynatma', description: 'Ses dili, canlı yayın biçimi ve oynatıcının nasıl çalıştığı.' },
  subtitles: { label: 'Altyazı', description: 'Hangi dilde altyazı açılacağı ve nasıl görüneceği.' },
  catalog: { label: 'Katalog', description: 'Listelerde hangi kategorilerin ve içeriklerin görüneceği.' },
  general: { label: 'Genel', description: 'Saat, yayın akışı, film bilgileri ve sıfırlama.' },
  updates: { label: 'Güncelleme', description: 'Hangi sürümü kullandığın ve yeni sürüm olup olmadığı.' },
  support: { label: 'Destek', description: 'Projeye katkı, geri bildirim, sürüm notları ve lisanslar.' }
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
    audioGroup: 'Ses',
    videoGroup: 'Görüntü ve yayın',
    audioLanguage: 'Tercih edilen dublaj dili',
    audioLanguagePlaceholder: 'Tercih edilen dublaj dili',
    audioLanguageAuto: 'Otomatik (yayın varsayılanı)',
    audioLanguageHint: 'Yayında bu dilde bir ses kanalı varsa kendiliğinden seçilir.',
    liveFormat: 'Canlı yayın biçimi',
    liveFormatHint:
      'Kanallar açılmıyor ya da takılıyorsa diğer biçimi dene. Açılmayan kanal bir kez diğer biçimle denenir; ' +
      'yedek oynatıcı her zaman HLS kullanır.',
    liveFormatAuto: 'Otomatik (izin varsa HLS)',
    liveFormatHls: 'HLS',
    liveFormatTs: 'MPEG-TS',
    hardwareDecoding: 'Donanım hızlandırmalı video çözme',
    hardwareDecodingHint: 'İşi ekran kartına verir, işlemciyi rahatlatır. Görüntü siyah geliyor ya da takılıyorsa kapat.',
    passthrough: 'Doğrudan ses aktarımı (passthrough: AC3 / DTS / E-AC3 / TrueHD)',
    passthroughHint: 'Sesi çözmeden amfine gönderir. Yalnızca bu biçimleri kendisi çözebilen bir ses sistemi bağlıysa aç.',
    passthroughActive: 'Şu anki yayında etkin.',
    passthroughInactive:
      'Şu anki yayında kullanılmıyor; ses normal şekilde çalınıyor. Cihazın bu biçimi desteklemiyorsa veya yayın bu biçimlerde değilse beklenen durumdur.',
    cornerPlayer: 'Oynatıcıdan çıkınca köşede oynatmaya devam et (deneysel)',
    cornerPlayerHint: 'Gezinirken yayın pencerenin sağ alt köşesinde sürer. Yalnızca mpv ile çalışır; kapalıyken yayın duraklar.'
  },

  subtitles: {
    languageGroup: 'Dil',
    language: 'Tercih edilen altyazı dili',
    languagePlaceholder: 'Tercih edilen altyazı dili',
    languageOff: 'Varsayılan kapalı',
    languageAuto: 'Otomatik (ilk uygun)',
    languageHint: 'Yayında bu dilde altyazı varsa kendiliğinden açılır.',
    appearance: 'Görünüm',
    fontSize: 'Yazı boyutu',
    fontSizeHint: 'Altyazının ekrandaki büyüklüğü.',
    fontSizeValue: (px: number) => `${px} px`,
    color: 'Yazı rengi',
    colorHint: 'Altyazı harflerinin rengi.',
    backgroundOpacity: 'Arka plan opaklığı',
    backgroundOpacityHint: 'Yazının arkasındaki koyu şeridin ne kadar kapalı olacağı.',
    opacityValue: (percent: number) => `%${percent}`,
    preview: 'Ön izleme',
    previewText: 'Bu bir altyazı ön izlemesidir.'
  },

  catalog: {
    contentGroup: 'İçerik',
    adultContent: 'Yetişkin içeriği göster',
    adultContentHint: 'Kapalıyken yetişkin içerik listelerde, aramada ve ana sayfada görünmez; açıkken listelerin sonunda yer alır.',
    noSources: 'Kategori yönetimi için önce bir kaynak ekle.',
    visibility: 'Kategori görünürlüğü',
    visibilityHint: 'Kapattığın kategori, içindeki kanallar, filmler ve dizilerle birlikte listelerden çıkar.',
    source: 'Kaynak',
    sourcePlaceholder: 'Kaynak seç',
    type: 'Tür',
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
    timeGroup: 'Saat ve yayın akışı',
    timeFormat: 'Saat biçimi',
    timeFormatHint: 'Yayın akışında saatlerin nasıl yazılacağı.',
    timeFormatPlaceholder: 'Saat biçimi',
    timeFormat24: '24 saat',
    timeFormat12: '12 saat',
    epgInterval: 'Yayın akışı yenileme aralığı (dakika)',
    epgIntervalHint: (min: number, max: number) => `Yayın akışı bu kadar dakikada bir yenilenir; ${min} ile ${max} arasında bir değer gir.`,
    tmdbGroup: 'Film ve dizi bilgileri',
    tmdbKey: 'TMDB API anahtarı (isteğe bağlı)',
    tmdbKeyPlaceholder: 'TMDB v3 anahtarı veya v4 erişim jetonu',
    tmdbKeyHint:
      'Film ve dizi ayrıntılarını ve bölüm adlarını zenginleştirir. themoviedb.org hesabının ayarlarında bulunur; ' +
      'şifreli olarak yalnızca bu bilgisayarda saklanır.',
    tmdbKeySaved: 'Anahtar güvenli depoya kaydedildi.',
    tmdbKeySaveFailed: (reason: string) => `Anahtar kaydedilemedi: ${reason}`,
    tmdbKeyInvalid: 'Geçersiz TMDB anahtarı: boşluk ya da özel karakter içermemeli.',
    dangerGroup: 'Temizleme ve sıfırlama',
    history: 'İzleme geçmişi',
    historyCount: (count: number) =>
      count > 0 ? `${formatCount(count)} içerik için kaldığın yer kayıtlı.` : 'Kaldığın yer kaydedilen bir içerik yok.',
    clearHistory: 'Geçmişi temizle',
    clearHistoryConfirmTitle: 'İzleme geçmişi temizlensin mi?',
    clearHistoryConfirmBody: (count: number) =>
      `${formatCount(count)} içerik için kaydedilen kaldığın yer silinecek. Bu işlem geri alınamaz.`,
    clearHistoryConfirm: 'Temizle',
    resetAll: 'Tüm ayarları sıfırla',
    resetAllHint: 'Ayarlar varsayılana döner. Kaynakların, favorilerin, gizlediğin kategoriler ve TMDB anahtarın korunur.',
    resetConfirmTitle: 'Ayarlar sıfırlansın mı?',
    resetConfirmBody: 'Oynatma, altyazı, yayın akışı ve saat ayarları varsayılan değerlerine döner. Bu işlem geri alınamaz.',
    resetConfirmKept: 'TMDB anahtarın, kaynakların, favorilerin ve gizlediğin kategoriler korunur.'
  },

  updates: {
    group: 'Sürüm',
    neverChecked: 'Henüz kontrol edilmedi',
    status: {
      unsupported: 'Bu ortamda otomatik güncelleme desteklenmiyor',
      idle: 'Güncelleme sistemi hazır',
      checking: 'Güncellemeler kontrol ediliyor...',
      available: 'Yeni sürüm bulundu, indirme başlatıldı',
      downloading: 'Güncelleme indiriliyor...',
      downloaded: 'Güncelleme indirildi, kurulum için yeniden başlat',
      notAvailable: 'Uygulama güncel',
      error: 'Güncelleme kontrolünde hata oluştu',
      unknown: 'Güncelleme durumu alınıyor...'
    },
    version: (current: string | undefined) => `Sürüm ${current ?? '...'}`,
    downloadProgress: 'İndirme ilerlemesi',
    percent: (fraction: number) => `%${Math.round(fraction * 100)}`,
    perSecond: (size: string) => `${size}/sn`,
    lastChecked: (when: string) => `Son kontrol: ${when}`,
    checking: 'Kontrol ediliyor...',
    check: 'Güncellemeleri kontrol et',
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
    supportTitle: 'Projeyi destekle',
    supportText: (appName: string) =>
      `${appName} ücretsiz ve açık kaynak. GitHub'da yıldız vermen projenin daha çok kişiye ulaşmasına yardımcı olur.`,
    star: "GitHub'da yıldız ver",
    reportIssue: 'Hata bildir veya öneri gönder',
    releaseNotes: 'Sürüm notları',
    allReleases: 'Tümü',
    licensesTitle: 'Lisanslar',
    licensesText:
      'Uygulamanın kendi kodu MIT lisanslı. Kurulumla gelen mpv ve FFmpeg, uygulamanın ayrı süreç olarak başlattığı GPL lisanslı programlar. ' +
      'Bunların ve diğer bileşenlerin sürümlerini, lisans metinlerini ve kaynak kodu adreslerini bildirim dosyasında bulabilirsin.',
    openNotices: 'Lisans bildirimlerini aç',
    openLicenses: 'Lisans metinleri klasörü',
    openFailed: 'Açılamadı. Dosyalar kurulum klasöründe, resources\\legal altında.',
    tmdbAttribution:
      "Bu uygulama TMDB'yi ve TMDB API'lerini kullanır, ancak TMDB tarafından onaylanmış, sertifikalandırılmış ya da başka bir şekilde desteklenmiş değildir.",
    // TMDB'nin kullanım koşullarındaki zorunlu bildirim, özgün dilinde.
    tmdbAttributionOriginal:
      'This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.'
  }
}
