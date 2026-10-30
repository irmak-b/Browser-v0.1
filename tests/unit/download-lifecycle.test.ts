import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type {BrowserWindow,Session,WebContents} from 'electron';
import {DownloadManager} from '../../src/main/browser/downloads';

function fixture(){
  const target=new EventEmitter(),owners=new Set<WebContents>(),notices:string[]=[];
  let changes=0;
  const manager=new DownloadManager({} as BrowserWindow,()=>({identity:'test-a',epoch:'fixture',owns:w=>owners.has(w)}),()=>changes++,s=>notices.push(s),()=>{},()=>{});
  manager.attach('test-a',target as unknown as Session);
  const owner=()=>{const w=Object.assign(new EventEmitter(),{isDestroyed:()=>false}) as unknown as WebContents;owners.add(w);return w;};
  const request=(index:number,w=owner())=>{
    let prevented=0;
    target.emit('will-download',{preventDefault:()=>prevented++},{getURL:()=>`https://download.test/file-${index}`,getTotalBytes:()=>4096,getFilename:()=>`file-${index}.bin`},w);
    assert.equal(prevented,1,'Initial transfer must remain cancelled until explicit approval');
    return w;
  };
  return {manager,target,notices,owner,request,changes:()=>changes};
}

test('DL-01: terminal history makes room after20 entries while retaining at most20 snapshots',()=>{
  const {manager,request,notices}=fixture();
  try{
    let admitted=0;
    for(let i=0;i<25;i++){
      const previous=manager.snapshots().at(-1)?.downloadId;request(i);
      const last=manager.snapshots().at(-1)!;
      if(last.downloadId===previous)console.log('DOWNLOAD_CAP_OBSERVATION '+JSON.stringify({attempted:i+1,admitted,retained:manager.snapshots().length}));
      assert.notEqual(last.downloadId,previous,'A completed/cancelled history row must not block a fresh request');
      assert.equal(last.status,'awaiting-approval');admitted++;
      manager.cancel(last.downloadId);assert.ok(manager.snapshots().length<=20);
    }
    assert.equal(manager.snapshots().length,20);assert.equal(manager.snapshots()[0]!.filename,'file-5.bin');
    assert.equal(notices.length,0);
    console.log('DOWNLOAD_CAP_OBSERVATION '+JSON.stringify({attempted:25,admitted,retained:manager.snapshots().length}));
  }finally{manager.dispose();}
});

test('DL-02: a terminal snapshot releases owner, private URL, timer and transfer references',()=>{
  const {manager,request}=fixture();
  try{
    const owner=request(1),id=manager.snapshots()[0]!.downloadId;
    const job=(manager as unknown as {jobs:Map<string,{owner?:WebContents;url?:string;timer?:unknown;item?:unknown;target?:unknown;awaitingTransfer?:boolean}>}).jobs.get(id)!;
    assert.equal(manager.protects(owner),true);manager.cancel(id);
    console.log('DOWNLOAD_RELEASE_OBSERVATION '+JSON.stringify({terminal:manager.snapshots()[0]!.status,ownerRetained:!!job.owner,urlRetained:!!job.url,ownerListeners:owner.listenerCount('destroyed')}));
    assert.equal(job.owner,undefined);assert.equal(job.url,undefined);assert.equal(job.timer,undefined);
    assert.equal(job.item,undefined);assert.equal(job.target,undefined);assert.equal(!!job.awaitingTransfer,false);
    assert.equal(owner.listenerCount('destroyed'),0);assert.equal(manager.protects(owner),false);
  }finally{manager.dispose();}
});

test('DL-03:20 live requests stay protected; rejecting21st and reset leave no listeners',()=>{
  const {manager,request,target,notices}=fixture();
  try{
    const owners=Array.from({length:20},(_,i)=>request(i)),ids=manager.snapshots().map(s=>s.downloadId);
    request(20);assert.deepEqual(manager.snapshots().map(s=>s.downloadId),ids);assert.equal(notices.length,1);
    for(const w of owners)assert.equal(manager.protects(w),true);
    manager.reset();assert.deepEqual(manager.snapshots(),[]);
    for(const w of owners){assert.equal(w.listenerCount('destroyed'),0);assert.equal(manager.protects(w),false);}
  }finally{manager.dispose();}
  assert.equal(target.listenerCount('will-download'),0);
});

test('DL-05: unchanged progress emits no notification; changed bytes and same-byte completion still publish',()=>{
  const f=fixture(),owner=f.request(5),id=f.manager.snapshots()[0]!.downloadId;
  const job=(f.manager as unknown as {jobs:Map<string,{awaitingTransfer:boolean;target:string;state:{status:string}}>}).jobs.get(id)!;
  job.awaitingTransfer=true;job.target='fixture-only.bin';job.state.status='choosing-target';
  let received=0;
  const item=Object.assign(new EventEmitter(),{getURL:()=> 'https://download.test/file-5',getTotalBytes:()=>4096,getReceivedBytes:()=>received,setSavePath:()=>{},cancel:()=>{}});
  try{
    f.target.emit('will-download',{preventDefault:()=>assert.fail('Approved adapter transfer must be accepted')},item,owner);
    const before=f.changes();
    for(let i=0;i<100;i++)item.emit('updated',{},'progressing');
    console.log('DOWNLOAD_PROGRESS_DUPLICATES '+JSON.stringify({events:100,extraNotifications:f.changes()-before}));
    assert.equal(f.changes()-before,0);
    for(const value of [1024,2048,4096]){received=value;item.emit('updated',{},'progressing');}
    assert.equal(f.changes()-before,3);assert.equal(f.manager.snapshots()[0]!.receivedBytes,4096);
    item.emit('done',{},'completed');
    assert.equal(f.changes()-before,4);assert.equal(f.manager.snapshots()[0]!.status,'completed');
    assert.equal(item.listenerCount('updated'),0);assert.equal(item.listenerCount('done'),0);assert.equal(owner.listenerCount('destroyed'),0);
  }finally{f.manager.dispose();}
});
