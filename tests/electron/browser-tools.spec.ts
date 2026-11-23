import { expect, test, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';

test('BM-01: menu opens existing controls and the database stub stays disconnected', async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const app = await electron.launch({ args: [resolve('.')], env, chromiumSandbox: true });
  try {
    const ui = await app.firstWindow();
    const menu = ui.getByRole('button', { name: 'Tarayıcı menüsü', exact: true });
    const panel = ui.locator('#browser-tools-panel');
    const openFixture = await ui.evaluate(async () => {
      const state = await window.browser.getState();
      if (!state.ok || !state.data.activeTabId) throw new Error('Browser Core unavailable');
      return window.browser.navigate(state.data.activeTabId, state.data.fixtureUrl);
    });
    expect(openFixture.ok).toBe(true);
    await expect.poll(() => ui.evaluate(async () => {
      const state = await window.browser.getState();
      return state.ok && state.data.history.entries.length > 0;
    })).toBe(true);

    const nativeView = () => app.evaluate(({ BrowserWindow, WebContentsView }) => {
      const host = BrowserWindow.getAllWindows()[0]!;
      const site = host.contentView.children.find(view => view instanceof WebContentsView && view.webContents.id !== host.webContents.id);
      if (!(site instanceof WebContentsView)) throw new Error('Missing page view');
      return {
        id: site.webContents.id,
        width: site.getBounds().width,
        visible: site.getVisible(),
      };
    });
    const before = await nativeView();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await expect(panel.getByRole('heading', { name: 'Tarayıcı menüsü' })).toBeFocused();
    await expect.poll(async () => {
      const menuLeft = (await panel.boundingBox())?.x;
      const native = await nativeView();
      return native.visible && native.width === menuLeft && native.id === before.id;
    }).toBe(true);

    const back = panel.getByRole('button', { name: 'Menüye dön' });
    await panel.getByRole('button', { name: 'Ayarlar' }).click();
    await panel.getByRole('checkbox', { name: 'Sekmeyi uyutma' }).check();
    await expect.poll(() => ui.evaluate(async () => {
      const state = await window.browser.getState();
      return state.ok && state.data.tabs.find(tab => tab.tabId === state.data.activeTabId)?.keepAwake;
    })).toBe(true);
    await back.click();
    await panel.getByRole('button', { name: 'Eklentiler' }).click();
    await expect(panel.getByText('Chrome Web Mağazası’ndan kurulum kullanılamıyor.')).toBeVisible();
    await back.click();
    await panel.getByRole('button', { name: 'İndirmeler' }).click();
    const downloads = ui.getByRole('region', { name: 'İndirmeler' });
    await expect(downloads).toBeFocused();
    await downloads.getByRole('button', { name: 'Menüye dön' }).click();

    await panel.getByRole('button', { name: 'Veritabanını gör' }).click();
    const example = panel.getByText('ornek-parola-42', { exact: true });
    await expect(example).toHaveCount(0);
    await panel.getByRole('button', { name: 'Örnek parolayı göster' }).click();
    await expect(example).toBeVisible();
    await panel.getByRole('button', { name: 'Örnek parolayı gizle' }).click();
    await expect(example).toHaveCount(0);
    await panel.getByRole('button', { name: 'Verileri getir' }).click();
    await expect(panel.getByRole('status')).toHaveText('Veritabanı bağlı değil. Veri alınamadı.');
    await panel.getByRole('textbox', { name: 'Başlık' }).fill('Sunum denemesi');
    await panel.getByRole('textbox', { name: 'Değer' }).fill('Örnek kayıt');
    await panel.getByRole('button', { name: 'Veri ekle' }).click();
    await expect(panel.getByRole('status')).toHaveText('Veritabanı bağlı değil. Kayıt eklenmedi.');
    await expect(panel.getByRole('list')).toHaveCount(0);

    await panel.getByRole('button', { name: 'Örnek parolayı göster' }).click();
    await ui.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(menu).toBeFocused();
    await expect.poll(nativeView).toEqual(before);
    await menu.click();
    await panel.getByRole('button', { name: 'Veritabanını gör' }).click();
    await expect(example).toHaveCount(0);
    await expect(panel.getByRole('textbox', { name: 'Başlık' })).toHaveValue('');

    await back.click();
    await panel.getByRole('button', { name: 'Parolalar' }).click();
    await expect(panel.getByText('Parola kasası henüz bağlı değil.', { exact: false })).toBeVisible();
    await back.click();
    await panel.getByRole('button', { name: 'Geçmiş' }).click();
    await panel.getByRole('list').getByRole('button').first().click();
    await expect(panel).toHaveCount(0);
    await expect(ui.getByRole('tab')).toHaveCount(2);
  } finally {
    await app.close();
  }
});
