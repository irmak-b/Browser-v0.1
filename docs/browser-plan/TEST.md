# Test planı

## Test katmanları

| Katman | Kapsam |
| --- | --- |
| Unit | Runtime doğrulama, URL/IPC politikası, snapshot, kaynak/geçmiş mantığı |
| Electron | Gerçek WebContentsView, gezinme, izolasyon, izin/indirme, modal/odak, çöküş ve kapanış |
| Windows paket | Runtime bütünlüğü, çıkarılmış ZIP, dış Node/npm olmadan başlangıç, tek örnek |
| Entegrasyon | Nihai UI, gerçek auth/API/Neon ve TOTP/kasa |
| Ölçüm | Sabit yükte CPU/RAM, video kareleri, süreç ve kapanış sayımları |

## Temel doğrulama ölçütleri

- Site Node/uygulama köprüsüne erişemez; yanlış IPC sender/frame/origin reddedilir.
- Site viewport'u güvenilen UI alanını kapatamaz.
- Sekme kapanışı olayları ve WebContents sahipliğini temizler.
- Eski belge/context yanıtı yeni sekme durumunu bozmaz.
- Tema/panel değişimi aynı belge ve session'ı korur.
- İzin ve indirme kararları desteklenen politika içinde uygulanır.
- Servis hatası gezinmeyi durdurmaz; kaydedilmemiş veriye kaydedildi denmez.
- Ziyaretler eventId ile tekilleşir; geç başlık aynı kaydı günceller.
- Windows paketi gerekli runtime ve lisans dosyalarını içerir.

## Hedefli komutlar

```powershell
npm run typecheck
npm test
npm run build
node node_modules/@playwright/test/cli.js test tests/electron/compact-layout.spec.ts
node node_modules/@playwright/test/cli.js test tests/electron/popup-navigation.spec.ts
npm run test:packaged
```

Değişikliğin etkilediği senaryolar seçilir. Test fixture'ları gerçek hesap/profil/sır gerektirmez. Gerçek site performans ölçümü, kontrollü görünürlük ve sabit karşılaştırma koşulları gerektirir.

## Sonuçların kapsamı

Unit başarısı GUI veya gerçek veri entegrasyonu yerine geçmez. Forced device scale testi gerçek Windows OS DPI kabulü değildir. Özel commit, çalışma kümesi, GPU cache ve heap aynı sayaç değildir. Sonuçlarda sürüm, komut, exit code ve çalıştırılmayan kapsam ayrı belirtilir.

[V1.0.14.0 doğrulaması](../validation/V1.0.14.0.md).

V1.0.14.1 popup kontrolü; farklı kaynaklı sonuç bağlantısı/redirect, Enter ile target=_blank GET formu, orta tuş, kullanıcı tıklamasındaki window.open ve otomatik/güvensiz/çoklu popup reddini kapsar. [Doğrulama](../validation/V1.0.14.1.md).

V1.0.15.0 ayrıca bağlantıyla ilgisiz açılışı bekletme, bir kez açma, origin'e bağlı izin/iptal, reklam hedefi ve HTTP yönlendirmesi, eski karar reddi, sınırlı yoğun istek kaydı ve UI'a tam hedef taşımama senaryolarını kapsar. Renderer yanıt vermediğinde intent denetimi süre sınırında reddeder. [Doğrulama](../validation/V1.0.15.0.md).

V1.0.15.1; ilk yüklemede yanıt vermeyen/değişen DOM, GET araması, gerçek script düğmeleri, küçük fare hareketi ve açık shadow-DOM denetimlerini kapsar. Olumsuz niyet ile yanıt alınamaması ayrılır; yeni uyumluluk yolu eski reklam/otomatik açılış korumalarıyla birlikte doğrulanır. [Doğrulama](../validation/V1.0.15.1.md).

V1.0.15.2; action'sız role=search GET başlatıcısını, sorgusuz hizmet açılışını, Enter/düğme gönderimini ve bu formdaki reklam hedefi reddini kapsar. Açık farklı action, sıradan metin formu ve POST yöntemi kapsamı genişletmez. [Doğrulama](../validation/V1.0.15.2.md).
