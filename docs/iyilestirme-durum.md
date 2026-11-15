# İyileştirme Planı: Uygulama Durumu

Plan: [iyilestirme-plani.md](iyilestirme-plani.md). Çalışma dalı: `iyilestirme` (yerel, push edilmedi).

Karar noktalarında plandaki öneriler uygulanıyor: dürüst mini oynatıcı kartı, kaynağa özel TLS onayı, yalnızca Windows, IndexedDB katalog önbelleği.

## İş paketleri

| Dalga | Paket | Kapsam | Durum |
|---|---|---|---|
| A | A1 Araçlar | F0-01..06, F0-08, F5-11 | Bitti (`6d5dedd`..`ba9925a`) |
| A | A2 Uçtan uca düzenek ve ölçüm | F0-07, F0-09, F2-01 | Birleştirildi |
| B | B1 mpv oturum modeli | F2-02, F2-03, F2-05, F2-14, F1-04..06, F1-16..18 | Birleştirildi |
| B | B2 Main süreç ve IPC | F3-06, F3-08, F1-27, F1-35, F1-36, F1-39, F2-11, F2-13 | Birleştirildi |
| B | B3 Oynatıcı hataları | F1-01..03, F1-07..11, F1-14 | Birleştirildi |
| B | B4 Servisler ve ayrıştırıcılar | F1-12, F1-13, F1-26, F1-28..30, F1-32, F1-37, F1-38, F1-41, F1-53, F1-55, F4-09 | Birleştirildi |
| B | B5 Arayüz | F1-21, F1-23..25, F1-33, F1-45, F1-46, F1-48, F1-50..52, F1-54 | Birleştirildi |
| C | C0 Ortak sözleşmeler | `PlaybackTarget`, `playbackId`, kalıcı durum geçiş çerçevesi, uçucu oynatma durumu, F1-15, F4-10 | Birleştirildi |
| C | C1 Oynatıcı mimarisi | F2-06..10, F2-12 | Birleştirildi |
| C | C2a Katalog çekirdeği | F4-01, F4-02, F4-06, F4-10, F1-15, F1-31, F1-42..44, F1-47, F1-49, F1-56 | Birleştirildi |
| C | C2b Ortak katalog sayfaları | F4-03, F4-07, F1-20, F1-22, F1-40 | Birleştirildi |
| C | C2d Açılış zinciri ve kaynak yaşam döngüsü | F4-06, F1-27, F1-31, F1-36, F1-43, F1-44, F1-56, F3-02 | Birleştirildi |
| C | C2c Worker, önbellek, EPG | F4-04, F4-05, F4-08, F1-34 | Birleştirildi |
| D | D1 Güvenlik | F3-01..03, F3-07 | TLS politikası birleştirildi; F3-02 C2d içinde |
| D | D2 Electron 45 ve paket | F3-04, F3-09, F5-07 | Birleştirildi (hls.js tembel yükleme D3te) |
| D | D3 Canlı biçim ve mini oynatıcı | F2-04, F2-15 | Birleştirildi |
| D | D4 Erişilebilirlik, metinler, temizlik | F5-01..06, F5-08, F5-09 | Bekliyor |
| D | D5 Testler ve belgeler | F5-10, F5-12, F3-10 | Bekliyor |
| E | Bağımsız inceleme ve son doğrulama | tümü | Bekliyor |

## Mimari kararlar

İkinci görüş için gpt-6-astra kullanılamadı (Codex oturumunun süresi dolmuştu); yerine planı görmeden kodu okuyan bağımsız bir inceleme alındı. Plana göre değişenler:

