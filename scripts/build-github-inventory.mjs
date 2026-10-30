// Read only explicitly permitted source roots. Never traverse profiles, secrets,
// runtime outputs or tool state. This prepares a review manifest, not a Git index.
import {readdirSync,lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';

const root=resolve('.'),output='docs/GITHUB_DOSYA_LISTESI.json';
const roots=['src','tests','scripts','docs/third-party'];
const rootFiles=['README.md','README_TR.md','.gitignore','package.json','package-lock.json','app-version.json','tsconfig.json','electron.vite.config.ts','playwright.config.ts','playwright.packaged.config.ts'];
// Publish project documentation by explicit file name, never local session
// journals, agent instructions, historical receipts or raw measurement reports.
const projectDocs=['docs/GITHUB_DEVIR_TR.md','docs/CORE_DURUM_TR.md','docs/WINDOWS_CALISTIR_TR.txt','docs/validation/V1.0.14.0.md',
 'docs/browser-plan/README_TR.md','docs/browser-plan/PLAN.md','docs/browser-plan/ARCH.md',
 'docs/browser-plan/SOZLESME.md','docs/browser-plan/EKIP.md','docs/browser-plan/TEST.md'];
const skip=new Set(['node_modules','out','artifacts','.cache','test-results','playwright-report','coverage','.git','.codex','.agents','.aws','.ssh','profiles','userData']);
const extensions=/\.(?:md|txt|ts|tsx|js|mjs|cjs|css|html|json|ps1|png|sha256)$/;
const candidates=[];
function add(path){
 const absolute=resolve(path);if(!absolute.startsWith(root+sep))throw Error('Outside source root');
 const stat=lstatSync(absolute);if(stat.isSymbolicLink())throw Error('Linked source entry requires separate review');
 if(stat.isDirectory()){
  if(skip.has(path.split('/').at(-1))||path==='docs/evidence')return;
  for(const name of readdirSync(absolute).sort())add(`${path}/${name}`);return;
 }
 if(!stat.isFile()||path===output||/\/(?:\.env(?:\..*)?|Cookies|Login Data|Local State)$/.test(path))return;
 if(!rootFiles.includes(path)&&!extensions.test(path)&&path!=='src/main/browser/filter-data/engine.bin')return;
 const body=readFileSync(absolute),findings=[];
 if(extensions.test(path)||path==='.gitignore'){
  const text=body.toString('utf8');
  for(const [kind,pattern] of [
   ['private-key-header',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
   ['github-token-shape',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],
   ['postgres-credential-url',/postgres(?:ql)?:\/\/[^\s/:]+:[^\s/@]+@/i],
   ['personal-windows-path',/C:[/\\]Users[/\\][^/\\\s]+/i],
  ])if(pattern.test(text))findings.push(kind);
  if(path.endsWith('.md')){
   if(/(?:^|[\s("'<>])(?:[A-Za-z]:[\\/]|\/(?:Users|home|mnt)\/)|~[\\/]/m.test(text))findings.push('absolute-local-path-in-documentation');
   if(/LAST_USER_ACCEPTED|CODE_ALLOWED|KULLANICI_KABULU_BEKLENIYOR|Kullanıcı (?:istedi|onayladı|dedi|kabul etti)|bilgisayarı (?:kullan|boş)|onayını|repo adresi/i.test(text))findings.push('session-context-in-documentation');
  }
 }
 candidates.push({path,bytes:stat.size,sha256:createHash('sha256').update(body).digest('hex'),reviewFlags:findings});
}
for(const path of [...rootFiles,...projectDocs,...roots])add(path);
candidates.sort((a,b)=>a.path.localeCompare(b.path,'en'));
const report={version:JSON.parse(readFileSync('app-version.json','utf8')).display,
 method:'Explicit source allowlist; no Git index, remote, commit or push. Never reads excluded secret/profile/cache/tool files. Limited pattern scan of included text is not a comprehensive secret guarantee. Review flags contain category and file name only, never matching content.',
 manifestSelf:'This JSON is intended for the repository too, but excludes its own hash to avoid a circular manifest.',
 files:candidates,fileCount:candidates.length,totalBytes:candidates.reduce((n,f)=>n+f.bytes,0),
 reviewFlaggedFiles:candidates.filter(f=>f.reviewFlags.length).length,
 excluded:['node_modules/','out/','artifacts/','.cache/','test-results/','playwright-report/','coverage/',
 'docs/evidence/','AGENTS.md','local session journals and historical reports','documentation outside the explicit project list',
 'real .env/secrets','profiles/userData/cookies','personal logs and DB backups','machine/tool settings']};
if(report.reviewFlaggedFiles)throw Error('Source review flags require resolution before export');
if(process.argv[2]==='--check'){
 const saved=JSON.parse(readFileSync(output,'utf8'));
 if(JSON.stringify(saved)!==JSON.stringify(report))throw Error('Review inventory is stale; regenerate before staging');
 console.log(`GITHUB_REVIEW_INVENTORY_VALID files=${report.fileCount} bytes=${report.totalBytes} flagged=${report.reviewFlaggedFiles}`);
}else{
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(`GITHUB_REVIEW_INVENTORY_READY files=${report.fileCount} bytes=${report.totalBytes} flagged=${report.reviewFlaggedFiles}`);
}
