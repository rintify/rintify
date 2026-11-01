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
 const langs={}, hours=Array(24).fill(0); let cursor=null, repos=0;
 do {
  const data=await query(`query($cursor:String) { viewer { repositories(first: 50, after:$cursor, ownerAffiliations: OWNER, isFork:false, orderBy:{field:UPDATED_AT,direction:DESC}) { pageInfo { hasNextPage endCursor } nodes { languages(first: 10, orderBy:{field:SIZE,direction:DESC}) { edges { size node { name } } } defaultBranchRef { target { ... on Commit { history(first: 30, author:{id:"MDQ6VXNlcjg3NDYyNjA0"}) { nodes { committedDate } } } } } } } } }`,{cursor});
  const rs=data.viewer.repositories;
  for(const r of rs.nodes){repos++; for(const e of r.languages.edges) langs[e.node.name]=(langs[e.node.name]||0)+e.size; for(const h of (r.defaultBranchRef?.target?.history?.nodes||[])) hours[(new Date(h.committedDate).getUTCHours()+9)%24]++;}
  cursor=rs.pageInfo.hasNextPage?rs.pageInfo.endCursor:null;
 } while(cursor);
 const top=Object.entries(langs).sort((a,b)=>b[1]-a[1]).slice(0,6), sum=Object.values(langs).reduce((a,b)=>a+b,0)||1;
 const max=Math.max(1,...hours); let shapes='';
 top.forEach(([n,v],i)=>{let y=370+i*31;shapes+=`<text x="48" y="${y}" class="label">${esc(n)}</text><rect x="190" y="${y-13}" width="${Math.max(2,Math.round(260*v/sum))}" height="10" rx="5" fill="#72d8ee"/><text x="465" y="${y}" class="muted">${(v/sum*100).toFixed(1)}%</text>`;});
 hours.forEach((v,i)=>{let hh=Math.round(105*v/max);shapes+=`<rect x="${540+i*14}" y="${523-hh}" width="9" height="${Math.max(1,hh)}" rx="3" fill="#a48dff"/>`;});
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="610" viewBox="0 0 960 610"><style>text{font-family:Arial,sans-serif;fill:#edf7ff}.small{font-size:14px;letter-spacing:3px;fill:#86d9f2}.label{font-size:15px}.muted{font-size:13px;fill:#a3b4cd}.big{font-size:30px;font-weight:bold}.title{font-size:20px;font-weight:bold}</style><rect width="960" height="610" rx="24" fill="#101a30"/><circle cx="900" cy="70" r="110" fill="#1b2c4c"/><text x="40" y="52" class="small">RINTIFY / ACTIVITY OBSERVATORY</text><text x="70" y="130" class="big">${commits}</text><text x="70" y="158" class="muted">commits / last 365 days</text><text x="365" y="130" class="big">${prs}</text><text x="365" y="158" class="muted">pull requests / last 365 days</text><text x="700" y="130" class="big">${issues}</text><text x="700" y="158" class="muted">issues / last 365 days</text>${shapes}<text x="40" y="322" class="title">LANGUAGE CONSTELLATION</text><text x="40" y="344" class="muted">Code size across owned non-fork repositories</text><text x="540" y="322" class="title">ACTIVE HOURS / JST</text><text x="540" y="344" class="muted">Recent default-branch commits / sample</text><text x="540" y="550" class="muted">00</text><text x="704" y="550" class="muted">12</text><text x="850" y="550" class="muted">23</text><text x="40" y="585" class="muted">Public + private aggregates / no repository names or code</text></svg>`;
 fs.mkdirSync('assets',{recursive:true});fs.writeFileSync('assets/activity-v2.svg',svg);
})().catch(e=>{console.error(e.message);process.exit(1)});
