# FreeIPTV Player

Electron + React + TypeScript ile geliştirilmiş, modern dark theme IPTV oynatıcı.

## Özellikler

- **Xtream Codes API** desteği (Live TV, VOD, Diziler)
- **M3U/M3U8** playlist import (URL veya dosya)
- **HLS.js** tabanlı video oynatma
- **EPG** (Elektronik Program Rehberi) - XMLTV desteği
- **Audio track** seçimi (çoklu dil)
- **Altyazı** desteği (embedded + harici SRT/VTT/ASS)
- **VOD detay** sayfası (poster, açıklama, rating, oyuncular)
- **Dizi** desteği (sezon/bölüm listesi)
- **Favoriler** sistemi
- **Mini Player** (PiP)
- **Klavye kısayolları** (Space, F, M, ok tuşları)
- **HTTP ve HTTPS** sunucu desteği
- **Otomatik yeniden bağlanma** (kayıtlı sunucular localStorage'da saklanır)
- **Lazy loading** + virtualized grid (büyük kanal listeleri için OOM koruması)

## Kurulum

```bash
git clone https://github.com/enesbsafak/freeiptv.git
cd freeiptv
npm install
```

## Geliştirme

```bash
npx electron-vite dev
```

## Build

```bash
npx electron-vite build
```

Paketleme (platform için installer):
```bash
npm run build
```

## Tech Stack

| Teknoloji | Kullanım |
|---|---|
| Electron | Desktop shell |
| React 18 | UI framework |
| TypeScript | Tip güvenliği |
| Vite (electron-vite) | Build tooling |
| HLS.js | Video oynatma |
| Zustand | State management |
| Tailwind CSS | Styling (dark theme) |
| @tanstack/react-virtual | Büyük liste virtualization |
| fast-xml-parser | EPG (XMLTV) parsing |
| lucide-react | İkonlar |
| date-fns | Tarih formatlama |

## Proje Yapısı

```
src/
├── main/                  # Electron main process
├── preload/               # contextBridge API
└── renderer/src/
    ├── components/        # UI bileşenleri
    │   ├── auth/          # Login, playlist import
    │   ├── channels/      # Kanal listesi, grid, arama
    │   ├── epg/           # EPG grid, timeline
    │   ├── player/        # Video player, kontroller, altyazı
    │   ├── vod/           # Film kartları, detay
    │   ├── series/        # Dizi detay, sezon/bölüm
    │   └── ui/            # Button, Input, Modal, Spinner...
    ├── hooks/             # usePlayer, useEPG, useKeyboard...
    ├── pages/             # Sayfa bileşenleri
    ├── services/          # API client, parser'lar
    ├── store/             # Zustand slice'ları
    └── types/             # TypeScript tip tanımları
```

## Klavye Kısayolları

| Tuş | İşlev |
|---|---|
| `Space` / `K` | Oynat / Duraklat |
| `F` | Tam ekran |
| `M` | Sessiz |
| `←` / `→` | 10sn geri / ileri |
| `↑` / `↓` | Ses +/- |
| `Cmd+K` | Arama |

## Bilinen Sorunlar

- **Altyazı çekme problemi**: Bazı HLS stream'lerde embedded altyazılar tespit edilemiyor veya düzgün yüklenemiyor. HLS.js subtitle track detection mevcut ancak tüm provider'larda çalışmayabiliyor. Harici altyazı dosyası (SRT/VTT/ASS) yükleme çalışıyor.
- Bazı IPTV sağlayıcılarında kategori içerikleri karışabilir (provider API'sine bağlı).

## Lisans

MIT
