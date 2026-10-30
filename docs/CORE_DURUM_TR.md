# Özellikler ve eksikler

**Uygulama:** V1.0.14.0

| Alan | Mevcut kapsam |
| --- | --- |
| Sekme ve gezinme | Aç/seç/kapat, geri/ileri, adres/Google araması, durdur/yenile ve klavye kısayolları |
| Sekme geri açma | Son 10 kapalı adres ve mute tercihi; kapalı sayfa süreçleri tutulmaz |
| Ses | Native ses etkinliği göstergesi ve sekme başına mute; sessiz sayfada simge yok |
| Sayfa araçları | Arama, eşleşmeler, yakınlaştırma ve sağ tık menüsü |
| Video | Native tam ekran, kısa Esc bildirimi ve çıkış |
| İzinler | Desteklenen ana HTTPS sayfaları için kamera/mikrofon/konum/bildirim kararı |
| Popup ve indirme | Kontrollü yeni sekme; bilinen boyutlu GET, boyut onayı, hedef, ilerleme ve iptal |
| Reklam filtresi | Ağ/CSS/scriptlet ve site tercihi; bütün reklamlara karşı garanti yok |
| Kaynak yönetimi | Hafif boş sekmeler, korumalı uyutma/dondurma, cache ve kapanış temizliği |
| Hata yönetimi | İptal/geç olay koruması, çöküş ve uzun donma uyarısı/toparlanma |
| Arayüz | 84DIP sekme/adres alanı, isteğe bağlı 272DIP Bilgi paneli |
| Geçmiş | Gerçek main-frame olayları, eventId tekilleştirme ve bellek servisi |
| Dağıtım | Ayrı Windows klasör/ZIP paketi ve yerel paket testleri |

## Tamamlanmamış entegrasyonlar

- Nihai React/Tailwind arayüzü ve persona sunumu.
- Gerçek auth, backend API ve Neon PostgreSQL bağlantısı.
- Kalıcı geçmiş ve yer imi veri işlemleri.
- TOTP/kasa modülü.
- Farklı Windows/gerçek DPI ortamlarında doğrulama.
- Kontrollü ön plan video CPU/RAM karşılaştırması.

## Bilinen sınırlar

Bellek geçmişi uygulama kapanınca silinir. Geliştirme A/B ayrımı gerçek auth değildir. Tam OAuth/opener, bütün indirme türleri, kalıcı offline sync ve tam eklenti sistemi desteklenmez.

Aralıklı YouTube oynatıcı durmasının nedeni kesinleşmemiştir; sonraki sınırlı denemelerde tekrarlanmaması genel çözüm kanıtı değildir. Sabit yükteki GPU bellek platosu da bütün sitelerde sızıntısızlık garantisi vermez. V1.0.14.0 için genel CPU/RAM üstünlüğü ölçülmemiştir.

[Modül ve genişletme rehberi](GITHUB_DEVIR_TR.md) · [Plan](browser-plan/PLAN.md) · [Sürüm doğrulaması](validation/V1.0.14.0.md)
