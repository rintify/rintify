const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {loadCache, saveCache} = require('./stats-cache.cjs');
const testKey = 'ab'.repeat(32);

test('generator rejects classic tokens and missing independent keys before network access', () => {
  for (const env of [
    {STATS_TOKEN:'ghp_fixture',STATS_CACHE_KEY:testKey},
    {STATS_TOKEN:'github_pat_fixture',STATS_CACHE_KEY:''},
  ]) {
    const result=spawnSync(process.execPath,[path.join(__dirname,'generate-stats.cjs')],{
      encoding:'utf8',env:{...process.env,...env},
    });
    assert.notEqual(result.status,0);
    assert.equal(result.stderr.includes(env.STATS_TOKEN),false);
  }
});

test('cache authenticates ciphertext without persisting private identifiers', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'profile-cache-'));
  try {
    const file=path.join(dir,'cache.enc'), entries={'private-repository:sha':{TypeScript:42}};
    saveCache(file,testKey,entries);
    assert.deepEqual(loadCache(file,testKey),entries);
    assert.equal(fs.readFileSync(file).includes(Buffer.from('private-repository')),false);
    assert.throws(()=>loadCache(file,'cd'.repeat(32)),/authentication failed/);
    assert.throws(()=>loadCache(file,'test-token'),/32-byte hex key/);
    const data=fs.readFileSync(file);data[data.length-1]^=1;fs.writeFileSync(file,data);
    assert.throws(()=>loadCache(file,testKey),/authentication failed/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('refresh reuses details, detects changes, checkpoints, and preserves quota', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'profile-refresh-'));
  const fixture=path.join(dir,'fetch.cjs');
  fs.writeFileSync(fixture, `
    global.fetch=async input=>{
      const u=new URL(input), q=u.searchParams.get('q')||'';
      let body;
      const day=new Date().toISOString().slice(0,10);
      if(u.pathname==='/rate_limit')body={resources:{core:{remaining:Number(process.env.TEST_QUOTA||5000)}}};
      else if(u.pathname==='/search/issues')body={total_count:7};
      else if(u.pathname==='/search/commits'){
        const range=q.split('author-date:')[1].split('..');
        const items=day>=range[0]&&day<=range[1] ? (process.env.TEST_SHAS||'a,b').split(',').map(sha=>({sha,repository:{id:1,owner:{login:'private-owner'},name:'private-repo'},commit:{author:{date:day+'T03:00:00Z'}}})) : [];
        body={total_count:items.length,items};
      }else if(u.pathname.includes('/commits/'))body={files:[{filename:'private-dir/file.ts',additions:3,deletions:2}]};
      else throw Error('Unexpected request');
      return {ok:true,headers:new Headers(),json:async()=>body};
    };
  `);
  const run=env=>{
    const result=spawnSync(process.execPath,['--require',fixture,path.join(__dirname,'generate-stats.cjs')],{cwd:dir,encoding:'utf8',env:{...process.env,STATS_TOKEN:'github_pat_fixture',STATS_CACHE_KEY:testKey,...env}});
    assert.equal(result.status,0,result.stderr);
    return result.stdout;
  };
  try {
    assert.match(run({}),/commit detail requests: 2/);
    assert.match(fs.readFileSync(path.join(dir,'README.md'),'utf8'),/10 行/);
    assert.match(run({STATS_TOKEN:'github_pat_rotated_fixture'}),/commit detail requests: 0/);
    assert.match(run({TEST_SHAS:'b,c'}),/commit detail requests: 1/);
    assert.equal(Object.keys(loadCache(path.join(dir,'.stats-cache/aggregates.enc'),testKey)).length,2);
    const previous=fs.readFileSync(path.join(dir,'README.md'),'utf8');
    assert.match(run({TEST_QUOTA:'1500'}),/preserving API quota/);
    assert.equal(fs.readFileSync(path.join(dir,'README.md'),'utf8'),previous);
    assert.match(run({TEST_SHAS:'b,c,d,e',STATS_DETAIL_BUDGET:'1'}),/pending: 1/);
    assert.equal(fs.readFileSync(path.join(dir,'README.md'),'utf8'),previous);
    assert.match(run({TEST_SHAS:'b,c,d,e'}),/commit detail requests: 1/);
    assert.match(fs.readFileSync(path.join(dir,'README.md'),'utf8'),/20 行/);
    assert.equal(fs.readFileSync(path.join(dir,'README.md'),'utf8').includes('private-repo'),false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
