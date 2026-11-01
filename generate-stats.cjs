const fs = require('fs');
const {gitChanges} = require('./git-stats.cjs');
const {loadCache, saveCache} = require('./stats-cache.cjs');
const token = process.env.STATS_TOKEN;
if (!token || !token.startsWith('github_pat_')) throw Error('Configure a dedicated fine-grained read-only token; CLI/classic tokens are not accepted.');
const cacheKey = process.env.STATS_CACHE_KEY;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
(async()=>{
 const cacheFile=process.env.STATS_CACHE_FILE || '.stats-cache/aggregates.enc';
 const cache=loadCache(cacheFile, cacheKey);
 let detailRequests=0, apiRequests=0;
 let phase='quota check';
 const report=(reason)=>{console.error(`Profile refresh failed during ${phase}: ${reason}. Previous README retained.`);};
 const budget=Number(process.env.STATS_DETAIL_BUDGET || 2500);
 const reserve=Number(process.env.STATS_CORE_RESERVE || 1500);
 let coreRemaining=Infinity;
 const since=new Date(Date.now()-365*86400000).toISOString().slice(0,10);
 async function request(url,headers) {
  for(let attempt=0;attempt<4;attempt++){
   apiRequests++;
   const r=await fetch(url,{headers});
   if(r.headers.get('x-ratelimit-resource')==='core') coreRemaining=Number(r.headers.get('x-ratelimit-remaining'));
   if(r.ok)return r.json();
   const body=await r.json().catch(()=>({}));
   if((r.status===403 || r.status===429) && (r.headers.get('x-ratelimit-remaining')==='0' || /rate limit/i.test(body.message||''))){
    const reset=Number(r.headers.get('x-ratelimit-reset')||0)*1000;
    const delay=Math.max(60000,Number(r.headers.get('retry-after')||0)*1000,reset-Date.now()+2000); if(delay>120000)throw Error('GitHub rate limit reset is too far away');
    await new Promise(resolve=>setTimeout(resolve,delay));continue;
   }
   throw Error(`GitHub API returned HTTP ${r.status}`);
  }
  throw Error('GitHub rate limit retry exhausted');
 }
 async function countSearch(kind, term) {
  const url=`https://api.github.com/search/${kind}?q=${encodeURIComponent(term)}&per_page=1`;
  const j=await request(url,{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','User-Agent':'rintify-profile'}); if(j.incomplete_results) throw Error('Search count incomplete'); return j.total_count;
 }
 const quota=await request('https://api.github.com/rate_limit',{Authorization:`Bearer ${token}`,'User-Agent':'rintify-profile'});
 coreRemaining=quota.resources.core.remaining;
 if(coreRemaining<=reserve){console.log('Profile refresh deferred: preserving API quota for other tasks.');return;}
 phase='issue and pull request search';
 const [prs,issues]=await Promise.all([
  countSearch('issues',`author:rintify type:pr created:>=${since}`),
  countSearch('issues',`author:rintify type:issue created:>=${since}`)
 ]);
 const langs={}, hours=Array(24).fill(0), hits=[];
 const names={ts:'TypeScript',tsx:'TypeScript',js:'JavaScript',jsx:'JavaScript',mjs:'JavaScript',cjs:'JavaScript',rs:'Rust',py:'Python',cs:'C#',cpp:'C++',cc:'C++',c:'C',h:'C/C++ header',hpp:'C++',java:'Java',kt:'Kotlin',go:'Go',html:'HTML',css:'CSS',scss:'SCSS',dart:'Dart',swift:'Swift',shader:'ShaderLab',hlsl:'HLSL',glsl:'GLSL',sh:'Shell',ps1:'PowerShell',lua:'Lua',sql:'SQL',gd:'GDScript',vue:'Vue',svelte:'Svelte',rb:'Ruby',php:'PHP'};
 const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','User-Agent':'rintify-profile'};
 async function api(url){return request(url,headers);}
 phase='commit search';
 const today=new Date(); today.setUTCHours(23,59,59,999);
 const start=new Date(`${since}T00:00:00Z`);
 let windowStart=new Date(start);
 while(windowStart<=today){
  const windowEnd=new Date(Date.UTC(windowStart.getUTCFullYear(),windowStart.getUTCMonth()+1,0,23,59,59));
  if(windowEnd>today) windowEnd.setTime(today.getTime());
  const range=`${windowStart.toISOString().slice(0,10)}..${windowEnd.toISOString().slice(0,10)}`;
  const term=`author:rintify author-date:${range}`;
  let page=1, seen=0, total=0;
  do {
   let data;
   for(let retry=0;retry<4;retry++) { data=await api(`https://api.github.com/search/commits?q=${encodeURIComponent(term)}&per_page=100&page=${page}`); if(!data.incomplete_results)break; await new Promise(resolve=>setTimeout(resolve,3000)); }
   if(data.incomplete_results) throw Error(`Commit search incomplete for ${range}`);
   if(data.total_count>1000) throw Error(`Commit search monthly limit exceeded for ${range}`);
   total=data.total_count; hits.push(...data.items); seen+=data.items.length; page++;
   if(data.items.length===0 && seen<total) throw Error('Commit search returned incomplete pages');
  } while(seen<total);
  windowStart=new Date(windowEnd.getTime()+1000);windowStart.setUTCHours(0,0,0,0);
 }
 const unique=new Map(hits.map(h=>[`${h.repository.id}:${h.sha}`,h]));
 const entries=[...unique.values()];
 // Re-enumerate the rolling year to detect newly indexed commits and removals.
 // Commit details are immutable for a repository + SHA; fetch only missing details.
 const id=h=>`${h.repository.id}:${h.sha}`;
 let completed=0;
 phase='commit detail retrieval';
 try {
  for(const h of entries){
   const key=id(h);
   if(cache[key])continue;
   let page=1, changes={}, complete=false;
   while(page<=30){
    if(detailRequests>=budget || coreRemaining<=reserve)break;
    detailRequests++;
    const detail=await api(`https://api.github.com/repos/${encodeURIComponent(h.repository.owner.login)}/${encodeURIComponent(h.repository.name)}/commits/${h.sha}?per_page=100&page=${page}`);
    const batch=detail.files||[];
    for(const f of batch){const ext=(f.filename.split('.').pop()||'').toLowerCase(), name=names[ext];if(name)changes[name]=(changes[name]||0)+(f.additions||0)+(f.deletions||0);}
    if(batch.length<100){complete=true;break;}
    if(page===30){
     console.log('Large commit: collecting full changes with Git.');
     changes=gitChanges(h,token,names);complete=true;break;
    }
    page++;
   }
   if(!complete)break;
   cache[key]=changes;
   completed++;
   if(completed%50===0){saveCache(cacheFile,cacheKey,cache);console.log(`Saved ${completed} new commit aggregates.`);}
  }
 } catch(e) {
  const safe=/^(Git fallback failed|GitHub API returned HTTP \d{3}|GitHub rate limit reset is too far away|GitHub rate limit retry exhausted|Commit exceeds the API file limit; keeping the previous profile\.)$/.test(e.message) ? e.message : 'unexpected error';
  report(`${safe}; completed ${completed} commits`);
  process.exitCode=1;return;
 } finally {
  saveCache(cacheFile,cacheKey,cache);
 }
 const missing=entries.filter(h=>!cache[id(h)]).length;
 console.log(`API requests: ${apiRequests}; commit detail requests: ${detailRequests}; cached commits reused: ${entries.length-missing-completed}; pending: ${missing}`);
 if(missing){console.log('Saved progress; keeping the previous README until aggregation is complete.');return;}
 const activeCache={};
 for(const h of entries){
  const changes=cache[id(h)];activeCache[id(h)]=changes;
  for(const [name,n] of Object.entries(changes))langs[name]=(langs[name]||0)+n;
  const date=h.commit.author?.date;if(date)hours[(new Date(date).getUTCHours()+9)%24]++;
 }
 saveCache(cacheFile,cacheKey,activeCache);
 const commits=entries.length;
 const top=Object.entries(langs).sort((a,b)=>b[1]-a[1]).slice(0,10), sum=Object.values(langs).reduce((a,b)=>a+b,0)||1;
 const max=Math.max(1,...hours);
 const months={};
 for(const entry of entries) {
  const date=entry.commit.author?.date;
  if(date){const month=new Date(new Date(date).getTime()+9*3600000).toISOString().slice(0,7);months[month]=(months[month]||0)+1;}
 }
 const monthEntries=Object.entries(months).sort((a,b)=>a[0].localeCompare(b[0]));
 const peak=Math.max(1,...monthEntries.map(([,v])=>v));
 const graph=monthEntries.map(([month,value])=>`${month}  ${'█'.repeat(Math.round(24*value/peak))} ${value}`).join('\n');
 const languagePeak=Math.max(1,...top.map(([,n])=>n));
 const languageBar=n=>{const units=Math.max(1,Math.round(256*n/languagePeak));return '█'.repeat(Math.floor(units/8))+(' ▏▎▍▌▋▊▉'[units%8].trim());};
 const formatLines=n=>{for(const [size,unit] of [[1e12,'兆'],[1e8,'億'],[1e4,'万']]){if(n>=size || (size>1e4 && n>=size-size/200000)){const value=Math.round(n/size*10)/10; return `${value}${unit}`;}}return n.toLocaleString('en-US');};
 const bars=top.map(([name,n],i)=>`| ${i+1} | ${esc(name)} | ${formatLines(n)} 行 | \`${languageBar(n)}\` |`).join('\n');
 const hoursGraph=hours.map((v,h)=>`${String(h).padStart(2,'0')}:00  ${'█'.repeat(Math.round(24*v/max))} ${v}`).join('\n');
 const md=`<div align="center">

# R I N T I F Y

✦  ACTIVITY OBSERVATORY  ✦

</div>

| 過去365日 | コミット | プルリクエスト | Issue |
| :--- | ---: | ---: | ---: |
| 公開・非公開 | **${commits}** | **${prs}** | **${issues}** |

### 言語

| 順位 | 言語 | 変更行数 | グラフ |
| ---: | :--- | ---: | :--- |
${bars}

### 活動の軌跡

\`\`\`text
${graph}
\`\`\`

<sub>直近365日間の本人のコミットを日本時間で月ごとに集計しています。</sub>

### 活動時間 · 日本時間

\`\`\`text
${hoursGraph}
\`\`\`

<sub>言語は過去365日間にアクセス可能なリポジトリへ行った本人のコミットで、拡張子から推定した追加・削除行数の合計です。時間帯は同じコミットの日時を集計しています。リポジトリ名やコードは公開しません。</sub>
`;
 fs.writeFileSync('README.md',md);

})().catch(e=>{const m=e.message||'';const safe=/^(Git fallback failed|GitHub API returned HTTP \d{3}|GitHub rate limit reset is too far away|GitHub rate limit retry exhausted|Search count incomplete|Commit search incomplete for \d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}|Commit search monthly limit exceeded for \d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}|Commit search returned incomplete pages|Cache authentication failed; remove the damaged or obsolete encrypted cache before retrying\.|STATS_CACHE_KEY must be an independent random 32-byte hex key)$/.test(m)?m:'unexpected error';console.error(`Profile refresh failed: ${safe}. Previous README retained.`);process.exit(1)});

