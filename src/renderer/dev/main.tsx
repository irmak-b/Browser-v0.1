import { StrictMode, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { LAYOUT, newerSnapshot, type BrowserSnapshot, type CommandResult, type ResourceSnapshot } from '../../shared/contracts';
import './style.css';

function App() {
  const [state, setState] = useState<BrowserSnapshot | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelButton = useRef<HTMLButtonElement>(null);
  const [findText, setFindText] = useState('');
  const findInput = useRef<HTMLInputElement>(null);
  const findTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [resources,setResources]=useState<ResourceSnapshot|null>(null);
  const siteArea = useRef<HTMLElement>(null);
  const address = useRef<HTMLInputElement>(null);
  const infoButton = useRef<HTMLButtonElement>(null);
  const viewportRevision = useRef(0);
  const currentEpoch = useRef<string | undefined>(undefined);
  const latestSnapshot = useRef<BrowserSnapshot | null>(null);
  const tab = state?.tabs.find((candidate) => candidate.tabId === state.activeTabId);

  useEffect(() => {
    const accept = (incoming: BrowserSnapshot) => {
      viewportRevision.current = Math.max(viewportRevision.current, incoming.viewportRevision);
      const next = newerSnapshot(latestSnapshot.current, incoming);
      latestSnapshot.current = next;
      currentEpoch.current = next.contextEpoch;
      setState(next);
    };
    const unsubscribe = window.browser.onStateChanged(accept);
    const unsubscribeFocus = window.browser.onFocusAddress(() => { address.current?.focus(); address.current?.select(); });
    const unsubscribeFind = window.browser.onFocusFind(() => { findInput.current?.focus(); findInput.current?.select(); });
    let mounted = true;
    void window.browser.getState().then((result) => {
      if (mounted && result.ok) accept(result.data);
      else if (mounted && !result.ok) setError(result.message);
    }).catch(() => { if (mounted) setError('Browser Core bağlantısı kurulamadı.'); });
    return () => { mounted = false; unsubscribe(); unsubscribeFocus(); unsubscribeFind(); };
  }, []);

  useEffect(() => { setInput(tab?.url ?? ''); }, [tab?.tabId, tab?.url]);
  const contextEpoch = state?.contextEpoch;
  const findOwner = state?.find?.tabId;
  useEffect(() => {
    setFindText('');
    if (findOwner) { findInput.current?.focus(); findInput.current?.select(); }
  }, [findOwner, contextEpoch]);
  useEffect(() => {
    if (!findOwner || findText === state?.find?.text) return;
    // Only while typing: keep one cancellable request instead of rescanning
    // a large page for every keystroke. No timer when the find bar is idle.
    findTimer.current = setTimeout(() => {
      if (latestSnapshot.current?.find?.tabId === findOwner) {
        void command(() => window.browser.findInPage(findOwner, findText, 'new'), findOwner);
      }
    }, 150);
    return () => { clearTimeout(findTimer.current); };
  }, [findText, findOwner, contextEpoch]);
  useEffect(()=>{setResources(null);},[contextEpoch]);
  useEffect(() => {
    const element = siteArea.current;
    if (!element || !contextEpoch) return;
    let cancelled = false;
    const update = () => {
      const rect = element.getBoundingClientRect();
      void window.browser.setViewport({
        visible: !infoOpen, x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height),
        revision: ++viewportRevision.current,
      }).then((result) => {
        if (!cancelled && !result.ok && result.errorCode !== 'OPERATION_CANCELLED') setError(result.message);
      }).catch(() => { if (!cancelled) setError('Sayfa alanı ayarlanamadı.'); });
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => { cancelled = true; observer.disconnect(); };
  }, [infoOpen, panelOpen, contextEpoch, !!state?.fullscreen]);

  async function command(action: () => Promise<CommandResult<unknown>>, expectedTabId?: string) {
    setError('');
    try {
      const result = await action();
      if (result.contextEpoch !== currentEpoch.current) return;
      if (expectedTabId && expectedTabId !== latestSnapshot.current?.activeTabId) return;
      if (!result.ok) setError(result.message);
    }
    catch { setError('Browser Core yanıt vermedi. Tekrar deneyebilirsiniz.'); }
  }
  function navigate(event: FormEvent) {
    event.preventDefault();
    void command(() => tab ? window.browser.navigate(tab.tabId, input) : window.browser.openTab(input));
  }
  function openTest() {
    if (!state) return;
    void command(() => tab ? window.browser.navigate(tab.tabId, state.fixtureUrl) : window.browser.openTab(state.fixtureUrl));
  }
  async function newTab() {
    await command(() => window.browser.openTab());
    address.current?.focus();
  }
  function closeInfo() { setInfoOpen(false); infoButton.current?.focus(); }
  function closePanel() { setPanelOpen(false); panelButton.current?.focus(); }
  function find(direction: 'next' | 'previous') {
    clearTimeout(findTimer.current);
    if (findOwner) void command(() => window.browser.findInPage(findOwner, findText, direction));
  }
  const status = tab?.status === 'ready' ? 'Hazır' : tab?.status === 'error' ? 'Hata'
    : tab?.status === 'sleeping' ? 'Uyuyor' : tab?.status === 'stopped' ? 'Durduruldu' : tab?.loading ? 'Yükleniyor' : 'Bekliyor';
  const toolsDisabled = !tab?.url || ['RENDER_PROCESS_GONE', 'RENDER_PROCESS_UNRESPONSIVE'].includes(tab?.errorCode ?? '');
  const downloadLabels = { 'awaiting-approval': 'Boyut onayı bekliyor', 'choosing-target': 'Hedef seçiliyor', downloading: 'İndiriliyor', completed: 'Tamamlandı', cancelled: 'İptal edildi', failed: 'Tamamlanamadı' };
  const historyLabels = { 'memory-only': 'Yalnız bellekte · uygulama kapanınca silinir', pending: 'Bekleyen geliştirme kaydı var', offline: 'Çevrimdışı · kayıt bekliyor', timeout: 'Zaman aşımı · kayıt bekliyor', unauthorized: 'Yetkilendirme gerekli · kayıt bekliyor', forbidden: 'Erişim reddedildi · kayıt bekliyor', 'queue-full': 'Kuyruk dolu · bazı kayıtlar alınamadı', unavailable: 'Servis kullanılamıyor · kayıt bekliyor' };

  return <div className={`shell${state?.fullscreen ? ' fullscreen-shell' : ''}`} data-theme={state?.theme ?? 'light'} style={{
    '--toolbar-height': `${LAYOUT.toolbarHeight + (findOwner ? 42 : 0)}px`, '--sidebar-width': `${panelOpen ? LAYOUT.infoPanelWidth : 0}px`,
  } as CSSProperties}>
    <header>
      <div className="tabs-row"><div role="tablist" aria-label="Sekmeler" className="tabs">
        {state?.tabs.map((item) => <div key={item.tabId} className={`tab-item ${item.tabId === state.activeTabId ? 'selected' : ''}`}>
          <button role="tab" aria-selected={item.tabId === state.activeTabId} data-tab-id={item.tabId} title={item.title} onClick={() => void command(() => window.browser.activateTab(item.tabId))}>
            <span aria-hidden="true">{item.status === 'sleeping' ? '☾' : item.frozen ? '❄' : item.loading ? '◌' : '◇'}</span><span className="tab-title">{item.title}{item.status === 'sleeping' ? ' · Uyuyor' : item.frozen ? ' · Donduruldu' : ''}</span>
          </button>{item.url && item.audible && <button type="button" className="mute-tab" aria-label={`${item.muted ? 'Sesini aç' : 'Sesini kapat'}: ${item.title}`} aria-pressed={!!item.muted} title={item.muted ? 'Sekme sessiz · sesi aç' : 'Ses çalıyor · sesi kapat'} onClick={() => void command(() => window.browser.setTabMuted(item.tabId, !item.muted))}>{item.muted ? '🔇' : '🔊'}</button>}
          <button className="close-tab" aria-label={`Sekmeyi kapat: ${item.title}`} onClick={() => void command(() => window.browser.closeTab(item.tabId))}>×</button>
        </div>)}
      </div><button className="new-tab" aria-label="Kapatılan sekmeyi aç" title="Kapatılan sekmeyi yeniden yükle (Ctrl+Shift+T)" disabled={!state?.canRestoreClosedTab} onClick={() => void command(() => window.browser.restoreClosedTab())}>↶</button>
      <button className="new-tab" aria-label="Yeni sekme" title="Yeni sekme (Ctrl+T)" onClick={() => void newTab()}>+</button></div>
      <form className="address-row" onSubmit={navigate}>
        <div className="navigation"><button type="button" aria-label="Geri" disabled={!tab?.canGoBack} onClick={() => tab && void command(() => window.browser.goBack(tab.tabId))}>←</button>
          <button type="button" aria-label="İleri" disabled={!tab?.canGoForward} onClick={() => tab && void command(() => window.browser.goForward(tab.tabId))}>→</button>
          {tab?.loading ? <button type="button" aria-label="Durdur" onClick={() => void command(() => window.browser.stop(tab.tabId))}>×</button>
            : <button type="button" aria-label="Yenile" disabled={!tab?.url} title="Yenile (F5) · Önbelleği atla (Ctrl+F5 / Ctrl+Shift+R)" onClick={() => tab && void command(() => window.browser.reload(tab.tabId))}>↻</button>}
        </div>
        <button type="button" className="home-button" aria-label="Google ana sayfa" title="Google ana sayfa" onClick={()=>void command(()=>tab?window.browser.navigate(tab.tabId,'https://www.google.com/'):window.browser.openTab('https://www.google.com/'))}>⌂</button>
        <label className="address"><span aria-hidden="true">↗</span><input ref={address} aria-label="Sayfa adresi" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Adres veya arama (Ctrl+L)" spellCheck={false} autoComplete="off" /></label>
        {state?.adBlocking&&<button type="button" className="ad-shield" aria-label="Bu sitede reklam engelle" aria-pressed={state.adBlocking.enabled} disabled={!tab?.url}
          title={`Reklam engeli ${state.adBlocking.enabled?'açık':'kapalı'} · ${state.adBlocking.blockedRequests} istek engellendi. Bu site için değiştir.`}
          onClick={()=>tab&&void command(()=>window.browser.setAdBlocking(tab.tabId,!state.adBlocking!.enabled))}>
          <svg width="20" height="22" viewBox="0 0 24 26" fill="none" aria-hidden="true"><path d="M12 2 3 6v7c0 5 5 9 9 11 4-2 9-6 9-11V6Z" stroke="currentColor" strokeWidth="2"/>{state.adBlocking.enabled?<path d="m7 13 3 3 7-7" stroke="currentColor" strokeWidth="2"/>:<path d="m8 9 8 8m0-8-8 8" stroke="currentColor" strokeWidth="2"/>}</svg>
        </button>}
        <button type="submit" className="go-button" aria-label="Adrese git" title="Adrese git (Enter)">→</button>
        <span className="connection-state" role="status" title={state ? 'Browser Core bağlı' : 'Bağlanıyor…'}><span className={`dot ${state ? 'ready' : ''}`} /><span className="sr-only">{state ? 'Browser Core bağlı' : 'Bağlanıyor…'}</span></span>
        <button ref={panelButton} type="button" className="panel-toggle" aria-label="Bilgi paneli" aria-controls="browser-info-panel" aria-expanded={panelOpen}
          title={error || state?.notice || (tab?.errorCode ? `Sayfa hatası: ${tab.errorCode}` : 'Bilgi panelini aç/kapat')}
          onClick={() => setPanelOpen(open => !open)}>☰{(error || state?.notice || tab?.errorCode || state?.downloads.some(item => item.status === 'awaiting-approval')) && <span className="panel-badge" aria-label="İlgilenilmesi gereken bildirim">!</span>}</button>
      </form>
      {state?.find && <form className="find-row" role="search" aria-label="Sayfa içinde arama" onSubmit={event => { event.preventDefault(); find('next'); }}>
        <input ref={findInput} aria-label="Sayfada ara" maxLength={256} value={findText} onChange={event => setFindText(event.target.value)} autoComplete="off" spellCheck={false} />
        <output aria-live="polite" data-testid="find-count">{!state.find.text ? 'Metin girin' : state.find.pending ? 'Aranıyor…' : state.find.matches ? `${state.find.activeMatch}/${state.find.matches}` : 'Eşleşme yok'}</output>
        <button type="button" aria-label="Önceki eşleşme" disabled={!findText} onClick={() => find('previous')}>↑</button>
        <button type="submit" aria-label="Sonraki eşleşme" disabled={!findText}>↓</button>
        <button type="button" aria-label="Sayfa aramasını kapat" title="Kapat (ESC)" onClick={() => void command(() => window.browser.closeFind(state.find!.tabId))}>×</button>
      </form>}
    </header>
    <section ref={siteArea} className="site-area" aria-label="Web sayfası alanı">
      {tab?.errorCode === 'RENDER_PROCESS_UNRESPONSIVE' && <div className="empty" role="alert">
        <h1>Sayfa yanıt vermiyor</h1><p>Bekleyebilir veya yalnız bu sekmeyi kapatabilirsiniz. Diğer sekmeler kullanılabilir.</p>
        {error && <p>{error}</p>}
        <button onClick={() => void command(() => window.browser.forceCloseUnresponsive(tab.tabId))}>Yanıt vermeyen sekmeyi kapat</button>
      </div>}
      {(!tab || tab.status === 'empty') && <div className="empty"><div className="empty-symbol">⌕</div><h1>Google ile ara</h1><p>Bir şey ara veya adres çubuğuna web adresini yaz.</p><form className="new-tab-search" onSubmit={navigate}><input aria-label="Google ile ara" value={input} onChange={event=>setInput(event.target.value)} placeholder="Google'da ara" autoComplete="off"/><button className="primary" type="submit">Ara</button></form><p className="muted">Arama yaptığında Google açılır.</p><button onClick={openTest}>Kontrollü sayfayı aç</button></div>}
    </section>
    <aside id="browser-info-panel" aria-label="Bilgi paneli" hidden={!panelOpen} onKeyDown={event => { if(event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePanel(); } }}>
      <div className="panel-heading"><strong>Bilgi ve araçlar</strong><button type="button" aria-label="Bilgi panelini kapat" onClick={closePanel}>×</button></div>
      <div className="panel-controls">
        <span>{status} · {state?.tabs.length ?? 0} sekme</span>
        <button type="button" onClick={openTest}>Test sayfasını aç</button>
        {state?.developmentControls && <><label>Test bağlamı <select aria-label="Test kullanıcısı" value={state.developmentIdentity} onChange={event => void command(() => window.browser.switchDevelopmentIdentity(event.target.value as 'test-a' | 'test-b'))}><option value="test-a">Test-A</option><option value="test-b">Test-B</option></select></label>
          <button type="button" className="theme-toggle" onClick={() => void command(() => window.browser.setDevelopmentTheme(state.theme === 'light' ? 'dark' : 'light'))}>Tema: {state.theme === 'light' ? 'Açık' : 'Koyu'}</button></>}
        <span className="page-tools" role="group" aria-label="Sayfa araçları">
          <button type="button" disabled={toolsDisabled} title="Sayfada ara (Ctrl+F)" onClick={() => tab && void command(() => window.browser.openFind(tab.tabId))}>Sayfada ara</button>
          <button type="button" aria-label="Uzaklaştır" disabled={toolsDisabled || (state?.zoomFactor ?? 1) <= 0.5} onClick={() => tab && void command(() => window.browser.zoom(tab.tabId, 'out'))}>−</button>
          <button type="button" aria-label="Yakınlaştırmayı sıfırla" disabled={toolsDisabled} title="Yakınlaştırmayı sıfırla (Ctrl+0)" onClick={() => tab && void command(() => window.browser.zoom(tab.tabId, 'reset'))}>%{Math.round((state?.zoomFactor ?? 1) * 100)}</button>
          <button type="button" aria-label="Yakınlaştır" disabled={toolsDisabled || (state?.zoomFactor ?? 1) >= 3} onClick={() => tab && void command(() => window.browser.zoom(tab.tabId, 'in'))}>+</button>
        </span>
      </div>
      <p className="eyebrow">SAYFA DURUMU</p><h2 data-testid="page-title">{tab?.title ?? 'Yeni sekme'}</h2>
      <p className="muted">Etkin sekmenin başlığı ve gezinme durumu.</p>
      {state?.sitePermissions && <section aria-label="Site izinleri"><strong>Site izinleri</strong>
        <p className="muted">Kararlar bu site ve uygulama oturumu için geçerli.</p>
        <ul>{state.sitePermissions.decisions.map(item => <li key={item.permission}>
          {{camera:'Kamera',microphone:'Mikrofon',location:'Konum',notifications:'Bildirim'}[item.permission]}: {item.state === 'allowed' ? 'İzin verildi' : 'Engellendi'}
        </li>)}</ul>
        {!state.sitePermissions.decisions.length && <p className="muted">Site desteklenen bir izin istediğinde sana sorulur.</p>}
        <button disabled={!state.sitePermissions.decisions.length || !tab} onClick={() => tab && void command(() => window.browser.resetSitePermissions(tab.tabId))}>İzinleri sıfırla ve yenile</button>
      </section>}
      {tab && <label><input type="checkbox" aria-label="Bu sekmeyi uyutma" checked={!!tab.keepAwake}
        onChange={event => void command(() => window.browser.setTabKeepAwake(tab.tabId, event.target.checked))} /> Bu sekmeyi uyutma</label>}
      {state?.adBlocking && <section aria-label="Reklam engelleme"><strong>Reklam engeli {state.adBlocking.enabled?'açık':'kapalı'}</strong>
        <p data-testid="ad-block-count">{state.adBlocking.blockedRequests} istek engellendi · ağ ve sayfa filtresi</p>
        {state.adBlocking.scriptletStatus==='unavailable'&&<p className="muted">Sayfa filtresinin bir bölümü uygulanamadı. Sayfayı yenilemeyi dene.</p>}
        <p className="muted">Tercihi değiştirdikten sonra tam uygulamak için sayfayı yenile.</p></section>}
      <button type="button" onClick={()=>void command(async()=>{const result=await window.browser.getResources();if(result.ok&&result.contextEpoch===currentEpoch.current)setResources(result.data);return result;})}>Kaynak kullanımını ölç</button>
      {resources&&<p data-testid="resource-summary">Özel bellek: {resources.privateMiB.toFixed(0)} MiB · {resources.processCount} süreç</p>}
      {resources?.backgroundWorkers && <p className="muted">Arka plan worker sayısı: {resources.backgroundWorkers.reduce((sum, item) => sum + item.running, 0)}</p>}
      <dl><dt>Bağlantı</dt><dd>{state ? 'Bağlı · main süreç' : 'Bağlanıyor…'}</dd><dt>Sayfa</dt><dd data-testid="page-status">{status}</dd><dt>Veri servisi</dt><dd>Bağlı değil · geliştirme</dd><dt>Uygulama sürümü</dt><dd>{state?.appVersion ?? '—'}</dd></dl>
      {tab?.errorCode !== 'RENDER_PROCESS_UNRESPONSIVE' && (error || tab?.errorCode) && <div role="alert" className="error">{error || `Sayfa yüklenemedi (${tab?.errorCode}). Başka bir adres veya test sayfasını deneyin.`}</div>}
      {state?.notice && <div role="status" data-testid="policy-notice" className="policy-notice">{state.notice}</div>}
      <section className="downloads" aria-label="İndirmeler"><strong>İndirmeler</strong>
        {!state?.downloads.length && <p>İndirme yok. Dosyalar otomatik açılmaz.</p>}
        {state?.downloads.map((item) => <div className="download-item" key={item.downloadId} data-testid="download-item"><span>{item.filename}</span><small>{item.receivedBytes.toLocaleString('tr-TR')} / {item.totalBytes.toLocaleString('tr-TR')} bayt · {downloadLabels[item.status]}</small>
          <progress aria-label="İndirme ilerlemesi" max={item.totalBytes} value={item.receivedBytes} />
          {item.status === 'awaiting-approval' && <button onClick={() => void command(() => window.browser.approveDownload(item.downloadId))}>Boyutu onayla ve kaydet</button>}
          {!['completed', 'cancelled', 'failed'].includes(item.status) && <button onClick={() => void command(() => window.browser.cancelDownload(item.downloadId))}>İndirmeyi iptal et</button>}
        </div>)}
      </section>
      <section className="history-panel" aria-label="Geliştirme geçmişi"><strong>Geliştirme geçmişi</strong>
        <p data-testid="history-status">{state ? historyLabels[state.history.status] : 'Bağlanıyor…'}</p>
        <p>Neon bağlı değil. Yerel denemeler etiketli olarak gösterilir; adresin sorgu ve # kısmı alınmaz.</p>
        {state?.developmentControls && <label>Servis denemesi <select aria-label="Geçmiş servisi denemesi" value={state.history.simulation} onChange={(event) => void command(() => window.browser.setDevelopmentHistoryMode(event.target.value as 'normal' | 'offline' | 'timeout' | 'unauthorized' | 'forbidden'))}>
          <option value="normal">Normal · bellek</option><option value="offline">Çevrimdışı</option><option value="timeout">Zaman aşımı</option><option value="unauthorized">Yetkisiz (401)</option><option value="forbidden">Yasak (403)</option>
        </select></label>}
        {!!state?.history.pendingCount && <><p>{state.history.pendingCount} işlem bekliyor</p><button onClick={() => void command(() => window.browser.retryHistory())}>Kaydı yeniden dene</button></>}
        {!!state?.history.droppedCount && <p role="status">{state.history.droppedCount} işlem kuyruk sınırı nedeniyle alınamadı.</p>}
        <ol>{state?.history.entries.map((entry) => <li key={entry.eventId} data-testid="history-entry"><span>{entry.title}</span><small>{entry.developmentFixture ? 'Yerel deneme' : 'Geliştirme kaydı'} · {entry.source}</small><span className="history-url">{entry.url}</span></li>)}</ol>
      </section>
      <div className="scope"><strong>A4 geliştirme kontrolü</strong><p>Gezinme ve geç başlık olayları tek ziyaret kaydına bağlanır. Servis denemesi hata verse de tarayıcı çalışır.</p><p>Nihai UI, gerçek API/auth, Neon ve TOTP diğer ekiplerden bekleniyor.</p></div>
      <button ref={infoButton} className="info-button" onClick={() => setInfoOpen(true)}>Geliştirme bilgisi</button>
      <p className="footnote">Geçici DevShell · Nihai arayüz ayrı ekipte</p>
    </aside>
    {infoOpen && <div className="modal-layer"><section role="dialog" aria-modal="true" aria-labelledby="info-title" onKeyDown={(event) => { if (event.key === 'Tab') event.preventDefault(); if (event.key === 'Escape') closeInfo(); }}><p className="eyebrow">GELİŞTİRME MODU</p><h2 id="info-title">A4 tarayıcı ve geliştirme geçmişi</h2><p>Geçmiş yalnız bellekte tutulur; gerçek giriş ve sunucu kaydı yoktur.</p><p>Panel açıkken native sayfalar gizlenir.</p><button autoFocus className="primary" onClick={closeInfo}>Sayfaya dön</button></section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
