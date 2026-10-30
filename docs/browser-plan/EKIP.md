# Modül sınırları ve entegrasyon çıktıları

| Modül | Mevcut sınır | Eklenmesi gereken bağlantı |
| --- | --- | --- |
| Browser Core | Main/browser/preload/shared ve browser testleri | Nihai UI ve yetkili veri adaptörleri |
| UI/persona | React görünümü, Tailwind, tema ve maskot | BrowserApi tüketimi, viewport/odak/modal davranışı |
| Backend/veri | Auth, yetkili API, Neon şema/migration, geçmiş ve yer imi | HistorySink uygulaması ve sunucu sahiplik kontrolü |
| Güvenlik | TOTP/kasa ve politika incelemesi | Dar yetkili bağlantı ve test senaryoları |

## UI bağlantısı

DevShell değiştirilebilir; BrowserApi sözleşmesi korunur. Tema/persona sunum değişikliğidir, session kimliği değildir. Maske veya panel native site alanının üzerine kontrolsüz bindirilmez.

## Veri bağlantısı

Backend sözleşmesi kimlik doğrulama, sahiplik, hata biçimi ve idempotency davranışını tanımlar. Veritabanı yönetici parolası istemciye verilmez. Geçmiş ve yer imi için gerçek veritabanı doğrulaması gerekir.

## Güvenlik bağlantısı

Core uzak sayfa izolasyonu ve politikaların motor içinde uygulanmasını sağlar. TOTP/kasa ayrı modüldür; Core sır üretme/çözme arayüzü açmaz.

## Entegrasyon çıktıları

- Nihai UI'dan çalışan sekme/gezinme ve modal akışı.
- Gerçek auth ile ayrılan kayıt sahipliği.
- Başarılı, iptal ve tekrarlanan ziyaretlerin doğru veritabanı karşılığı.
- Servis hatasında çalışmaya devam eden browser.
- Güvenlik modülü ve Windows paketinin uçtan uca testleri.
