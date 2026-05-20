Abi Player 0.4.6-beta sürümü hazır.

Bu sürümde, M3U oynatma listelerinde kararlılık, altyazı motoru dayanıklılığı, odak-bağımsız pencere kontrolleri ve kullanıcı deneyimine yönelik çeşitli kritik hata düzeltmeleri ve iyileştirmeler yapılmıştır.

## Kararlılık ve Hata Düzeltmeleri

- **M3U Kararlı Kanal ID Altyapısı** — M3U oynatma listelerindeki kanal ID'leri artık yayın URL'inin benzersiz hash'i temel alınarak üretiliyor. Oynatma listesi güncellendiğinde veya yeniden yüklendiğinde favori listeleriniz ve izleme geçmişiniz korunur.
- **Altyazı Ayrıştırma Güçlendirmesi** — SRT, VTT ve ASS altyazı ayrıştırıcıları, eksik veya hatalı zaman formatlarında çökme ya da `NaN` (Not a Number) hataları vermeyecek şekilde güçlendirildi.
- **Odak Bağımsız Pencere Kontrolleri** — Pencere küçültme/büyütme/kapatma komutlarında `BrowserWindow.getFocusedWindow()` yerine `BrowserWindow.fromWebContents(event.sender)` kullanılarak uygulamanın arka plandayken de kontrollere doğru yanıt vermesi sağlandı.
- **Bellek ve IPC Güvenlik Limiti** -- Çalma listesi dosya okuma limiti 25MB ile sınırlandırılarak aşırı büyük dosyalarda oluşabilecek bellek taşmaları engellendi.
- **Güvenli Kimlik Depolama Kilitleri** — Eşzamanlı kimlik doğrulama veya okuma/yazma isteklerinde veritabanının kilitlenmesini engellemek için `safeStorage` işlemleri kilit mekanizmasıyla korundu.
- **MPV Soket Kapanış Yönetimi** — MPV soketi beklenmedik şekilde kapandığında askıda kalan asenkron isteklerin hemen sonlandırılması için soketin `close` olayında `cleanup()` tetiklendi.

## Kullanıcı Deneyimi ve Arayüz

- **Genel Aramadan Doğrudan Diziye Geçiş** — Arama sayfasında bir diziye tıklandığında kategoriler listesi yerine doğrudan dizi detay sayfasının açılması sağlandı.
- **Yan Menü Kategori Sabitlemesi** — Oynatıcı yan menüsünden kanal değiştirildiğinde seçili yan menü kategorisinin sıfırlanması sorunu giderildi; kategori artık oynatılan yeni kanalın kategorisine göre otomatik olarak korunur.
- **React fetchPriority DOM Uyarısı Düzeltildi** — `LazyImage` bileşeninde `fetchPriority` özelliğinin DOM'a camelCase geçmesi nedeniyle oluşan konsol uyarısı `fetchpriority` formatına çevrilerek giderildi.

## Notlar

- Bu release, Windows kurulum dosyasını, blockmap dosyasını ve latest.yml güncelleme bilgisini içerir.

## Yasal Not

Abi Player yalnızca bir oynatıcıdır; içerik sağlamaz, satmaz, dağıtmaz veya barındırmaz. Kullanılan kaynakların yasal uygunluğundan kullanıcı sorumludur.

