Abi Player 0.4.7-beta sürümü hazır.

Bu sürüm, react-doctor denetimleri temel alınarak yürütülen kapsamlı bir kod kalitesi, erişilebilirlik ve kararlılık geçişidir. Kullanıcıya yönelik davranış büyük ölçüde korunurken; arayüzün klavye ve ekran okuyucu uyumu, oynatıcı performansı ve hata dayanıklılığı önemli ölçüde iyileştirildi.

## Erişilebilirlik (a11y) İyileştirmeleri

- **Tutarlı Buton Semantiği** — Arayüzdeki tüm butonlara açık `type="button"` eklenerek form içlerindeki butonların yanlışlıkla gönderim tetiklemesi engellendi.
- **Gerçek Buton Öğeleri** — Tıklanabilir kart ve liste satırları (`ChannelCard`, `VODCard`, dizi bölümleri, kaynak satırları) `role="button"` taşıyan `<div>`'ler yerine gerçek `<button>` öğelerine dönüştürüldü; manuel klavye işleme kodu kaldırıldı, odak ve klavye erişimi yerleşik hâle geldi.
- **Erişilebilir Açılır Menüler** — Kalite, ses, altyazı ve ayar açılır menüleri semantik `<ul>/<li>` yapısına ve `aria-controls`, `aria-labelledby`, `aria-current` öznitelikleriyle güçlendirilmiş ARIA modeline taşındı.
- **Modal Pencereler** — Modallar tarayıcının yerleşik `<dialog>` öğesini kullanacak şekilde yeniden yazıldı; ESC ile kapatma ve odak yönetimi standart davranışa kavuştu.
- **Etiketleme** — Arama alanları, kaydırıcılar ve oynatıcı etiketlendi (`aria-label`), giriş alanları görsel etiketleriyle eşlendi.

## Kararlılık ve Hata Düzeltmeleri

- **ASS Altyazı Ayrıştırma Düzeltmesi** — `Text` alanı içermeyen ASS satırlarında hatalı metin kesimini önlemek için format alanları indekslenerek doğrulanıyor; eksik formatlı satırlar güvenle atlanıyor.
- **MPV Soket Dayanıklılığı** — Soket veri ayrıştırma satır bazlı yeniden yazıldı; dosya açma, altyazı stili ve oynatma komutları `Promise.allSettled` ile paralelleştirilerek başlatma hızlandırıldı.
- **Görsel Yükleme Tutarlılığı** — `LazyImage`, kaynak değiştiğinde yükleme durumunu kaynağa göre sıfırlayacak biçimde düzeltildi; önceki görselin durumunun bir an için görünmesi sorunu giderildi.
- **Akış Boyut Limiti Okuyucuları** — EPG (50MB) ve M3U (20MB) boyut sınırlı akış okuyucuları daha güvenli bir yapıya taşındı.
- **Atomik EPG Durum Güncellemeleri** — EPG yükleme/başarı/hata durumları tek adımda güncellenerek tutarsız ara durumlar ortadan kaldırıldı.

## Performans ve Mimari

- **Toplu Oynatıcı Durum Güncellemesi** — Oynatıcı durumu, dağınık tekil `set` çağrıları yerine tek bir `applyPlayerPatch` ile güncelleniyor; video olaylarında gereksiz yeniden render'lar azaltıldı.
- **EPG Zaman Çizelgesi Optimizasyonu** — EPG ızgarasındaki "şu an" göstergesi her render'da yeniden hesaplanmak yerine `useSyncExternalStore` ile paylaşımlı, dakikalık bir zaman kaynağına bağlandı.
- **Bileşen Ayrıştırma** — `SettingsPage`, `PlayerControls`, `SeriesDetail` ve `usePlayer` daha küçük, yeniden kullanılabilir parçalara bölündü; `Intl.DisplayNames` gibi maliyetli nesneler tek sefer oluşturuluyor.
- **Durum Yönetimi Sadeleştirmesi** — Sayfa ve formlardaki çok sayıda `useState`, okunabilirliği artıran `useReducer` tabanlı yapıya taşındı.
- **Paralel Arka Plan Senkronizasyonu** — Öncelikli içerik türü yüklendikten sonra kalan türler eşzamanlı olarak senkronize ediliyor.

## Temizlik

- **ChannelSearch Sadeleştirmesi** — Kullanılmayan `useSearch` kancası kaldırıldı; arama bileşeni doğrudan kontrol edilen (controlled) bir yapıya geçti.
- **Bağımlılık Temizliği** — Kullanılmayan `@electron-toolkit/preload` geliştirme bağımlılığı kaldırıldı.

## Notlar

- Bu release, Windows kurulum dosyasını, blockmap dosyasını ve latest.yml güncelleme bilgisini içerir.

## Yasal Not

Abi Player yalnızca bir oynatıcıdır; içerik sağlamaz, satmaz, dağıtmaz veya barındırmaz. Kullanılan kaynakların yasal uygunluğundan kullanıcı sorumludur.
