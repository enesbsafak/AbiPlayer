# Oynatma açılışı: ölçüm ve mpv ayar denemeleri (F2-01, F2-03)

> **Bu sayılar gerçek bir IPTV sağlayıcısından değil, bu makinede çalışan sentetik yerel bir sağlayıcıdan (`e2e/mock-provider`) alınmıştır.** Canlı yayın, sağlayıcının kendi kurgusuyla akar: MPEG-TS bağlantısında ilk 1 saniyelik veri hemen, sonrası gerçek zamanlı gönderilir; HLS tek kaliteli, 2 sn'lik parçalarla gelir. Gerçek paneller bu bakımdan çok farklı davranabilir (ilk gönderilen veri miktarı, sunucu yanıt süresi, birden çok kalite, birden çok ses ve altyazı akışı). Aşağıdaki kazanımlar "bu düzenekte ölçüldü" demektir; gerçek sağlayıcıda ne kadar kazanılacağının ölçüsü değildir.

> Uygulama uçtan uca test kipinde çalıştı (`ABI_E2E=1`): pencere ekran dışında, etkinleştirilmeden, sessiz klipler ve kapalı sesle. Aynı makinede başka çalışma ağaçlarında aynı düzenek eşzamanlı koşuyordu; gürültü aşağıda ayrıca verildi.

## Ortam

- Tarih: 2026-11-15, 11:00–12:10 UTC
- Kod: `wp/d3` dalı (taban `94b79e3`), `electron-vite build` çıktısı
- Makine: AMD Ryzen 7 7800X3D, 16 mantıksal çekirdek, 31 GB bellek, Windows 10.0.26300
- Electron 45.3.2, Node 26.13.1, mpv v0.42.0-38-gbcde6b93c (sabitlenmiş yapı)
- Komut: `node e2e/perf/baseline.ts --only playback --playback-runs 6 [--no-throttled] [--wait-prewarm] --label <ad>`; ham zaman çizelgeleri `e2e/.output/perf/summary-<ad>.json`

## Yöntem

- Senaryolar taban ölçümüyle (`2026-11-15-taban.md`) aynı: HLS (Xtream) ve MPEG-TS (aynı katalogdan `output=ts` M3U) için soğuk ilk kanal ve iki sıcak kanal değişimi, film (MP4) açılışı; yerel ve kısıtlı (150 ms, 2 MB/s) bağlantı. Her tur ayrı bir uygulama açılışı. Yerelde 6 tur (sıcak değişimde 12 örnek), kısıtlıda 3 tur.
- "Tıklamadan oynamaya": tıklamadan, sayfanın içinden 40 ms'de bir okunan mpv durumunda yeni yayının konumunun ilk ilerlediği ana kadar (dış ölçüm, ortanca; parantez içinde en küçük–en büyük).
- Bu pakette kaybolan işaretler geri geldi (`perfMpvOpen`, `mpv:open-resolved`, `perfMpvSnapshot`) ve main tarafına mpv işaretleri eklendi (`src/main/mpv/session.ts`): `mpv:open`, `mpv:spawn`, `mpv:pipe-connected`, `mpv:session-ready`, `mpv:loadfile-sent`, `mpv:loadfile-replied`, mpv'nin kendi olayları `mpv:start-file`, `mpv:file-loaded`, `mpv:playback-restart` (ilk kare/ses). İşaretler yalnızca o yüklemeye ait olaylar için atılır.
- Gürültü: aynı kodla dört ayrı taban koşusunun (aynı saat içinde) ortancaları senaryo başına 20–40 ms oynadı (ör. HLS sıcak değişim 139–181 ms, MPEG-TS sıcak değişim 352–392 ms). Tek tek örneklerde, başka düzeneklerin yük bindirdiği anlarda 3–4 sn'lik aykırı değerler görüldü (kısıtlı bağlantıda). Bu yüzden 40 ms'nin altındaki farklar "fark yok" sayıldı.

## Bugünkü durum (önce)

