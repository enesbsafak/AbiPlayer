Abi Player 0.4.1-beta sürümü hazır.

## Düzeltmeler

- **Güncelleme sonrası kaynak kaybı düzeltildi** — Uygulama içinden güncelleme yapıldığında kaynakların (Xtream/M3U) silinmesi sorunu giderildi. Güncelleme öncesi store verisi otomatik olarak yedekleniyor, yeni sürüm açıldığında gerekirse yedekten geri yükleniyor.
- **Yeni kaynak eklenememe sorunu düzeltildi** — Güncelleme sonrası localStorage bozulmasından kaynaklanan kaynak ekleme hatası giderildi.

## Teknik Detaylar

- `quitAndInstall` çağrısı öncesi renderer localStorage verisi `store-backup.json` dosyasına yedekleniyor.
- Store başlatılırken localStorage boşsa otomatik olarak yedekten geri yükleme yapılıyor.
- `autoInstallOnAppQuit` kapatıldı — güncelleme yalnızca kullanıcı onayı ile kurulacak.

## Notlar

- Bu release, Windows kurulum dosyasını, blockmap dosyasını ve latest.yml güncelleme bilgisini içerir.
