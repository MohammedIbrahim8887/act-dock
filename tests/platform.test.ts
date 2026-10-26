import {expect,test} from 'bun:test';
import {platformPaths} from '../apps/desktop/src/runner/paths';
test('platform data and transport paths preserve macOS and use XDG or Windows user state',()=>{
  expect(platformPaths('darwin','/user',{}).directory).toBe('/user/Library/Application Support/Act Dock');
  expect(platformPaths('linux','/user',{}).directory).toBe('/user/.local/share/act-dock');
  expect(platformPaths('linux','/user',{XDG_DATA_HOME:'/xdg'}).directory).toBe('/xdg/act-dock');
  const win=platformPaths('win32','/user',{LOCALAPPDATA:'/local'});
  expect(win.executable.endsWith('act-dock.exe')).toBe(true);
  expect(win.socket.startsWith('\\\\.\\pipe\\act-dock-')).toBe(true);
  expect(platformPaths('win32','/other',{LOCALAPPDATA:'/other'}).socket).not.toBe(win.socket);
  expect(platformPaths('linux','/user',{ACT_DOCK_DATA_DIR:'/fixture'}).directory).toBe('/fixture');
});
