import { settingsPath } from './settings'

/** What a failure is called once it reaches the user, and failures of the TMDB and GitHub requests. */
export const errors = {
  /** What `toUserMessage` says for each kind of failure. */
  kinds: {
    network: 'Sunucuya ulaşılamadı. İnternet bağlantını ve sunucu adresini kontrol et.',
    timeout: 'Sunucu zamanında yanıt vermedi. Biraz sonra tekrar dene.',
    cancelled: 'İstek tamamlanmadan durduruldu. Tekrar dene.',
    auth: 'Kullanıcı adı veya şifre kabul edilmedi.',
    badResponse: 'Sunucudan beklenmeyen bir yanıt geldi.',
    certificate:
      'Sunucunun güvenlik sertifikası doğrulanamadı ya da daha önce güvendiğin sertifikadan farklı. ' +
      `Açılan onay penceresinden ya da ${settingsPath('sources')} → Sunucu sertifikaları bölümünden bu sunucuya güvenebilirsin.`,
    generic: 'Beklenmeyen bir hata oluştu.',
    httpRefused: (status: number | null) =>
      status !== null ? `Sunucu isteği reddetti (HTTP ${status}).` : 'Sunucu isteği reddetti.',
    tooLarge: (limit: string | null) =>
      limit ? `Liste veya dosya çok büyük (en fazla ${limit}).` : 'Liste veya dosya çok büyük.'
  },

  /** An add-on answered 401 or 403: it has no user name, its settings are in its address. */
  addonRefused:
    'Eklenti bu adresi kabul etmedi. Eklentinin ayarları değişmiş ya da süresi dolmuş olabilir; ' +
    `eklentiyi ${settingsPath('sources')} bölümünden yeniden eklemeyi dene.`,

  /** The error screens: what to do next, under what happened. */
  screens: {
    pageHint: 'Tekrar dene; düzelmezse ana sayfaya dönüp oradan devam et.',
    homeHint: 'Tekrar dene; düzelmezse kaynağını ayarlardan kontrol et ya da kaldır.',
    notFoundHint: 'Ana sayfaya dönüp oradan devam et.',
    appHint: 'Tekrar dene. Sorun sürerse uygulamayı kapatıp yeniden aç.'
  },

  tmdb: {
    badResponse: 'TMDB geçersiz bir yanıt döndürdü',
    requestFailed: (status: number) => `TMDB isteği başarısız oldu (HTTP ${status})`
  },

  github: {
    listFailed: (status: number) => `GitHub sürüm listesi alınamadı (${status})`,
    badResponse: 'GitHub sürüm listesi okunamadı: beklenmeyen yanıt'
  }
}
