import {expect,test} from 'bun:test';
import {nextVersion,stampWorkspaceLock} from '../scripts/release';
test('main releases use a new patch version while honoring a higher source version',()=>{
 expect(nextVersion('0.2.0')).toBe('0.2.0');
 expect(nextVersion('0.2.0','v0.2.0')).toBe('0.2.1');
 expect(nextVersion('0.2.0','v0.2.8')).toBe('0.2.9');
 expect(nextVersion('0.3.0','v0.2.8')).toBe('0.3.0');
 expect(()=>nextVersion('untrusted')).toThrow();
});
test('release stamping changes private workspace metadata without changing locked dependencies',()=>{
 const source=JSON.stringify({workspaces:{'apps/desktop':{name:'@act-dock/desktop',version:'0.2.0',dependencies:{react:'19'}},'apps/web':{name:'@act-dock/web',version:'0.2.0',dependencies:{react:'19'}}}},null,2);
 // Actual Bun lockfiles use a comma after each workspace version.
 const stamped=stampWorkspaceLock(source,'0.2.1');
 expect(stamped.match(/0\.2\.1/g)).toHaveLength(2);
 expect(stamped).toContain('"react": "19"');
 expect(()=>stampWorkspaceLock('{}','0.2.1')).toThrow();
});
