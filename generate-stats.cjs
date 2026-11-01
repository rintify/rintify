const fs = require('fs');
const token = process.env.STATS_TOKEN;
if (!token) throw Error('STATS_TOKEN is missing');
async function query(q, variables={}) {
 const r=await fetch('https://api.github.com/graphql',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','User-Agent':'rintify-profile'},body:JSON.stringify({query:q,variables})});
 const j=await r.json(); if(!r.ok || j.errors) throw Error(JSON.stringify(j.errors || j)); return j.data;
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
(async()=>{
 const since=new Date(Date.now()-365*86400000).toISOString().slice(0,10);
 async function request(url,headers) {
  for(let attempt=0;attempt<4;attempt++){
   const r=await fetch(url,{headers});
   if(r.ok)return r.json();
   const body=await r.json().catch(()=>({}));
   if((r.status===403 || r.status===429) && (r.headers.get('x-ratelimit-remaining')==='0' || /rate limit/i.test(body.message||''))){
    const reset=Number(r.headers.get('x-ratelimit-reset')||0)*1000;
    const delay=Math.max(1500,reset-Date.now()+2000); if(delay>120000)throw Error('GitHub rate limit reset is too far away');
    await new Promise(resolve=>setTimeout(resolve,delay));continue;
   }
   throw Error(`GitHub API error: ${r.status} ${body.message||''}`);
  }
  throw Error('GitHub rate limit retry exhausted');
 }
 async function countSearch(kind, term) {
  const url=`https://api.github.com/search/${kind}?q=${encodeURIComponent(term)}&per_page=1`;
  const j=await request(url,{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','User-Agent':'rintify-profile'}); if(j.incomplete_results) throw Error('Search count incomplete'); return j.total_count;
 }
 const [commits,prs,issues]=await Promise.all([
  countSearch('commits',`author:rintify author-date:>=${since}`),
  countSearch('issues',`author:rintify type:pr created:>=${since}`),
  countSearch('issues',`author:rintify type:issue created:>=${since}`)
 ]);
 const calendar=(await query(`query { viewer { contributionsCollection { contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }`)).viewer.contributionsCollection.contributionCalendar;
 const langs={}, hours=Array(24).fill(0), hits=[];
 const names={ts:'TypeScript',tsx:'TypeScript',js:'JavaScript',jsx:'JavaScript',mjs:'JavaScript',cjs:'JavaScript',rs:'Rust',py:'Python',cs:'C#',cpp:'C++',cc:'C++',c:'C',h:'C/C++ header',hpp:'C++',java:'Java',kt:'Kotlin',go:'Go',html:'HTML',css:'CSS',scss:'SCSS',dart:'Dart',swift:'Swift',shader:'ShaderLab',hlsl:'HLSL',glsl:'GLSL',sh:'Shell',ps1:'PowerShell',lua:'Lua',sql:'SQL',gd:'GDScript',vue:'Vue',svelte:'Svelte',rb:'Ruby',php:'PHP'};
 const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','User-Agent':'rintify-profile'};
 async function api(url){const r=await fetch(url,{headers});if(!r.ok)throw Error(`GitHub API error: ${r.status}`);return r.json();}
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
   const data=await api(`https://api.github.com/search/commits?q=${encodeURIComponent(term)}&per_page=100&page=${page}`);
   if(data.incomplete_results || data.total_count>1000) throw Error('Commit search incomplete or monthly limit exceeded');
   total=data.total_count; hits.push(...data.items); seen+=data.items.length; page++;
   if(data.items.length===0 && seen<total) throw Error('Commit search returned incomplete pages');
  } while(seen<total);
  windowStart=new Date(windowEnd.getTime()+1000);windowStart.setUTCHours(0,0,0,0);
 }
 const unique=new Map(hits.map(h=>[`${h.repository.id}:${h.sha}`,h]));
 const entries=[...unique.values()]; let index=0, completed=0;
 async function worker(){while(true){const i=index++;if(i>=entries.length)return;const h=entries[i];
  const date=h.commit.author?.date;if(date)hours[(new Date(date).getUTCHours()+9)%24]++;
  let page=1, files=[]; do {const detail=await api(`https://api.github.com/repos/${encodeURIComponent(h.repository.owner.login)}/${encodeURIComponent(h.repository.name)}/commits/${h.sha}?per_page=100&page=${page}`); const batch=detail.files||[];files.push(...batch);if(batch.length<100)break;page++;} while(page<=30);
  for(const f of files){const ext=(f.filename.split('.').pop()||'').toLowerCase(), name=names[ext];if(name) langs[name]=(langs[name]||0)+(f.additions||0)+(f.deletions||0);}
  completed++;if(completed%250===0)console.log(`Processed ${completed}/${entries.length} commits`);
 }}
 await Promise.all(Array.from({length:8},worker));
 const top=Object.entries(langs).sort((a,b)=>b[1]-a[1]).slice(0,6), sum=Object.values(langs).reduce((a,b)=>a+b,0)||1;
 const max=Math.max(1,...hours);
 const months={};
 for(const week of calendar.weeks) for(const day of week.contributionDays) {
  const month=day.date.slice(0,7); months[month]=(months[month]||0)+day.contributionCount;
 }
 const monthEntries=Object.entries(months).sort((a,b)=>a[0].localeCompare(b[0])).slice(-12);
 const peak=Math.max(1,...monthEntries.map(([,v])=>v));
 const graph=monthEntries.map(([month,value])=>`${month}  ${'█'.repeat(Math.round(24*value/peak))} ${value}`).join('\n');
 const bars=top.map(([name,n])=>`| ${esc(name)} | ${'█'.repeat(Math.max(1,Math.round(20*n/sum)))} | ${(n/sum*100).toFixed(1)}% |`).join('\n');
 const hoursGraph=hours.map(v=>'▁▂▃▄▅▆▇█'[Math.min(7,Math.floor(8*v/(max+1)))]).join('');
 const md=`<div align="center">

# R I N T I F Y

✦  ACTIVITY OBSERVATORY  ✦

</div>

| 過去365日 | コミット | プルリクエスト | Issue |
| :--- | ---: | ---: | ---: |
| 公開・非公開 | **${commits}** | **${prs}** | **${issues}** |

### 活動の軌跡

\`\`\`text
${graph}
\`\`\`

<sub>月ごとのGitHubコントリビューション数。非公開分はGitHubのプロフィール設定に従います。</sub>

### 言語

| 言語 | 変更行数 | 割合 |
| :--- | :--- | ---: |
${bars}

### 活動時間 · 日本時間

\`\`\`text
${hoursGraph}
00       06       12       18   23
\`\`\`

<sub>言語は過去365日間にアクセス可能なリポジトリへ行った本人のコミットで、拡張子から推定した追加・削除行数の合計です。時間帯は同じコミットの日時を集計しています。リポジトリ名やコードは公開しません。</sub>
`;
 fs.writeFileSync('README.md',md);

})().catch(e=>{console.error(e.message);process.exit(1)});

