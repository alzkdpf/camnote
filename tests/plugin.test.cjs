const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs/promises');
const {EventEmitter}=require('node:events');
const path=require('node:path');
test('Obsidian delegation preserves the source and creates linked output',async()=>{
  const code=await fs.readFile(path.join(__dirname,'../obsidian-plugin/main.js'),'utf8');
  const created=[];const notices=[];const commands=[];
  class Plugin{async loadData(){return {}}addSettingTab(){}addCommand(c){commands.push(c)}}
  class Notice{constructor(s){notices.push(s)}}
  class PluginSettingTab{}
  const fakeSpawn=(exe,args,options)=>{
    assert.equal(options.shell,false);assert.equal(args[args.indexOf('--image')+1],'/test vault/CamNote/attachments/scene.png');
    assert.equal(args[args.indexOf('--sandbox')+1],'read-only');
    const child=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};child.stdin=new EventEmitter();
    child.stdin.end=async prompt=>{assert.match(prompt,/untrusted data/);await fs.writeFile(args[args.indexOf('--output-last-message')+1],'## Result\nTwo shapes');child.emit('close',0)};
    return child;
  };
  const fakeFs={...fs,realpath:async p=>p};
  const context={module:{exports:{}},require:n=>n==='obsidian'?{Plugin,Notice,PluginSettingTab,Setting:class{}}:n==='node:child_process'?{spawn:fakeSpawn}:n==='node:fs/promises'?fakeFs:require(n),setTimeout,clearTimeout,process};
  vm.runInNewContext(code,context);
  const plugin=new context.module.exports();
  const source={path:'CamNote/source.md',basename:'source',parent:{path:'CamNote'}};
  plugin.app={workspace:{getActiveFile:()=>source,getLeaf:()=>({openFile:async()=>{}})},metadataCache:{getFileCache:()=>({embeds:[{link:'attachments/scene.png'}]}),getFirstLinkpathDest:()=>({path:'CamNote/attachments/scene.png',extension:'png'})},vault:{adapter:{getBasePath:()=>'/test vault'},create:async(p,body)=>{created.push({p,body});return {path:p}}}};
  await plugin.onload();assert.equal(commands.length,2);
  await plugin.delegate();
  assert.equal(created.length,1);assert.match(created[0].p,/CamNote\/source-Codex-/);assert.match(created[0].body,/원본: \[\[CamNote\/source.md\]\]/);assert.match(created[0].body,/Two shapes/);assert.equal(plugin.running,false);assert.match(notices.at(-1),/저장했습니다/);
});
