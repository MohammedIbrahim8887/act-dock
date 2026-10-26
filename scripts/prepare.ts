import { resolve,join } from 'node:path';
import {mkdir} from 'node:fs/promises';
import {run,desktop,root,download} from './lib';
// SDK source is platform independent. Linux containers on Apple Silicon cannot
// run Hutch's x64 Zig binary under Rosetta; project the same pinned SDK directly.
if(process.platform==='linux'){
  const dir=join(desktop,'.hutch/devkit');await mkdir(dir,{recursive:true});
  const file=await download('https://github.com/blackboardsh/electrobun/releases/download/v2.0.5/electrobun-core-linux-x64.tar.gz',resolve(root,'.cache/electrobun-linux-sdk.tar.gz'),'29deec8eb7f8a017f786f95816bccccd91f514e57ea14868e4b97bd409268e88');
  await run(['tar','-xzf',file,'-C',dir,'api']);
  const paths={'electrobun':['./api/sdks/main/index.ts'],'electrobun/main':['./api/sdks/main/index.ts'],'electrobun/view':['./api/browser/index.ts']};
  await Bun.write(join(dir,'tsconfig.json'),JSON.stringify({compilerOptions:{baseUrl:'.',paths}}));
  await Bun.write(join(dir,'package.json'),JSON.stringify({name:'electrobun',version:'2.0.5',type:'module',exports:{'.':'./api/sdks/main/index.ts','./main':'./api/sdks/main/index.ts','./view':'./api/browser/index.ts'}}));
}else{
  await run(['bun','x','electrobun@2.0.5','prepare'],desktop);
}
