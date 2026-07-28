Abi Player 0.4.3-beta sürümü hazır.

## Düzeltmeler

- **Çözünürlük göstergesi düzeltildi** — Tüm yayınlarda (canlı TV, film) çözünürlük her zaman "1440p" olarak görünüyordu. 1080p yayın (1920x1080) genişlik değeri 1920 >= 1440 koşulunu sağladığı için yanlış etiketleniyordu. Artık çözünürlük etiketi yükseklik (dikey piksel) temel alınarak doğru hesaplanıyor.
- **Canlı yayın donma sorunu düzeltildi (HLS.js)** — Canlı yayın donduğunda oynatıcı süresiz olarak takılı kalıyordu. HLS.js oynatıcısına donma algılama mekanizması eklendi: 15 saniye ilerleme olmazsa otomatik yeniden bağlanma başlıyor (maks. 5 deneme).
- **MPV yeniden bağlanma düzeltildi** — MPV'deki donma algılama mekanizması çalışmıyordu. "İyi oynatım" tespiti `timePos > 0` kontrolü yapıyordu; yayın donduğunda timePos sabit kalsa bile sıfırdan büyük olduğu için 15 saniyelik eşik hiç tetiklenmiyordu. Artık timePos'un gerçekten ilerleyip ilerlemediği kontrol ediliyor.
- **Kanal arama kutusu düzeltildi** — Arama kutusuna yazı yazılırken girdi otomatik olarak siliniyordu. Debounce gecikmesi sırasında eski değerin geri yazılmasına neden olan state senkronizasyon hatası giderildi.

## Notlar

- Bu release, Windows kurulum dosyasını, blockmap dosyasını ve latest.yml güncelleme bilgisini içerir.
