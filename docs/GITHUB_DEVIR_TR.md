# Browser Core — modül ve kaynak rehberi

**Uygulama:** V1.0.14.0 · **Başlangıç planı:** BrowserPlan V1.0.1.0

Bu belge projenin parçalarını, genişletme noktalarını, değiştirilebilir bileşenleri ve kaynak deposunun kapsamını tanımlar.

## Başlangıç planıyla ilişki

[A1–A5 planı](browser-plan/PLAN.md), [mimari](browser-plan/ARCH.md) ve [UI–Core sözleşmesi](browser-plan/SOZLESME.md) temel alınır.

Electron + React + TypeScript ve Chromium `WebContentsView` mimarisi kullanılır. Nihai UI için Tailwind, veri katmanı için Neon PostgreSQL hedeflenir. DevShell basit CSS kullanır. Persona yalnız tema ve maskot sunumunu değiştirir; tarayıcı oturumunu yeniden oluşturmaz.

| Aşama | Uygulanan bölüm | Eksik bölüm |
| --- | --- | --- |
| A1 | Gerçek sayfa, main/preload ve React bağlantısı | — |
| A2 | Sekmeler, gezinme, yükleme ve kapanış yaşam döngüsü | — |
| A3 | Geliştirme session ayrımı, izin/popup/indirme politikaları | Gerçek kimlik sağlayıcısı; kapsam dışı indirme ve popup türleri |
| A4 | BrowserApi, gerçek ziyaret olayları ve HistorySink sınırı | Nihai UI, API/auth, Neon ve TOTP/kasa bağlantıları |
| A5 | Windows paketleme ve yerel testler | Farklı Windows/DPI ortamları ve tam entegrasyon doğrulaması |

Reklam filtresi, arka plan kaynak yönetimi ve ek tarayıcı araçları bu temelin üzerindeki genişletmelerdir. [Özellik ve eksik listesi](CORE_DURUM_TR.md).

## Hangi modüle ne eklenebilir?

| Bölüm | Mevcut işlev | Genişletme noktası |
| --- | --- | --- |
| `src/main/browser/controller.ts` | Browser durumunun ve komutların koordinasyonu | Yeni Core işlemlerinin sahiplik ve yaşam döngüsüyle bağlanması |
| `src/main/browser/tab-manager.ts` | Sekme, gezinme ve WebContents yaşam döngüsü | Sekme davranışları; gezinme ve kapanış senaryoları |
| `src/shared/contracts.ts` | BrowserApi, snapshot ve runtime girdi biçimleri | Yeni komut/veri alanlarının dar ve doğrulanan sözleşmesi |
| `src/preload/index.ts`, `src/main/ipc.ts` | Güvenilen UI–main bağlantısı | Yeni API'nin preload ve IPC uygulaması |
| `src/renderer/dev` | Geçici çalışan arayüz | Nihai React/Tailwind arayüzü, tema ve maskot |
| `src/main/browser/history.ts` | HistorySink ve bellek geçmişi | Yetkili backend API adaptörü; idempotent kayıt ve metadata güncellemesi |
| `src/main/browser/site-sessions.ts` | Session ve profil bağlamı | Gerçek kimlik sağlayıcısından gelen güvenilir bağlam |
| `src/main/browser/site-permissions.ts` | Desteklenen site izinleri | İzin politikası ve arayüz entegrasyonu |
| `src/main/browser/downloads.ts` | Onay, hedef, ilerleme ve iptal | Ek indirme türlerinin ayrı doğrulama ve testlerle desteklenmesi |
| `src/main/browser/ad-blocker.ts`, `ad-scriptlets.ts`, `filter-data` | Ağ/CSS/scriptlet filtresi | Liste güncelleme ve site uyumluluğu; lisans/hash kaydıyla |
| `resource-policy.ts`, `page-freezer.ts`, `renderer-watchdog.ts` | Arka plan yönetimi ve yanıt kontrolü | Ölçüme dayalı politika iyileştirmeleri |
| `tests`, `scripts` | Doğrulama, build ve paketleme | Yeni senaryo testleri ve ölçüm araçları |

Yeni bir UI komutu gerekiyorsa sıra: ortak sözleşme → runtime doğrulama → IPC sahiplik denetimi → main işlemi → preload → UI → hedefli test. Site içeriklerine genel IPC, SQL, shell veya script yürütme yetkisi açılmaz.

