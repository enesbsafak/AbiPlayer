# Abi Player İyileştirme Planı

- **Tarih:** 15 Kasım 2026
- **Taban:** v0.4.15-beta (`c7f23c9`)
- **Kapsam:** iki tur kod taramasında bulunan tüm sorunların düzeltme planı

## 1. Kanıt tabanı

Tarama dokuz kolda yapıldı: main süreç ve IPC, oynatıcı, veri ve durum katmanı, arayüz, build/sürüm/test, çapraz kalıp taraması, performans ve ölçek, main süreç durum haritası, bağımlılık dökümü.

- Typecheck temiz, 19 dosyada 150 test geçiyor.
- Üretim derlemesi bir kez alındı (paket boyutları için).
- **Uygulama çalıştırılmadı.** Bu kopyada mpv ikilisi yok ve bir IPTV kaynağıyla giriş yapılmadı. Zamanlamaya bağlı maddeler "olası" diye işaretli; hız kazancı tahminleri ölçümle doğrulanacak.

Boyut gösterimi: **K** yarım günden az, **O** bir-iki gün, **B** üç gün ve üzeri.

## 2. İlkeler

1. **Önce ağ, sonra değişiklik.** Aşağıdaki hataların tamamı testsiz kodda. Büyük değişikliklerden önce CI, lint ve test altyapısı kurulur.
2. **Her hata düzeltmesi bir regresyon testiyle gelir.** Test yazılamıyorsa nedeni PR'a yazılır.
3. **Kopyayı değil kökü düzelt.** Üç katalog sayfasındaki bir hata üç kez yamalanmaz; ortak yapıya taşınınca bir kez düzelir. Faz 1'deki yamalar bu yüzden bilinçli olarak küçük tutulur.
4. **Ölçmeden hız iddiası yok.** Her hız maddesi önce zaman damgasıyla ölçülür, sonra değiştirilir, sonra yeniden ölçülür.
5. **Her faz sonunda yayınlanabilir sürüm.** Fazlar birbirine yarım iş bırakmaz.

## 3. Yol haritası

| Faz | Amaç | Çıkış ölçütü | Boyut |
|---|---|---|---|
| 0 | Güvenlik ağı: CI, lint, test altyapısı, ölçüm, sürüm betiği | Her PR'da typecheck + test + derleme koşuyor; sürüm taslak olarak çıkıyor; açılış süreleri ölçülebiliyor | O |
| 1 | Kullanıcının bugün gördüğü hatalar | Bölüm 5'teki maddelerin her biri testle kapanmış | B |
| 2 | Oynatıcı: açılış hızı ve oturum modeli | mpv yarışları kapanmış; anket yerine olay; ölçülen açılış süresi düşmüş | B |
| 3 | Güvenlik ve sürüm bütünlüğü | TLS varsayılan olarak sıkı; hiçbir kimlik bilgisi düz metin değil; Electron güncel | B |
| 4 | Katalog katmanı: indeks, ortak yapı, önbellek, worker | Açılışta içerik önbellekten geliyor; 200 bin kayıtta arayüz donmuyor; üç sayfa tek yapıdan türüyor | B |
| 5 | Arayüz kalitesi ve temizlik | Klavye ile tam gezinme; ölü kod yok; metinler tek yerde | O |

Faz 0 ve Faz 1 sırayla yapılır. Faz 2, 3 ve 4 birbirinden büyük ölçüde bağımsızdır ve paralel yürüyebilir; aralarındaki bağımlılıklar bölüm 11'de.

## 4. Faz 0: Güvenlik ağı

| No | İş | Yer | Boyut |
|---|---|---|---|
| F0-01 | CI kur: Windows üzerinde `npm ci`, typecheck, test, `electron-vite build` | yeni `.github/workflows/ci.yml` | K |
| F0-02 | ESLint ekle: `typescript-eslint`, `react-hooks` (bağımlılık dizisi kuralı), `no-floating-promises`. Mevcut ihlaller için taban dosyası; dokunulan dosyada sıfır ihlal kuralı | kök | O |
| F0-03 | Vitest yapılandırması: `.test.tsx` dahil edilsin, `src/main` testleri Node ortamında koşsun, `scripts/` için test projesi | `vitest.config.ts:22` | K |
| F0-04 | Sürüm betiği: yayından önce testleri çalıştır; sürümü taslak oluştur, tüm dosyaları yükle, sonra yayınla; belirteci push'tan önce çöz; `--no-push` ile etiketin uzak depoda ve HEAD'de olduğunu doğrula | `scripts/release-win.mjs:31, 583-633` | O |
| F0-05 | `package-lock.json` sürümünü sürüm artışına bağla (şu an depoda `0.4.8-beta` kalmış; `npm install` düzeltti, commit edilmedi) | `package.json`, sürüm betiği | K |
| F0-06 | mpv'yi sabitle: sürüm etiketi, dosya adı ve SHA256 depoya yazılsın, uyuşmazlıkta derleme dursun; ayrı klasöre çıkar ve yeniden adlandır; mevcut kurulumu `.mpv-source.json` ile karşılaştır | `scripts/prepare-mpv-win.mjs:14, 153-192` | O |
| F0-07 | Zaman damgaları: açılış zinciri ve oynatma açılışı için `performance.mark`; geliştirme modunda özet tablo; uzun görev gözlemcisi. Noktalar bölüm 12'de | main, renderer | O |
| F0-08 | Kırıcı olmayan bağımlılık güncellemeleri (`npm audit fix`): `fast-xml-parser`, `electron-updater` (js-yaml), vite, vitest ve diğerleri | `package.json` | K |
| F0-09 | Paketlenmiş duman testi: `build:unpack` sonrası mpv, ffmpeg ve ffprobe yollarının çözüldüğünü ve çalıştığını doğrulayan betik | yeni `scripts/` | O |

## 5. Faz 1: Kullanıcının gördüğü hatalar

### 5.1 Oynatıcı

