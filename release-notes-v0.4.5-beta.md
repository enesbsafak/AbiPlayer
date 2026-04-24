Abi Player 0.4.5-beta sürümü hazır.

Bu sürüm, canlı yayın izleme deneyimini kökünden sağlamlaştıran düzeltmelerin yanı sıra EPG'nin kaynak başına izole edilmesi, arka plan senkronlarının tamamlanma güvencesi ve tip güvenliğini build akışına bağlayan altyapı sertleştirmelerini içeriyor.

## Canlı Yayın Kararlılığı

- **"15 saniyede bir duruyor, 10 saniye sonra bağlanıyor" sorunu kaldırıldı** — Stall detection artık `time-pos` ilerlemesini değil MPV'nin kendi demuxer underrun bayrağını temel alıyor. Sağlıklı canlı yayınlarda (proxied TS, HLS segment sınırları, DVR'sız feed'ler gibi) time-pos sabit kalsa da false-positive reconnect tetiklenmiyor. Eşik de 12 saniyeye çekildi: yalnızca MPV'nin kendi reconnect mekanizması (5s × 2 deneme) başarısız olursa manuel reload devreye giriyor.
- **"Canlı" butonu işlevsel hale getirildi** — IPTV origin sunucularında gerçek seekable range olmadığı için seek tabanlı `jumpToLive` sessizce başarısız oluyordu; artık doğrudan `loadfile` ile stream yeniden yükleniyor. Canlı yayın duraklatılıp tekrar oynatıldığında da aynı reload yolu çalışıyor. UI tarafında kırmızı / outlined toggle ile "canlıdayım" ve "canlıya dön" durumları ayırt ediliyor.
- **MPV controller sadeleştirmesi** — Kullanımdan kalkan live-edge cache parser ve seek doğrulama gecikme sabitleri kaldırıldı.

## EPG

- **Kaynak başına EPG izolasyonu** — Store'a `epgSourceId` eklendi; EPG verisi hangi kaynağa ait olduğu bilinerek saklanıyor. Kaynak değiştirildiğinde eski EPG artık gösterilmiyor ve yeni kaynağın EPG'si otomatik fetch ediliyor. Yenileme kararı da buna göre alınıyor: kaynak değiştiğinde veri "bayat" kabul edilip hemen çekiliyor.
- **EPGGrid, NowPlaying ve EPGPage** — Üç bileşen de artık yalnızca aktif kaynağa ait EPG verisini gösteriyor; kaynak değişimi sırasında geçici yanlış veri görünümü riski ortadan kalktı.

## Arka Plan Senkronu

- **"Yüklendi" bayrağının erken işaretlenmesi düzeltildi** — LiveTV, VOD ve Seriler sayfalarında `ensureStagedSync(...)` fire-and-forget çağrılıyor, sync daha tamamlanmadan `loadedFullSourceCache.add(...)` ile başarı işaretleniyordu. Artık promise sonucu bekleniyor, hydration durumu doğrulandıktan sonra cache'e ekleniyor, her koşulda `isBackgroundSyncing` bayrağı temizleniyor ve paralel çağrıyı engellemek için `syncingFullSourceCache` takip listesi tutuluyor.

## Build ve Tip Güvenliği

- **`npm run build` artık typecheck'ten geçiyor** — Yeni `typecheck` scripti eklendi (`tsc -p tsconfig.node.json --noEmit` + `tsc -p tsconfig.web.json --noEmit`) ve `build` script'i buna bağlandı. Tip hatası varken kurulum paketi üretilemiyor.
- **tsconfig sertleştirmesi** — Node ve web config'lerine `target: ES2023` açıkça yazıldı, node config'e `lib: ["ES2023"]` eklendi, web config'in `rootDir` değeri repo köküne çekilerek preload ve shared type import'ları doğru çözüldü.
- **ffprobe-static tip shim'i** — `@types/ffprobe-static` paketi olmadığı için typecheck akışında hata veriyordu; `src/main/types/ffprobe-static.d.ts` içine yerel modül tanımı eklendi.

## Kod ve Bağımlılık Temizliği

- **IndexedDB depolama katmanı söküldü** — Kullanımda olmayan `src/renderer/src/services/storage.ts` (111 satır IDB wrapper) ve `idb` paketi kaldırıldı; persistence tamamen localStorage + safeStorage üzerinden yürüyor.
- **fast-xml-parser güncellemesi** — 5.5.10 → 5.7.1.
- **Kalite etiketi helper'ı** — `quality.ts` içinde `name` alanı olan kanal ve `title` alanı olan bölüm için ortak `getQualityTitle` yardımcısı eklendi; episode kalite çıkarımı artık doğru haystack üzerinden yürüyor.
- **Kullanılmayan import ve yardımcı temizliği** — `Category` (PlayerSidebar), `MpvTrackInfo` (preload), `settings/setVolume/setMuted` (usePlayer) ve `isBackgroundSyncing` (background-sync) kaldırıldı.
- **ffmpeg path null-check** — `extractEmbeddedSubtitle` içinde path'in darboğazda tekrar kontrol edilmesine gerek kalmayacak şekilde yerel `ffmpegExecutable` sabitine taşındı.

## IPC ve State

- **Yeni IPC kanalı `mpv-jump-to-live`** — Main, preload, platform service ve PlayerControls baştan uca bu kanala bağlandı.
- **`demuxerCacheDuration` player state'e eklendi** — `MpvStateSnapshot` ve `player-slice` aynı alanı taşıyor; ileride cache görünürlüğü için altyapı hazır.

## Notlar

- Bu release, Windows kurulum dosyasını, blockmap dosyasını ve latest.yml güncelleme bilgisini içerir.