Taban ölçümünden bu yana mpv önceden ısıtılıyor, `mpv --version` sondası kalktı, durum anket yerine olayla geliyor. Bu paketteki değişiklikler öncesi (ölçüm işaretleri eklenmiş hal), yerel bağlantı:

| Senaryo | Taban (sabah) | Şimdi | Şimdiki ortancaların aralığı (4 koşu) |
|---|---|---|---|
| HLS: soğuk ilk kanal | 638 ms | 535 ms (488–594) | 530–615 ms |
| HLS: sıcak kanal değişimi | 143 ms | 156 ms (136–190) | 139–181 ms |
| MPEG-TS: soğuk ilk kanal | 737 ms | 748 ms (739–793) | 743–770 ms |
| MPEG-TS: sıcak kanal değişimi | 385 ms | 392 ms (310–437) | 352–392 ms |
| Film (MP4) | 95 ms | 138 ms (90–143) | 122–140 ms |
| Kısıtlı: HLS soğuk / sıcak | 932 / 628 ms | 1.051 / 629 ms | |
| Kısıtlı: MPEG-TS soğuk / sıcak | 866 / 522 ms | 919 / 522 ms | |
| Kısıtlı: film | 519 ms | 548 ms | |

Not: "soğuk ilk kanal" ölçümünde tıklama, ön ısıtmadan (pencere gösterildikten ve sayfa yüklendikten 1,5 sn sonra) önce geliyor: 9/9 turda tıklama anında mpv süreci yoktu. Yani bu satır gerçek soğuk başlangıcı ölçüyor. Ön ısıtmanın beklendiği durum ayrı ölçüldü (aşağıda).

## Süre nereye gidiyor (önce, yerel, ortanca)

| Adım | HLS soğuk | HLS sıcak | TS soğuk | TS sıcak | Film |
|---|---|---|---|---|---|
| tıklama → `mpv:open` (rota, motor, IPC, TLS) | 57 ms | 27 ms | 55 ms | 29 ms | 38 ms |
| süreç başlatma → oturum hazır (`spawn` → `session-ready`) | 166 ms | – | 168 ms | – | – |
| oturum hazır → `loadfile` gönderildi | 81 ms | – | 78 ms | – | – |
| `loadfile` → `start-file` | 2 ms | 60 ms | 5 ms | 56 ms | 1 ms |
| `start-file` → `file-loaded` (akış sondalama) | 9 ms | 5 ms | **222 ms** | **218 ms** | 6 ms |
| `file-loaded` → `playback-restart` (ilk kare) | 192 ms | 17 ms | 201 ms | 55 ms | 39 ms |

- MPEG-TS'in HLS'ten yavaş olmasının nedeni tümüyle sondalama: `start-file` ile `file-loaded` arası TS'te 220 ms, HLS'te 5 ms. Varsayılanda lavf (`avformat_find_stream_info`) 5 sn'lik akış süresine kadar bakar; sağlayıcının ilk 1 sn'lik verisi bitince gerçek zamanlı gelen veriyi bekliyor.
- Sıcak değişimde `loadfile` ile `start-file` arası ~60 ms: mpv'nin önceki yayını kapatması (demuxer, ağ bağlantısı).
- İlk dosyada `file-loaded` → ilk kare ~190 ms: ilk video/ses çıkışının kurulması (ses aygıtı açılışı dahil). Ön ısıtılmış süreç ses aygıtı açmaz (bilinçli karar), bu yüzden bu süre ilk kanalda kalıyor.
- Oturum hazır ile `loadfile` arasındaki ~80 ms, kalıcı ayarların (ses, sessiz, altyazı biçemi) gönderilip yanıtlarının beklenmesi. Aşağıda denendi: yanıtları beklememek bu süreyi kaldırmıyor, mpv aynı işi `loadfile` yanıtından önce yapıyor.

## Denenen seçenekler

Her aday tek başına, aynı yapı üzerinde, başlatma argümanı olarak (`src/main/mpv/args.ts`) denendi; yerel bağlantı, 6 tur. Değerler tıklamadan oynamaya ortanca.

