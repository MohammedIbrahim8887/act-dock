import { mkdir, rm, copyFile, chmod, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { root, run, download } from './lib';
// act is the engine Act Dock ships. Bump the version and hashes together (from the release's checksums.txt).
export const ACT_VERSION = '0.2.89';
export type ActTarget = 'darwin-arm64' | 'linux-x64' | 'win32-x64';
const assets: Record<ActTarget, { file: string; sha256: string }> = {
  'darwin-arm64': { file: 'act_Darwin_arm64.tar.gz', sha256: '48ae218af96725f7635a66de2b87e1e346893b02add0f16b92f560296b2151fc' },
  'linux-x64': { file: 'act_Linux_x86_64.tar.gz', sha256: '0191d6f1f3b716b5c55820032605d05fc3c1cdbf581ebeff655019e5dd1524c0' },
  'win32-x64': { file: 'act_Windows_x86_64.zip', sha256: '0f8cf866ad7e32421a219fc551a0a0ea5d12ead464de12ebfeafd334a5973b50' },
};
export const hostActTarget = (): ActTarget => {
  const target = `${process.platform}-${process.arch}`;
  if (target in assets) return target as ActTarget;
  throw new Error(`No bundled act build for ${target}`);
};
/** Downloads the pinned act release for `target`, verifies it, and writes `act[.exe]` and `act-LICENSE.txt` into `dest`. */
export async function bundleAct(target: ActTarget, dest: string) {
  const { file, sha256 } = assets[target];
  const archive = await download(`https://github.com/nektos/act/releases/download/v${ACT_VERSION}/${file}`, join(root, '.cache/act', file), sha256);
  const work = await mkdtemp(join(tmpdir(), 'act-dock-act-'));
  try {
    await run(file.endsWith('.zip') ? ['unzip', '-o', '-q', archive, '-d', work] : ['tar', '-xzf', archive, '-C', work]);
    const name = target === 'win32-x64' ? 'act.exe' : 'act';
    await mkdir(dest, { recursive: true });
    await copyFile(join(work, name), join(dest, name));
    if (target !== 'win32-x64') await chmod(join(dest, name), 0o755);
    await copyFile(join(work, 'LICENSE'), join(dest, 'act-LICENSE.txt'));
    return join(dest, name);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
if (import.meta.main) console.log(await bundleAct(hostActTarget(), process.argv[2] || join(root, 'apps/desktop/dist-runner')));
