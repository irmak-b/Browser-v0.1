# Browser Core

Electron, React ve TypeScript tabanlı masaüstü tarayıcı çekirdeği. Chromium sayfaları ayrı `WebContentsView` içinde çalışır.

**Sürüm:** V1.0.14.0 · **Temel plan:** BrowserPlan V1.0.1.0

## Mevcut özellikler

- Çoklu sekme; adres ve Google araması; geri/ileri, yenileme ve durdurma.
- Kapatılan sekmeyi geri açma, sekme sesi ve susturma.
- Sayfada arama, yakınlaştırma, sağ tık menüsü ve video tam ekranı.
- Site izinleri, kontrollü popup ve boyut onaylı indirme.
- Ağ, CSS ve scriptlet tabanlı reklam filtresi.
- Hafif boş sekmeler, korumalı uyutma/dondurma ve önbellek.
- Kompakt sekme/adres alanı ve açılıp kapanabilen Bilgi paneli.

## Proje durumu

Browser Core ve geçici DevShell çalışır. Geçmiş servisi bellekte tutulur. Nihai React/Tailwind arayüzü, gerçek kimlik doğrulama, backend API, Neon PostgreSQL ve TOTP/kasa entegrasyonları henüz tamamlanmamıştır.

## Belgeler

- [Modüller, ekleme/değiştirme noktaları ve kaynak kapsamı](docs/GITHUB_DEVIR_TR.md)
- [Özellikler ve eksikler](docs/CORE_DURUM_TR.md)
- [Başlangıç planı ve aşamalar](docs/browser-plan/PLAN.md)
- [Mimari](docs/browser-plan/ARCH.md)
- [UI–Core sözleşmesi](docs/browser-plan/SOZLESME.md)
- [Geliştirme ve çalıştırma](README_TR.md)
- [Test planı](docs/browser-plan/TEST.md) · [Sürüm doğrulaması](docs/validation/V1.0.14.0.md)

## Teknik sınırlar

Tarayıcı durumu main sürecindedir. React yalnız komut gönderir ve snapshot gösterir. Uzak sayfalar Node, SQL veya uygulama köprüsüne erişemez. Ortak PostgreSQL parolası istemciye gömülmez.

Filtre kaynakları ve [üçüncü taraf lisansları](docs/third-party/adblock/NOTICE.txt) korunur. Projenin kendi lisansı henüz tanımlanmamıştır.
