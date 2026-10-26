import packageMacInstaller from './macos/package';
export default async function packageInstallers() {
  if (process.platform === 'darwin') await packageMacInstaller();
  if (process.platform === 'linux') {
    const p = Bun.spawn(['bun','scripts/linux/package.ts'], {stdout:'inherit',stderr:'inherit'});
    if (await p.exited) throw new Error('Linux packaging failed');
  }
}
