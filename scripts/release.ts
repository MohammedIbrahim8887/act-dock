import {mkdtemp,mkdir,cp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {root,run,capture,sha256} from './lib';
const repository='MohammedIbrahim8887/act-dock';
export function nextVersion(base:string,latest?:string){
  if(!/^\d+\.\d+\.\d+$/.test(base))throw new Error('Invalid base version');
  const previous=latest?.replace(/^v/,'');if(!previous||!/^\d+\.\d+\.\d+$/.test(previous))return base;
  const a=base.split('.').map(Number),b=previous.split('.').map(Number);
  for(let i=0;i<3;i++){if(a[i]>b[i])return base;if(a[i]<b[i])return `${b[0]}.${b[1]}.${b[2]+1}`;}
  return `${b[0]}.${b[1]}.${b[2]+1}`;
}
export async function release(){
  const commit=await capture(['git','rev-parse','HEAD']);
  if(process.env.GITHUB_REF && process.env.GITHUB_REF!=='refs/heads/main')throw new Error('Release must run from main');
  if(!process.env.GITHUB_REF && await capture(['git','branch','--show-current'])!=='main')throw new Error('Release must run from main');
  if(await capture(['git','status','--porcelain']))throw new Error('Commit all changes before releasing');
  let latest:string|undefined;
  try{latest=JSON.parse(await capture(['gh','release','view','--repo',repository,'--json','tagName'])).tagName;}catch{}
  const base=(await Bun.file(join(root,'package.json')).json()).version;
  const version=nextVersion(base,latest),tag='v'+version;
  const temp=await mkdtemp(join(tmpdir(),'act-dock-release-')),stage=join(temp,'act-dock');
  try{
    await run(['git','worktree','add','--detach',stage,commit]);
    for(const file of ['package.json','apps/desktop/package.json','apps/web/package.json']){
      const path=join(stage,file);const data=await Bun.file(path).json();data.version=version;await Bun.write(path,JSON.stringify(data,null,2)+'\n');
    }
    await Bun.write(join(stage,'apps/desktop/src/shared/version.ts'),`export const APP_VERSION = ${JSON.stringify(version)};\n`);
    await run(['bun','install','--frozen-lockfile'],stage);
    await run(['bun','scripts/run-ci.ts'],stage,{...process.env,ACT_DOCK_TRANSIENT_PROJECT:'1'});
    await run(['docker','build','--platform','linux/amd64','-t','act-dock-build:0.2.0','-f','scripts/docker/Dockerfile','.'],stage);
    await run(['hutch','run','build'],join(stage,'apps/desktop'));
    await mkdir(join(stage,'artifacts'),{recursive:true});
    const macArtifacts=join(stage,'apps/desktop/artifacts');
    for(const file of await readdir(macArtifacts))if(/^(?:stable-)?macos-arm64-/.test(file))await cp(join(macArtifacts,file),join(stage,'artifacts',file));
    await run(['bun','scripts/build-linux.ts'],stage);
    await run(['bun','scripts/build-windows.ts'],stage);
    const specs=[
      ['macos-arm64','macos-arm64-ActDock.dmg','macos','arm64','DMG'],
      ['windows-x64','windows-x64-ActDock-Setup.exe','windows','x64','EXE'],
      ['linux-x64-deb','linux-x64-ActDock.deb','linux','x64','DEB'],
      ['linux-x64-rpm','linux-x64-ActDock.rpm','linux','x64','RPM'],
      ['linux-x64-appimage','linux-x64-ActDock.AppImage','linux','x64','AppImage'],
    ];
    const directory=join(stage,'artifacts');
    const assets=[];
    for(const [kind,name,platform,arch,format] of specs){
      const file=Bun.file(join(directory,name));if(!await file.exists()||file.size<1000000)throw new Error('Missing installer: '+name);
      assets.push({kind,name,platform,arch,format,size:file.size,sha256:await sha256(join(directory,name)),url:`https://github.com/${repository}/releases/download/${tag}/${name}`});
    }
    await Bun.write(join(directory,'manifest.json'),JSON.stringify({version,publishedAt:new Date().toISOString(),commit,assets},null,2)+'\n');
    const files=(await readdir(directory)).filter(f=>!f.endsWith('-preview.png')&&!f.endsWith('.sha256'));
    await Bun.write(join(directory,'SHA256SUMS'),(await Promise.all(files.map(async name=>`${await sha256(join(directory,name))}  ${name}`))).join('\n')+'\n');
    const notes=join(temp,'notes.md');await Bun.write(notes,`Act Dock ${version}\n\nDesktop installers for macOS Apple Silicon, Windows x64, and Linux x64 (DEB, RPM, AppImage).\n\n[Download and setup guide](https://act-dock.mohammedibrahim.dev) · [Source commit](https://github.com/${repository}/commit/${commit})\n\nChecks run locally through Act Dock. Packages are unsigned. Windows packaging is cross-assembled from the pinned Electrobun 2.0.5 native core; a Windows GUI smoke test requires a Windows machine.\n`);
    await run(['gh','release','create',tag,'--repo',repository,'--target',commit,'--title','Act Dock '+version,'--notes-file',notes,'--draft',...files.map(f=>join(directory,f)),join(directory,'SHA256SUMS')],stage);
    await run(['gh','release','edit',tag,'--repo',repository,'--draft=false','--latest'],stage);
    await run(['bun','run','deploy'],stage);
    console.log(`Published https://github.com/${repository}/releases/tag/${tag}`);
  }finally{
    await capture(['git','worktree','remove','--force',stage]).catch(()=>{});
    await rm(temp,{recursive:true,force:true});
  }
}
if(import.meta.main)await release();
