/** The frame around every page: navigation, title bar, header and error screens. */
export const shell = {
  nav: {
    label: 'Ana gezinme',
    home: 'Ana Sayfa',
    live: 'Canlı TV',
    vod: 'Filmler',
    series: 'Diziler',
    epg: 'Yayın Akışı',
    favorites: 'Favoriler',
    search: 'Ara',
    support: 'Destek',
    settings: 'Ayarlar'
  },

  header: {
    searchShortcut: 'Ctrl+K'
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
    pageNotFound: 'Aradığınız sayfa bulunamadı.',
    pageFailed: 'Sayfa açılamadı.',
    unexpected: 'Beklenmeyen bir hata oluştu.',
    goToSettings: 'Ayarlara Git',
    goHome: 'Ana Sayfaya Dön'
  }
}
