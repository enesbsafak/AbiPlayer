/** The frame around every page: the top bars, window controls and error screens. */
export const shell = {
  nav: {
    label: 'Ana gezinme',
    /** The section switcher of the inner screens' top bar. */
    sections: 'Bölümler',
    home: 'Ana Sayfa',
    live: 'Canlı TV',
    vod: 'Filmler',
    series: 'Diziler',
    epg: 'Yayın Akışı',
    favorites: 'Favoriler',
    search: 'Ara',
    settings: 'Ayarlar'
  },

  app: {
    stage: 'Açık Beta',
    /** The line a bug report is prefilled with. */
    versionLine: (version: string) => `Sürüm: ${version}`
  },

  header: {
    searchShortcut: 'Ctrl+K',
    searchPlaceholder: 'Kanal, film veya dizi ara',
    /** The home bar's search field; Enter opens the search screen with it. */
    searchLabel: 'Kanal, film veya dizi ara (Enter ile aramaya geç)',
    /** The inner bar's search button. */
    openSearch: 'Arama ekranını aç'
  },

  window: {
    minimizeTitle: 'Aşağı Al',
    minimizeLabel: 'Pencereyi aşağı al',
    maximizeTitle: 'Büyüt',
    maximizeLabel: 'Pencereyi büyüt',
    restoreTitle: 'Önceki Boyut',
    restoreLabel: 'Pencereyi önceki boyutuna getir',
    closeTitle: 'Kapat',
    closeLabel: 'Pencereyi kapat'
  },

  update: {
    upToDate: 'Güncel',
    available: 'Güncelleme var',
    checkFailed: 'Güncellemeler kontrol edilemedi',
    installTitle: 'Güncellemeyi kurmak için yeniden başlat',
    restarting: 'Yeniden başlatılıyor...',
    install: 'Güncelle',
    downloading: (fraction: number) => `%${Math.round(fraction * 100)} indiriliyor`,
    checkTitle: 'Güncellemeleri kontrol et',
    installedOnly: 'Otomatik güncelleme yalnızca kurulu uygulamada çalışır',
    checking: 'Kontrol ediliyor'
  },

  errors: {
    unexpectedTitle: 'Beklenmeyen bir hata oluştu',
    appStopped: 'Uygulama beklenmedik şekilde durdu.',
    pageTitle: 'Sayfa yüklenemedi',
    pageNotFound: 'Aradığın sayfa bulunamadı.',
    pageFailed: 'Sayfa açılamadı.',
    unexpected: 'Beklenmeyen bir hata oluştu.',
    goToSettings: 'Ayarlara Git',
    goHome: 'Ana Sayfaya Dön'
  }
}
