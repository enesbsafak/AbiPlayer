import { settingsPath } from './settings'

/** What a failure is called once it reaches the user, and failures of the TMDB and GitHub requests. */
export const errors = {
  /** What `toUserMessage` says for each kind of failure. */
  kinds: {
    network: 'Sunucuya ulaşılamadı. İnternet bağlantınızı ve sunucu adresini kontrol edin.',
    timeout: 'Sunucu zamanında yanıt vermedi. Biraz sonra tekrar deneyin.',
    cancelled: 'İstek tamamlanmadan durduruldu. Tekrar deneyin.',
    auth: 'Kullanıcı adı veya şifre kabul edilmedi.',
    badResponse: 'Sunucudan beklenmeyen bir yanıt geldi.',
    certificate:
      'Sunucunun güvenlik sertifikası doğrulanamadı ya da daha önce güvendiğiniz sertifikadan farklı. ' +
      `Açılan onay penceresinden ya da ${settingsPath('sources')} → Sunucu sertifikaları bölümünden bu sunucuya güvenebilirsiniz.`,
    generic: 'Beklenmeyen bir hata oluştu.',
    httpRefused: (status: number | null) =>
      status !== null ? `Sunucu isteği reddetti (HTTP ${status}).` : 'Sunucu isteği reddetti.',
    tooLarge: (limit: string | null) =>
      limit ? `Liste veya dosya çok büyük (en fazla ${limit}).` : 'Liste veya dosya çok büyük.'
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
