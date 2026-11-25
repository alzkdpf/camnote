'use strict';
const $=id=>document.getElementById(id);
const invoke=(command,args={})=>window.__TAURI__.core.invoke(command,args);
const state={settings:null,devices:[],scenes:[],scene:null,page:'camera',session:null,live:false,frameAt:0,busy:false,manual:false,dirty:false,saveTimer:null,saveVersion:0,exported:false};
function notice(text){$('notice-text').textContent=String(text);$('notice').hidden=false;}
function clearNotice(){$('notice').hidden=true;}
async function attempt(fn){try{await fn();}catch(e){notice(e);}}
function dateLabel(scene){const m=scene.name.match(/scene-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);if(!m)return '가져온 장면';const d=new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]);const today=new Date().toDateString()===d.toDateString();return `${today?'오늘':new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric'}).format(d)} ${new Intl.DateTimeFormat('ko-KR',{hour:'numeric',minute:'2-digit',hour12:false}).format(d)}`;}
function sceneDescription(s){return [s.body?'노트 있음':'아직 정리하지 않음',s.generated?'이미지 변환됨':''].filter(Boolean).join(' · ');}
function renderLibrary(){
 $('count').textContent=state.scenes.length;
 $('recent').replaceChildren();$('library-grid').replaceChildren();
 for(const s of state.scenes){
  const recent=document.createElement('button');recent.className='recent-item'+(state.page==='scene'&&state.scene?.path===s.path?' active':'');recent.disabled=state.busy;recent.title=dateLabel(s);const img=document.createElement('img');img.src=s.preview;img.alt='';const text=document.createElement('span');const title=document.createElement('strong');title.textContent=dateLabel(s);const description=document.createElement('small');description.textContent=s.body?'노트 있음':'촬영한 장면';text.append(title,description);recent.append(img,text);recent.onclick=()=>attempt(()=>selectScene(s));$('recent').append(recent);
  const tile=document.createElement('button');tile.className='scene-tile';tile.disabled=state.busy;const ti=img.cloneNode();const tt=document.createElement('strong');tt.textContent=dateLabel(s);const td=document.createElement('small');td.textContent=sceneDescription(s);tile.append(ti,tt,td);tile.onclick=()=>attempt(()=>selectScene(s));$('library-grid').append(tile);
 }
 $('library-empty').hidden=state.scenes.length>0;
}
function updateVault(){const vault=state.settings?.vault||'';$('vault-state').textContent=vault?'Obsidian · '+vault.split('/').filter(Boolean).pop():'Obsidian 연결 안 됨';$('vault-state').title=vault;$('send').textContent=vault?'Obsidian으로 보내기':'Obsidian 연결';}
async function flushNote(){clearTimeout(state.saveTimer);if(!state.scene||!state.dirty)return;const path=state.scene.path,body=$('note').value,version=state.saveVersion;await invoke('save_note',{path,body});if(state.scene?.path===path&&state.saveVersion===version){state.scene.body=body;state.dirty=false;$('save-state').textContent='자동 저장됨';renderLibrary();}}
async function stopCamera(){state.session=null;state.live=false;state.frameAt=0;await invoke('stop_camera');renderCamera();}
async function navigate(page){if(state.busy)return;await flushNote();if(state.live||state.session)await stopCamera();state.page=page;clearNotice();renderPage();}
function renderPage(){
 for(const page of ['camera','library','scene','settings'])$(page+'-view').hidden=page!==state.page;
 for(const page of ['camera','library','settings'])$('nav-'+page).classList.toggle('active',state.page===page);
 const titles={camera:['카메라','iPhone 또는 Mac 카메라로 촬영하세요.'],library:['보관함',`${state.scenes.length}개의 장면`],scene:[state.scene?dateLabel(state.scene):'장면','원본 이미지와 노트'],settings:['설정','CamNote 연결 및 작업 방식']};
 $('page-title').textContent=titles[state.page][0];$('page-subtitle').textContent=titles[state.page][1];$('import').hidden=state.page==='settings';
 renderLibrary();if(state.page==='camera')renderCamera();if(state.page==='scene')renderScene();
}
function renderCamera(){
 const active=!!state.session;$('camera-idle').hidden=active;$('live-controls').hidden=!active;$('connecting').hidden=!active||!!state.frameAt;$('live-image').hidden=!active||!state.frameAt;$('live-tag').hidden=!active||!state.frameAt;$('device').disabled=active;$('refresh').disabled=active;$('start').disabled=state.busy;$('capture').disabled=!state.frameAt||Date.now()-state.frameAt>3000;
 $('camera-footnote').textContent=active?(state.frameAt?'프레임을 확인한 뒤 장면을 촬영하세요.':'연결이 늦어지면 iPhone 잠금 상태를 확인하세요.'):'시작 버튼을 누를 때만 카메라가 켜집니다.';
}
async function refreshDevices(){
 $('refresh').disabled=true;$('device-state').textContent='검색 중…';
 try{state.devices=await invoke('devices');$('device').replaceChildren();for(const d of state.devices){const option=document.createElement('option');option.value=d.name;option.textContent=d.name;$('device').append(option);}const remembered=state.settings.camera_name;const preferred=state.devices.find(d=>d.name===remembered)||state.devices.find(d=>/iphone/i.test(d.name)&&!/desk|데스크/i.test(d.name))||state.devices[0];$('device').value=preferred?.name||'';$('device-state').textContent=`${state.devices.length}개 연결 가능`;$('camera-hint').textContent=preferred?`${preferred.name}로 장면을 담아보세요.`:'카메라를 연결한 뒤 시작하세요.';}
 catch(e){$('device').replaceChildren(new Option('카메라를 연결해 주세요.',''));$('device-state').textContent='카메라 없음';$('camera-hint').textContent='iPhone을 연결하거나 다른 카메라를 확인해 주세요.';notice(e);}
 finally{$('refresh').disabled=false;}
}
async function startCamera(){
 clearNotice();if(!$('device').value)await refreshDevices();const name=$('device').value;if(!name){$('connection-help').open=true;return;}
 const session=String(Date.now());state.session=session;state.frameAt=0;state.live=false;renderCamera();
 try{await invoke('start_camera',{name,session});if(state.session===session)state.live=true;}catch(e){state.session=null;renderCamera();throw e;}
}
async function captureScene(){const scene=await invoke('capture');state.session=null;state.live=false;state.frameAt=0;upsert(scene);await selectScene(scene);}
function upsert(s){const i=state.scenes.findIndex(v=>v.path===s.path);if(i<0)state.scenes.unshift(s);else state.scenes[i]=s;}
async function selectScene(s){if(state.busy)return;await flushNote();if(state.session)await stopCamera();state.scene=s;state.manual=false;state.exported=false;state.dirty=false;$('transform-form').hidden=true;state.page='scene';clearNotice();renderPage();}
function renderScene(){if(!state.scene)return;const s=state.scene;$('scene-image').src=s.preview;$('original').classList.add('selected');$('generated').classList.remove('selected');$('generated').hidden=!s.generated;$('image-prompt').value=state.settings.image_instruction;$('note').value=s.body;showNote(!!s.body||state.manual);$('save-state').textContent=s.body?'자동 저장됨':'';updateVault();$('send').hidden=state.exported;$('reopen').hidden=!state.exported;}
function showNote(visible){$('note-empty').hidden=visible;$('note').hidden=!visible;$('note-actions').hidden=!visible&&!state.scene?.generated;$('resummarize').hidden=!visible;document.querySelector('#note-empty p').textContent=state.scene?.generated?'생성 이미지를 Obsidian에 바로 보내거나 노트를 덧붙일 수 있습니다.':'내용을 요약하고, 보이는 글자와 다음 할 일을 정리합니다.';}
function setBusy(busy,kind){state.busy=busy;for(const el of document.querySelectorAll('.nav-item,.recent-item,.scene-tile,#import,#new-capture,#transform-toggle,#transform,#summarize,#resummarize,#diagram,#send,#note,#image-prompt'))el.disabled=busy;$('job-status').hidden=!busy;if(busy){$('job-title').textContent=kind==='image'?'새 이미지를 만들고 있습니다.':kind==='diagram'?'장면을 도식으로 정리하고 있습니다.':'장면을 읽고 정리하고 있습니다.';$('job-detail').textContent=kind==='image'?'완료되면 원본 옆에서 결과를 확인할 수 있습니다.':'작업이 끝나면 오른쪽 노트에 표시됩니다.';$('save-state').textContent='작업 중';}}
async function processScene(kind){
 if(!state.scene||state.busy)return;await flushNote();clearNotice();const imagePrompt=$('image-prompt').value;if(kind==='image'&&!imagePrompt.trim()){notice('어떤 이미지로 바꿀지 입력해 주세요.');$('image-prompt').focus();return;}
 setBusy(true,kind);
 try{const s=await invoke('process_scene',{path:state.scene.path,kind,instruction:kind==='image'?imagePrompt:state.settings.instruction});state.scene=s;upsert(s);state.manual=false;renderScene();renderLibrary();if(kind==='image'){showGenerated();$('transform-form').hidden=true;}if(kind==='diagram'){notice('SVG 도식을 저장했습니다. Obsidian으로 보낼 때 함께 첨부됩니다.');}}
 finally{setBusy(false,kind);$('save-state').textContent=state.scene?.body?'자동 저장됨':'';}
}
function showGenerated(){if(!state.scene?.generated)return;$('scene-image').src=state.scene.generated;$('generated').classList.add('selected');$('original').classList.remove('selected');}
function fillSettings(){for(const key of ['vault','provider','model','instruction','codex','ffmpeg'])$(key).value=state.settings[key];providerHint();}
function providerHint(){const local=$('provider').value==='Ollama';$('provider-help').textContent=local?'로컬 Ollama 서버와 vision 모델을 사용합니다. 모델 이름을 입력하세요.':'Codex는 이 Mac에서 실행되며 온라인 모델을 사용할 수 있습니다.';$('model').placeholder=local?'설치한 vision 모델 이름':'Codex 기본 모델 사용';}
async function saveSettings(){for(const key of ['vault','provider','model','instruction','codex','ffmpeg'])state.settings[key]=$(key).value;await invoke('update_settings',{value:state.settings});updateVault();$('settings-status').textContent='설정을 저장했습니다.';}
async function importImage(){if(state.busy)return;await flushNote();if(state.session)await stopCamera();const s=await invoke('pick_image');if(s){upsert(s);await selectScene(s);}}
function bind(){
 $('dismiss-notice').onclick=clearNotice;
 for(const page of ['camera','library','settings'])$('nav-'+page).onclick=()=>attempt(()=>navigate(page));
 $('first-capture').onclick=$('new-capture').onclick=()=>attempt(()=>navigate('camera'));
 $('import').onclick=()=>attempt(importImage);$('refresh').onclick=()=>attempt(refreshDevices);$('start').onclick=()=>attempt(startCamera);$('stop').onclick=()=>attempt(stopCamera);$('capture').onclick=()=>attempt(captureScene);
 $('iphone-help').onclick=()=>{$('connection-help').open=true;$('connection-help').scrollIntoView({behavior:'smooth',block:'nearest'});};
 $('device').onchange=()=>{state.settings.camera_name=$('device').value;attempt(()=>invoke('update_settings',{value:state.settings}));};
 $('original').onclick=()=>{$('scene-image').src=state.scene.preview;$('original').classList.add('selected');$('generated').classList.remove('selected');};$('generated').onclick=showGenerated;
 $('transform-toggle').onclick=()=>{$('transform-form').hidden=!$('transform-form').hidden;if(!$('transform-form').hidden)$('image-prompt').focus();};$('transform').onclick=()=>attempt(()=>processScene('image'));$('diagram').onclick=()=>attempt(()=>processScene('diagram'));
 $('summarize').onclick=$('resummarize').onclick=()=>attempt(()=>processScene('note'));
 $('write-manually').onclick=()=>{state.manual=true;showNote(true);$('note').focus();};
 $('note').oninput=()=>{state.dirty=true;state.saveVersion++;$('save-state').textContent='저장 중…';clearTimeout(state.saveTimer);state.saveTimer=setTimeout(()=>attempt(flushNote),600);};
 $('note').onblur=()=>attempt(flushNote);
 $('send').onclick=()=>attempt(async()=>{await flushNote();if(!state.settings.vault){await navigate('settings');$('choose-vault').focus();return;}try{await invoke('export_note',{path:state.scene.path,body:$('note').value});$('save-state').textContent='Obsidian 저장됨';}catch(e){if(!String(e).includes('기존'))throw e;notice('이미 Obsidian에 저장한 장면입니다. 기존 노트를 열어 편집하세요.');}state.exported=true;$('send').hidden=true;$('reopen').hidden=false;});
 $('reopen').onclick=()=>attempt(()=>invoke('reopen_note',{path:state.scene.path}));
 $('choose-vault').onclick=()=>attempt(async()=>{const p=await invoke('pick_vault');if(p){$('vault').value=p;await saveSettings();}});
 $('save-settings').onclick=()=>attempt(saveSettings);$('provider').onchange=providerHint;$('install-plugin').onclick=()=>attempt(async()=>{await saveSettings();await invoke('plugin_install');$('settings-status').textContent='설치 완료 · Obsidian에서 CamNote 플러그인을 켜세요.';});
 document.addEventListener('keydown',event=>{const editing=/INPUT|TEXTAREA|SELECT/.test(event.target.tagName);if(event.metaKey&&event.key===','){event.preventDefault();attempt(()=>navigate('settings'));}else if(event.metaKey&&event.key==='o'){event.preventDefault();attempt(importImage);}else if(event.metaKey&&event.key==='s'){event.preventDefault();attempt(flushNote);}else if(event.code==='Space'&&!editing&&state.page==='camera'){event.preventDefault();attempt(state.frameAt?captureScene:state.session?async()=>{}:startCamera);}});
 setInterval(()=>{if(state.session&&state.frameAt&&Date.now()-state.frameAt>3000){$('capture').disabled=true;$('camera-footnote').textContent='영상 수신이 멈췄습니다. iPhone 연결을 확인하거나 카메라를 다시 시작하세요.';}},1000);
}
async function init(){bind();try{
 await window.__TAURI__.event.listen('camera-frame',event=>{const f=event.payload;if(f.session!==state.session)return;state.frameAt=Date.now();$('live-image').src=f.data;renderCamera();});
 await window.__TAURI__.event.listen('camera-ended',event=>{if(event.payload!==state.session)return;state.session=null;state.live=false;renderCamera();notice('카메라 연결이 종료됐습니다. 장치를 확인한 뒤 다시 시작하세요.');});
 state.settings=await invoke('settings');fillSettings();updateVault();state.scenes=await invoke('library');renderPage();await refreshDevices();
 const bounds=$('start').getBoundingClientRect();await invoke('frontend_ready',{report:{version:'0.2.1',ready:true,width:innerWidth,height:innerHeight,startVisible:bounds.width>0&&bounds.height>=40,startLabel:$('start').textContent.trim(),devices:state.devices.map(d=>d.name),sceneCount:state.scenes.length}});
 }catch(e){notice('앱을 준비하지 못했습니다. '+e);await invoke('frontend_ready',{report:{ready:false,error:String(e)}}).catch(()=>{});}}
init();
