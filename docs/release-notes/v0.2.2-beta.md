Abi Player v0.2.2-beta (Public Beta)

Bu patch surum, release surecini daha guvenli hale getirmek ve temel regression kontrolleri eklemek icin hazirlandi.

One Cikanlar
- Windows release, tag, asset yukleme ve latest.yml dogrulamasini tek komutta toplayan yeni release script eklendi
- GitHub release yayinlama akisinda tekrar kullanilabilir bir otomasyon hazirlandi
- Temel test paketi eklendi: player navigation, M3U parser, track preference ve Electron platform wrapper davranislari dogrulaniyor

Teknik Iyilestirmeler
- Vitest tabanli test calistirma altyapisi projeye eklendi
- Release script build artifact kontrolu, tag kontrolu ve legal note ekleme mantigi ile guclendirildi

Bilinen Kisitlar
- Auto update sadece paketli uygulamada calisir
- Release script, temiz bir surum akisi icin yeni versiyon/tag bekler

Yasal Not
Abi Player yalnizca bir oynaticidir; icerik saglamaz, satmaz, dagitmaz veya barindirmaz. Kullanilan kaynaklarin yasal uygunlugundan kullanici sorumludur.
