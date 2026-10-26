import {mkdtemp,mkdir,readdir,cp,rm,chmod} from 'node:fs/promises';
import {join,resolve,dirname,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {run} from '../build-brand';
async function findLauncher(dir:string):Promise<string|undefined>{
  for(const e of await readdir(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isFile()&&e.name==='launcher')return path;if(e.isDirectory()){const found=await findLauncher(path);if(found)return found;}}
}
export async function packageLinux(){
  const channel=process.env.ELECTROBUN_BUILD_ENV||'stable';if(channel!=='stable')return;
  const artifacts=resolve(process.env.ELECTROBUN_ARTIFACT_DIR||'artifacts');
  const {version}=await Bun.file('package.json').json();
  const archive=(await readdir(artifacts)).find(n=>/^stable-linux-x64-ActDock.*\.tar\.zst$/.test(n));
  if(!archive)throw new Error('Native Linux update archive missing');
  const stage=await mkdtemp(join(tmpdir(),'act-dock-pkg-'));
  try{
    const unpack=join(stage,'unpack');await mkdir(unpack);await run(['tar','-xf',join(artifacts,archive),'-C',unpack]);
    const launcher=await findLauncher(unpack);if(!launcher)throw new Error('Linux launcher missing');
    const app=resolve(dirname(launcher),'..');const launcherRel=relative(app,launcher);
    const tree=join(stage,'root');await mkdir(join(tree,'opt'),{recursive:true});await cp(app,join(tree,'opt/act-dock'),{recursive:true});
    await mkdir(join(tree,'usr/bin'),{recursive:true});
    for(const [name,path] of [['act-dock-desktop',launcherRel],['act-dock','Resources/app/act-dock']]){
      const file=join(tree,'usr/bin',name);await Bun.write(file,`#!/bin/sh\nexec "/opt/act-dock/${path}" "$@"\n`);await chmod(file,0o755);
    }
    const desktop='[Desktop Entry]\nType=Application\nName=Act Dock\nComment=Run GitHub Actions locally\nExec=act-dock-desktop\nIcon=act-dock\nTerminal=false\nCategories=Development;\nStartupWMClass=sh.actdock.desktop\n';
    await mkdir(join(tree,'usr/share/applications'),{recursive:true});await Bun.write(join(tree,'usr/share/applications/act-dock.desktop'),desktop);
    const icon=join(tree,'usr/share/icons/hicolor/256x256/apps/act-dock.png');await mkdir(dirname(icon),{recursive:true});await run(['convert','assets/brand/app-icon.png','-resize','256x256',icon]);
    await mkdir(join(tree,'DEBIAN'));await Bun.write(join(tree,'DEBIAN/control'),`Package: act-dock\nVersion: ${version}\nArchitecture: amd64\nMaintainer: Mohammed Ibrahim <mohammedibrahim4641@gmail.com>\nSection: devel\nPriority: optional\nDepends: libc6 (>= 2.39), libgtk-3-0, libwebkit2gtk-4.1-0, libayatana-appindicator3-1, librsvg2-2\nDescription: Local GitHub Actions desktop runner and MCP server\n`);
    await run(['dpkg-deb','--root-owner-group','--build',tree,join(artifacts,'linux-x64-ActDock.deb')]);
    await rm(join(tree,'DEBIAN'),{recursive:true});
    const rpmroot=join(stage,'rpmbuild');await mkdir(join(rpmroot,'SPECS'),{recursive:true});
    const spec=join(rpmroot,'SPECS/act-dock.spec');await Bun.write(spec,`Name: act-dock\nVersion: ${version}\nRelease: 1\nSummary: Local GitHub Actions desktop runner\nLicense: LicenseRef-Proprietary\nURL: https://act-dock.mohammedibrahim.dev\nBuildArch: x86_64\nAutoReqProv: no\nRequires: glibc >= 2.39\nRequires: libgtk-3.so.0()(64bit)\nRequires: libwebkit2gtk-4.1.so.0()(64bit)\nRequires: libayatana-appindicator3.so.1()(64bit)\nRequires: librsvg-2.so.2()(64bit)\n%description\nRun local GitHub Actions workflows from your desktop, CLI, and AI agents.\n%prep\n%build\n%install\nmkdir -p %{buildroot}\ncp -a ${tree}/. %{buildroot}/\n%files\n/opt/act-dock\n/usr/bin/act-dock\n/usr/bin/act-dock-desktop\n/usr/share/applications/act-dock.desktop\n/usr/share/icons/hicolor/256x256/apps/act-dock.png\n`);
    await run(['rpmbuild','--define',`_topdir ${rpmroot}`,'--define','_build_id_links none','--define','__os_install_post %{nil}','-bb',spec]);
    await cp(join(rpmroot,`RPMS/x86_64/act-dock-${version}-1.x86_64.rpm`),join(artifacts,'linux-x64-ActDock.rpm'));
    const appdir=join(stage,'ActDock.AppDir');await mkdir(join(appdir,'usr/lib'),{recursive:true});await cp(app,join(appdir,'usr/lib/act-dock'),{recursive:true});
    await cp(icon,join(appdir,'act-dock.png'));await Bun.write(join(appdir,'act-dock.desktop'),desktop);
    await Bun.write(join(appdir,'AppRun'),`#!/bin/sh\nAPPDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$APPDIR/usr/lib/act-dock/${launcherRel}" "$@"\n`);await chmod(join(appdir,'AppRun'),0o755);
    const tool=resolve('.cache/appimagetool.AppImage');await mkdir(dirname(tool),{recursive:true});
    if(!(await Bun.file(tool).exists())){const r=await fetch('https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage');if(!r.ok)throw new Error('AppImage tooling download failed');await Bun.write(tool,r);await chmod(tool,0o755);}
    await run([tool,'--appimage-extract-and-run',appdir,join(artifacts,'linux-x64-ActDock.AppImage')]);
    await run(['dpkg-deb','--info',join(artifacts,'linux-x64-ActDock.deb')]);
    await run(['rpm','-qip',join(artifacts,'linux-x64-ActDock.rpm')]);
  }finally{await rm(stage,{recursive:true,force:true});}
}
if(import.meta.main)await packageLinux();
