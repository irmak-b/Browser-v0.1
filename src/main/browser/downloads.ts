import { randomUUID } from 'node:crypto';
import { dialog, type BrowserWindow, type DownloadItem, type Session, type WebContents } from 'electron';
import { BrowserFault, type DevelopmentIdentity, type DownloadSnapshot } from '../../shared/contracts';
import { siteUrl } from './policy';

interface Job {
  state: DownloadSnapshot;
  epoch: string;
  url?: string;
  owner?: WebContents;
  item?: DownloadItem;
  target?: string;
  cleanup?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  awaitingTransfer?: boolean;
  ownerCleanup?: () => void;
}
export function safeDownloadName(input: string) {
  const name = input.replace(/[\x00-\x1f\x7f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, '_').slice(0, 120).replace(/[. ]+$/g, '');
  return !name || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(name) ? 'download.bin' : name;
}

export class DownloadManager {
  private readonly jobs = new Map<string, Job>();
  private readonly removers: (() => void)[] = [];
  private disposed = false;
  constructor(private readonly window: BrowserWindow,
    private readonly current: () => { identity: DevelopmentIdentity; epoch: string; owns: (wc: WebContents) => boolean },
    private readonly changed: () => void, private readonly notice: (text: string) => void,
    private readonly modal: (open: boolean) => void,
    private readonly navigationDownload: (owner: WebContents, url: string) => void) {}
  snapshots() { return [...this.jobs.values()].map((job) => ({ ...job.state })); }
  protects(owner: WebContents) {
    return [...this.jobs.values()].some(job => job.owner === owner && this.live(job)
      && ['awaiting-approval', 'choosing-target', 'downloading'].includes(job.state.status));
  }
  private live(job: Job) {
    return !this.disposed && this.jobs.get(job.state.downloadId) === job && job.epoch === this.current().epoch;
  }
  private reserveSlot() {
    if(this.jobs.size<20)return true;
    for(const [id,job] of this.jobs){
      if(['completed','cancelled','failed'].includes(job.state.status)){
        this.jobs.delete(id);this.release(job);return true;
      }
    }
    return false;
  }
  attach(identity: DevelopmentIdentity, target: Session) {
    const listener = (event: Electron.Event, item: DownloadItem, owner: WebContents) => {
      const context = this.current();
      const ticket = [...this.jobs.values()].find((job) => job.awaitingTransfer
        && job.owner === owner && job.url === item.getURL() && this.live(job));
      if (this.disposed || context.identity !== identity || !context.owns(owner)) { event.preventDefault(); return; }
      if (ticket) {
        ticket.awaitingTransfer = false;
        if (ticket.state.status !== 'choosing-target' || !ticket.target) { event.preventDefault(); return; }
      }
      let url: string;
      try { url = siteUrl(item.getURL()); } catch { event.preventDefault(); return; }
      this.navigationDownload(owner, url);
      const size = item.getTotalBytes();
      if (!Number.isSafeInteger(size) || size <= 0 || (ticket && size !== ticket.state.totalBytes)) {
        event.preventDefault();
        if (ticket) { ticket.state.status = 'failed'; this.finish(ticket); }
        this.notice('Boyutu bilinmeyen veya onaydan sonra değişen indirme engellendi.'); return;
      }
      if (!ticket) {
        // Cancel the initial transfer. A GET retry starts only after explicit
        // size approval and a native destination choice. No auto-open path exists.
        const filename = safeDownloadName(item.getFilename());
        event.preventDefault();
        if (!this.reserveSlot()) { this.notice('En fazla 20 bekleyen veya çalışan indirme olabilir. Birini tamamlayın ya da iptal edin.'); return; }
        const job: Job = { epoch: context.epoch, url, owner, state: {
          downloadId: randomUUID(), filename, totalBytes: size, receivedBytes: 0, status: 'awaiting-approval',
        } };
        const ownerClosed = () => { if (this.live(job)) this.cancel(job.state.downloadId); };
        owner.once('destroyed', ownerClosed);
        job.ownerCleanup = () => owner.off('destroyed', ownerClosed);
        this.jobs.set(job.state.downloadId, job); this.changed(); return;
      }
      clearTimeout(ticket.timer);
      ticket.target && item.setSavePath(ticket.target);
      ticket.target = undefined;
      ticket.item = item;
      ticket.state.status = 'downloading';
      const update = () => {
        if (!this.live(ticket)) return;
        const previous = ticket.state.receivedBytes;
        ticket.state.receivedBytes = item.getReceivedBytes();
        if (ticket.state.receivedBytes > ticket.state.totalBytes) { this.cancel(ticket.state.downloadId); return; }
        if (ticket.state.receivedBytes !== previous) this.changed();
      };
      const done = (_event: Electron.Event, state: string) => {
        if (!this.live(ticket)) return;
        ticket.state.receivedBytes = item.getReceivedBytes();
        ticket.state.status = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'failed';
        this.finish(ticket);
      };
      item.on('updated', update); item.once('done', done);
      ticket.cleanup = () => { item.off('updated', update); item.off('done', done); };
      this.changed();
    };
    target.on('will-download', listener);
    this.removers.push(() => target.off('will-download', listener));
  }
  private get(id: string) {
    const job = this.jobs.get(id);
    if (!job || !this.live(job)) throw new BrowserFault('INVALID_INPUT', 'İndirme bu bağlama ait değil.');
    return job;
  }
  private release(job: Job) {
    clearTimeout(job.timer); job.timer=undefined;job.cleanup?.(); job.cleanup = undefined;
    job.ownerCleanup?.(); job.ownerCleanup = undefined;
    job.target = undefined; job.item = undefined;
    job.owner=undefined;job.url=undefined;job.awaitingTransfer=false;
  }
  private finish(job: Job) {
    this.release(job);
    if (this.live(job)) this.changed();
  }
  async approve(id: string) {
    const job = this.get(id);
    const owner=job.owner,url=job.url;
    if (job.state.status !== 'awaiting-approval' || !owner || !url || owner.isDestroyed() || !this.current().owns(owner)) {
      throw new BrowserFault('OPERATION_CANCELLED', 'İndirme artık başlatılamaz.');
    }
    job.state.status = 'choosing-target'; this.changed(); this.modal(true);
    let selection: Electron.SaveDialogReturnValue;
    try { selection = await dialog.showSaveDialog(this.window, { title: 'Onaylanan indirmeyi kaydet', defaultPath: job.state.filename, buttonLabel: 'Kaydet' }); }
    catch { if (this.live(job)) { job.state.status = 'failed'; this.finish(job); } return null; }
    finally { this.modal(false); }
    if (!this.live(job) || job.state.status !== 'choosing-target') return null;
    if (selection.canceled || !selection.filePath) { job.state.status = 'cancelled'; this.finish(job); return null; }
    if (job.owner!==owner || job.url!==url || owner.isDestroyed() || !this.current().owns(owner)) { job.state.status = 'cancelled'; this.finish(job); return null; }
    job.target = selection.filePath;
    job.awaitingTransfer = true;
    job.timer = setTimeout(() => {
      if (this.live(job) && job.state.status === 'choosing-target') { job.state.status = 'failed'; this.finish(job); }
    }, 15000);
    try { owner.downloadURL(url); }
    catch { job.state.status = 'failed'; this.finish(job); }
    return null;
  }
  cancel(id: string) {
    const job = this.get(id);
    if (['completed', 'cancelled', 'failed'].includes(job.state.status)) return null;
    job.state.status = 'cancelled'; job.item?.cancel(); this.finish(job); return null;
  }
  reset() {
    for (const job of this.jobs.values()) { const item=job.item;this.release(job);item?.cancel(); }
    this.jobs.clear();
  }
  dispose() { this.disposed = true; this.reset(); for (const remove of this.removers) remove(); }
}
