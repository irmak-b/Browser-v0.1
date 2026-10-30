import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import fixtureHtml from '../../../tests/fixtures/page.html?raw';

export async function startFixture() {
  const counts = new Map<string, number>();
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; frame-src 'self'; connect-src 'self'");
    const path = request.url?.split('?')[0];
    if (path === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end("document.getElementById('change-title').onclick = () => {document.title='Başlık güncellendi';document.getElementById('result').textContent='Başlık main üzerinden React ekranına gönderildi.'}; if(location.pathname==='/late-title')setTimeout(()=>document.title='Eski sayfa başlığı',400);");
    } else if (path === '/load-hash.js') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end("history.replaceState({},'', '/load-hash#ready');document.title='SPA yükleme denemesi';");
    } else if (path === '/load-hash') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><meta charset="utf-8"><title>SPA denemesi</title><h1>Yükleme sırasında adres değişimi</h1><script src="/load-hash.js"></script>');
    } else if (path === '/session.js') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end(`const show=()=>document.getElementById('session-result').textContent='Çerez: '+(document.cookie.includes('fixture=sample')?'var':'yok')+' · Yerel veri: '+(localStorage.getItem('fixture')||'yok');
        document.getElementById('save-session').onclick=()=>{document.cookie='fixture=sample; SameSite=Strict; Path=/';localStorage.setItem('fixture','sample');show()};show();
        document.getElementById('permission').onclick=()=>navigator.geolocation.getCurrentPosition(()=>document.getElementById('permission-result').textContent='Beklenmeyen izin',()=>document.getElementById('permission-result').textContent='Konum izni reddedildi');`);
    } else if (path === '/session') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html lang="tr"><meta charset="utf-8"><title>Oturum denemesi</title><style>body{font:18px system-ui;padding:28px}button,a{font:inherit;margin:12px}output{display:block;margin:18px}</style><h1>Yalnız geliştirme verisi</h1><p>Aynı test kullanıcısının sekmeleri bu işareti paylaşır. Test-B ayrı oturumdur. Uygulama kapanınca veriler korunmaz.</p><button id="save-session">Test işaretini kaydet</button><output id="session-result"></output><button id="permission">Konum izni iste</button><output id="permission-result"></output><p><a href="/">Ana test sayfası</a></p><script src="/session.js"></script></html>');
    } else if (path === '/download' || path === '/download-slow' || path === '/download-unknown') {
      const total = path === '/download' ? 4096 : 131072;
      response.setHeader('Content-Type', 'application/octet-stream');
      response.setHeader('Content-Disposition', 'attachment; filename="browser-core-fixture.txt"');
      if (path !== '/download-unknown') response.setHeader('Content-Length', total);
      if (path === '/download') response.end(Buffer.alloc(total, 65));
      else {
        let sent = 0;
        response.write(Buffer.alloc(4096, 65)); sent += 4096;
        const timer = setInterval(() => {
          if (response.destroyed) { clearInterval(timer); return; }
          response.write(Buffer.alloc(Math.min(4096, total - sent), 65)); sent += 4096;
          if (sent >= total) { clearInterval(timer); response.end(); }
        }, 120);
        response.once('close', () => clearInterval(timer));
      }
    } else if (path === '/disconnect') {
      request.socket.destroy();
    } else if (path === '/frames') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><meta charset="utf-8"><title>Çerçeve denemesi</title><h1>Yalnız ana sayfa geçmişe yazılır</h1><iframe src="/second" title="Alt sayfa"></iframe>');
    } else if (path === '/slow') {
      const timer = setTimeout(() => {
        if (!response.destroyed) { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><meta charset="utf-8"><title>Yavaş sayfa</title><h1>Yavaş yanıt tamamlandı</h1>'); }
      }, 900);
      response.once('close', () => clearTimeout(timer));
    } else if (path && /^\/page\/[1-5]$/.test(path)) {
      const number = path.slice(-1);
      const count = (counts.get(path) ?? 0) + 1;
      counts.set(path, count);
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html lang="tr"><meta charset="utf-8"><title>Sayfa ${number}</title><h1>Sayfa ${number}</h1><p id="load-count">Yükleme ${count}</p><input id="state-input" aria-label="Sekme notu" placeholder="Sekmeye özel not"><p><a href="/second">İkinci kontrollü sayfa</a></p></html>`);
    } else if (path === '/redirect') {
      response.writeHead(302, { Location: '/second' }); response.end();
    } else if (path === '/redirect-invalid') {
      response.writeHead(302, { Location: 'app://browser/index.html' }); response.end();
    } else if (path === '/error') {
      response.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>A1 — HTTP 503</title><h1>Kontrollü HTTP 503 yanıtı</h1>');
    } else if (path === '/second') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html lang="tr"><meta charset="utf-8"><title>İkinci sayfa</title><h1>İkinci kontrollü sayfa</h1><a href="/">Test sayfasına dön</a></html>');
    } else if (path === '/' || path === '/popup' || path === '/late-title') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(fixtureHtml);
    } else {
      response.writeHead(404); response.end('Not found');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    close: () => { server.closeAllConnections(); server.close(); },
  };
}
