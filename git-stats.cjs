const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

function parseNumstat(data, names) {
  const fields=data.toString('utf8').split('\0'), changes={};
  for(let i=0;i<fields.length;i++){
    if(!fields[i])continue;
    const match=/^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(fields[i]);
    if(!match)throw Error('Invalid Git numstat data');
    let filename=match[3];
    if(!filename){i++;filename=fields[++i];} // -z rename: old path, new path
    const name=names[(filename.split('.').pop()||'').toLowerCase()];
    if(name && match[1]!=='-' && match[2]!=='-')changes[name]=(changes[name]||0)+Number(match[1])+Number(match[2]);
  }
  return changes;
}
function gitChanges(hit, token, names) {
  const owner=hit.repository.owner.login, repo=hit.repository.name, sha=hit.sha;
  if(!/^[\w.-]+$/.test(owner)||!/^[\w.-]+$/.test(repo)||! /^[a-f0-9]{40}$/.test(sha))throw Error('Invalid Git target');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'profile-git-'));
  const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:os.devNull,
    GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0:`AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`};
  const git=args=>execFileSync('git',args,{cwd:dir,env,stdio:['ignore','pipe','pipe'],timeout:600000,maxBuffer:32*1024*1024});
  try {
    git(['init','--bare']);
    git(['remote','add','origin',`https://github.com/${owner}/${repo}.git`]);
    git(['-c','protocol.version=2','fetch','--quiet','--filter=blob:none','--depth=2','origin',sha]);
    const parents=git(['show','-s','--format=%P',sha]).toString().trim().split(' ').filter(Boolean);
    const args=parents.length?['diff',parents[0],sha]:['diff-tree','--root','--no-commit-id','-r',sha];
    return parseNumstat(git([...args,'--numstat','-z','--find-renames','--no-ext-diff','--no-textconv']),names);
  } catch {
    // Git stderr can contain private repository names or URLs; never publish it.
    throw Error('Git fallback failed');
  } finally {
    if(path.dirname(dir)===path.resolve(os.tmpdir()) && path.basename(dir).startsWith('profile-git-'))fs.rmSync(dir,{recursive:true,force:true});
  }
}
module.exports={parseNumstat,gitChanges};
