# Mimari

## Katmanlar

| Katman | Konum | Sorumluluk |
| --- | --- | --- |
| Main | `src/main` | Uygulama başlangıcı, pencere, IPC ve yaşam döngüsü |
| Browser | `src/main/browser` | Sekmeler, session, gezinme, politikalar ve kaynak yönetimi |
| Preload | `src/preload` | Güvenilen arayüze dar BrowserApi sunumu |
| Shared | `src/shared` | API/snapshot tipleri ve runtime doğrulama |
| DevShell | `src/renderer/dev` | Mevcut API için geçici React görünümü |

Browser durumu main sürecindedir. React komut gönderir ve snapshot gösterir. Tema/maskot değişimi WebContents veya session yeniden oluşturmaz.

## Güven sınırları

Uzak içerik ayrı, uygulama köprüsü olmayan WebContentsView içinde çalışır. Güvenilen UI preload'u siteye verilmez.

- `nodeIntegration=false`
- `contextIsolation=true`
- `sandbox=true`
- `webSecurity=true`
- `webviewTag=false`

IPC girdileri runtime'da doğrulanır. Sender/frame/origin ve sekme sahipliği kontrol edilir. Genel invoke, SQL, shell veya script yürütme yetkisi UI'a açılmaz. TLS/sandbox/CSP korumaları test kolaylığı için kapatılmaz.

## Görüntü yerleşimi

Mevcut kalıcı sekme/adres alanı84DIP'tir. Bilgi paneli açıkken272DIP ayırır; kapalıyken sayfa tam genişlik kullanır. Find çubuğu yalnız açıkken42DIP ekler.

Trusted UI gerçek DOM rect'ini setViewport ile bildirir. Main üst güven alanını korur ve native pencere sınırlarıyla kesiştirir. Fullscreen ayrı native yoldadır; modal açıkken site view gizlenir. Panel geçişi belgeyi yeniden yüklemez.

## Sekme ve session yaşam döngüsü

Session bağlamı main tarafından belirlenir. Aynı bağlamdaki sekmeler paylaşabilir; farklı bağlamlar ayrılır. Geliştirme kimliği gerçek auth değildir.

Geç gezinme/context olayları yeni state'e uygulanmaz. Sekme kapanınca WebContents ve abonelikler temizlenir. Sağlık kontrolü gerçek belge nesline bağlıdır; önceki belgenin kayıp yanıtı yeni sayfaya uyarı taşıyamaz.

## Kaynak yönetimi

Boş sekmeler site WebContents'i oluşturmaz. Statik uyutma ve dinamik dondurma; medya, etkileşim, ağ ve keep-awake korumalarına bağlıdır. Uygunluk taraması bütçelidir. Cache açıktır; discardable GPU görüntü/transfer cache bütçesi64MiB'dir. Bu toplam GPU süreç belleği sınırı değildir.

Politika değişiklikleri ölçümle değerlendirilir. Kapanan view/listener sayıları, heap, özel commit ve çalışma kümesi ayrı anlamlar taşır.

## Veri sınırı

`HistorySink`, bellek servisi ile gerçek backend arasında değişim noktasıdır. Gerçek servis kimliği doğrular ve kayıt sahipliğini sunucuda uygular. `profileKey` yetki kanıtı değildir. Ortak PostgreSQL parolası Electron/Vite/ASAR veya dağıtılan yerel backende konmaz.

TOTP/kasa Core'un içinde yeniden uygulanmaz; ayrı modül dar bir sözleşmeyle bağlanır. Sır, cookie, token veya hassas URL loglanmaz.

## Sürüm ve dağıtım

Görünür sürüm VMAJOR.MINOR.FEATURE.BUILD; npm sürümü geçerli üç bileşenli semver'dir. Kaynak deposu bağımlılık/runtime çıktılarından ayrıdır. Windows paketinde gerekli runtime dosyaları birlikte tutulur.
