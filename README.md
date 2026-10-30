# Browser Core

Electron, React ve TypeScript tabanlı masaüstü tarayıcı çekirdeği. Chromium sayfaları ayrı `WebContentsView` içinde çalışır.

**Sürüm:** V1.0.14.0 · **Temel plan:** BrowserPlan V1.0.1.0

## Hızlı başlangıç

### Gereklilikler

Bu rehberde doğrulanan hedef **Windows x64**'tür.

| Araç | Gereklilik |
| --- | --- |
| [Node.js](https://nodejs.org/en/download) | **24 LTS** dalından **24.16.0 veya daha güncel bir 24.x** sürüm; projenin aralığı `>=24.16.0 <25` |
| npm | [Node kurulumuyla birlikte gelir](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/); projede kayıtlı referans sürüm **11.13.0** |
| [Git](https://git-scm.com/install/windows) | Klonlama, güncelleme ve değişiklik gönderme için |
| [PowerShell 7](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows) | Yalnız Windows paketleme/export komutları için; geliştirme penceresini açmak için gerekmez |

Node indirme sayfasında **24.x** dalını seçin. Kurulumdan sonra yeni bir terminal açıp `node --version`, `npm --version` ve `git --version` ile araçların erişilebilir olduğunu kontrol edin. Özel depolarda GitHub okuma erişimi de gerekir.

### İndir ve ilk kez çalıştır

CMD veya bir terminalde:

```shell
git clone --config core.autocrlf=false https://github.com/irmak-b/Browser-v0.1.git
cd Browser-v0.1
npm ci
npm run setup:electron
npm run dev
```

Klon komutundaki ayar, hash ile doğrulanan filtre dosyalarının satır sonlarını korur ve yalnız bu depo için geçerlidir.

Git yerine GitHub'da **Code → Download ZIP** ile de indirilebilir. ZIP'i tamamen çıkarın; `package.json` bulunan klasörde terminal açıp yukarıdaki **son üç komutu** çalıştırın. Git, daha sonra güncelleme ve katkı göndermek için kullanılabilir.

İlk kurulum npm bağımlılıklarını ve [Electron runtime'ını](https://www.electronjs.org/docs/latest/tutorial/installation) indirir; internet gerekir. React, TypeScript ve Electron proje bağımlılıklarıdır; ayrıca global kurulum gerekmez. Mevcut Core'u açmak için Neon hesabı, veritabanı kurulumu veya `.env` gerekmez.

Electron masaüstü penceresi açıldığında adres alanından gezinilebilir. **☰ → Test sayfasını aç** yerel kontrol sayfasını açar. Geliştirme terminalini açık tutun; durdurmak için terminalde **Ctrl+C** kullanın.

### Sonraki açılışlar

Proje klasöründe `npm run dev` yeterlidir. Git ile klonlanan kopyayı güncellemek için çalışma değişikliklerini önce kaydedip `git pull --ff-only` kullanın. `package-lock.json` değişmişse sırayla `npm ci` ve `npm run setup:electron` çalıştırın.

### Sık karşılaşılan durumlar

- **`npm.ps1` çalıştırılamıyor:** CMD kullanın veya npm komutlarını `npm.cmd ci`, `npm.cmd run setup:electron`, `npm.cmd run dev` şeklinde çalıştırın.
- **Electron çalışma dosyaları eksik:** `npm run setup:electron` komutunu tamamlayıp yeniden açın.
- **5173 portu kullanımda:** Bu projeye ait açık diğer geliştirme sunucusunu terminalinden kapatın; ardından yeniden başlatın.

## Modüller nereye eklenecek?

| Alan | Konum ve bağlantı |
| --- | --- |
| UI / Tailwind / tema / maskot | Mevcut örnek `src/renderer/dev/`; renderer giriş dosyası `src/renderer/index.html`. Nihai UI, `window.browser` API'sini tüketir |
| Backend / auth / Neon | Ayrı servis için `backend/` önerilir. Browser bağlantısı, `src/main/browser/history.ts` içindeki `HistorySink` adaptörü üzerinden kurulur |
| TOTP / kasa | Masaüstü modülü için `src/main/security/` önerilir; server tarafındaki MFA/auth işlemleri backend servisinde kalır. UI bağlantısı dar preload/IPC sözleşmesiyle yapılır |
| Browser Core | `src/main/browser/`, `src/preload/`, `src/shared/` ve ilgili `tests/` dosyaları |

`backend/` ve `src/main/security/` henüz mevcut değildir; yeni modüller için önerilen konumlardır. Yeni kaynak kökleri eklenince `scripts/build-github-inventory.mjs` ve ilgili build/export kapsamı da güncellenmelidir.

Modül çalışmaları için ayrı Git dalları kullanılması önerilir. Başlangıç sözleşmesi: [`src/shared/contracts.ts`](src/shared/contracts.ts). Ayrıntılı [modül ve değiştirme noktaları](docs/GITHUB_DEVIR_TR.md) rehberde açıklanır. Ortak DB parolası veya kasa sırları renderer'a eklenmez.

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
