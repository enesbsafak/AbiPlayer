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
      'Bu sunucu için daha önce güvendiğin sertifika değişti. Sağlayıcın sertifikasını yenilemiş olabilir; ' +
      'ama bu, bağlantına birinin araya girdiği anlamına da gelebilir.',
    explanation:
      'Güvenirsen uygulama bu sunucuda yalnızca bu sertifikayı kabul eder; sertifika değişirse yeniden sorar. ' +
      'Bağlantı şifreli kalır, ama sunucunun gerçekten sağlayıcına ait olduğu doğrulanamaz: aynı ağdaki biri ' +
      'araya girerse kullanıcı adını ve şifreni görebilir. Bu sertifikayı beklemiyorsan güvenme.',
    fingerprint: 'Parmak izi (SHA-256)',
    issuer: 'Düzenleyen',
    validity: 'Geçerlilik',
    appOnly: 'Sertifika onayı yalnızca uygulamada yapılabilir',
    manageHint: `Güvendiğin sunucuları ${settingsPath('sources')} bölümünden kaldırabilirsin.`
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
