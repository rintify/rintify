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
 async function countSearch(kind, term) {
  const url=`https://api.github.com/search/${kind}?q=${encodeURIComponent(term)}&per_page=1`;
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','User-Agent':'rintify-profile'}});
  const j=await r.json(); if(!r.ok || j.incomplete_results) throw Error('Search count unavailable or incomplete'); return j.total_count;
 }
 const [commits,prs,issues]=await Promise.all([
  countSearch('commits',`author:rintify author-date:>=${since}`),
  countSearch('issues',`author:rintify type:pr created:>=${since}`),
  countSearch('issues',`author:rintify type:issue created:>=${since}`)
 ]);
 const calendar=(await query(`query { viewer { contributionsCollection { contributionCalendar { weeks { contributionDays { contributionCount } } } } } }`)).viewer.contributionsCollection.contributionCalendar;
 const langs={}, hours=Array(24).fill(0); let cursor=null, repos=0;
 do {
  const data=await query(`query($cursor:String) { viewer { repositories(first: 50, after:$cursor, ownerAffiliations: OWNER, isFork:false, orderBy:{field:UPDATED_AT,direction:DESC}) { pageInfo { hasNextPage endCursor } nodes { languages(first: 10, orderBy:{field:SIZE,direction:DESC}) { edges { size node { name } } } defaultBranchRef { target { ... on Commit { history(first: 30, author:{id:"MDQ6VXNlcjg3NDYyNjA0"}) { nodes { committedDate } } } } } } } } }`,{cursor});
  const rs=data.viewer.repositories;
  for(const r of rs.nodes){repos++; for(const e of r.languages.edges) langs[e.node.name]=(langs[e.node.name]||0)+e.size; for(const h of (r.defaultBranchRef?.target?.history?.nodes||[])) hours[(new Date(h.committedDate).getUTCHours()+9)%24]++;}
  cursor=rs.pageInfo.hasNextPage?rs.pageInfo.endCursor:null;
 } while(cursor);
 const top=Object.entries(langs).sort((a,b)=>b[1]-a[1]).slice(0,6), sum=Object.values(langs).reduce((a,b)=>a+b,0)||1;
 const max=Math.max(1,...hours);
 const weeks=calendar.weeks.slice(-52);
 const shades=['·','░','▒','▓','█'];
 const graph=Array.from({length:7},(_,day)=>weeks.map(w=>{const v=w.contributionDays[day]?.contributionCount||0; return shades[v===0?0:v<4?1:v<10?2:v<25?3:4]}).join('')).join('\n');
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

<sub>薄 · ░ ▒ ▓ █ 濃 ｜GitHubのコントリビューショングラフに準拠。非公開分はGitHubのプロフィール設定に従います。</sub>

### 言語

| 言語 | コード量 | 割合 |
| :--- | :--- | ---: |
${bars}

### 活動時間 · 日本時間

\`\`\`text
${hoursGraph}
00       06       12       18   23
\`\`\`

<sub>言語は所有する非フォークリポジトリのコード量。時間帯は各リポジトリの既定ブランチにある直近30件までの自分のコミットを集計したサンプルです。リポジトリ名やコードは公開しません。</sub>
`;
 fs.writeFileSync('README.md',md);

})().catch(e=>{console.error(e.message);process.exit(1)});
