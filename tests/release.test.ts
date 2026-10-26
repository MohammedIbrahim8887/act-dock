import {expect,test} from 'bun:test';
import {nextVersion} from '../scripts/release';
test('main releases use a new patch version while honoring a higher source version',()=>{
 expect(nextVersion('0.2.0')).toBe('0.2.0');
 expect(nextVersion('0.2.0','v0.2.0')).toBe('0.2.1');
 expect(nextVersion('0.2.0','v0.2.8')).toBe('0.2.9');
 expect(nextVersion('0.3.0','v0.2.8')).toBe('0.3.0');
 expect(()=>nextVersion('untrusted')).toThrow();
});