- **mpv durumu yama olarak değil, tam anlık görüntü olarak itilir** (F2-06). Her görüntü `sessionId`, `playbackId` ve `phase` taşır. Görüntü iki kez uygulanınca zarar vermez; yamalar sıra ve boşluk sorunu getirir.
- **Oynatma kimliğini (`playbackId`) renderer üretir** ve `open` ile gönderir; main bunu mpv'nin `playlist_entry_id` değeriyle eşler.
- **Oynatma ayarı (tuning) kalıcı niyet değil, yüklemeye aittir** (F2-05). Kalıcı olanlar: donanım çözme, ses aktarımı, altyazı stili, ses düzeyi, kenar boşluğu, tam ekran.
- **Katalog zustand dışında, normalleştirilmiş bir depoda tutulur**; alımı bir worker yapar ve IndexedDB'ye kuşak (generation) olarak yazar, bitince tek işlemde geçer. Ağır alanlar (dizi özeti, oyuncular) yalnızca detay açılınca yüklenir.
- **Önbellek tazelemesi kategori listesine değil, tam listenin `stream_id` ve kayıt özeti farkına dayanır** (F4-05).
- **Oynatma hedefi (`PlaybackTarget`) ortak bir tür olur**; adres yalnızca uçlarda (mpv, `<video>`, ffprobe) kurulur. İzleme geçmişi anahtarları adres olmaktan çıkar. Bu tür, kalıcı durum geçiş çerçevesi ve uçucu oynatma durumunun ayrılması, C dalgası başlamadan tek bir pakette (C0) yapılır; aksi halde oynatıcı ve katalog paketleri "aynı yayın" tanımında ayrışır.
- **M3U kimlikleri:** eski özet işlevi dondurulur; yeni şemaya ilk alımda eski kimlikten yeniye eşleme kurulup favoriler ve gizli kategoriler tek adımda taşınır.

## Günlük

