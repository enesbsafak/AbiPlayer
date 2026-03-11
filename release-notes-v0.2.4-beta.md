Abi Player v0.2.4-beta (Public Beta)

Bu sürümde sürüm görünürlüğü ve player dönüş deneyimi üzerine odaklandık. Özellikle içerik izledikten sonra geri döndüğünüzde sayfa bağlamının korunması iyileştirildi.

Öne Çıkanlar
- Uygulama içindeki sürüm etiketi artık sabit yazıdan değil, doğrudan paket sürümünden geliyor
- Live TV, Filmler ve Diziler sayfalarında player dönüşünde kategori seçimi korunuyor
- Player dönüşünde arama metni korunuyor
- Film detayına geri dönüldüğünde liste bağlamı kaybolmuyor
- Dizi detayına geri dönüldüğünde seçili sezon bağlamı korunuyor

Arayüz ve Deneyim
- Geri dönüş sonrası tekrar geri basıldığında liste ekranı sıfırlanmıyor
- Aynı filtreye tekrar girildiğinde kategori seçimi gereksiz yere temizlenmiyor
- Sürüm etiketi Header, Sidebar, TitleBar ve ana sayfada tek kaynaktan besleniyor

Teknik ve Stabilite
- Renderer build sürecine package.json sürüm enjeksiyonu eklendi
- Playlist filter davranışı test ile güvence altına alındı
- Player dönüş state’i Live, VOD ve Series sayfalarında daha tutarlı hale getirildi

Bilinen Kısıtlar
- Bazı sağlayıcılarda ilk tam liste senkronizasyonu hâlâ zaman alabilir
- Sağlayıcı API ve CDN kalitesine bağlı olarak poster ve logo gecikmeleri devam edebilir
- Public beta olduğu için edge-case oynatma ve metadata hataları görülebilir

Yasal Not
Abi Player yalnızca bir oynatıcıdır; içerik sağlamaz, satmaz, dağıtmaz veya barındırmaz. Kullanılan kaynakların yasal uygunluğundan kullanıcı sorumludur.
