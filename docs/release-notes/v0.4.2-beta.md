Abi Player 0.4.2-beta sürümü hazır.

## Kritik Düzeltme

- **Xtream Codes kaynak ekleme düzeltildi** — "Bağlanılıyor..." butonunun sonsuza kadar takılı kalması sorunu giderildi. Kimlik bilgisi saklama mekanizmasındaki (credential store mutex) deadlock hatası düzeltildi. Aynı hata Xtream kaynak silme işlemini de etkiliyordu.

## Düzeltmeler

- **M3U URL'de protokol oto-ekleme** — Xtream formunda olduğu gibi, M3U URL alanına `http://` olmadan adres girildiğinde otomatik ekleniyor.
- **Mükerrer kaynak koruması** — Aynı Xtream sunucu+kullanıcı adı, aynı M3U URL veya aynı M3U dosya yolu ile tekrar kaynak eklenmesi engelleniyor.
- **M3U dosya kaynağı yenileme** — Yenile butonuna basıldığında dosya seçici açılarak liste güncellenebiliyor. Önceden bu buton M3U dosya kaynaklarında işlevsizdi.
- **Kaynak yenileme hata bildirimi** — Yenileme başarısız olduğunda kaynak altında hata mesajı gösteriliyor. Önceden hatalar sessizce yutuluyordu.
- **Xtream çift kimlik doğrulama** — Kaynak ekleme sırasında useAutoConnect'in gereksiz ikinci auth isteği göndermesi engellendi.
- **Türkçe hata mesajları** — Geçersiz URL girildiğinde İngilizce "Invalid URL" yerine Türkçe mesaj gösteriliyor.

## Teknik Detaylar

- `withCredentialLock` mutex implementasyonu yeniden yazıldı. Eski versiyon `.then()` zinciri ile oluşturulan pending promise'i `await` ediyordu, ancak `resolve()` ancak `await`'ten sonra çağrılabildiği için deadlock oluşuyordu.
- `setXtreamAuth` artık `addSource`'dan önce çağrılarak auto-connect hook'unun yarış durumu önleniyor.

## Notlar

- Bu release, Windows kurulum dosyasını, blockmap dosyasını ve latest.yml güncelleme bilgisini içerir.
