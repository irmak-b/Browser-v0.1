# UI–Browser Core sözleşmesi

**ProtocolVersion:** 1. Asıl tip kaynağı [contracts.ts](../../src/shared/contracts.ts) dosyasıdır. Sabit komut köprüsü [preload](../../src/preload/index.ts) üzerinden sunulur.

## Komut grupları

| Alan | API |
| --- | --- |
| Durum | getState, onStateChanged |
| Sekme | openTab, activateTab, closeTab, restoreClosedTab |
| Gezinme | navigate, goBack, goForward, reload, stop |
| Yerleşim/odak | setViewport, onFocusAddress, onFocusFind |
| Sayfa | openFind, findInPage, closeFind, zoom |
| Ses | setTabMuted |
| Politikalar | setAdBlocking, resetSitePermissions, setTabKeepAwake |
| İndirme | approveDownload, cancelDownload, onDownloadChanged |
| Kurtarma | forceCloseUnresponsive, exitFullscreen |
| Tanı | getResources |
| Geliştirme | switchDevelopmentIdentity, setDevelopmentTheme, setDevelopmentHistoryMode, retryHistory |

Geliştirme kimlik/tema/servis simülasyonu yöntemleri gerçek auth değildir; ilgili kontroller paketli üretim akışında kapalıdır.

## Sonuç ve snapshot

Komut sonucu requestId, contextEpoch ve ok alanlarını taşır. Başarı data, hata errorCode/message içerir. Arayüz eski contextEpoch sonuçlarını uygulamaz.

Snapshot revision ile sıralanır. İlk getState yanıtı daha yeni bir olayın üzerine yazamaz. Arka plan sekmesi adres alanını değiştiremez. Dinleyici kayıtları kaldırılabilir unsubscribe işlevi döndürür.

## Viewport, modal ve odak

Viewport görünürlük, x/y/width/height ve artan revision içerir. Sonuç native Bounds değeridir. Girdiler güvenli tam sayı ve pencere sınırları içinde doğrulanır.

Mevcut kalıcı üst sınır84DIP; isteğe bağlı panel272DIP, find satırı42DIP'tir. Nihai UI bu ölçüleri main ile birlikte güncellemelidir. CSS değişikliği tek başına main güven alanını değiştirmez. Modalda native sayfa gizlenir; kapanışta odak doğru kontrole döner.

## Geçmiş adaptörü

[HistorySink](../../src/main/browser/history.ts) iki işlem tanımlar:

- recordVisit(visit, signal)
- updateVisitMetadata(profileKey, eventId, title, signal)

PageVisit; eventId, profileKey, navigationToken, url, title, visitedAtUtc, source ve developmentFixture alanlarını içerir.

Başarılı main-frame tamamlanması bir ziyaret üretir. Redirect final sayfada tek kayıttır. Geri/ileri/reload ayrı tamamlanan gezinmeler olarak kaydedilir. İptal/başarısız/kapanan gezinme kaydedilmez. Aynı-belge hash/SPA değişimi yeni ziyaret oluşturmaz; geç başlık aynı eventId'yi günceller.

API adaptörü; iptal, offline/timeout/401/403, eventId tekilleştirme ve kayıt sahipliğini doğrulamalıdır. Bellek kuyruğu kalıcı sync değildir.

## Güvenlik ve genişletme

Yeni API önce tip ve runtime doğrulamasına, sonra main/preload uygulamasına eklenir. Kimlik, session/partition veya sahiplik UI tarafından keyfî belirlenmez. Uzak sayfalara BrowserApi açılmaz.
