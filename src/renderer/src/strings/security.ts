import { settingsPath } from './settings'

/** Certificates the user is asked to trust, and the list of trusted ones. */
export const security = {
  trust: {
    changedTitle: 'Sunucunun sertifikası değişti',
    unverifiedTitle: 'Sunucunun sertifikası doğrulanamadı',
    confirm: 'Bu sunucuya güven',
    trustFailed: 'Sunucuya güvenilemedi.',
    ownerSuffix: (name: string) => ` (${name})`,
    unverifiedBody: ' kimliğini kanıtlayan güvenlik sertifikası doğrulanamadı.',
    changedWarning:
      'Bu sunucu için daha önce güvendiğiniz sertifika değişti. Sağlayıcınız sertifikasını yenilemiş olabilir; ' +
      'ama bu, bağlantınıza birinin araya girdiği anlamına da gelebilir.',
    explanation:
      'Güvenirseniz uygulama bu sunucuda yalnızca bu sertifikayı kabul eder; sertifika değişirse yeniden sorar. ' +
      'Bağlantı şifreli kalır, ama sunucunun gerçekten sağlayıcınıza ait olduğu doğrulanamaz: aynı ağdaki biri ' +
      'araya girerse kullanıcı adınızı ve şifrenizi görebilir. Bu sertifikayı beklemiyorsanız güvenmeyin.',
    fingerprint: 'Parmak izi (SHA-256)',
    issuer: 'Düzenleyen',
    validity: 'Geçerlilik',
    appOnly: 'Sertifika onayı yalnızca uygulamada yapılabilir',
    manageHint: `Güvendiğiniz sunucuları ${settingsPath('sources')} bölümünden kaldırabilirsiniz.`
  },

  problems: {
    authority:
      'Sertifikayı tanınmış bir sertifika yetkilisi imzalamamış; büyük olasılıkla sunucu kendi sertifikasını kendisi imzalamış.',
    expired: (date: string) => `Sertifikanın süresi ${date} tarihinde dolmuş.`,
    notYetValid: (date: string) => `Sertifika ${date} tarihinden önce geçerli değil.`,
    nameMismatch: 'Sertifika bu adres için değil, başka bir sunucu adı için düzenlenmiş.',
    other: 'Sertifika doğrulanamadı.'
  },

  trusted: {
    title: 'Sunucu sertifikaları',
    hint:
      'Sertifikası doğrulanamayan sunuculara yalnızca burada listelenen sertifikayla bağlanılır. Sertifika değişirse ' +
      'yeniden sorulur.',
    waitingList: 'Onay bekleyen sertifikalar',
    changed: 'Sertifika değişti. ',
    review: 'İncele',
    trustedList: 'Güvenilen sunucular',
    validity: (from: string, to: string) => `Geçerlilik: ${from} – ${to}`,
    revoke: 'Güveni kaldır',
    revokeFor: (endpoint: string) => `${endpoint} için güveni kaldır`,
    revokeFailed: 'Güven kaldırılamadı.'
  }
}
