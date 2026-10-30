# Geliştirme ve çalıştırma

## Teknoloji

Electron45.0.0, React19.3.1 ve TypeScript7.0.2 kullanılır. Node24.16.0 ve npm11.13.0 kayıtlı geliştirme sürümleridir. Bağımlılık sürümleri `package.json` ve `package-lock.json` içinde sabittir.

## Kaynaktan çalıştırma

Komutlar depo kökünde çalıştırılır:

```powershell
npm ci
npm run setup:electron
npm run dev
```

Bağımlılık ve Electron kurulumu ağ kullanır. Mevcut runtime yeniden kurulmadan kullanılabilir. Geliştirme için gerçek veritabanı veya hesap bilgisi gerekmez.

## Kontroller

```powershell
npm run typecheck
npm test
npm run build
```

Hedefli Windows arayüz testi:

```powershell
node node_modules/@playwright/test/cli.js test tests/electron/compact-layout.spec.ts
```

GUI testleri geçici uygulama örnekleri açar. Gerçek site/video ve benchmark araçları ayrı ölçüm senaryolarıdır.

## Windows paketi

```powershell
npm run build
npm run package:windows
npm run export:windows
npm run test:packaged
```

Paket, Electron runtime dosyalarıyla birlikte çalışır; yalnız EXE dosyasını ayırmak yeterli değildir. Paketli uygulama dışarıdan Node/npm gerektirmez.

## Arayüz ve kısayollar

Bilgi paneli ☰ ile açılır. Sayfa araçları, indirmeler, site izinleri ve kaynak bilgileri bu paneldedir.

| Kısayol | İşlev |
| --- | --- |
| Ctrl+L | Adres alanı |
| Ctrl+T / Ctrl+W | Yeni sekme / sekmeyi kapat |
| Ctrl+Tab / Ctrl+Shift+Tab | Sonraki / önceki sekme |
| Ctrl+Shift+T | Kapatılan sekmeyi yeniden aç |
| Ctrl+F / F3 / Shift+F3 | Sayfada arama ve eşleşmeler |
| Ctrl+artı / Ctrl+eksi / Ctrl+0 | Yakınlaştırma |
| F5 / Ctrl+R | Yenileme |
| Ctrl+F5 / Ctrl+Shift+R | Açık sayfayı önbelleği atlayarak yenileme |
| Esc | Aramadan veya tam ekrandan çıkış |

## Entegrasyon

[Modül rehberi](docs/GITHUB_DEVIR_TR.md), [BrowserApi sözleşmesi](docs/browser-plan/SOZLESME.md) ve [mevcut durum](docs/CORE_DURUM_TR.md) genişletme noktalarını açıklar. Test kimliği ve bellek servisi gerçek auth/veri katmanı değildir.
