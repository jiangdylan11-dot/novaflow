// "把 D:\素材\角色 里的图都转成水彩风": the folder is asked for once, then every file goes through
// the turn one attached file takes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInContext} from 'node:vm';
import {probe} from './helpers/xiaotao-route-probe.mjs';

const open={action:'open',surface:'drawing'};
const dir=(name,entries)=>({kind:'directory',name,async *values(){yield* entries;},queryPermission:async()=>'granted',
  async getDirectoryHandle(part){const hit=entries.find(e=>e.kind==='directory'&&e.name===part);if(!hit)throw new Error('missing');return hit;}});
const pic=name=>({kind:'file',name,getFile:async()=>new File([new Uint8Array([1,2,3])],name,{type:/\.txt$/.test(name)?'text/plain':'image/png'})});
async function setup(entries,plans,{picked}={}) {
  const p=await probe({page:'drawing',plans});
  p.root.File=File;p.root.showDirectoryPicker=async()=>picked||dir('角色',entries);
  runInContext(readFileSync(new URL('../renderer/xiaotao-folder-batch.js',import.meta.url),'utf8'),p.root);
  return p;
}
const replies=p=>p.c.state.messages.filter(m=>m.role==='assistant').map(m=>m.content);

test('the sentence is split into the folder and what to do with one file',async()=>{
  const p=await setup([],[]),find=p.root.FoartXiaotaoFolder.find;
  const hit=find('把 D:\\素材\\角色 里的图都转成水彩风');
  assert.equal(hit.path,'D:\\素材\\角色');assert.equal(hit.name,'角色');assert.equal(hit.instruction('image'),'把这张图转成水彩风');
  assert.equal(find('处理一下 "D:\\my files\\in" 文件夹').instruction('image'),'');
  assert.equal(find('D:\\素材\\角色\\').name,'角色');
  assert.equal(find('把 /Users/me/图 里的视频抠掉背景，包括子文件夹').deep,true);
  assert.equal(find('把这张图转成水彩风'),null);
  assert.equal(find('打开 D:\\a\\b.png'),null);
});

test('a new folder is asked for once, then each file takes its own turn',async()=>{
  const p=await setup([pic('b.png'),pic('a.png'),pic('notes.txt'),dir('sub',[])],[open,null,open,null]);
  assert.equal(await p.c.send('把 D:\\素材\\角色 里的图都转成水彩风'),true);
  const ask=p.c.state.messages.at(-1);
  assert.equal(ask.folderAsk,true);assert.equal(p.starts.length,0,'nothing is sent before the folder is opened');
  assert.equal(await p.c.openFolder(),true);
  assert.equal(p.starts.filter(s=>/把这张图转成水彩风/.test(s.message)).length>=2,true);
  const last=replies(p).at(-1);
  assert.match(last,/做完了 2 个/);assert.match(last,/另外 1 个/);assert.match(last,/仓库/);
  assert.equal(p.c.state.messages.some(m=>m.folderAsk),false);
  assert.equal(p.c.state.staged.length,0);
});

test('a path with nothing to do asks what to do, the answer starts the work',async()=>{
  const p=await setup([pic('a.png')],[open]);
  await p.c.send('D:\\素材\\角色');await p.c.openFolder();
  assert.match(replies(p).at(-1),/要对它们做什么/);
  assert.equal(await p.c.send('转成水彩风'),true);
  assert.equal(p.starts.some(s=>/对这张图：转成水彩风/.test(s.message)),true);
  assert.match(replies(p).at(-1),/做完了 1 个/);
});

test('more than five files wait for one go-ahead',async()=>{
  const names=['1','2','3','4','5','6'].map(n=>pic(n+'.png'));
  const p=await setup(names,names.flatMap(()=>[open,null]));
  await p.c.send('把 D:\\素材\\角色 里的图都转成水彩风');await p.c.openFolder();
  assert.match(replies(p).at(-1),/有 6 个可以处理的文件.*要现在开始吗/);assert.equal(p.starts.length,0);
  await p.c.send('开始');
  assert.match(replies(p).at(-1),/做完了 6 个/);
});

test('project files are opened in 动画 one by one, the pictures beside them are theirs',async()=>{
  const opened=[];
  const p=await setup([pic('a.png'),{kind:'file',name:'hero.foart',getFile:async()=>new File([new Uint8Array([1])],'hero.foart')},{kind:'file',name:'boss.foart',getFile:async()=>new File([new Uint8Array([1])],'boss.foart')}],[open,null,open,null]);
  p.root.NovaFlowSkeletonEditor={active:()=>true,ready:async()=>({openProjectFile:async(file,handle,options)=>{opened.push([file.name,handle.name,options.operation,options.directory.handle.name]);return 1;}})};
  const hit=p.root.FoartXiaotaoFolder.find('把 D:/素材/角色 里的所有工程都导出一遍');
  assert.deepEqual([...hit.kinds],['project']);assert.equal(hit.instruction('project'),'把这个工程导出一遍');
  await p.c.send('把 D:/素材/角色 里的所有工程都导出一遍');await p.c.openFolder();
  assert.deepEqual(opened,[['boss.foart','boss.foart','append','角色'],['hero.foart','hero.foart','append','角色']]);
  assert.equal(p.starts.some(s=>/工程「boss.foart」：把这个工程导出一遍/.test(s.message)),true);
  assert.match(replies(p).at(-1),/做完了 2 个/);assert.equal(p.c.state.staged.length,0);
});
