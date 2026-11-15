/**
 * Failures of requests, downloads, the catalog worker and the on-disk cache.
 * The catalog worker imports this file directly (not `./index`), so its
 * bundle carries only these texts; keep this file free of imports.
 *
 * `services/user-error.ts` still recognises some of these sentences by their
 * words ("zaman aşımı", "iptal edildi", "bağlanılamadı", "kimlik doğrulama")
 * when an error has lost its typed kind; keep those words when rewording.
 */
export const requests = {
  cancelled: 'İstek iptal edildi',

  worker: {
    jobCancelled: 'İş iptal edildi',
    interrupted: 'Katalog işlemi yarıda kaldı. Tekrar deneyin.',
    closed: 'Katalog işlemleri durduruldu.'
  },

  xtream: {
    authRejected: 'Kimlik doğrulama başarısız oldu: sunucu kullanıcı adını veya şifreyi reddetti',
    authHttp: (status: number, sample: string) =>
      `Kimlik doğrulama başarısız oldu (HTTP ${status}). Kullanıcı adını, şifreyi ve hesap durumunu kontrol edin.${sample ? ` (${sample})` : ''}`,
    http: (status: number, sample: string) => `Sunucu hata döndürdü (HTTP ${status})${sample ? ` (${sample})` : ''}`,
    notJson: (sample: string) => `Geçersiz sunucu yanıtı. JSON bekleniyordu: ${sample || 'boş gövde'}`,
    headersTimeout: (seconds: number) => `İstek zaman aşımına uğradı: sunucu ${seconds} saniye içinde yanıt vermedi`,
    bodyTimeout: (seconds: number) => `İstek zaman aşımına uğradı: sunucudan ${seconds} saniyedir veri gelmiyor`,
    unreachable: 'Sunucuya bağlanılamadı. İnternet bağlantısını ve sunucu adresini kontrol edin.',
    /** What each Xtream list is called in `missingList`. */
    listNames: { category: 'kategori', live: 'kanal', vod: 'film', series: 'dizi' },
    missingList: (name: string) => `Beklenmeyen sunucu yanıtı: ${name} listesi gelmedi`,
    badAuthResponse: 'Sunucu geçersiz kimlik doğrulama yanıtı döndürdü',
    missingVodInfo: 'Beklenmeyen sunucu yanıtı: film bilgisi gelmedi',
    missingSeriesInfo: 'Beklenmeyen sunucu yanıtı: dizi bilgisi gelmedi'
  },

  playlist: {
    unreachable: 'Oynatma listesi sunucusuna bağlanılamadı. İnternet bağlantısını ve adresi kontrol edin.',
    httpOnly: 'Yalnızca HTTP/HTTPS oynatma listesi adresleri destekleniyor',
    downloadFailed: (status: number) => `M3U listesi indirilemedi (HTTP ${status})`,
    timeout: 'M3U listesi indirilirken zaman aşımı oluştu'
  },

  epg: {
    downloadFailed: (status: number) => `Yayın akışı indirilemedi (HTTP ${status})`,
    timeout: 'Yayın akışı indirilirken zaman aşımı oluştu',
    /** A programme the guide lists without a title. */
    noTitle: 'Başlık Yok'
  },

  cache: {
    quota: 'Önbellek için disk alanı yetmedi',
    chunkMissing: 'Önbellek parçası eksik',
    badKey: 'Önbellek anahtarı geçersiz'
  }
}
