import { useLayoutEffect, useRef } from 'react';
import type { BrowserSnapshot, CommandResult, TabSnapshot } from '../../shared/contracts';
import { DatabasePanel, DemoPassword } from './DatabasePanel';

const sections = [
  ['settings', 'Ayarlar'],
  ['history', 'Geçmiş'],
  ['downloads', 'İndirmeler'],
  ['passwords', 'Parolalar'],
  ['extensions', 'Eklentiler'],
  ['database', 'Veritabanını gör'],
] as const;

export type BrowserToolsPage = 'menu' | (typeof sections)[number][0];
type PanelPage = Exclude<BrowserToolsPage, 'downloads'>;

interface Props {
  page: PanelPage;
  state: BrowserSnapshot | null;
  tab: TabSnapshot | undefined;
  selectPage(page: BrowserToolsPage): void;
  close(): void;
  openHistory(url: string): void;
  command(action: () => Promise<CommandResult<unknown>>): Promise<void>;
}

export function BrowserToolsPanel({ page, state, tab, selectPage, close, openHistory, command }: Props) {
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pageTitle = page === 'menu' ? 'Tarayıcı menüsü' : sections.find(([id]) => id === page)?.[1];

  useLayoutEffect(() => {
    panel.current?.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [page]);

  return <aside ref={panel} className="browser-tools" id="browser-tools-panel" aria-labelledby="browser-tools-title"
    onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    }}>
    <div className="panel-heading">
      <h2 tabIndex={-1} ref={heading} id="browser-tools-title">{pageTitle}</h2>
      <button type="button" aria-label="Tarayıcı menüsünü kapat" onClick={close}>×</button>
    </div>
    {page !== 'menu' && <button type="button" className="tools-back" onClick={() => selectPage('menu')}>← Menüye dön</button>}
    {page === 'menu' && <nav className="tools-navigation" aria-label="Tarayıcı araçları">
      {sections.map(([id, label]) => <button type="button" key={id} onClick={() => selectPage(id)}>{label}<span aria-hidden="true">›</span></button>)}
    </nav>}
    {page === 'settings' && <>
      <h3>Etkin site ve sekme</h3>
      {tab?.url ? <div className="tools-settings">
        {state?.adBlocking && <label><input type="checkbox" checked={state.adBlocking.enabled}
          onChange={event => void command(() => window.browser.setAdBlocking(tab.tabId, event.target.checked))} /> Reklam engelle</label>}
        <label><input type="checkbox" checked={!!tab.keepAwake}
          onChange={event => void command(() => window.browser.setTabKeepAwake(tab.tabId, event.target.checked))} /> Sekmeyi uyutma</label>
        <button type="button" disabled={!state?.sitePermissions?.decisions.length}
          onClick={() => void command(() => window.browser.resetSitePermissions(tab.tabId))}>Site izinlerini sıfırla</button>
      </div> : <p>Site ayarlarını görmek için bir web sayfası açın.</p>}
    </>}
    {page === 'history' && <>
      <p>Bu oturumdaki ziyaretler. Uygulama kapanınca silinir.</p>
      {state?.history.entries.length ? <ol className="tools-list">
        {state.history.entries.map(entry => <li key={entry.eventId}>
          <button type="button" onClick={() => openHistory(entry.url)}>
            <strong>{entry.title}</strong><span>{entry.url}</span>
          </button>
        </li>)}
      </ol> : <p>Henüz ziyaret kaydı yok.</p>}
    </>}
    {page === 'passwords' && <>
      <p>Parola kasası henüz bağlı değil. Aşağıdaki değer yalnızca bir örnektir.</p>
      <DemoPassword />
    </>}
    {page === 'extensions' && <>
      <p>Eklenti yükleme henüz desteklenmiyor. Electron, açılmış eklentiler için sınırlı API desteği sunar.</p>
      <p>Chrome Web Mağazası’ndan kurulum kullanılamıyor.</p>
    </>}
    {page === 'database' && <DatabasePanel />}
  </aside>;
}