## Hangi parçalar değiştirilebilir veya çıkarılabilir?

| Parça | Yapılabilecek değişiklik | Korunacak bağımlılık |
| --- | --- | --- |
| DevShell görünümü | Nihai UI ile değiştirilebilir | BrowserApi, snapshot sıralaması, viewport/odak/modal anlaşması |
| A/B ve servis simülasyonu kontrolleri | Ürün arayüzünden kaldırılabilir | Gerçek kimlik ve veri adaptörü; testlerdeki izolasyon senaryoları |
| MemoryHistorySink | Backend adaptörüyle değiştirilebilir | İptal, hata, eventId tekilleştirme ve metadata davranışı |
| Yerel test sayfası | Ürün dağıtımından ayrılabilir | Main başlangıcı ve build fixture bağlantıları birlikte düzenlenmeli |
| Bilgi panelinin görünümü | Taşınabilir veya yeniden tasarlanabilir | İzin/indirme onayları ve hata durumlarına erişim |
| Ölçüm ve benchmark araçları | Ayrı geliştirme paketi olarak tutulabilir | Ürün runtime'ına eklenmeleri gerekmez |
| Reklam filtresi | Ayrı seçenek veya modül olarak düzenlenebilir | Session hook'ları, debugger/CSS temizliği ve lisans kaynakları |

Sandbox, context isolation, uzak sayfa–uygulama ayrımı, IPC girdi/sahiplik kontrolü ve kapanış temizliği bir görünüm değişikliğinin parçası olarak kaldırılmaz.

## Kaynak deposuna dahil edilenler

- `src`: Core, preload, ortak sözleşmeler, DevShell ve filtre kaynakları.
- `tests`: fixture'lar, birim, Electron ve paket testleri.
- `scripts`: build, paketleme, kaynak denetimi ve isteğe bağlı tanı araçları.
- Package/lock, sürüm ve build/test yapılandırmaları.
- Proje README'leri, bu rehber, mevcut durum, teknik plan/sözleşme ve doğrulama özetleri.
- Üçüncü taraf bildirimleri ve lisans metinleri.

[Dosya envanteri](GITHUB_DOSYA_LISTESI.json) bu kapsamı dosya/boyut/SHA düzeyinde listeler.

## Kaynak deposuna dahil edilmeyenler

- `node_modules`, `out`, cache, test çıktıları ve ham ölçüm kayıtları.
- EXE, runtime klasörleri, ZIP ve diğer dağıtım çıktıları.
- Sırlar, gerçek profiller, cookie/depolama, DB yedekleri ve özel anahtarlar.
- Makineye özel ayarlar, araç yönergeleri ve yerel çalışma günlükleri.
- Teknik proje dokümanı yerine geliştirme oturumu geçmişi içeren arşiv raporları.

Derlenmiş filtre verisi `engine.bin`, onu üreten listeler ve scriptlerle birlikte kaynak kapsamındadır. Gerekli runtime dosyaları ayrı Windows dağıtım paketinde bulunur.

## Sonraki geliştirme sırası

1. Nihai UI'ı BrowserApi'ye bağlamak; viewport, kısayol, modal ve tema davranışlarını doğrulamak.
2. Auth/API sözleşmesini tanımlayıp HistorySink backend adaptörünü eklemek.
3. Neon şema/migration, geçmiş ve yer imi uçlarını gerçek veriyle doğrulamak.
4. TOTP/kasa modülünü dar bir entegrasyonla bağlamak.
5. Kontrollü video CPU/RAM, farklı Windows/DPI ve uçtan uca testleri tamamlamak.

Ortak PostgreSQL parolası Electron/Vite/ASAR içine konmaz. `profileKey` tek başına kimlik veya yetki kanıtı değildir; sahiplik sunucuda doğrulanır.

Kalıcı profil/oturum, kalıcı offline sync, kapsamlı OAuth/popup, ek indirme türleri, tam eklenti sistemi ve otomatik güncelleme ayrı geliştirme başlıklarıdır. Mevcut [üçüncü taraf lisansları](third-party/adblock/NOTICE.txt) korunur; projenin kendi lisansı henüz tanımlanmamıştır.
