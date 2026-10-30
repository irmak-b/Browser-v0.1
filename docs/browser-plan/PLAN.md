# Geliştirme planı

BrowserPlan V1.0.1.0'ın A1–A5 aşamaları temel alınır. Mevcut uygulama V1.0.14.0'dır.

## A1 — Gerçek sayfa ve uygulama bağlantısı

Main/preload/React katmanlarını bağlamak; uzak sayfayı ayrı WebContentsView içinde açmak; başlık/yükleme/hata durumunu göstermek.

**Durum:** Uygulandı. Uzak sayfaya Node veya uygulama köprüsü verilmez.

## A2 — Sekmeler ve gezinme

Sekme açma/seçme/kapatma, adres girişi, geri/ileri, yenileme/durdurma, native yaşam döngüsü ve geç olay korumaları.

**Durum:** Uygulandı. Sekme kapandığında WebContents ve abonelikler temizlenir.

## A3 — Oturum ve dış etkileşimler

Bağlamlar arası session ayrımı; izin, popup, dış protokol ve indirme politikaları.

**Durum:** Geliştirme bağlamları ve desteklenen akışlar uygulandı. Gerçek kimlik sağlayıcısı ve kapsam dışı popup/indirme biçimleri ayrı entegrasyon gerektirir.

## A4 — UI ve gerçek veri servisleri

BrowserApi'yi nihai arayüze bağlamak. Başarılı main-frame ziyaretlerini HistorySink üzerinden yetkili veri servisine aktarmak; eventId ile tekilleştirmek; metadata güncellemelerini aynı kayda uygulamak.

**Durum:** API ve bellek adaptörü var. Nihai UI, auth/API/Neon ve TOTP/kasa bağlantıları eksik.

## A5 — Doğrulama ve dağıtım

Hata/kapanış/resize/odak/servis kesintisi senaryolarını doğrulamak; sürüm, lisans ve Windows dağıtımını hazırlamak.

**Durum:** Yerel testler ve Windows paketi var. Farklı Windows/DPI ve gerçek veriyle uçtan uca entegrasyon doğrulaması eksik.

## Core genişletmeleri

Temel planın üzerine reklam filtresi, hafif boş sekmeler, korumalı arka plan yönetimi, cache, sayfa araçları, sekme sesi/geri açma, sağ tık menüsü ve kompakt kabuk eklendi.

## Sonraki teslimler

| Sıra | Teslim | Çıkış ölçütü |
| --- | --- | --- |
| 1 | Nihai UI adaptasyonu | Mevcut BrowserApi ile gezinme; doğru viewport, modal ve odak |
| 2 | Auth ve HistorySink API adaptörü | Kimlik/sahiplik, iptal, hata ve idempotency doğrulaması |
| 3 | Neon veri işlemleri | Gerçek geçmiş/yer imi kaydı ve erişim ayrımı |
| 4 | TOTP/kasa bağlantısı | Dar yetki sınırı ve test verileriyle doğrulama |
| 5 | Sistem ve performans doğrulaması | Kontrollü CPU/RAM, Windows/DPI ve ortak uçtan uca test |

Kalıcı profil, offline sync, tam eklenti sistemi, kapsamlı OAuth/popup ve otomatik güncelleme sonraki ürün kapsamlarıdır.

[Mimari](ARCH.md) · [Sözleşme](SOZLESME.md) · [Test planı](TEST.md)
