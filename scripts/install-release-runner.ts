import {homedir,hostname} from 'node:os';
import {join} from 'node:path';
import {mkdir,chmod,writeFile} from 'node:fs/promises';
import {capture,download,run} from './lib';
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('The release coordinator requires this Apple Silicon Mac.');
const dir=join(homedir(),'Library/Application Support/Act Dock/release-runner');
await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
const repo='MohammedIbrahim8887/act-dock';
if(!(await Bun.file(join(dir,'.runner')).exists())){
  const packages=JSON.parse(await capture(['gh','api',`repos/${repo}/actions/runners/downloads`]));
  let pkg=packages.find((p:{os:string;architecture:string})=>p.os==='osx'&&p.architecture==='arm64');
  if(!pkg){
    const release=JSON.parse(await capture(['gh','api','repos/actions/runner/releases/latest']));
    const asset=release.assets.find((a:{name:string})=>a.name.startsWith('actions-runner-osx-arm64-'));
    if(!asset)throw new Error('GitHub did not provide a macOS ARM64 runner');
    pkg={download_url:asset.browser_download_url,sha256_checksum:asset.digest?.replace('sha256:','')};
  }
  const file=await download(pkg.download_url,join(dir,'runner.tar.gz'),pkg.sha256_checksum);
  await run(['tar','-xzf',file,'-C',dir]);
  const {token}=JSON.parse(await capture(['gh','api','-X','POST',`repos/${repo}/actions/runners/registration-token`]));
  const p=Bun.spawn(['./config.sh','--url',`https://github.com/${repo}`,'--token',token,'--name','act-dock-'+hostname(),'--labels','act-dock-release','--work','_work','--unattended','--replace'],{cwd:dir,stdout:'inherit',stderr:'inherit'});
  if(await p.exited)throw new Error('GitHub runner registration failed');
}
const label='sh.actdock.release-runner';
const xml=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const plist=join(homedir(),'Library/LaunchAgents',label+'.plist');
await mkdir(join(homedir(),'Library/LaunchAgents'),{recursive:true});
const envPath=[join(homedir(),'.bun/bin'),join(homedir(),'.hutch/bin'),'/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin','/usr/sbin','/sbin',process.env.PATH].join(':');
await writeFile(plist,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(join(dir,'run.sh'))}</string></array><key>WorkingDirectory</key><string>${xml(dir)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(envPath)}</string></dict><key>StandardOutPath</key><string>${xml(join(dir,'service.log'))}</string><key>StandardErrorPath</key><string>${xml(join(dir,'service-error.log'))}</string></dict></plist>`,{mode:0o600});
const domain=`gui/${process.getuid!()}`;
try{await capture(['launchctl','print',`${domain}/${label}`]);}catch{await run(['launchctl','bootstrap',domain,plist]);}
console.log('Local release runner installed. Log:',join(dir,'service.log'));