| No | Sorun | Yer | Düzeltme yönü | Boyut |
|---|---|---|---|---|
| F1-01 | "Yeniden Bağlan" hiçbir şeyi yeniden yüklemiyor, yalnızca parça listelerini boşaltıyor | `VideoPlayer.tsx:221` | Store'a yeniden yükleme sayacı; iki motorun etkileri buna bağlansın | K |
| F1-02 | mpv'de tercih edilen altyazı dili uygulanmıyor | `useMpvPlayer.ts:401` | Tercih yalnızca parça listesi doluyken ve yol eşleşince tüketilsin | K |
| F1-03 | Mini oynatıcı oynatmıyor; dönüşte film 0:00'dan başlıyor ve kayıtlı ilerleme eziliyor | `useMpvPlayer.ts:186`, `MiniPlayer.tsx`, `useWatchProgress.ts` | Kısa vade: kart "duraklatıldı, devam et" olarak dürüstleşsin; büyütünce devam bayrağı yeniden kurulsun; devam bekleyen yayında düşük konum kaydedilmesin. Kalıcı çözüm K1 | O |
| F1-04 | Eski dosyanın süresi ve konumu yeni kanala sızıyor; yanlış devam noktası | `mpv-controller.ts:196-205, 890-894` | `open()` içinde konum ve süre sıfırlansın; yolu eşleşmeyen anlık görüntü yok sayılsın | K |
| F1-05 | Hızlı yükleme hatası siliniyor: ölü kanal hata göstermiyor, yeniden bağlanmıyor | `mpv-controller.ts:197-205, 598-601` | Hata `loadfile` gönderilmeden önce temizlensin, sonra dokunulmasın | K |
| F1-06 | mpv beklenmedik biçimde kapanınca arayüz bir şey göstermiyor | `mpv-controller.ts:694-707` | Beklenmedik çıkışta hata yazılsın; soket kapanışı süreç dinleyicilerini sökmesin | K |
| F1-07 | hls.js toplam 8 hatadan sonra kurtarmayı bırakıyor (art arda değil) | `usePlayer.ts:562-570` | Başarılı parça yüklemesinde sayaç sıfırlansın; liste hatasında `loadSource` | K |
| F1-08 | Kaydırıcıya tıklayınca kısayollar ölüyor; ilerleme çubuğu sürüklerken geri atlıyor | `useKeyboard.ts:35-42`, `PlayerControls.tsx:56-68` | Koruma yalnızca metin girişlerinde; sürükleme için yerel durum, bırakınca tek arama | K |
| F1-09 | Mini oynatıcı görünürken boşluk ve ok tuşları tüm uygulamada ele geçiriliyor | `useKeyboard.ts:53` | Kısayollar yalnızca `/player` rotasında | K |
| F1-10 | "Kapalı" seçilen altyazı geri açılabiliyor (olası) | `useMpvPlayer.ts:421-423` | Kullanıcı seçimi sonrası mpv'den geri doldurma yapılmasın | K |
| F1-11 | HTML5 yolu: gömülü altyazı çıkarma yarım sonucu başarı sayıyor; filmden filme geçişte eski film çalmaya devam ediyor; ön sorgu 45 sn sürebiliyor | `ipc-handlers.ts:368-378`, `usePlayer.ts:630-679` | Kesilmiş çıktı işaretlensin; temizlikte `src` kaldırılsın; ön sorguya kısa üst sınır | O |
| F1-12 | Harici altyazı hep UTF-8 okunuyor (Windows-1254 bozuk çıkıyor); SRT tek haneli saati düşürüyor; 25 MB üstü sessizce hata veriyor | `ipc-handlers.ts:515`, `subtitle-parser.ts:59, 272`, `SubtitleSelector.tsx:34-55` | BOM ve 1254 yedeği; toleranslı zaman deseni; hata mesajı | K |
| F1-13 | `.ts` kapsayıcılı her film "CAM" rozeti alıyor | `quality.ts:25, 89` | Kapsayıcı uzantısı kalite deseninden çıkarılsın | K |
| F1-14 | Pencere kapanırken son 10 saniyelik ilerleme kayboluyor | `useWatchProgress.ts:54-60` | `pagehide` üzerinde son kayıt | K |
| F1-15 | Oynatma sırasında saniyede 4-14 kez tüm ayarlar localStorage'a yazılıyor; altyazı satırları değişmese de 100 ms'de bir yazılıyor | `store/index.ts:96-124`, `usePlayer.ts:1022-1027` | Nesne düzeyinde ertelemeli depolama, yalnızca kalıcı dilim değişince yazma; satır dizisi değişmediyse yazma | O |
| F1-16 | Oynatma ayarı, kenar boşluğu ve tam ekran mpv soğuk başlarken kayboluyor, yeniden başlatmada geri gelmiyor | `mpv-controller.ts:332, 353, 441` | Son istenen değerler denetleyicide tutulsun, her yeni süreçte yeniden uygulansın | K |
| F1-17 | Ses aktarımı (passthrough) doğrulaması erken çalışıyor ve eski doğrulama yenisini iptal edebiliyor | `mpv-controller.ts:378-424` | Ses başladıktan sonra doğrula; her beklemeden sonra belirteci yeniden denetle | K |
| F1-18 | Parça ayarlayıcıları mpv'nin seçtiği değerin üzerine yazıyor ("otomatik" seçilince parça boş görünüyor) | `mpv-controller.ts:290, 297, 304` | Durumu yalnızca gözlemci güncellesin | K |

### 5.2 Katalog ve arayüz

