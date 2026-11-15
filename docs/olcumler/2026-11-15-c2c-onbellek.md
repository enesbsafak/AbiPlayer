# C2c ölçümü: katalog işçisi ve disk önbelleği

> **Bu sayılar gerçek bir IPTV sağlayıcısından değil, bu makinede çalışan sentetik yerel bir sağlayıcıdan (`e2e/mock-provider`) alınmıştır.** Ağ gecikmesi ve bant genişliği yapaydır. Sayılar mutlak hız iddiası değil, aynı düzenekte önce ile sonranın karşılaştırmasıdır.

> Uygulama uçtan uca test kipinde çalıştı (`ABI_E2E=1`): pencere ekran dışında, etkinleştirilmeden gösterildi, ses kapalı.

## Ortam

- Tarih: 2026-11-15
- "Önce": `4828663` (C2c'nin tabanı, önbellek yok). "Sonra": `3d0e218` (C2c dalı).
- Makine: AMD Ryzen 7 7800X3D, 16 mantıksal çekirdek, 31 GB bellek, Windows 10.0.26300; Electron 45.
- Komut: `npx electron-vite build`, ardından `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON e2e/perf/catalog-cache.ts --label <etiket>` (her satır 3 tur). Ham zaman çizelgeleri `e2e/.output/perf-cache/<etiket>/` altına yazılır.

## Yöntem

- Her katalog boyutu ve bağlantı için bir kurulum açılışında Xtream kaynağı eklenir ve ilk tam eşitleme bitirilir. Ardından aynı profille sırayla soğuk ve sıcak açılışlar yapılır.
- **Soğuk:** açılıştan önce profilin `IndexedDB` dizini silinir (diskte katalog yok). **Sıcak:** bir önceki açılışın bıraktığı önbellekle. Önbelleği olmayan "önce" kodunda iki satır aynı şeyi ölçer.
- Süreler main sürecin başlangıcına göredir (`perfMark` zaman çizelgesi). Değerler ortanca; parantez içinde en küçük ve en büyük.
- **Ana sayfada ilk içerik:** `renderer:home-first-content`. **Tam katalog bellekte:** üç türün de tam listesinin bellekte olduğu ilk an, önbellekten (`cache:committed`) ya da sağlayıcıdan (`sync:done`) hangisi önce geldiyse. **Sağlayıcıdan taze liste:** üç türün de sağlayıcıdan gelen tam listesinin eklendiği an (`sync:done`).
- **Uzun görev:** renderer ana iş parçacığında 50 ms üstü görevler (Long Tasks API), ilk katalog işinin (önbellek okuması veya eşitleme) başlamasından son tam listenin eklenmesinden 500 ms sonrasına kadar.
- **Yığın:** tam eşitlemeden sonra DevTools protokolüyle çöp toplama yapılıp `Runtime.getHeapUsage` ile okunan renderer ana yalıtımının kullanılan yığını (işçinin yığını dahil değil; işçi iş bitince kayıt tutmaz).
- **IndexedDB:** açılış kapandıktan sonra profilin `IndexedDB` dizininin diskteki boyutu.
- Kısıtlı bağlantı: her yanıta 150 ms gecikme ve bağlantı başına 2 MB/s.

## Önce

| Katalog | Bağlantı | Açılış | n | Ana sayfada ilk içerik | Tam katalog bellekte | Sağlayıcıdan taze liste | Uzun görev (adet / toplam / en uzun) | Yığın (GC sonrası) | IndexedDB |
|---|---|---|---|---|---|---|---|---|---|
| medium (50.000) | yerel | soğuk | 3 | 267 ms (252–270) | 499 ms (492–526) | 499 ms (492–526) | 2 / 132 ms / 84 ms | 22,4 MB (22,4–22,5) | 0 MB |
| medium (50.000) | yerel | sıcak | 3 | 236 ms (230–240) | 480 ms (479–481) | 480 ms (479–481) | 1 / 91 ms / 88 ms | 22,5 MB (22,4–22,5) | 0 MB |
| medium (50.000) | kısıtlı (150 ms, 2 MB/s) | soğuk | 3 | 788 ms (677–791) | 8.662 ms (8.661–8.664) | 8.662 ms (8.661–8.664) | 0 / 0 ms / 0 ms | 22,6 MB (22,6–22,7) | 0 MB |
| medium (50.000) | kısıtlı (150 ms, 2 MB/s) | sıcak | 3 | 703 ms (697–711) | 8.692 ms (8.674–8.692) | 8.692 ms (8.674–8.692) | 1 / 86 ms / 85 ms | 22,7 MB (22,6–22,7) | 0 MB |
| large (200.000) | yerel | soğuk | 3 | 255 ms (250–257) | 1.086 ms (1.084–1.122) | 1.086 ms (1.084–1.122) | 2 / 297 ms / 153 ms | 72,8 MB (72,8–73,4) | 0 MB |
| large (200.000) | yerel | sıcak | 3 | 240 ms (238–244) | 1.080 ms (1.039–1.085) | 1.080 ms (1.039–1.085) | 2 / 304 ms / 156 ms | 73 MB (73–73,4) | 0 MB |
| large (200.000) | kısıtlı (150 ms, 2 MB/s) | soğuk | 3 | 853 ms (851–890) | 31.639 ms (31.608–31.731) | 31.639 ms (31.608–31.731) | 2 / 312 ms / 157 ms | 73,9 MB (73,8–73,9) | 0 MB |
| large (200.000) | kısıtlı (150 ms, 2 MB/s) | sıcak | 3 | 877 ms (867–894) | 31.668 ms (31.574–31.740) | 31.668 ms (31.574–31.740) | 3 / 646 ms / 330 ms | 73,8 MB (73,8–73,9) | 0 MB |

## Sonra

| Katalog | Bağlantı | Açılış | n | Ana sayfada ilk içerik | Tam katalog bellekte | Sağlayıcıdan taze liste | Uzun görev (adet / toplam / en uzun) | Yığın (GC sonrası) | IndexedDB |
|---|---|---|---|---|---|---|---|---|---|
| medium (50.000) | yerel | soğuk | 3 | 312 ms (292–315) | 792 ms (739–842) | 792 ms (739–842) | 0 / 0 ms / 0 ms | 24,7 MB (24,7–24,7) | 2,9 MB |
| medium (50.000) | yerel | sıcak | 3 | 323 ms (304–329) | 383 ms (362–393) | 769 ms (720–783) | 0 / 0 ms / 0 ms | 22,1 MB (22,1–22,1) | 2,9 MB |
| medium (50.000) | kısıtlı (150 ms, 2 MB/s) | soğuk | 3 | 723 ms (718–731) | 8.787 ms (8.778–8.841) | 8.787 ms (8.778–8.841) | 0 / 0 ms / 0 ms | 25 MB (25–25,3) | 2,9 MB |
| medium (50.000) | kısıtlı (150 ms, 2 MB/s) | sıcak | 3 | 309 ms (286–311) | 359 ms (333–360) | 8.198 ms (8.167–8.256) | 0 / 0 ms / 0 ms | 22,3 MB (22,2–22,4) | 2,9 MB |
| large (200.000) | yerel | soğuk | 3 | 320 ms (316–531) | 1.923 ms (1.917–3.333) | 1.923 ms (1.917–3.333) | 0 / 0 ms / 0 ms | 82,1 MB (82,1–82,2) | 11,7 MB |
| large (200.000) | yerel | sıcak | 3 | 392 ms (355–533) | 610 ms (599–873) | 1.791 ms (1.759–3.308) | 0 / 0 ms / 0 ms | 75,3 MB (75,3–76,8) | 11,7 MB |
| large (200.000) | kısıtlı (150 ms, 2 MB/s) | soğuk | 3 | 917 ms (914–931) | 32.246 ms (31.371–32.348) | 32.246 ms (31.371–32.348) | 0 / 0 ms / 0 ms | 82,7 MB (82,6–82,8) | 11,7 MB |
| large (200.000) | kısıtlı (150 ms, 2 MB/s) | sıcak | 3 | 367 ms (353–373) | 616 ms (551–652) | 31.645 ms (30.691–31.753) | 0 / 0 ms / 0 ms | 76,4 MB (75,6–77,4) | 11,7 MB |

## Sonuçlar

- **Sıcak açılışta tam katalog hemen bellekte.** Kısıtlı bağlantıda 50.000 öğede 8,7 sn yerine 0,36 sn, 200.000 öğede 31,7 sn yerine 0,62 sn. İçerik artık sağlayıcının hızına bağlı değil: kısıtlı bağlantıda ana sayfanın ilk içeriği 0,70 sn yerine 0,31 sn (50.000) ve 0,88 sn yerine 0,37 sn (200.000). Sağlayıcıdan taze liste arkadan gelir ve önbellekteki listenin yerine geçer.
- **Ana iş parçacığında uzun görev kalmadı.** Önce eşitleme sırasında 50.000 öğede 1–2, 200.000 öğede 2–3 uzun görev vardı (en uzunu 150–350 ms: JSON ayrıştırma ve kayıtlara dönüştürme). Sonra hiçbir turda 50 ms üstü görev yok; indirme, ayrıştırma, dönüştürme ve disk yazımı işçide, kayıtlar 4.000'lik parçalarla gelip görünmeden dizinleniyor ve tek adımda yerine konuyor.
- **Yerel (anında yanıt veren) sağlayıcıda soğuk açılış yavaşladı:** tam katalog 50.000 öğede 0,50 sn yerine 0,79 sn, 200.000 öğede 1,09 sn yerine 1,92 sn. Kayıtlar işçiden ana iş parçacığına kopyalanarak geliyor ve aynı anda önbelleğe yazılıyor; bu iş ana iş parçacığını bloke etmiyor ama toplam süreyi uzatıyor. Kısıtlı bağlantıda (ağın baskın olduğu, gerçeğe yakın durumda) fark %1–2, gürültü düzeyinde.
- **Yerel sağlayıcıda ana sayfanın ilk içeriği 70–150 ms geç** (sıcakta 236 → 323 ms, 240 → 392 ms): eskiden anında yanıt veren sağlayıcıdan küçük bir ön izleme çekiliyordu; şimdi ana sayfa önce önbelleğin okunmasını bekliyor ve tüm türlerin tam listesi IndexedDB'den geliyor. Gerçek sağlayıcılarda (kısıtlı satırlar) tersine ~0,4–0,5 sn erken.
- **Yığın (200.000 öğe):** soğukta 72,8 → 82,1 MB (+9 MB), sıcakta 73,0 → 75,3 MB (+2 MB). Kayıtların biçimi değişmedi; farkın kaynağı ayrıca incelenmedi (olasılıkla yapılandırılmış kopyayla gelen nesnelerin JSON'dan üretilenlerden farklı iç düzeni ve soğuk açılışta ön izleme ile tam listenin bir süre birlikte durması). İşçinin yığını sayılmadı; işçi bir işin kayıtlarını iş bitince bırakır.
- **Diskte:** 50.000 öğe 2,9 MB, 200.000 öğe 11,7 MB (Chromium'un IndexedDB'si LevelDB ile sıkıştırarak yazar).

## Yalnızca değişeni yazma

Xtream katalog sürümü vermediği için tazelemede tam liste yine indirilir; önbellek yalnızca değişen parçaları yazar. Kayıtlar içerikle belirlenen sınırlarda parçalara bölünür (en az 256, ortalama ~1.200, en çok 4.096 kayıt) ve parça anahtarı içeriğinin özetidir; diskte zaten bulunan anahtar yeniden yazılmaz. Sahte sağlayıcının `large` film listesiyle (110.000 kayıt, bellek içi arka uçla ölçüldü):

| Tazeleme | Parça (yazılan / toplam) | Yazılan kayıt |
|---|---|---|
| İlk yazım | 93 / 93 | 110.000 (260 ms, işçide) |
| Değişmemiş liste (sahte sağlayıcının her tazelemesi) | 0 / 93 | 0 (147 ms: özetleme ve karşılaştırma) |
| 500 kayıt silinip 1.000 kayıt eklendi | 2 / 91 | 4.425 (%4) |
| 2 kaydın puanı değişti | 5 / 92 | 5.023 (%5) |
| Kayıtların %1'i listeye dağılmış biçimde değişti | 92 / 92 | 110.000 |

Sahte sağlayıcı her seferinde aynı katalogu verdiği için ölçümlerdeki her sıcak açılış tazelemesi diske hiçbir parça yazmadı. Değişikliklerin listeye her yere serpiştirildiği durumda (son satır) kazanç yoktur; o durumda bedel ilk yazımınki kadardır ve işçide ödenir.

## Gürültü

Ölçümler sırasında makinede başka çalışma ağaçlarının uçtan uca testleri ve sahibinin işleri çalışıyordu. Aynı satırın üç turu arasındaki fark çoğunlukla 10–60 ms; büyük katalogda yerel bağlantıda tek bir tur 0,5–1,4 sn sapmış (ör. soğukta 1.917–3.333 ms, sıcak "taze liste"de 1.759–3.308 ms). Kısıtlı bağlantıdaki önce/sonra farkları ve uzun görev sayıları bu gürültünün çok üstünde; yerel bağlantıdaki 70–150 ms'lik ilk içerik farkı tutarlı ama küçük.

## Uçtan uca doğrulamalar (`e2e/tests/11-catalog-cache.spec.ts`)

- Sağlayıcı her yanıtı 20 sn geciktirirken ikinci açılışta katalog ~0,5 sn'de ekranda; zaman çizelgesinde üç türün `cache:committed` işareti var, hiçbir `sync:done` yok.
- Sağlayıcı kapalıyken önbellekteki katalog kullanılabilir; ana sayfada "çevrimdışı kopya gösteriliyor (… tarihinde güncellendi)" bildirimi ve "Tekrar dene".
- 63 MB'lık, 4.000 kanallı XMLTV (`url-tvg` ile) açılıştan ~1,4 sn sonra EPG sayfasında; DOM'da 14 satır; yükleme ve kaydırma sırasında ana iş parçacığında 50 ms üstü görev yok.
- 200.000 öğelik katalog 1,6 sn'de alındı; ana iş parçacığında 50 ms üstü görev yok.