- 2026-11-15: Dal açıldı, plan commit edildi (`c75266a`).
- 2026-11-15: A1 bitti. Lint 0 hata, 62 uyarı; 191 test geçiyor. mpv `20261111` sürümüne sabitlendi. Kalan denetim bulguları: Electron 40 (F3-04) ve electron-builder zincirindeki minimatch.
- 2026-11-15: B2, B3, B4, B5 `wp/int` dalında birleştirildi. Lint 0 hata (51 uyarı), 513 test geçiyor. Tüm test paketinde beş çalıştırmada bir kez tek bir test başarısız oldu ve yinelenmedi; kararsız test aranacak.
- 2026-11-15: gpt-6-astra'dan ikinci görüş alındı (Codex girişi yenilendi). Bağımsız incelemeyle aynı yönü destekledi; eklenenler: anlık görüntüde `seq` ve `loadId`, oynatma ayarı `playbackId` kapsamında, devam bayrağı yalnızca eşleşen yükleme hazırken tüketilir. `--force-window=no` önerisi alınmadı: pencere şeffaf, mpv yüzeyi yokken masaüstü görünürdü.
- 2026-11-15: B1 (mpv oturum modeli) birleştirildi; 567 test geçiyor. Gerçek mpv ile doğrulama uçtan uca düzenek gelince yapılacak.
- 2026-11-15: Kararsız EPG testi düzeltildi. C0 (oynatma kimliği, sürümlü kalıcılık, ertelenmiş yazım) birleştirildi; 641 test geçiyor. C1 ve C2a başladı. Uçtan uca testler artık sessiz ve ekran dışı modda çalışacak.
- 2026-11-15: A2 birleştirildi: sahte Xtream sağlayıcı, Playwright ile gerçek uygulamayı süren 7 senaryo dosyası, zaman damgaları, taban ölçüm raporu (docs/olcumler/2026-11-15-taban.md), paket duman testi. Testler ekran dışında ve sessiz çalışıyor. Plan K7 düştü: CORS başlığı göndermeyen panel sorunsuz çalışıyor.
- 2026-11-15: E1 birleştirildi. Uçtan uca paket birleştirilmiş kodda geçiyor: 19 testten 16'sı geçiyor, 3'ü hâlâ açık hata olarak işaretli (F1-20, F1-42, F1-43; C2 paketlerinde). Gerçek uygulamada ve gerçek mpv ile doğrulananlar: F1-01, F1-02, F1-03, F1-05, F1-06, F1-08 (klavye yarısı), F1-09, F1-21, F1-23, F1-29, F1-37, F1-41, F1-45, F1-55 ve soğuk başlangıçta durdurma.
- Yeni bulgu: oynatıcıdan "Geri dön" veya Escape dışında bir yolla çıkılınca (ör. Ctrl+K ile arama) oynatma askıya alınıyor ama mini kart görünmüyor. Düzeltme: kart `isPlaybackSuspended` iken gösterilsin (AppShell.tsx).
- 2026-11-15: C1 birleştirildi: mpv durumu artık olayla geliyor (anket yok), mpv açılışta ön ısıtılıyor, usePlayer 1160 satırdan 505'e indi ve modüllere bölündü, iki motor tek yeniden bağlanma politikası ve tek parça uzlaştırıcı kullanıyor. 726 birim testi ve 19 uçtan uca test (gerçek mpv) geçiyor. Mini kart artık her çıkış yolunda görünüyor.
- 2026-11-15: C2a birleştirildi: katalog zustand dışında indeksli depoda; kayıtlar kimlik bilgisi taşımıyor; yenileme ekleme yerine değiştiriyor ve geç kalan eşitleme sonucu düşürülüyor; favoriler anlık kayıtla kalıcı. 796 birim testi geçiyor; uçtan uca testlerde F1-42 düzeldi. 200 bin kayıt: dönüştürme 309 ms, yazma 44 ms, görünüm 9 ms, arama 5 ms. Davranış değişikliği: yetişkin içerik artık varsayılan olarak gizli (ayar kapalı).
- 2026-11-15: D1 birleştirildi: sertifika doğrulaması varsayılan olarak sıkı; kaynağa özel onay ve sertifika iğneleme; TMDB ve GitHub için güven verilemez; mpv ve ffmpeg doğrulamayla çalışıyor (mpv 0.42 libcurl ile Windows sertifika deposunu kullanabiliyor). 880 birim testi, 22 uçtan uca test (kendinden imzalı ve süresi dolmuş sertifikalı gerçek HTTPS sunucuya karşı, gerçek mpv ile) geçiyor. Kalan risk: kullanıcının onayladığı, süresi dolmuş veya adı uyuşmayan sertifikalarda mpv o yükleme için doğrulamasız çalışıyor; yönlendirme hedefleri ve HLS parçaları ayrıca denetlenmiyor.
- 2026-11-15: D2 birleştirildi: Electron 40 → 45.3.2 (npm audit: 0 yüksek, 12 orta; kalanlar yalnızca derleme araçlarında); ffmpeg-static ve ffprobe-static yerine tek, sabitlenmiş FFmpeg n9.0.2 (GPL, paylaşımlı); app.asar 72.4 → 2.5 MB; renderer paketi 2.63 → 1.31 MB; yalnızca Windows; MIT LICENSE dosyası; README güncel. 890 birim testi ve 22 uçtan uca test Electron 45 üzerinde geçiyor. Doğrulanmayanlar: CI'daki e2e işi (push yok), görünür pencerede şeffaflık, NSIS kurulumu.
- 2026-11-15: C2b birleştirildi: üç katalog sayfası ve iki ızgara tek yapıdan türüyor (1.672 → 307 satır; ortak kod 1.265 satır, klavye gezinmesi, durum şeritleri ve ayrıntı katmanı dahil); kategori seçimi tür başına; ayrıntı açılınca ızgara ve kaydırma konumu korunuyor; arama ertelenmiş ve gerçek eşleşme sayısını gösteriyor; kategori listesi ve oynatıcı kenar çubuğu sanallaştırıldı. 200 bin kayıtta arama tuş başına en fazla 24 ms, kaydırmada 33 ms üstü kare yok. 937 birim testi, 25 uçtan uca test geçiyor; açık kalan tek işaretli hata F1-43 (C2d).
- 2026-11-15: C2d birleştirildi: giriş ile ana sayfa yüklemesi paralel, her tür kendi ön izlemesi gelince çiziliyor, ana sayfa tembel değil; tüm istekler başarısızsa hata ve Yeniden Dene; başarısız kaynak geri çekilmeyle kendiliğinden yeniden deneniyor; yerel M3U dosyaları açılışta yeniden okunuyor; M3U adresleri güvenli depoda, izleme geçmişi ve favori kayıtlarında adres yok (kalıcı durum sürümü 3). 985 birim testi, 27 uçtan uca test geçiyor; işaretli açık hata kalmadı. Yavaş bağlantıda ilk içerik ~1,2 sn → ~0,87 sn.
- 2026-11-15: Üç bağımsız inceleme yapıldı (main süreç/IPC/TLS, oynatıcı, katalog/açılış/kalıcılık). Üçünün hükmü "kusurlarla geçer"; birleştirme hasarı bulunmadı. Bulgular: 2 yüksek (HTML5 motorunda canlı yayın donunca yeniden bağlanma tetiklenmiyor; ana sayfadaki "yeniden dene" düğmesi inen M3U listesini boşa düşürebiliyor), 6 orta (duraklatılmış canlı yayında TLS kararının yeniden denetlenmemesi, kimlik bilgisi maskelemede eksik biçim, HTML5'te yeniden bağlanınca ses parçası seçiminin kaybolması, arayüz yeniden yüklenince mpv'nin çalmaya devam etmesi, temiz kapanan canlı yayında yeniden bağlanmama, güvenli depo okunamazsa "sil ve yeniden ekle" yönlendirmesi) ve düşük önemde kalemler. Düzeltme paketleri: FA (maskeleme, medya işleri, sürüm betiği) başladı; kalanlar C2c ve D3 birleşince.
- 2026-11-15: FA (maskeleme, medya işleri, sürüm betiği düzeltmeleri) ve D3 birleştirildi. D3: mpv sondalama süresi kısaltıldı (MPEG-TS kanal değişimi 392 → 164 ms, ilk kanal 748 → 537 ms; HLS değişmedi, Otomatik ayarı HLS kaldı); canlı yayın biçimi ayarı; hls.js yalnızca gerektiğinde yükleniyor (oynatıcı paketi 588 → 56 kB); başlık çubuğu pencere durumunu yansıtıyor; deneysel köşe oynatıcı (varsayılan kapalı, görsel olarak doğrulanmadı). 1.070 birim testi, 31 uçtan uca test geçiyor.
- 2026-11-15: C2c birleştirildi: katalog indirme ve ayrıştırma web worker'da; IndexedDB önbelleği (kuşak + bildirim, tek işlemde yayın; M3U parçaları AES-256-GCM ile şifreli, anahtar güvenli depoda); açılışta önbellek, arkada tazeleme; sağlayıcı kapalıyken çevrimdışı kopya; EPG akışla ayrıştırılıyor, 50 MB sınırı kalktı, EPG sayfası sanallaştırıldı. Yavaş bağlantıda ikinci açılış: tam katalog 8,7 sn → 0,36 sn (50 bin), 31,7 sn → 0,62 sn (200 bin); eşitlemede uzun görev yok. 1.123 birim testi, 37 uçtan uca test geçiyor. Açık: worker'ın paketlenmiş uygulamada (app.asar içinden) yüklenmesi denenmedi.
- 2026-11-15: FB birleştirildi: oynatıcı incelemesinin dokuz bulgusu (M1, P1-P8) doğrulanıp testleriyle düzeltildi. Öne çıkanlar: HTML5 motorunda donan canlı yayın artık yeniden bağlanıyor; canlıya atlamada TLS kararı her yüklemede yeniden alınıyor; arayüz yeniden yüklenince mpv duruyor; temiz kapanan canlı yayın yeniden bağlanıyor; izleyicinin ses, altyazı ve harici altyazı dosyası seçimleri yeniden bağlanma, yeniden yükleme ve askıya alma boyunca korunuyor; paketlenmiş derlemede Electron'un varsayılan menüsü kaldırıldı. 1.155 birim testi, 39 uçtan uca test geçiyor.
- 2026-11-15: FC birleştirildi: katalog incelemesinin 16 bulgusu ele alındı (13'ü doğrulanıp düzeltildi, 3'ü EPG paketiyle zaten kapanmıştı) ve önbellek entegrasyonunun kalanı yapıldı. Öne çıkanlar: ana sayfadaki yeniden dene düğmesi inen M3U listesini artık boşa düşürmüyor; güvenli depo okunamazsa kaynak silinmeden bilgiler yerinde yeniden girilebiliyor; TMDB anahtarı güvenli depoda; localStorage'daki yedek kopyalar kimlik bilgisinden arındırılıyor; katalog sayfalarında çevrimdışı kopya şeridi; içe aktarma worker üzerinden. Varsayılan ses düzeyi ayarı kaldırıldı (hatırlanan ses düzeyiyle çelişiyordu). 1.197 birim testi geçiyor.
