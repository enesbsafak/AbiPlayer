# Abi Player

Modern, hizli ve masaustu odakli bir IPTV oynatici.

**Surum:** `0.1.0-beta`  
**Durum:** Public Beta

Abi Player, Electron + React + TypeScript ile gelistirilmistir. Xtream Codes ve M3U kaynaklariyla calisir, MPV native playback ile daha stabil oynatma hedefler ve beta asamasinda aktif olarak gelistirilmektedir.

## Icerik

1. [Beta Uyarisi](#beta-uyarisi)
2. [Yasal Uyari ve Sorumluluk Reddi](#yasal-uyari-ve-sorumluluk-reddi)
3. [One Cikan Ozellikler](#one-cikan-ozellikler)
4. [Teknoloji Yigini](#teknoloji-yigini)
5. [Sistem Gereksinimleri](#sistem-gereksinimleri)
6. [Kurulum](#kurulum)
7. [Gelistirme Komutlari](#gelistirme-komutlari)
8. [Kullanim Akisi](#kullanim-akisi)
9. [Cache ve Loading Davranisi](#cache-ve-loading-davranisi)
10. [MPV Native Oynatma Notlari](#mpv-native-oynatma-notlari)
11. [TMDB Entegrasyonu](#tmdb-entegrasyonu)
12. [Guvenlik Notlari](#guvenlik-notlari)
13. [Bilinen Kisitlar](#bilinen-kisitlar)
14. [Yol Haritasi](#yol-haritasi)
15. [Katki](#katki)
16. [Lisans](#lisans)

## Beta Uyarisi

Bu surum **beta** oldugu icin asagidaki durumlar gorulebilir:

- Bazi saglayicilarda yavas ilk tarama
- Saglayiciya ozel API farklarindan kaynakli uyumsuzluklar
- Arayuzde duzeltilecek edge-case hatalari

Hata bildirimi ve geri bildirimler public beta sureci icin kritik onemdedir.

## Yasal Uyari ve Sorumluluk Reddi

Abi Player yalnizca genel amacli bir medya oynaticidir.

- Uygulama herhangi bir TV kanali, film, dizi veya canli yayin **saglamaz**, **satmaz**, **dagitmaz** ve **barindirmez**.
- Uygulama ile acilan tum icerikler, kullanicinin ekledigi ucuncu taraf kaynaklardan gelir.
- Kullanici, kullandigi tum kaynaklarin ve yayinlarin kendi ulkesindeki yasalara uygun oldugunu dogrulamaktan sorumludur.
- Telif hakki ihlali olusturabilecek kullanimlardan sadece kullanici sorumludur.
- Proje sahipleri/gelistiricileri, kullanicinin ekledigi kaynaklar veya oynattigi icerikler nedeniyle dogrudan ya da dolayli yasal sorumluluk kabul etmez.
- Uygulama "oldugu gibi" sunulur; belirli bir amaca uygunluk, kesintisiz calisma veya hatasizlik konusunda acik/ortulu garanti verilmez.
- Bu bildirim bilgilendirme amaclidir, hukuki danismanlik yerine gecmez.

## One Cikan Ozellikler

- Xtream Codes API destegi: Canli TV, Film (VOD), Dizi
- M3U/M3U8 iceri aktarma: URL veya yerel dosya
- MPV native playback (gomme) + HTML5/HLS fallback
- Coklu ses ve altyazi secimi
- Harici altyazi yukleme: SRT, VTT, ASS, SSA
- Altyazi gorunum ayarlari: boyut, renk, arka plan opakligi
- TMDB ile film/dizi detay zenginlestirme
- EPG (XMLTV) destegi
- Favoriler, arama, mini player, klavye kisayollari
- Kaynaklar acilis sirasinda otomatik yeniden baglanti
- Ilk tam tarama sonrasi oturum ici bellek cache davranisi

## Teknoloji Yigini

- Electron
- React 18
- TypeScript
- Zustand
- Tailwind CSS
- hls.js
- ffmpeg / ffprobe yardimci araclari

## Sistem Gereksinimleri

- Node.js: **20+** onerilir
- npm: **10+** onerilir
- Isletim sistemi:
  - Windows (aktif test edilen hedef)
  - macOS / Linux (build script mevcut, test kapsami daha sinirli)
- Internet baglantisi (kaynaklar ve metadata servisleri icin)

## Kurulum

```bash
git clone https://github.com/enesbsafak/freeiptv.git
cd freeiptv
npm install
```

## Gelistirme Komutlari

```bash
# Gelistirme (Electron + Renderer)
npm run dev

# Production build
npm run build

# Paketleme (hedef platforma gore)
npm run build:win
npm run build:mac
npm run build:linux
```

## Kullanim Akisi

1. Uygulamayi ac.
2. `Ayarlar` sayfasindan kaynak ekle:
   - Xtream Codes
   - M3U URL
   - M3U dosya
3. Ilk baglanti ve tarama tamamlanana kadar loading durumunu bekle.
4. Canli TV / Filmler / Diziler bolumlerinden icerik secip oynat.
5. Istersen TMDB API anahtari ekleyerek detaylari zenginlestir.

## Cache ve Loading Davranisi

- Ilk kaynak taramasi (ozellikle Xtream saglayicilarinda) zaman alabilir.
- Uygulama ilk taramada kategori ve icerikleri yuklerken loading state gosterir.
- Tarama tamamlandiktan sonra veriler uygulama acik oldugu surece bellekte tutulur.
- Kaynak silme/yenileme durumlarinda ilgili cache temizlenir ve tekrar tarama tetiklenir.

## MPV Native Oynatma Notlari

Abi Player, MPV'yi ayni pencereye gomerek kullanir. Bu sayede ayrik pencere olmadan native oynatma hedeflenir.

### MPV bulunamazsa ne olur?

- Uygulama MPV binary bulamazsa fallback akislari devreye girebilir.
- En iyi deneyim icin sistemde `mpv` kurulu olmalidir.

### Ozel MPV yolu tanimlama

Varsayilan olarak `mpv` PATH uzerinden aranir. Gerekirse `MPV_PATH` tanimlanabilir.

PowerShell ornegi:

```powershell
$env:MPV_PATH="C:\path\to\mpv.exe"
npm run dev
```

## TMDB Entegrasyonu

- TMDB API key veya bearer token ayarlardan girilebilir.
- Film/dizi aciklamalari, cast, poster/backdrop ve bolum detaylari zenginlestirilir.
- Uygulama dili ve TMDB sorgu dili su an Turkce odakli ayarlidir (`tr-TR`).

## Guvenlik Notlari

- Xtream kimlik bilgileri renderer localStorage icinde duz metin olarak tutulmaz.
- Kimlik bilgileri preload/main katmani uzerinden guvenli saklama akisina tasinir.
- Harici link acma ve navigasyon tarafinda temel guvenlik kontrolleri uygulanir.

## Bilinen Kisitlar

- Buyuk IPTV saglayicilarinda ilk tarama suresi uzun olabilir.
- Saglayici API kalitesine bagli olarak bazi kategoriler eksik donebilir.
- MPV davranisi platforma gore degisiklik gosterebilir.
- Public beta surecinde UI/UX ve performans ince ayarlari devam etmektedir.

## Yol Haritasi

- Disk tabanli kalici cache (uygulama yeniden acilisinda hizli geri donus)
- Daha guclu hata raporlama ve telemetri secenekleri
- Gelismis provider uyumlulugu ve fallback stratejileri
- Arayuz ve erisilebilirlik iyilestirmeleri
- Daha net onboarding ve ilk kurulum deneyimi

## Katki

Katki ve geri bildirim icin:

1. Issue ac
2. Repro adimlarini net yaz
3. Munkunse ekran goruntusu/log ekle
4. PR gondermeden once local build al

Basit katkida genel akis:

```bash
git checkout -b feat/your-change
# degisikliklerini yap
npm run build
git commit -m "feat: your change"
git push origin feat/your-change
```

## Lisans

MIT