| Aday | HLS soğuk | HLS sıcak | TS soğuk | TS sıcak | Film | TS `start-file`→`file-loaded` | Karar |
|---|---|---|---|---|---|---|---|
| (değişiklik yok, taban koşuları) | 530–615 | 139–181 | 743–770 | 352–392 | 122–140 | 218–222 | |
| `--demuxer-lavf-analyzeduration=0.5` | 533 | 141 | **529** | **179** | 139 | **5** | **Tutuldu** |
| `--demuxer-lavf-analyzeduration=0.2` | 532 | 140 | 530 | 178 | 102 | 5 | 0,5 ile aynı kazanç; daha az güvenlik payı, alınmadı |
| `--demuxer-lavf-analyzeduration=1` | 531 | 179 | 722 | 394 | 100 | 218 | Kazanç yok (sağlayıcının 1 sn'lik ilk verisini aşınca yine bekliyor) |
| `--demuxer-lavf-probesize=500000` | 511 | 154 | 751 | 352 | 137 | 218 | Kazanç yok: bekleme bayt değil süre sınırından |
| `--demuxer-lavf-probe-info=nostreams` | 532 | 171 | 530 | 180 | 116 | 3 | analyzeduration kadar kazanç, ama sondalamayı tümden atlıyor (akış bilgisi hiç toplanmıyor); daha riskli, alınmadı |
| `--hls-bitrate=min` | 531 | 173 | 744 | 354 | 116 | 218 | Fark yok; sahte sağlayıcının HLS'i tek kaliteli, bu seçenek burada ölçülemez. Gerçekte en düşük kaliteyi seçtirir, alınmadı |
| Önbellek seçenekleri kaldırıldı (`--cache=yes`, `--cache-secs=30`, `--demuxer-max-bytes`, `--demuxer-max-back-bytes`) | 532 | 159 | 740 | 351 | 137 | 232 | Fark yok; açılışı geciktirmiyorlar, dayanıklılık için kaldı |
| Yeniden bağlanma seçenekleri kaldırıldı (`--stream-lavf-o=reconnect=…`) | 535 | 171 | 749 | 392 | 135 | 220 | Fark yok; dayanıklılık için kaldı |
| Kalıcı ayarların yanıtını beklemeden `loadfile` (`mpv-controller.ts`, soğuk başlangıç) | 532 | 137 | 537 | 164 | 139 | – | Fark yok: `loadfile` erken gidiyor ama yanıtı ~70 ms sonra geliyor, mpv ayarları önce işliyor. Geri alındı |

`--network-timeout=30` açılışı etkileyemeyeceği için (yalnızca bağlantı kopunca devreye girer) ölçülmedi.

### Tutulan: `--demuxer-lavf-analyzeduration=0.5`

İz kaybı denetimi:

- Uçtan uca takımın tamamı her aday sonrasında değil, tutulan seçenekle koşuldu (öteki adaylar ölçümde kazanç göstermediği için takım koşusu bir karar değiştirmezdi). Takım geçti; MKV klibinin iki ses ve iki altyazı izi bulunuyor ve dil tercihi testi (`08-track-preferences`, F1-02/F1-41) geçiyor; canlı TS ve HLS senaryoları geçiyor.
- Elle, sabitlenmiş mpv ile, iki sesli bir MPEG-TS dosyasında: iki ses izi de dil etiketleriyle ve kodek bilgisiyle listeleniyor. İkinci ses izinin ilk paketi 3. saniyede başlayacak biçimde yapay olarak geciktirilince, 0,5 ile iz yine listeleniyor ve dili doğru, ama kodek ayrıntısı eksik kalıyor (`mp2` yerine `mp3`, kanal sayısı yok); seçildiğinde çalıyor. Varsayılanla (5 sn) ayrıntı tam. Canlı yayında bütün akışlar sürekli aktığı için, katılım anından sonraki yarım saniyede her akıştan paket gelir; bu durum yalnızca seyrek akışlarda (ör. yayının ortasında başlayan altyazı) beklenir.
- Ayar başlatma argümanı olarak bırakıldı: film yüklemelerinde ölçülebilir etkisi yok (MKV/MP4 izleri başlıkta bildirir), canlı/film ayrımı için yükleme başına seçeneğe gerek görülmedi.

## Sonra (bu paketin değişiklikleriyle)

Aynı saat içinde, `--demuxer-lavf-analyzeduration=0.5` ile:

| Senaryo | Bağlantı | Önce | Sonra |
|---|---|---|---|
| HLS: soğuk ilk kanal | yerel | 535 ms (488–594) | 532 ms (526–536) |
| HLS: sıcak kanal değişimi | yerel | 156 ms (136–190) | 137 ms (125–227) |
| MPEG-TS: soğuk ilk kanal | yerel | 748 ms (739–793) | **537 ms** (485–907) |
| MPEG-TS: sıcak kanal değişimi | yerel | 392 ms (310–437) | **164 ms** (128–220) |
| Film (MP4) | yerel | 138 ms (90–143) | 139 ms (97–145) |
| HLS: soğuk ilk kanal | kısıtlı | 1.051 ms (991–1.059) | 963 ms (950–996) |
| HLS: sıcak kanal değişimi | kısıtlı | 629 ms (555–652) | 622 ms (606–654) |
| MPEG-TS: soğuk ilk kanal | kısıtlı | 919 ms (868–959) | **695 ms** (659–713) |
| MPEG-TS: sıcak kanal değişimi | kısıtlı | 522 ms (478–609) | **307 ms** (267–351) |
| Film (MP4) | kısıtlı | 548 ms (518–554) | 545 ms (510–553) |

HLS ve film satırlarındaki farklar gürültü aralığında. Kısıtlı HLS soğuktaki 90 ms'lik fark 3 örnekten ve tek koşudan; kazanç diye okunmamalı.

### Ön ısıtma beklendiğinde ilk kanal

`--wait-prewarm` ile tıklama, ön ısıtılmış mpv oturumu hazır olduktan sonra yapıldı (gerçek kullanımın çoğu bu durum: kullanıcı ilk kanalı pencere açıldıktan 1,5 sn'den sonra seçer):

| Senaryo | Bağlantı | Önce | Sonra |
|---|---|---|---|
| HLS: ilk kanal, mpv önceden ısıtılmış | yerel | 269 ms (267–279) | 271 ms (266–314) |
| MPEG-TS: ilk kanal, mpv önceden ısıtılmış | yerel | 482 ms (472–494) | **269 ms** (266–274) |
| HLS: ilk kanal, mpv önceden ısıtılmış | kısıtlı | 780 ms | 735 ms |
| MPEG-TS: ilk kanal, mpv önceden ısıtılmış | kısıtlı | 654 ms | **483 ms** |

Ön ısıtma ilk kanaldan ~265 ms kazandırıyor (gerçek soğuk 535 ms'ye karşı 270 ms). Kalan sürenin büyük kısmı ilk dosyada video ve ses çıkışının kurulması (~190 ms).

## Canlı yayın biçimi kararı (F2-04)

Bu ölçümlerle mpv için MPEG-TS'in HLS'ten hızlı olduğuna dair açık bir neden çıkmadı: ayardan sonra TS sıcak değişim 164 ms, HLS 137 ms; soğuk ilk kanalda ikisi aynı. "Otomatik" bu yüzden bugünkü davranışı koruyor (hesap izin veriyorsa HLS).

## Bu düzeneğin gösteremedikleri

- Gerçek panellerde ilk gönderilen veri miktarı ve sunucu gecikmesi farklıdır; sondalama kazancı ilk verinin yarım saniyeden kısa olduğu panellerde daha küçük olur.
- Çok kaliteli HLS (`hls-bitrate`), çok sesli ve altyazılı canlı TS, şifreli veya yönlendirmeli adresler burada yok.
- Ekran dışı pencerede kompozisyon ve GPU zamanlaması görünür pencereden biraz farklı olabilir; "ilk kare" `playback-restart` olayıdır, ekranda görülen kare değil.