| No | Sorun | Yer | Düzeltme yönü | Boyut |
|---|---|---|---|---|
| F1-20 | Canlı TV'de seçilen kategori Filmler ve Diziler'e sızıyor, liste boş | `LiveTVPage.tsx:375`, `VODPage.tsx:445`, `SeriesPage.tsx:442` | Seçim tür başına tutulsun | K |
| F1-21 | Kanal kartında favori yıldızı güncellenmiyor | `ChannelCard.tsx:20` | Seçici `favoriteIds.has(id)` olsun; aynı kalıbın diğer örnekleri Ek A'da | K |
| F1-22 | Yükleme katmanı takılıp ızgarayı tıklanamaz bırakabiliyor (zamanlamaya bağlı) | `LiveTVPage.tsx:226-285` ve iki kopyası | Temizlikte yükleme bitirilsin; `channels` bağımlılıktan çıkarılsın. Kalıcı çözüm F4-03 | K |
| F1-23 | Her sezon tıklaması tüm diziyi yeniden yüklüyor | `SeriesDetail.tsx:310-320`, `SeriesPage.tsx:461, 514` | Başlangıç sezonu bir kez okunsun | K |
| F1-24 | Ana sayfa ve Favoriler'de diziye tıklamak genel listeyi açıyor | `HomePage.tsx:42`, `FavoritesPage.tsx:18` | Arama sayfasındaki doğru davranış ortak yardımcıya taşınsın | K |
| F1-25 | Kaynak yenileme kataloğu önce siliyor (ağ hatasında boş kalıyor) ve gizli kategorileri sıfırlıyor; silme düğmesi onaysız | `SourceManager.tsx:61-76, 161-165` | Önce indir, başarıda değiştir; gizli bayraklar yalnızca silmede temizlensin; onay iletişim kutusu | K |
| F1-26 | Tam katalog eşitlemesi sessizce başarısız oluyor; 20 sn sınırı gövde indirmeyi de kapsıyor | `xtream-api.ts:5, 185-241`, `background-sync.ts:54` | Gövde için ayrı ve uzun sınır, geri çekilmeli yeniden deneme, `syncErrors` için şerit ve "Tekrar Dene" | O |
| F1-27 | Yerel M3U dosyası kaynakları her açılışta boş | `useAutoConnect.ts:94-109` | Main tarafında, daha önce iletişim kutusundan seçilmiş yolu yeniden okuyan işleyici | O |
| F1-28 | M3U: virgüllü adlar kesiliyor; aynı adres iki grupta aynı kimliği alıyor; 20 MB sınırı gerçek listeleri reddediyor | `m3u-parser.ts:16, 42, 78` | Öznitelik bölümünden sonraki ilk virgül; kimliğe grup ve sıra katılsın (favoriler için geçiş gerekir); sınır geçici olarak yükseltilsin, kalıcı çözüm F4-04 | O |
| F1-29 | Xtream yanıtları `as` ile güveniliyor: `{}` dönen panel çökertiyor, `"1"` ile `1` ayrımı arşivi kapatıyor | `xtream-api.ts:274-293, 431-446` | Servis sınırında tek normalleştirici | O |
| F1-30 | EPG: çok dilli başlıklar "Başlık Yok" oluyor; kaynak değişince yükleme takılıyor; 50 MB üstü sessizce kesiliyor | `epg-service.ts:51, 203`, `useEPG.ts:26, 59` | Dil seçimi; kaynak başına iptal; kesilince uyarı | K |
| F1-31 | Otomatik yeniden bağlanma zamanlayıcı kurmuyor; sağlayıcı açılışta 30 sn kapalıysa uygulama bağlanmıyor | `useAutoConnect.ts:7, 94` | Geri çekilmeli zamanlayıcı | K |
| F1-32 | Görsel adresleri çift kodlanıyor, zaten kodlu afişler 404 veriyor | `LazyImage.tsx:72-77` | Yalnızca ayrıştırılamayan adres kodlansın | K |
| F1-33 | Herhangi bir çizim hatası başlık çubuğu dahil tüm kabuğu siliyor | `router/index.tsx:30` | Alt rota başına hata öğesi | K |
| F1-34 | EPG sayfası tüm satırları ve logoları tek seferde çiziyor; "şimdi" çubukları donuk | `EPGPage.tsx:85, 212-270` | Satır sanallaştırma, `LazyImage`, zamanlayıcıyla güncelleme | O |
| F1-35 | Güncelleme penceresi 4 saatte bir geri geliyor; kurulum başarısız olursa düğme kalıcı olarak işlevsiz | `app-updater.ts:157-252, 313-329` | İndirme hazırken periyodik denetimi atla; hata olayında bayrağı sıfırla | K |
| F1-36 | Bozuk kimlik dosyası kaydetmeyi ve silmeyi kalıcı olarak kilitliyor | `ipc-handlers.ts:453-482, 599-611` | Geçici dosyaya yaz, yeniden adlandır; okunamayan dosyayı karantinaya al | K |
| F1-37 | Yayın adreslerinde kullanıcı adı ve şifre kodlanmıyor; `#` veya `/` içeren şifre oynatmayı bozuyor | `xtream-api.ts:401-414` | `encodeURIComponent` | K |
| F1-38 | TMDB tam eşleşme bulamayınca ilk sonucu alıp sağlayıcının verisini eziyor | `tmdb-api.ts:363, 413` | Ad temizliği; güvenli eşleşme yoksa boş dön | K |
| F1-39 | Pencere: büyütülmüş kayıtta boyanmadan gösteriliyor; başlık çubuğuna çift tık çalışmıyor; tam ekranda kapatınca ekran boyutu "normal" diye kaydediliyor | `index.ts:31-46, 143-168`, `TitleBar.tsx:69` | `ready-to-show` sonrası büyüt; çift tık işleyicisi; `getNormalBounds()` | K |
| F1-40 | Katalog sayfasında detay açmak ızgarayı ve kaydırma konumunu atıyor | `VODPage.tsx:479-502`, `SeriesPage.tsx:507-522` | Detay katman veya iç rota olsun, ızgara bağlı kalsın | O |

### 5.3 Ayarlar, ana sayfa ve bayat sonuçlar

| No | Sorun | Yer | Düzeltme yönü | Boyut |
|---|---|---|---|---|
| F1-41 | Tercih edilen dil hiç eşleşmiyor: menü `tr` sunuyor, MKV ve TS parçaları `tur`/`eng` bildiriyor | `track-preferences.ts:7-18`, `PlaybackSettings.tsx:16`, `SubtitleSettings.tsx:23` | Karşılaştırmadan önce ISO 639-1 ve 639-2 kodları aynı biçime getirilsin. F1-02 ile birlikte ele alınmalı | K |
| F1-42 | Favoriler yeniden başlatmadan sonra "Henüz favori yok" gösteriyor; etkin olmayan kaynakta ve M3U dosyasında hiç dolmuyor | `FavoritesView.tsx:12-17`, `HomePage.tsx:79-86` | Favori için küçük bir anlık kayıt saklansın (izleme geçmişinde olduğu gibi) veya yükleniyor durumu gösterilsin. Kalıcı çözüm F4-05 | O |
| F1-43 | Ana sayfa ön yüklemesi tüm hataları yutuyor: sunucu katalog isteklerinde zaman aşımına uğrarsa "toplam 0 içerik hazır" görünüyor, hata ve yeniden deneme yok | `useHomeBootstrap.ts:75-93` | Tüm istekler başarısızsa hata gösterilsin; iptal hatası ayrı ele alınsın | K |
| F1-44 | "Yeniden dene"ye basınca eski çalıştırma yükleme bayraklarını temizliyor; yükleyici kaybolup boş pano çıkıyor | `useHomeBootstrap.ts:108-117`, `HomeStates.tsx:74-77` | `finally` çalıştırma kimliğiyle korunsun | K |
| F1-45 | En sık hatalar ham İngilizce görünüyor: "Failed to fetch", "signal is aborted without reason", Electron'un "Error invoking remote method" öneki | `LoginForm.tsx:122`, `PlaylistImport.tsx:106, 147`, `useAutoConnect.ts:132`, `SupportSettings.tsx:82, 102` | Ağ, iptal ve IPC hataları tek yerde Türkçe mesaja çevrilsin | K |
| F1-46 | Üç ayar hiçbir şeyi değiştirmiyor: Saat Formatı, Kanal Görünüm Modu, otomatik oynat | `GeneralSettings.tsx:16-29`, `CatalogSettings.tsx:11-26`, `PlaybackSettings.tsx:66-74` | Uygulansın veya kaldırılsın | K |
| F1-47 | Xtream biçimli adres içeren M3U kayıtları "Devam Et"te hiç görünmüyor, ama sayaçta sayılıyor | `HomePage.tsx:96-112`, `watch-progress.ts:36-78` | Adres gizleme yalnızca Xtream kaynaklarında yapılsın | K |
| F1-48 | EPG yenileme aralığı her tuşta sınırlanıyor: "120" yazarken 5, 52, 520 oluyor | `GeneralSettings.tsx:41-44`, `settings-slice.ts:34-40` | Yerel taslak, odak çıkınca sınırla | K |
| F1-49 | Kaynak eşitleme ortasında silinir veya yenilenirse kanalları geri ekleniyor (hayalet kanallar); bağlanma sırasında silinen kaynak için de aynısı | `background-sync.ts:40-61`, `useAutoConnect.ts:142-168`, `SourceManager.tsx:39-87` | Yazmadan önce kaynağın hâlâ var olduğu denetlensin; eşitleme iptal edilebilir olsun | K |
| F1-50 | Ana sayfadaki sayı ve satırlar tüm kaynakları, gizli ve yetişkin içeriği karıştırıyor; "Tümünü Gör" yalnızca etkin kaynağı gösteriyor | `HomeHero.tsx:32`, `HomePage.tsx:64-86, 140` | Ana sayfa etkin kaynağa ve katalog görünümüne bağlansın | K |
| F1-51 | "Tüm Ayarları Sıfırla" onaysız ve TMDB anahtarını sessizce siliyor | `GeneralSettings.tsx:85` | Onay; anahtar korunsun veya belirtilsin | K |
| F1-52 | Kayıtlı dil tercihi listede yoksa açılır menü yer tutucu gösteriyor; sürüm rozetine tıklayınca sonuç görünmüyor; güncelleme denetimi hata verirse düğme kalıcı olarak kilitli (olası) | `Dropdown.tsx:27, 49`, `TitleBar.tsx:43-62`, `useAppUpdate.ts:26, 45-58` | Kayıtlı değer hep listede olsun; sonuç kısa süre gösterilsin; `try/finally` | K |
| F1-53 | "Adult Swim" yetişkin içerik sayılıyor; `showAdultContent` ayarı okunmuyor, yetişkin içerik yalnızca sona itilebiliyor | `adult-content.ts:28`, `types/settings.ts:10` | Desen daraltılsın; ayar uygulansın veya kaldırılsın | K |
| F1-54 | Film ve dizi kartlarında favori düğmesi yok, boş durum metni ise yıldızlamayı söylüyor; giriş formunda kullanıcı adı ve şifre kırpılmıyor | `VODCard.tsx`, `FavoritesView.tsx:24`, `LoginForm.tsx:84-92` | Düğme eklensin; `trim` | K |
| F1-55 | Xtream girişinde `auth` alanı metin olarak `"1"` gelirse giriş reddediliyor (olası) | `LoginForm.tsx:94`, `SourceManager.tsx:56`, `useAutoConnect.ts:151` | F1-29'daki normalleştiriciye dahil | K |
| F1-56 | Güvenli depoya geçiş yazımı başarısız olursa kimlik bilgisi bir sonraki açılışta kayboluyor; güvenli silme hatası yalnızca konsola düşüyor | `useAutoConnect.ts:60-68`, `SourceManager.tsx:21-25` | Geçiş sonucu denetlensin, başarısızsa eski kayıt korunsun ve kullanıcıya bildirilsin | K |

