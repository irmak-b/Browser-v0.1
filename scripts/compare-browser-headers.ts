// Own localhost probe. Deliberately never record cookies, auth or referrers.
import {createServer} from 'node:http';
import {writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {PackagedDriver} from '../tests/packaged/driver';
async function main(){
 const out=process.argv[2];if(!out||existsSync(out))throw Error('New report required');
 const names=['user-agent','accept-language','sec-ch-ua','sec-ch-ua-platform','sec-ch-ua-mobile','sec-fetch-dest','sec-fetch-mode','sec-fetch-site','sec-fetch-user','accept','priority','cache-control','pragma','upgrade-insecure-requests','accept-encoding'];
 const requests:any[]=[];
 const server=createServer((req,res)=>{if(req.url==='/probe'){requests.push(Object.fromEntries(names.map(name=>[name,req.headers[name]??null])));writeFileSync(out,JSON.stringify({method:'Own localhost fixed header allowlist; never cookie/auth/referrer',requests},null,2));}res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Browser Core header probe</title><p>Yerel tanı tamamlandı.</p>');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/probe`;console.log('LOCAL_PROBE '+url);
 const d=new PackagedDriver(),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
 try{await d.launch(resolve('node_modules/electron/dist/electron.exe'),env,false,[resolve('tests/fixtures/google-control.cjs'),'--control-origin='+url],{mainOnly:true});await new Promise(r=>setTimeout(r,2500));await d.close();await new Promise<void>(r=>{const timer=setInterval(()=>{if(requests.length>=2){clearInterval(timer);clearTimeout(timeout);r();}},250);const timeout=setTimeout(()=>{clearInterval(timer);r();},60000);});}
 finally{await d.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
 console.log('SELECTED_HEADERS '+JSON.stringify(requests));
}
main().catch(()=>{console.error('Header comparison incomplete');process.exitCode=1;});
