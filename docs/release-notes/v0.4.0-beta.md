Abi Player 0.4.0-beta sürümü hazır.

## Tasarım Yenileme

- **shadcn tarzı modern arayüz** — Glassmorphism efektleri kaldırıldı, temiz ve profesyonel koyu tema uygulandı. Solid arka planlar, ince border'lar, minimal shadow'lar.
- **Yeni TitleBar** — Windows-native tarz düz kontrol butonları.
- **Yeni Sidebar** — Kompakt, temiz navigasyon. Aktif sayfa net şekilde vurgulanıyor.
- **Yeni kartlar** — Kanal ve film kartları sadeleştirildi, hover efektleri hafifletildi.
- **Tutarlı tasarım token'ları** — Font boyutları, border radius, z-index katmanları standartlaştırıldı.
- **Erişilebilirlik** — Player kontrolleri, kartlar, modal, dropdown gibi tüm etkileşimli öğelere aria-label, role ve klavye desteği eklendi. Modal artık React Portal ile render ediliyor.

## Performans

- **Staged content loading** — Ana sayfa artık 9MB'lık tam kataloğu bekletmiyor. Önce küçük ön izleme (~150KB) yükleniyor, kullanıcı anında içerik görüyor. Tam katalog arka planda sıralı olarak yükleniyor (live → vod → series).
- **Per-type hydration** — Her içerik tipi bağımsız olarak takip ediliyor. Canlı TV sayfasına girince sadece canlı kanallar, Film sayfasına girince sadece filmler öncelikli yükleniyor.
- **Akıllı bant genişliği kullanımı** — 3 büyük indirme artık paralel değil sıralı yapılıyor, her biri 3x daha hızlı bitiyor.
- **Progress göstergesi** — Ana sayfada arka plan yüklemesinin ilerleme durumu gerçek zamanlı gösteriliyor (1/3, 2/3, 3/3).

## EPG (Yayın Akışı)

- **Yeni EPG sayfası** — Eski zaman çizelgesi yerine "Şu An Yayında + Sıradaki" görünümü. Kategori filtresi, kanal arama, kanal logoları ve ilerleme çubuğu.
- **Sadece EPG verisi olan kanallar** — Boş satırlar artık gösterilmiyor.
- **Büyük EPG dosyası desteği** — XML entity expansion limiti kaldırıldı, çok büyük EPG dosyaları sorunsuz parse ediliyor.
- **Case-insensitive eşleştirme** — EPG kanal ID'leri artık büyük/küçük harf fark etmeksizin eşleşiyor.

## Düzeltmeler

- **EPG URL encoding** — Şifrede özel karakter (`&`, `=`, `+`) olan kullanıcılar artık EPG verisi alabiliyor.
- **Series bölüm oynatma** — `container_extension` boş olan bölümler artık mp4 fallback ile oynatılıyor.
- **M3U parser** — Tırnaksız attribute desteği (`tvg-id=kanal.tr`), `#EXTGRP` tag desteği, bare URL'lerden temiz isim çıkarma.
- **M3U kategori ID'leri** — Index-based yerine hash-based ID'ler, playlist yenilendiğinde favoriler ve seçimler korunuyor.
- **Xtream auth doğrulaması** — Geçersiz sunucu yanıtları artık anlamlı hata mesajı veriyor.
- **Background sync hata bildirimi** — İçerik senkronizasyonu başarısız olduğunda kullanıcıya bilgi veriliyor.
- **Uygulama her zaman ana sayfadan açılıyor** — Son ziyaret edilen sayfaya otomatik yönlendirme kaldırıldı.
- **EPG stale cache** — EPG fetch artık `cache: no-store` ile yapılıyor, eski veri gösterilmiyor.

## Notlar

- Bu release, Windows kurulum dosyasını, blockmap dosyasını ve latest.yml güncelleme bilgisini içerir.
- Tasarım tamamen yeniden yazıldığı için eski tema ayarları sıfırlanmış olabilir.