## 6. Faz 2: Oynatıcı

Mimari karar: **mpv kalıyor, ayrı süreç ve `--wid` gömme kalıyor.** Değişen, sürecin nasıl sürüldüğü.

| No | İş | Yer | Boyut |
|---|---|---|---|
| F2-01 | Ölçüm tabanı: tıklamadan ilk kareye kadar adımların süreleri (soğuk ve sıcak; HLS ve MPEG-TS). Hedefler bu ölçümden sonra konur | F0-07 | K |
| F2-02 | mpv ön ısıtma: pencere gösterildikten sonra boşta başlat. `mpv --version` denetimini kaldır; dosyanın varlığı ve gerçek başlatmanın sonucu yeterli. "Kullanılamaz" sonucunu zaman aşımında önbelleğe alma | `mpv-controller.ts:152-187, 607` | O |
| F2-03 | Başlatma argümanları: `--no-config`, `--load-scripts=no`, `--ytdl=no`. Ölçerek: `--demuxer-lavf-analyzeduration`, `--demuxer-lavf-probesize`, `--hls-bitrate`, `--network-timeout`, yeniden bağlanma seçenekleri | `mpv-controller.ts:629-660` | O |
| F2-04 | Canlı yayın biçimi: `allowed_output_formats` okunsun; mpv'de varsayılan MPEG-TS, HTML5'te HLS; ayarlara "Otomatik / MPEG-TS / HLS" | `xtream-api.ts:401, 436`, `types/xtream.ts:29` | O |
| F2-05 | Süreç başına oturum nesnesi (`MpvSession`): süreç, soket, boru yolu, bekleyen istekler, gözlemciler, zamanlayıcılar ve yayın durumu oturuma ait olsun. Denetleyicide yalnızca kalıcı niyet kalsın (donanım çözme, ses aktarımı, altyazı stili, son ayar ve ses düzeyi) ve her yeni oturuma uygulansın | `mpv-controller.ts` tamamı | B |
| F2-06 | Anket yerine olay: main, durum yamalarını renderer'a itsin (konum kısılmış). Her yama oturum ve yükleme kimliği taşısın | `mpv-controller.ts:832-930`, `useMpvPlayer.ts:286-457` | B |
| F2-07 | Renderer'da oynatma kimliği: `playChannel` her çağrıda yeni kimlik üretsin; devam, ön sorgu, altyazı ve parça tercihi sonuçları bu kimlikle eşleşmezse atılsın | `player-slice.ts:140`, `usePlayer.ts`, `useResumePlayback.ts` | O |
| F2-08 | Uçucu oynatma durumu (konum, arabellek, etkin satırlar) kalıcı store'dan ayrılsın | `store/index.ts`, `player-slice.ts` | O |
| F2-09 | İki motorun ortak mantığı tek yere: parça uzlaştırıcı ve yeniden bağlanma politikası saf modüller olarak, testleriyle | `usePlayer.ts`, `useMpvPlayer.ts` | O |
| F2-10 | `usePlayer` (1.032 satır) bölünsün: HLS motoru, doğrudan oynatma, altyazı, parça eşleme | `usePlayer.ts` | B |
| F2-11 | ffprobe ve ffmpeg işleri kimlikli ve iptal edilebilir olsun; kanal değişince öldürülsün | `ipc-handlers.ts:190-271, 368` | O |
| F2-12 | Oynatıcı kenar çubuğu: sanallaştır, kapalıyken bağlama, küçük görsel kullan; komşu kanal hesabı indeksten gelsin | `PlayerSidebar.tsx:94-106, 238`, `useAdjacentChannels.ts:30-62` | O |
| F2-13 | Çökme ve kapanış: `render-process-gone` üzerinde mpv durdur, uyku engelini bırak, yeniden yükle; kapanışta `shutdown()` beklensin | `index.ts`, `ipc-handlers.ts:485-488` | K |
| F2-14 | Sahte mpv soketiyle entegrasyon testleri: çerçeveleme, istek eşleme, zaman aşımı, başlat-durdur yarışları | `mpv-controller.test.ts` | O |
| F2-15 | Gerçek mini oynatıcı (K1'e bağlı): oynatıcı kabuğa taşınsın, mpv kenar boşluklarıyla köşeye küçültülsün | `AppShell.tsx`, `VideoPlayer.tsx` | B |

F2-05, F1-04, F1-05, F1-06, F1-16 ve aşağıdaki yarışları kalıcı olarak kapatır: başarısız başlangıçtan kalan sürecin yeni oturumu öldürmesi (`mpv-controller.ts:669-700`), temizliğin iki saniye boyunca yeni oturumun komutlarını reddetmesi (`:980-1043`), soğuk başlangıçta "durdur"un kaybolması (`:216-219`), temizliğin sonunda yeni oturumun alanlarının sıfırlanması (`:1035-1036`).

## 7. Faz 3: Güvenlik ve sürüm bütünlüğü

| No | İş | Yer | Boyut |
|---|---|---|---|
| F3-01 | TLS politikası (K2): varsayılan sıkı; gevşetme yalnızca kullanıcının onayladığı kaynak sunucuları için; TMDB ve GitHub hiçbir koşulda gevşemez; mpv'de `--tls-verify` yükleme başına | `index.ts:86-96`, `mpv-controller.ts:657-658` | B |
| F3-02 | M3U adresleri `safeStorage`'a taşınsın; `store-backup.json` başarılı açılıştan sonra silinsin | `store/index.ts:113`, `app-updater.ts:123-137` | O |
| F3-03 | Hata metinlerinde ve günlüklerde kimlik bilgisi maskelensin (ffmpeg stderr, konsol çıktıları; örnekler Ek A'da) | `ipc-handlers.ts:254, 413` | K |
| F3-04 | Electron 40 → 45 yükseltmesi (14 güvenlik bildirimi). Şeffaf pencere ve `--wid` gömme elle denenmeli | `package.json` | O |
| F3-05 | Kod imzalama (K3) | `electron-builder.yml:39` | O |
| F3-06 | `mpv-add-subtitle-file` yalnızca kendi iletişim kutusundan dönen yolu kabul etsin; izin istekleri varsayılan olarak reddedilsin; işleyiciler gönderen çerçeveyi denetlesin | `ipc-handlers.ts:495-506, 709` | K |
| F3-07 | ffmpeg ve ffprobe tek, sabitlenmiş ve sağlaması denetlenen kaynaktan gelsin; `-protocol_whitelist` eklensin; `MPV_PATH`, çalışma dizini adayı ve PATH yedeği yalnızca geliştirme modunda | `package.json:27-28`, `ipc-handlers.ts:269, 305`, `mpv-controller.ts:60, 117` | O |
| F3-08 | IPC sözleşmesi tek kaynaktan: kanal adları ve yük türleri `src/shared` içinde, preload türleri bundan türesin. `ipc-handlers.ts` dört modüle bölünsün (kimlik bilgisi, süreç çalıştırıcılar, pencere, mpv). Kullanılmayan kanallar silinsin (`window-is-maximized`, `mpv-set-pause`) | `ipc-handlers.ts`, `preload/index.ts`, `preload/index.d.ts` | O |
| F3-09 | Paket içeriği: yalnızca renderer'ın kullandığı paketler `devDependencies`'e; `tsbuildinfo` ve `scripts/` hariç tutulsun; masaüstü kısayolu her güncellemede yeniden oluşturulmasın | `package.json:21-35`, `electron-builder.yml:54` | K |
| F3-10 | Belgeler: README'deki Node sürümü, lisans ve platform beyanları kodla uyuşsun (K4, K5) | `README.md` | K |
| F3-11 | Sürüm belirteci dar kapsamlı olsun; depoda iki adımlı doğrulama | `release-win.mjs:174-191` | K |

## 8. Faz 4: Katalog katmanı

| No | İş | Yer | Boyut |
|---|---|---|---|
| F4-01 | İndeksli katalog deposu: kimliğe göre harita, kaynak ve tür başına listeler, kategori başına listeler, sayaçlar; arama için ad, eklenirken bir kez normalleştirilsin. Bugün her katalog yazımı 10-15 tam taramayı tetikliyor | `playlist-slice.ts:68-225` | B |
| F4-02 | Kanal nesnesinden kimlik bilgisi çıksın: yayın adresi oynatma anında `streamId` ve kimlik bilgisinden kurulsun. Disk önbelleğinin ön koşulu ve F2-04'ün temiz hali | `xtream-api.ts:401-480`, `types/playlist.ts:27` | O |
| F4-03 | Üç katalog sayfası tek yapıdan: `useCatalogSource(tür)`, `<CatalogLayout>`, `<VirtualCardGrid>`. Yaklaşık 800-1.000 satır silinir; modül düzeyindeki dört önbellek kümesi kalkar | `LiveTVPage.tsx`, `VODPage.tsx`, `SeriesPage.tsx`, `ChannelGrid.tsx`, `VODGrid.tsx` | B |
| F4-04 | Katalog worker'ı: indirme, ayrıştırma (M3U, Xtream JSON, XMLTV) ve normalleştirme ana iş parçacığından çıksın; boyut sınırları kalksın | `m3u-parser.ts`, `xtream-api.ts`, `epg-service.ts` | B |
| F4-05 | Disk önbelleği (K6): açılışta içerik önbellekten, tazeleme arkada; `stream_id` ile fark alma. Xtream sürüm bilgisi vermiyor, bu yüzden tazeleme zamana ve kategori farkına bağlanır | yeni | B |
| F4-06 | Açılış zinciri: giriş ile kategoriler paralel; her tür kendi ön izlemesi gelince çizilsin; `useHomeBootstrap` bağımlılıkları daraltılsın (başka kaynağın yazımı bugün yüklemeyi iptal edip baştan başlatıyor); ana sayfa tembel yüklenmesin | `useAutoConnect.ts:36-180`, `useHomeBootstrap.ts:58-137`, `router/index.tsx:8` | O |
| F4-07 | Arama: ön-normalleştirilmiş adlar, ertelenmiş sorgu, doğru sonuç sayısı | `SearchPage.tsx:41-52` ve üç sayfanın `filtered` hesapları | K |
| F4-08 | EPG: worker'da akışla ayrıştırma, zaman penceresi dışını atarak; M3U için `url-tvg` desteği | `epg-service.ts:37-160`, `useEPG.ts:29` | O |
| F4-09 | Tek istek katmanı: bağlantı ve gövde için ayrı zaman aşımları, geri çekilmeli yeniden deneme, hata sınıfları. İsteklerin renderer'dan mı main'den mi yapılacağı K7 | `xtream-api.ts:185-254` | O |
| F4-10 | Kalıcı durum: `version` ve `migrate`; `partialize` ve `merge` için testler; yedekten geri yüklemede kimlik bilgisi yarışı (olası) | `store/index.ts:67-172`, `auth-slice.ts:62` | K |
| F4-11 | Güncelleme indirmesi ilk eşitlemeyle yarışmasın; `electron-updater` geç yüklensin | `app-updater.ts:140, 248` | K |

## 9. Faz 5: Arayüz kalitesi ve temizlik

| No | İş | Yer | Boyut |
|---|---|---|---|
| F5-01 | Klavye ve kumanda gezinme: ızgarada ok tuşlarıyla odak, detayda Esc ve Backspace, detay açılıp kapanınca odak yönetimi | ızgaralar, detay görünümleri | O |
| F5-02 | Erişilebilirlik: `Dropdown` klavye desteği ve doğru roller; dar ekranda adsız kenar çubuğu bağlantıları; `lang="tr"`; etiketsiz girişler | `Dropdown.tsx:41-71`, `Sidebar.tsx:36`, `index.html:2` | K |
| F5-03 | Metinler tek sözlük dosyasında; aksansız yazılmış Türkçe metinler düzeltilsin (liste Ek A'da) | renderer geneli | O |
| F5-04 | Store abonelikleri: seçicisiz `useStore()` kullanımları dar seçicilere çevrilsin (liste Ek A'da) | renderer geneli | K |
| F5-05 | Ölü kod: `EPGGrid`, `NowPlaying`, `VirtualList`, `Modal`, `getChannelById`, `showAdultContent` ayarı, son rota kaydı ve Ek A'daki diğerleri | renderer geneli | K |
| F5-06 | TypeScript sıkılığı: `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnusedLocals`; `_normalBounds` için `any` kaçakları (F1-39 ile kalkar) | `tsconfig.*.json`, `index.ts:33, 143-151` | O |
| F5-07 | Paket: `fast-xml-parser` tembel; hls.js yalnızca HTML5 yolunda yüklensin; renderer paketi küçültülsün (bugün 708 kB, küçültülmemiş); yalnızca Latin ve Latin-ext yazı tipi alt kümeleri | `electron.vite.config.ts`, `usePlayer.ts:2`, `AppShell.tsx:9` | K |
| F5-08 | Görseller: küçük resimlerde tam boy afiş yüklenmesin; yeniden deneme önbelleği atlamasın | `LazyImage.tsx:49-63, 138-146`, `PlayerSidebar.tsx:255` | K |
| F5-09 | Kart yüksekliği: film ızgarasında satırlar ölçülsün (iki satırlı başlık taşıyor, olası) | `VODGrid.tsx:130-137` | K |
| F5-10 | Test kapsamı: `ipc-handlers`, `app-updater`, `store` birleştirme, `subtitle-parser`, `useAutoConnect`, `background-sync`, sürüm betiğinin saf işlevleri | ilgili dosyalar | B |
| F5-11 | Sürüm notu üreticisindeki çeviri hataları ("kategoriies", "güncellemer"); v0.4.14 ve v0.4.15 için not dosyaları | `release-win.mjs:14-27`, `docs/release-notes/` | K |
| F5-12 | Kullanılmayan çoklu platform kalıntıları (K5'e bağlı) | `package.json:18-19`, `electron-builder.yml` | K |

## 10. Karar noktaları

Bunlar kodla çözülemez; yön senin kararın. Her birinde önerim ilk sırada.

| No | Karar | Önerim | Neden |
|---|---|---|---|
| K1 | Mini oynatıcı ne olsun? | Şimdi dürüst bir "devam et" kartı (F1-03); gerçek köşe oynatıcı Faz 2 bittikten sonra (F2-15) | Gerçek mini oynatıcı oturum modeli olmadan yeni yarışlar üretir |
| K2 | TLS gevşetmesi nasıl sınırlansın? | Varsayılan sıkı; sertifika hatasında kaynağa özel bir kez onay sorulsun ve sunucu kaydedilsin | Mevcut kullanıcıların bozuk sertifikalı kaynakları tek tıkla çalışmaya devam eder, geri kalan trafik korunur |
| K3 | Kod imzalama yapılsın mı? | Evet (ör. Azure Trusted Signing, aylık ücretli) | Bugün otomatik güncellemenin tek güvencesi GitHub deposuna yazma yetkisi; ayrıca ilk kurulumda SmartScreen uyarısı kalkar |
| K4 | Lisans | README "MIT" diyor ama `LICENSE` dosyası yok; ya dosya eklensin ya ifade kaldırılsın | Dosya yokken kod hukuken tüm hakları saklı sayılır |
| K5 | macOS ve Linux desteklenecek mi? | Şimdilik yalnızca Windows; mac ve Linux betikleri ve yapılandırması kaldırılsın | Yapılandırma o platformların ikililerini zaten ayıklıyor, betikler çalışmaz durumda |
| K6 | Katalog önbelleği nerede dursun? | Renderer'da IndexedDB, worker'dan yazılarak | 100 MB'lık veriyi IPC'den geçirmez, yerel modül gerektirmez. Alternatifler: main'de sıkıştırılmış JSON dosyaları, SQLite |
| K7 | Ağ istekleri nereden yapılsın? | Ölçüp karar verelim: bugün renderer'dan ve CORS'a tabi; CORS başlığı göndermeyen paneller çalışmıyor olabilir | Main'e taşımak CORS'u ve kaynağa özel TLS'i çözer, ama büyük gövdeleri IPC'den geçirir |

K6 ve F4-02 (veri modeli), F2-05 ve F2-06 (oynatıcı mimarisi) geri dönüşü pahalı kararlar. Uygulamaya başlamadan önce bu ikisi için bağımsız ikinci görüş alınacak.

## 11. Bağımlılıklar

- **Faz 0 → her şey.** F0-01, F0-02 ve F0-03 olmadan Faz 2 ve Faz 4'ün büyük değişiklikleri yapılmaz.
- **F0-07 → F2-01, F4-06.** Ölçüm olmadan hız işi yapılmaz.
- **F2-05 → F2-06 → F2-15.** Oturum nesnesi, olay itme ve gerçek mini oynatıcı bu sırayla.
- **F4-02 → F4-05.** Kanal nesnesinde kimlik bilgisi varken katalog diske yazılamaz; yazılırsa `safeStorage` tasarımı boşa düşer.
- **F4-01 → F4-03 → F4-07, F2-12.** İndeks, ortak sayfa yapısı ve onu kullanan arama ile kenar çubuğu.
- **F4-04 → F4-08, F1-28'in kalıcı hali.** Worker gelince boyut sınırları kalkar.
- **F3-04 (Electron 45) → F0-01.** CI olmadan ana sürüm yükseltmesi yapılmaz.
- **F1-28 kimlik değişikliği → geçiş.** M3U kanal kimliği değişirse favoriler ve izleme geçmişi eski kimlikten yenisine taşınmalı.

## 12. Ölçüm noktaları (F0-07)

**Açılış**

- Main: `index.ts` başı; `whenReady` (`:219`); `registerIpcHandlers` öncesi ve sonrası; `loadFile` (`:198`); `ready-to-show` (`:170`); `did-finish-load`.
- Renderer: `main.tsx` ilk satır; store oluşturma (`store/index.ts:96`) ve yükleme bitişi; kabuğun ilk çizimi; ana sayfa parçasının yüklenmesi.
- Bağlantı: kimlik bilgisi IPC'si (`useAutoConnect.ts:42, 65`); giriş (`:149`); M3U indirme ve ekleme (`:160-161`).
- Ön yükleme: kategoriler (`useHomeBootstrap.ts:79`); ön izlemeler (`:93`); ilk `addChannels` (`:95`); içerikli ilk ana sayfa çizimi.
- Eşitleme: indirme başı, gövde okuma ve `JSON.parse` (`xtream-api.ts:201, 218, 221`); tür başına dönüştürme ve ekleme (`background-sync.ts:43-50`); `parseM3U`, `parseEPGXml`.

**Oynatma**

- Tıklama; rota parçasının yüklenmesi; motor tespiti (`VideoPlayer.tsx:84`).
- `mpv-open` çağrısı; süreç başlatma; boruya bağlanma (`mpv-controller.ts:700`); gözlemci kaydı (`:709`); `loadfile` (`:197`).
- mpv'nin `file-loaded` ve `playback-restart` olayları (ilk kare); yükleme katmanının kalkması.

Dört senaryo ölçülür: soğuk ilk kanal, sıcak kanal değişimi, HLS ile MPEG-TS karşılaştırması, film açılışı.

## 13. Açılışta bugün ne oluyor

İçerik görünmeden önce dört bekleme art arda diziliyor:

1. Kimlik bilgisi IPC'si (dosya okuma ve şifre çözme).
2. Giriş isteği (20 sn sınırı).
3. Üç kategori listesi; hepsi beklenir.
4. Üç ön izleme; hepsi beklenir, her biri 12'ye kadar kategori isteği yapar.

Ardından tam eşitleme canlı, film ve dizi listelerinin tamamını indirir ve ana iş parçacığında ayrıştırır. Katalog diske yazılmadığı için bu her açılışta tekrarlanır. F4-05 ve F4-06 bu zinciri hedefler.

Oynatmada ilk kanalın maliyeti: `mpv --version` süreci, ardından asıl mpv süreci, 150 ms aralıklarla boruya bağlanma, 12 gözlem ve 8 stil komutu, sonra `loadfile`. Sonraki her kanal değişiminde HLS'in liste ve parça beklemesi. F2-02, F2-03 ve F2-04 bunları hedefler.

## 14. Riskler

| Risk | Önlem |
|---|---|
| Faz 2 ve Faz 4'ün büyük değişiklikleri testsiz kodda yeni hata üretir | Faz 0 önce; her değişiklik öncesi davranışı sabitleyen testler; küçük PR'lar |
| TLS sıkılaştırması mevcut kullanıcıların kaynaklarını bozar | K2'deki onay akışı; yükseltme notunda açıklama |
| MPEG-TS varsayılanı bazı sağlayıcılarda çalışmaz | `allowed_output_formats` denetimi; hata durumunda HLS'e otomatik dönüş; ayar |
| M3U kimlik değişikliği favorileri kaybettirir | Geçiş adımı ve testi (bölüm 11) |
| Electron 45 şeffaf pencere ve `--wid` davranışını değiştirir | Ayrı PR, elle deneme listesi, kolay geri alma |
| Küçük sondalama değerleri ses veya altyazı parçalarını eksik bırakır | F2-03 yalnızca ölçümle ve çok kanallı yayınlarda denenerek |

## Ek A: Kalıp taraması örnek listeleri

Her kalıp tek geçişte düzeltilebilsin diye tüm örnekler burada.

### A1. Seçicisiz `useStore()` (8 örnek, F5-04)

- `auth/LoginForm.tsx:58`, `auth/PlaylistImport.tsx:56`, `auth/SourceManager.tsx:11-15`
- `player/SubtitleOverlay.tsx:14`, `player/AudioTrackSelector.tsx:6`, `player/QualitySelector.tsx:7`, `player/SubtitleSelector.tsx:18-21`, `player/MiniPlayer.tsx:7`

Hepsi her store yazımında, yani oynatma sırasında her zaman güncellemesinde yeniden çiziliyor. Ayrıca `useAutoConnect.ts:23` `channels`'a abone olduğu için her katalog yazımı tüm kabuğu yeniden çiziyor.

### A2. Sabit işlevi seçip çizimde çağırma (1 görünür hata, F1-21)

- `channels/ChannelCard.tsx:20-22` (`isFavorite`): yıldız güncellenmiyor.
- Diğer 13 kullanım (`getXtreamCredentials`, `isSourceTypeHydrated`) zararsız: okudukları veri bağımlılık dizisinde.

### A3. Tüm `channels` veya `categories` dizisine bağlı etkiler (18 örnek, F1-22, F4-01, F4-03)

- Kategori yayınlarını çekme: `LiveTVPage.tsx:226-285`, `VODPage.tsx:297-356`, `SeriesPage.tsx:293-352`
- Ön izleme ve eşitleme: `LiveTVPage.tsx:287-367`, `VODPage.tsx:358-437`, `SeriesPage.tsx:354-434`
- Kategori listesi: `LiveTVPage.tsx:198-224`, `VODPage.tsx:269-295`, `SeriesPage.tsx:265-291`
- Tam tarama: `LiveTVPage.tsx:182-188`, `VODPage.tsx:253-259`, `SeriesPage.tsx:249-255`
- `useHomeBootstrap.ts:50-137`, `useAutoConnect.ts:77-195`
- Pahalı hesaplar: `HomePage.tsx:56-75`, `useAdjacentChannels.ts:30-57`, `PlayerSidebar.tsx:94-106`, `useCatalogView.ts:17` (sekiz ayrı kopyada)

### A4. Güncelliği denetlenmeden uygulanan asenkron sonuçlar (12 örnek, F1-44, F1-49, F1-30)

- `background-sync.ts:40-61`, `useAutoConnect.ts:142-168`, `useHomeBootstrap.ts:108-117`
- `useEPG.ts:52-65`, `useEPG.ts:79-95`, `EPGPage.tsx:46-63`
- Üç katalog sayfasının iki etkisi (A3'teki ilk iki satır)
- `SourceManager.tsx:39-87`, `LoginForm.tsx:92-120`, `PlaylistImport.tsx:98-104`

### A5. Yutulan hatalar (12 örnek, F1-26, F1-43, F1-56)

- `useHomeBootstrap.ts:76-78, 90-92`; `background-sync.ts:54-57`
- `LiveTVPage.tsx:213-216`, `VODPage.tsx:284-287`, `SeriesPage.tsx:280-283`
- `useAutoConnect.ts:60-62, 66-68`; `SourceManager.tsx:21-25`
- `SubtitleSelector.tsx:34-55`; `useAppUpdate.ts:26, 45-58`
- `store/index.ts:50-56` (localStorage yazma hatası); `app-updater.ts:134` (kurulum öncesi yedek hatası)
- `useMpvPlayer.ts:202, 207`

### A6. Kimlik bilgisi yazdırabilen günlükler (F3-03)

- `usePlayer.ts:643, 793`: `ipc-handlers.ts:254, 413`'ten gelen ffprobe ve ffmpeg hata çıktısını yazıyor; çıktı yayın adresini içeriyor.
- Olası: `ErrorBoundary.tsx:21`, `RouteError.tsx:23`.

### A7. Kalıcı katman dışında doğrudan depolama

- `AppShell.tsx:34, 42`: `iptv:last-route` yazılıp hiç okunmadan siliniyor (ölü).
- `app-updater.ts:128-130`: main, store'u okuyup `store-backup.json`'a yazıyor.

### A8. Temizliği olmayan zamanlayıcı ve dinleyiciler

Hepsi zararsız veya olası: `PlayerSidebar.tsx:118-126` (kenar boşluğu sıfırlanmıyor), `PlayerSidebar.tsx:131`, `LiveTVPage.tsx:150`, `VODPage.tsx:221`, `SeriesPage.tsx:217`, `VideoPlayer.tsx:138-143`, `usePlayer.ts:171`.

### A9. Ölü kod (46 öğe, F5-05)

- **Bileşenler:** `epg/EPGGrid.tsx`, `epg/NowPlaying.tsx`, `ui/Modal.tsx`, `ui/VirtualList.tsx`
- **İşlevler ve IPC:** `ensureSourceFullSync` ve `TYPE_LABELS` (`background-sync.ts:129, 12`), `mpvSetPause` (`platform.ts:65`), `windowIsMaximized` ve işleyicisi (`preload/index.ts:65`), `LAST_ROUTE_KEY` ve `RESTORABLE_ROUTES` (`AppShell.tsx:13-43`)
- **Store, playlist:** `getFilteredChannels`, `getChannelById`, `getCategoriesByType`, `setChannels`, `selectedChannelId`, `setSelectedChannel`; yalnızca testlerde kullanılanlar `channelFilter`, `setChannelFilter`, `setCategories`, `setHiddenCategories`; yazılıp okunmayan `syncErrors` (F1-26 ile kullanıma girecek)
- **Store, diğer:** `getActiveSource`, `setFavorites`, `setPlaying`, `setPaused`, `setBuffering`, `setCurrentTime`, `setDuration`, `setDemuxerCacheDuration`, `setAudioTracks`, `setSubtitleTracks`, `setVideoQualityOptions`, `setActiveVideoQuality`, `isPiP`
- **Ayar alanları:** hiç okunmayan `theme`, `showAdultContent`, `bufferLength`; arayüzde olup etkisiz `epgTimeFormat`, `channelViewMode`, `autoPlay`; arayüzü olmayan `language`
- **Türler:** `PlayerState`, `PlaylistSource.lastRefresh`, `Category.parentId`, `Channel.seasonCount`; yazılıp okunmayan `Channel.tvArchive`, `tvArchiveDuration`, `backdropUrl`

### A10. Aksansız Türkçe ve karışık dilli metinler (33 + 9, F5-03, F1-45)

- `app-updater.ts:88, 90, 147, 168, 181, 197, 213` (güncelleme mesajlarının tamamı)
- `SourceManager.tsx:97, 98, 105`; `ErrorBoundary.tsx:35`; `RouteError.tsx:29, 37`
- `TitleBar.tsx:79, 80, 88, 89`; `AudioTrackSelector.tsx:27`; `QualitySelector.tsx:37, 54`
- `SubtitleSelector.tsx:70, 95, 106, 115, 172, 183`; `SeriesDetail.tsx:469`; `Dropdown.tsx:20`
- `usePlayer.ts:877`; `xtream-api.ts:230, 235`; `m3u-parser.ts:213, 227`; `LoginForm.tsx:142`
- Karışık: "Public Beta" (`app-info.ts:3`); ham tarayıcı ve Electron hata metinleri (F1-45); `xtream-api.ts:215` `statusText`; `usePlayer.ts:567, 583` hls hata kodları; `mpv-controller.ts:103` eşlenmemiş mpv metni

### A11. Dış veride tür dökümü ve boş olamaz varsayımı (7 riskli, F1-29, F1-55)

- `xtream-api.ts:169, 221`: her Xtream yanıtı `as T`; boş `name` aramayı çökertir (olası)
- `LoginForm.tsx:94`, `SourceManager.tsx:56`, `useAutoConnect.ts:151`: `auth !== 1`
- `github-releases.ts:106`, `tmdb-api.ts:262`; `store/index.ts:134-137, 163`; `main/index.ts:22`

## Ek B: Bağımlılık durumu

`npm audit`: 19 paket (9 yüksek, 9 orta, 1 düşük). Kullanıcıya giden üçü:

| Paket | Önem | Düzeltme |
|---|---|---|
| `electron` 40.10.6 | Yüksek (14 bildirim) | 45.3.2, ana sürüm geçişi (F3-04) |
| `js-yaml` 4.3.0 (`electron-updater` üzerinden) | Yüksek | `npm audit fix` (F0-08) |
| `fast-xml-parser` 5.10.1 | Düşük | `npm audit fix` (F0-08) |

Kalan 16 paket yalnızca derleme ve test araçlarında (vite, vitest, electron-builder zinciri, postcss). `npm`'in electron-builder için önerdiği "düzeltme" 25.1.0'a geri dönüş; uygulanmayacak, 26.18.0'a ilerlenecek.

Ana sürümü geride olanlar: `react` ve `react-dom` (18 → 19), `tailwindcss` (3 → 4), `vite` (7 → 8), `vitest` (4 → 5), `typescript` (5 → 7), `electron-vite` (5 → 6), `lucide-react` (0.468 → 1.x). Bunların hiçbiri acil değil; Faz 5'ten sonra tek tek ele alınır.

## Ek C: Doğrulanmamış varsayımlar

- mpv, gömüldüğü pencere yok olunca kendiliğinden kapanıyor mu? Yerleşik tuş atamaları kapalı olduğu için kapanmıyor olabilir. Main süreç ölürse Windows iş nesnesi çocuk süreçleri öldürür.
- Şeffaf pencerede kenardan boyutlandırma ve kenara yaslama çalışıyor mu? Electron belgelerine göre çalışmıyor olabilir.
- Paketlenmiş uygulamada ffmpeg ve ffprobe çalışıyor mu? electron-builder kaynağına göre evet; gerçek paketle denenmedi (F0-09).
- Sağlayıcı panelleri CORS başlığı gönderiyor mu? Göndermeyenlerde katalog istekleri bugün başarısız olur (K7).
- Paketteki mpv sürümü, borusunu yalnızca geçerli kullanıcıya kısıtlayan sürüm mü? Sabitleme (F0-06) sırasında doğrulanacak.
