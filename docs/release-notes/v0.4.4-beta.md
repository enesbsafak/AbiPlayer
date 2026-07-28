Abi Player 0.4.4-beta sürümü hazır.

Bu sürüm, kullanıcıdan gelen iki bildirim üzerine yapılan kök-neden incelemesinin ve ardından yürütülen kapsamlı stabilite/güvenlik düzeltmelerinin ürünüdür.

## Kullanıcı Tarafından Bildirilen Hatalar

- **Sidebar kanal listesi kategori filtresi düzeltildi** — Canlı yayın seyrederken sağ panelde kanal listesi açıldığında, seçili kategori (örn. "Ulusal Kanallar") yok sayılıp tüm IPTV kanalları listeleniyordu. Sidebar artık açılırken ana sayfada seçili olan kategoriyi koruyor; kullanıcı kanal değiştirene kadar filtre yeniden başa dönmüyor. Prev/next kanal gezintisi de artık seçili kategorinin içinde kalıyor.
- **"Dizi detayı yüklenemedi" hatası düzeltildi** — React Strict Mode'un geliştirme çift-mount davranışında, ilk mount tarafından iptal edilen istek ikinci mount'a miras kalıyor ve "İstek iptal edildi" hatası veriyordu. Xtream API isteklerindeki paylaşım mantığı güncellendi: iptal sinyali sahibi olan çağıranlar artık paylaşılan in-flight haritasına katılmıyor, her biri izole çalışıyor. Ayrıca bazı Xtream sunucularının `seasons` alanını dizi yerine obje, `info.info` alanını boş dizi olarak dönmesi gibi tutarsız yanıt şekilleri için dayanıklı parse eklendi. Detay yüklenemezse artık statik "yüklenemedi" mesajı yerine gerçek hata sebebi ve "Tekrar Dene" butonu gösteriliyor.

## Kritik Stabilite Düzeltmeleri

- **MPV süreç temizlemesi yarış durumu** — SIGKILL sonrasında geç gelen soket verisi pending-request haritasını yeniden doldurup zombi süreçler bırakabiliyordu. Temizlik sırası yeniden düzenlendi, yeniden giriş koruması `try/finally` içinde güvence altına alındı.
- **Kimlik bilgisi kilidi kilitlenme koruması** — Güvenli kimlik bilgisi deposu için kullanılan mutex'e 15 saniyelik zaman aşımı eklendi. Önceki sürümde bir işlem takılırsa tüm credential IPC kalıcı olarak kilitleniyordu.
- **Zustand merge sıkılaştırıldı** — Kalıcı durum hidratasyonu artık izin listesi tabanlı; beklenmeyen alanlar (enjekte edilmiş state, prototype alanları) yok sayılıyor. Ayrıca `volume`, `isMuted`, `favoriteIds`, `activeSourceId` için tip doğrulaması var.
- **EPG prototype pollution koruması** — Kötü niyetli XMLTV kanal ID'leri (örn. `__proto__`, `constructor`) artık reddediliyor; EPG verisi `Object.create(null)` ile tutulan null-prototype haritalarda saklanıyor.
- **LocalStorage kotası** — Storage kotası dolduğunda uygulama artık çökmüyor; get/set/remove çağrıları try-catch ile sarmalandı.
- **TMDb önbellek LRU** — Uzun oturumlarda sınırsız büyüyen TMDb yanıt önbelleği için 300 giriş üst sınırı ve LRU çıkarma stratejisi eklendi.
- **FFmpeg altyazı çıkarımı** — stderr için sabit üst sınır, her çözüm yolunda child process'i garantili şekilde öldürme.
- **MPV request-id taşma koruması** — `MAX_SAFE_INTEGER` sarmalama, uzun oturumlarda çakışma riski ortadan kaldırıldı.
- **Otomatik güncelleyici çift-kurulum koruması** — `quitAndInstall` eşzamanlı çağrıldığında yaşanabilen yeniden başlatma döngüsü için tek uçuşta kurulum bayrağı eklendi. `before-quit`'te timer temizliği sağlamlaştırıldı.
- **Canlı yayın donma kurtarma iyileştirmesi** — Donma kontrolü 2,5 saniyede bir çalışıyor, terminal hatadan sonra bile izlemeye devam ediyor: ağ kendiliğinden toparlanırsa hata mesajı otomatik kalkıyor.
- **Pencere olay dinleyicisi temizliği** — Ana pencere kapanırken resize/move/close dinleyicileri açıkça çözülüyor.

## Güvenlik

- **Kimlik bilgisi URL maskeleme** — HTTP hata yanıtlarında sunucu tarafından yankılanan URL'ler loglara/arayüze düşerken kullanıcı adı ve şifre artık `***` ile maskeleniyor (`maskCredentialsInUrl` yardımcısı; `?username=…&password=…` ve `/live/<user>/<pass>/<id>` formlarını kapsar).
- **TLS bypass kapsamı aynı kaldı** — Mevcut `ignore-certificate-errors` Electron anahtarı IPTV sunucuları için gerekli; bu sürümde değişmedi.

## Arama ve Eşleşme

- **Türkçe locale tutarsızlığı giderildi** — `toLowerCase()` ve naif `toLocaleLowerCase('tr')` karışımı arama ve EPG eşleşmesinde sorun yaratıyordu. Kullanıcıya dönük arama (Canlı TV, Film, Dizi, Genel Arama, EPG) artık `normalizeSearchText` yardımcısı ile hem ASCII `I` hem Türkçe `ı`/`İ` spelling'ini aynı anahtara katlıyor; "IZLE", "İZLE" ve "izle" birbiriyle eşleşir. EPG kanal ID'leri teknik tanımlayıcı oldukları için ASCII küçültme ile eşleniyor (örn. `Istanbul.tr` ve `istanbul.tr` artık yine eşleşir).

## Test ve Doğrulama

- Test kapsamı 43 → 47 testa çıkarıldı: EPG prototype pollution, xtream dedup davranışı, credential URL maskeleme, metin normalizasyonu için yeni testler eklendi.

## Notlar

- Bu release, Windows kurulum dosyasını, blockmap dosyasını ve latest.yml güncelleme bilgisini içerir.