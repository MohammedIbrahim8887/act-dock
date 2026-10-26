import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
export const root = resolve(import.meta.dir,'..');
export const desktop = resolve(root,'apps/desktop');
export const output = resolve(root,'artifacts');
export async function run(args:string[],cwd=root,env:NodeJS.ProcessEnv=process.env) {
  console.log('+',args.join(' '));
  const child=Bun.spawn(args,{cwd,env,stdout:'inherit',stderr:'inherit'});
  if(await child.exited)throw new Error('Command failed: '+args[0]);
}
export async function capture(args:string[],cwd=root) {
  const child=Bun.spawn(args,{cwd,stdout:'pipe',stderr:'pipe'});
  const [out,err,status]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  if(status)throw new Error(err||out||args.join(' '));
  return out.trim();
}
export async function sha256(file:string){return createHash('sha256').update(new Uint8Array(await Bun.file(file).arrayBuffer())).digest('hex')}
export async function download(url:string,file:string,hash?:string){
  const cached=hash ? resolve(homedir(),'.cache/act-dock-downloads',hash) : undefined;
  await mkdir(resolve(file,'..'),{recursive:true});
  if(await Bun.file(file).exists() && (!hash||await sha256(file)===hash)) {
    if(cached && !await Bun.file(cached).exists()){await mkdir(resolve(cached,'..'),{recursive:true});await copyFile(file,cached);}
    return file;
  }
  if(cached && await Bun.file(cached).exists() && await sha256(cached)===hash){await copyFile(cached,file);return file;}
  await run(['curl','-4','-fsSL','--retry','3','--retry-all-errors','--connect-timeout','20','--max-time','300','--output',file,url]);
  if(hash && await sha256(file)!==hash)throw new Error('Checksum mismatch: '+file);
  if(cached){await mkdir(resolve(cached,'..'),{recursive:true});await copyFile(file,cached);}
  return file;
}
