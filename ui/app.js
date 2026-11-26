'use strict';
const $=id=>document.getElementById(id);
const invoke=(command,args={})=>window.__TAURI__.core.invoke(command,args);
const state={settings:null,devices:[],scenes:[],scene:null,page:'camera',session:null,live:false,frameAt:0,frameZoom:100,zoom:100,zoomApplied:100,zoomPending:null,focusSupport:null,focusPending:false,focusStatus:"",busy:false,manual:false,dirty:false,saveTimer:null,saveVersion:0,exported:false,detailTab:'chat',draining:false,drafts:{},recording:false,recordAt:0,videos:[]};
function notice(text){$('notice-text').textContent=String(text);$('notice').hidden=false;}
function clearNotice(){$('notice').hidden=true;}
async function attempt(fn){try{await fn();}catch(e){notice(e);}}
function dateLabel(scene){const m=scene.name.match(/scene-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);if(!m)return '가져온 장면';const d=new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]);const today=new Date().toDateString()===d.toDateString();return `${today?'오늘':new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric'}).format(d)} ${new Intl.DateTimeFormat('ko-KR',{hour:'numeric',minute:'2-digit',hour12:false}).format(d)}`;}
function sceneLabel(s){return s.title||dateLabel(s);}
function sceneDescription(s){return [s.body?'노트 있음':'아직 정리하지 않음',s.generated?'이미지 변환됨':''].filter(Boolean).join(' · ');}
function renderLibrary(){
 $('count').textContent=state.scenes.length;
 $('recent').replaceChildren();$('library-grid').replaceChildren();
 for(const s of state.scenes){
  const recent=document.createElement('button');recent.className='recent-item'+(state.page==='scene'&&state.scene?.path===s.path?' active':'');recent.disabled=state.busy;recent.title=dateLabel(s);const img=document.createElement('img');img.src=s.preview;img.alt='';const text=document.createElement('span');const title=document.createElement('strong');title.textContent=sceneLabel(s);const description=document.createElement('small');description.textContent=dateLabel(s);text.append(title,description);recent.append(img,text);recent.onclick=()=>attempt(()=>selectScene(s));$('recent').append(recent);
  const tile=document.createElement('button');tile.className='scene-tile';tile.disabled=state.busy;const ti=img.cloneNode();const tt=document.createElement('strong');tt.textContent=sceneLabel(s);const td=document.createElement('small');td.textContent=sceneDescription(s);tile.append(ti,tt,td);tile.onclick=()=>attempt(()=>selectScene(s));$('library-grid').append(tile);
 }
 $('library-empty').hidden=state.scenes.length>0;
}
function updateVault(){const vault=state.settings?.vault||'';$('vault-state').textContent=vault?'Obsidian · '+vault.split('/').filter(Boolean).pop():'Obsidian 연결 안 됨';$('vault-state').title=vault;$('send').textContent=vault?'Obsidian으로 보내기':'Obsidian 연결';}
async function flushNote(){clearTimeout(state.saveTimer);if(!state.scene||!state.dirty)return;const path=state.scene.path,body=$('note').value,version=state.saveVersion;await invoke('save_note',{path,body});if(state.scene?.path===path&&state.saveVersion===version){state.scene.body=body;state.dirty=false;$('save-state').textContent='자동 저장됨';renderLibrary();}}
async function stopCamera(){if(state.recording){await stopRecording();return;}state.session=null;state.live=false;state.frameAt=0;await invoke('stop_camera');renderCamera();}
async function navigate(page){if(state.busy)return;await flushNote();if(state.live||state.session)await stopCamera();state.page=page;clearNotice();renderPage();}
function renderPage(){
 for(const page of ['camera','library','scene','videos','settings'])$(page+'-view').hidden=page!==state.page;
 for(const page of ['camera','library','videos','settings'])$('nav-'+page).classList.toggle('active',state.page===page);
 const titles={camera:['카메라','iPhone 또는 Mac 카메라로 촬영하세요.'],library:['보관함',`${state.scenes.length}개의 장면`],videos:['동영상',`${state.videos.length}개의 녹화 파일`],scene:[state.scene?sceneLabel(state.scene):'장면','원본 이미지와 노트'],settings:['설정','CamNote 연결 및 작업 방식']};
 $('page-title').textContent=titles[state.page][0];$('page-subtitle').textContent=titles[state.page][1];$('import').hidden=['settings','videos'].includes(state.page);
 renderLibrary();if(state.page==='videos')renderVideos();if(state.page==='camera')renderCamera();if(state.page==='scene')renderScene();
}
function renderCamera(){
 const active=!!state.session;$('camera-idle').hidden=active;$('live-controls').hidden=!active;$('connecting').hidden=!active||!!state.frameAt;$('live-image').hidden=!active||!state.frameAt;$('live-tag').hidden=!active||!state.frameAt;$('device').disabled=active;$('refresh').disabled=active;$('start').disabled=state.busy;$('capture').disabled=state.recording||!state.frameAt||Date.now()-state.frameAt>3000;$('stop').hidden=state.recording;$('record').disabled=!state.recording&&(!state.frameAt||state.busy||Date.now()-state.frameAt>3000);$('record').classList.toggle('is-recording',state.recording);$('record-label').textContent=state.recording?'중지하고 저장':'녹화 시작';$('record-timer').hidden=!state.recording;$('live-label').textContent=state.recording?'녹화 중':'미리보기';$('live-tag').classList.toggle('recording',state.recording);
 const fresh=active&&state.frameAt&&Date.now()-state.frameAt<=3000;
 const zoomReady=!state.zoomPending&&state.frameZoom===state.zoom&&state.zoomApplied===state.zoom;
 $('camera-adjustments').hidden=!active||!state.frameAt;
 $('camera-zoom').disabled=state.recording||!fresh;
 $('zoom-out').disabled=state.recording||!fresh||state.zoom<=100;
 $('zoom-in').disabled=state.recording||!fresh||state.zoom>=300;
 $('camera-zoom').value=state.zoom;
 $('camera-zoom').setAttribute('aria-valuetext',`${state.zoom/100}배`);
 $('zoom-value').textContent=`${state.zoom/100}×`;
 $('autofocus').disabled=state.recording||!fresh||state.focusSupport!==true||state.focusPending;
 $('focus-status').textContent=state.recording?'녹화 시작 전 선택한 줌을 적용 중':state.focusStatus;
 if(!zoomReady){$('capture').disabled=true;if(!state.recording)$('record').disabled=true;}
 $('camera-footnote').textContent=state.recording?'영상만 녹화 중입니다. 중지하면 MP4 파일로 자동 저장됩니다.':active?(state.frameAt?'프레임을 확인한 뒤 장면을 촬영하세요.':'연결이 늦어지면 iPhone 잠금 상태를 확인하세요.'):'시작 버튼을 누를 때만 카메라가 켜집니다.';
}
function resetCameraControls(){
 state.zoom=100;state.zoomApplied=100;state.frameZoom=100;state.zoomPending=null;
 state.focusSupport=null;state.focusPending=false;state.focusStatus='';
}
async function stepZoom(delta){
 if(!state.session||state.recording||!state.live||Date.now()-state.frameAt>3000)return;
 $('camera-zoom').value=Math.max(100,Math.min(300,state.zoom+delta));
 await selectZoom();
}
async function selectZoom(){
 const session=state.session;
 if(!session||state.recording)return;
 state.zoom=Number($('camera-zoom').value);
 if(state.zoomPending===session){renderCamera();return;}
 state.zoomPending=session;renderCamera();
 try{
  while(state.session===session&&state.zoomApplied!==state.zoom){
   const percent=state.zoom;
   await invoke('set_camera_zoom',{session,percent});
   if(state.session===session)state.zoomApplied=percent;
  }
 }catch(e){
  if(state.session===session){state.zoom=state.zoomApplied;notice(e);}
 }finally{
  if(state.zoomPending===session)state.zoomPending=null;
  if(state.session===session)renderCamera();
 }
}
async function checkAutofocus(session){
 if(state.focusSupport!==null||state.recording)return;
 state.focusSupport=false;state.focusStatus='자동 초점 지원 여부 확인 중…';renderCamera();
 try{
  const supported=await invoke('autofocus',{session,perform:false});
  if(state.session!==session)return;
  state.focusSupport=supported;
  state.focusStatus=supported?'':'이 연결에서는 초점을 직접 제어할 수 없어요.';
 }catch(e){
  if(state.session===session)state.focusStatus='이 연결에서는 초점을 직접 제어할 수 없어요.';
 }
 if(state.session===session)renderCamera();
}
async function refocus(){
 const session=state.session;
 if(!session||state.recording||!state.focusSupport||state.focusPending)return;
 state.focusPending=true;state.focusStatus='';renderCamera();
 try{
  const accepted=await invoke('autofocus',{session,perform:true});
  if(state.session===session)state.focusStatus=accepted?'자동 초점을 요청했어요.':'미리보기가 멈췄어요. 연결을 확인해 주세요.';
 }catch(e){
  if(state.session===session)state.focusStatus=String(e);
 }finally{
  if(state.session===session){state.focusPending=false;renderCamera();}
 }
}
async function refreshDevices(){
 $('refresh').disabled=true;$('device-state').textContent='검색 중…';
 try{state.devices=await invoke('devices');$('device').replaceChildren();for(const d of state.devices){const option=document.createElement('option');option.value=d.name;option.textContent=d.name;$('device').append(option);}const remembered=state.settings.camera_name;const preferred=state.devices.find(d=>d.name===remembered)||state.devices.find(d=>/iphone/i.test(d.name)&&!/desk|데스크/i.test(d.name))||state.devices[0];$('device').value=preferred?.name||'';$('device-state').textContent=`${state.devices.length}개 연결 가능`;$('camera-hint').textContent=preferred?`${preferred.name}로 장면을 담아보세요.`:'카메라를 연결한 뒤 시작하세요.';}
 catch(e){$('device').replaceChildren(new Option('카메라를 연결해 주세요.',''));$('device-state').textContent='카메라 없음';$('camera-hint').textContent='iPhone을 연결하거나 다른 카메라를 확인해 주세요.';notice(e);}
 finally{$('refresh').disabled=false;}
}
async function startCamera(){
 clearNotice();if(!$('device').value)await refreshDevices();const name=$('device').value;if(!name){$('connection-help').open=true;return;}
 const session=String(Date.now());resetCameraControls();state.session=session;state.frameAt=0;state.live=false;renderCamera();
 try{await invoke('start_camera',{name,session});if(state.session===session)state.live=true;}catch(e){state.session=null;renderCamera();throw e;}
}
function renderVideos(){const list=$('video-list');list.replaceChildren();$('videos-empty').hidden=state.videos.length>0;for(const v of state.videos){const row=document.createElement('div');row.className='video-row';const text=document.createElement('div');const name=document.createElement('strong');name.textContent=v.name;const size=document.createElement('p');size.className='quiet';size.textContent=(v.bytes/1048576).toFixed(1)+' MB · MP4';text.append(name,size);const buttons=document.createElement('div');for(const [label,action] of [['재생',()=>invoke('open_video',{path:v.path,reveal:false})],['Finder에서 보기',()=>invoke('open_video',{path:v.path,reveal:true})],['다른 이름으로 저장',async()=>{const p=await invoke('save_video',{path:v.path});if(p)notice('동영상을 저장했습니다.');}]]){const b=document.createElement('button');b.className='button';b.textContent=label;b.onclick=()=>attempt(action);buttons.append(b);}row.append(text,buttons);list.append(row);}}
async function startRecording(){if(state.busy||state.recording||!state.frameAt||state.zoomPending||state.frameZoom!==state.zoom||state.zoomApplied!==state.zoom)return;clearNotice();const name=$('device').value,session=String(Date.now()),zoomPercent=state.zoom;state.recording=true;state.recordAt=0;state.session=session;state.frameAt=0;setBusy(true,'record');renderCamera();try{await invoke('start_recording',{name,session,zoomPercent});state.live=true;}catch(e){state.recording=false;state.session=null;state.live=false;setBusy(false,'record');renderCamera();throw e;}}
async function stopRecording(){if(!state.recording)return;state.session=null;state.live=false;state.frameAt=0;$('record').disabled=true;$('record-label').textContent='저장 중…';try{const video=await invoke('stop_recording');state.videos=await invoke('recordings');notice('동영상이 저장되었습니다. '+video.name);}finally{state.recording=false;state.recordAt=0;state.videos=await invoke('recordings').catch(()=>state.videos);setBusy(false,'record');renderCamera();renderVideos();}}
async function captureScene(){if(state.recording||!state.frameAt||state.zoomPending||state.frameZoom!==state.zoom||state.zoomApplied!==state.zoom)return;const scene=await invoke('capture');state.session=null;state.live=false;state.frameAt=0;upsert(scene);await selectScene(scene);}
function upsert(s){const i=state.scenes.findIndex(v=>v.path===s.path);if(i<0)state.scenes.unshift(s);else state.scenes[i]=s;}
async function selectScene(s){if(state.busy)return;if(state.scene)state.drafts[state.scene.path]={text:$('chat-input').value,mode:$('chat-mode').value};await flushNote();if(state.session)await stopCamera();state.scene=s;state.manual=false;state.exported=false;state.dirty=false;state.detailTab='chat';$('chat-input').value=state.drafts[s.path]?.text||'';$('chat-mode').value=state.drafts[s.path]?.mode||'adjust';$('transform-form').hidden=true;state.page='scene';clearNotice();renderPage();}
function renderScene(){if(!state.scene)return;const s=state.scene;if(s.chat_error)notice(s.chat_error);const h=s.chat||{messages:[],revisions:[],active:null};$('scene-image').src=h.active&&s.generated?s.generated:s.preview;$('original').classList.toggle('selected',!h.active);$('generated').classList.toggle('selected',!!h.active);$('generated').hidden=!h.revisions.length;$('image-prompt').value=state.settings.image_instruction;$('note').value=s.body;showNote(!!s.body||state.manual);$('save-state').textContent=s.body?'자동 저장됨':'';updateVault();$('send').hidden=state.exported;$('reopen').hidden=!state.exported;
 $('revision').replaceChildren(new Option('원본',''));for(const r of h.revisions)$('revision').append(new Option(r.label+' · '+(r.kind==='adjust'?'사진 보정':'생성형 편집'),r.id));$('revision').value=h.active||'';renderChat();setDetailTab(state.detailTab);}
function setDetailTab(tab){state.detailTab=tab;$('chat-pane').hidden=tab!=='chat';$('note-content').hidden=tab!=='note';$('tab-chat').setAttribute('aria-selected',String(tab==='chat'));$('tab-note').setAttribute('aria-selected',String(tab==='note'));}
function renderChat(){const h=state.scene?.chat||{messages:[]};const log=$('chat-log');log.replaceChildren();$('chat-engine').textContent=state.settings.provider==='Ollama'?'Ollama · 이 Mac에서 실행':'Codex CLI · 온라인 모델 사용 가능';
 if(!h.messages.length){const empty=document.createElement('div');empty.className='chat-empty';const title=document.createElement('h3');title.textContent='사진을 어떻게 보정할까요?';const copy=document.createElement('p');copy.textContent='밝기, 대비, 색감, 선명도를 대화로 조절하세요. 이전 보정본에 이어서 적용하며 원본은 보존합니다.';const choices=document.createElement('div');choices.className='chat-suggestions';for(const text of ['조금 더 밝게','채도를 살짝 낮춰줘','어떤 보정이 어울릴까?']){const button=document.createElement('button');button.className='button';button.type='button';button.textContent=text;button.disabled=state.busy;button.onclick=()=>{$('chat-input').value=text;$('chat-mode').value=text.includes('?')?'talk':'adjust';updateChatComposer();$('chat-input').focus();};choices.append(button);}empty.append(title,copy,choices);log.append(empty);}
 for(const m of h.messages){const item=document.createElement('div');item.className='chat-message '+m.role+(m.error?' error':'');const who=document.createElement('strong');who.textContent=m.role==='user'?'나':m.error?'작업을 완료하지 못했습니다':'CamNote';const text=document.createElement('p');text.textContent=m.content;item.append(who,text);if(m.revision&&h.revisions.some(r=>r.id===m.revision)){const button=document.createElement('button');button.type='button';button.className='text-button';button.textContent='이 버전 보기';button.disabled=state.busy;button.onclick=()=>attempt(()=>chooseRevision(m.revision));item.append(button);}log.append(item);}log.scrollTop=log.scrollHeight;updateChatComposer();}
function updateChatComposer(){if(state.settings?.provider==='Ollama'&&$('chat-mode').value==='generate')$('chat-mode').value='adjust';const mode=$('chat-mode').value;$('chat-send').disabled=state.busy||!$('chat-input').value.trim();$('chat-mode').querySelector('[value=generate]').disabled=state.settings?.provider==='Ollama';$('chat-caption').textContent=mode==='generate'?'Codex가 새 이미지를 생성합니다.':mode==='talk'?'대화만 하고 사진은 바꾸지 않습니다.':'모델이 지시를 해석하고 보정은 로컬 처리합니다.';}
async function chooseRevision(id){if(state.busy)return;await flushNote();const s=await invoke('select_revision',{path:state.scene.path,id});state.scene=s;state.exported=false;upsert(s);renderScene();renderLibrary();}
async function sendChat(){if(state.busy||!state.scene)return;const message=$('chat-input').value.trim(),mode=$('chat-mode').value;if(!message)return;await flushNote();clearNotice();state.scene.chat??={messages:[],revisions:[],active:null};state.scene.chat.messages.push({role:'user',content:message,error:false,revision:null});$('chat-input').value='';renderChat();setBusy(true,'chat');$('chat-wait').hidden=false;
 try{const s=await invoke('photo_chat',{path:state.scene.path,message,mode});state.scene=s;upsert(s);state.exported=false;$('chat-input').value='';renderScene();renderLibrary();}catch(e){try{const s=await invoke('refresh_scene',{path:state.scene.path});state.scene=s;upsert(s);renderScene();}catch{}throw e;}finally{setBusy(false,'chat');$('chat-wait').hidden=true;renderChat();$('chat-input').focus();}}
async function importPaths(paths){if(state.busy)return;await flushNote();if(state.session)await stopCamera();setBusy(true,'import');try{const result=await invoke('import_photos',{paths});for(const photo of result.scenes)upsert(photo);setBusy(false,'import');if(result.scenes.length){await selectScene(result.scenes[0]);await invoke('frontend_ready',{report:{version:'0.4.0',ready:true,event:'photos-imported',imported:result.scenes.length,sceneCount:state.scenes.length,chatAvailable:!!$('chat-form'),activeTitle:state.scene.title||null}});}if(result.errors.length)notice(result.errors.join('\n'));}finally{setBusy(false,'import');}}
async function drainOpenPhotos(){if(state.busy||state.draining||!state.settings)return;state.draining=true;try{while(!state.busy){const paths=await invoke('take_open_photos');if(!paths.length)break;await importPaths(paths);}}finally{state.draining=false;}}

function showNote(visible){$('note-empty').hidden=visible;$('note').hidden=!visible;$('note-actions').hidden=!visible&&!state.scene?.generated&&!state.scene?.chat?.revisions?.length;$('resummarize').hidden=!visible;document.querySelector('#note-empty p').textContent=state.scene?.generated?'생성 이미지를 Obsidian에 바로 보내거나 노트를 덧붙일 수 있습니다.':'내용을 요약하고, 보이는 글자와 다음 할 일을 정리합니다.';}
function setBusy(busy,kind){state.busy=busy;for(const el of document.querySelectorAll('.nav-item,.recent-item,.scene-tile,#import,#new-capture,#transform-toggle,#transform,#summarize,#resummarize,#diagram,#send,#note,#image-prompt,#revision,#original,#generated,#save-photo,#chat-input,#chat-mode,#chat-send,#recover-data'))el.disabled=busy;$('job-status').hidden=!busy;if(busy){$('job-title').textContent=kind==='record'?'영상 녹화 중입니다.':kind==='recovery'?'이전 저장 내용을 복구하고 있습니다.':kind==='import'?'사진을 불러오고 있습니다.':kind==='chat'?'사진 채팅을 처리하고 있습니다.':kind==='image'?'새 이미지를 만들고 있습니다.':kind==='diagram'?'장면을 도식으로 정리하고 있습니다.':'장면을 읽고 정리하고 있습니다.';$('job-detail').textContent=kind==='record'?'중지하면 MP4 파일로 저장됩니다.':kind==='image'?'완료되면 원본 옆에서 결과를 확인할 수 있습니다.':'작업이 끝나면 오른쪽 노트에 표시됩니다.';$('save-state').textContent='작업 중';}updateChatComposer();if(!busy&&!state.draining)queueMicrotask(()=>attempt(drainOpenPhotos));}
async function processScene(kind){
 if(!state.scene||state.busy)return;await flushNote();clearNotice();const imagePrompt=$('image-prompt').value;if(kind==='image'&&!imagePrompt.trim()){notice('어떤 이미지로 바꿀지 입력해 주세요.');$('image-prompt').focus();return;}
 setBusy(true,kind);
 try{const s=await invoke('process_scene',{path:state.scene.path,kind,instruction:kind==='image'?imagePrompt:state.settings.instruction});state.scene=s;upsert(s);state.manual=false;if(kind==='note')state.detailTab='note';renderScene();renderLibrary();if(kind==='image'){showGenerated();$('transform-form').hidden=true;}if(kind==='diagram'){notice('SVG 도식을 저장했습니다. Obsidian으로 보낼 때 함께 첨부됩니다.');}}
 finally{setBusy(false,kind);$('save-state').textContent=state.scene?.body?'자동 저장됨':'';}
}
function showGenerated(){if(!state.scene?.generated)return;$('scene-image').src=state.scene.generated;$('generated').classList.add('selected');$('original').classList.remove('selected');}
function fillSettings(){for(const key of ['vault','provider','model','instruction','codex','ffmpeg'])$(key).value=state.settings[key];providerHint();}
function providerHint(){const local=$('provider').value==='Ollama';$('provider-help').textContent=local?'로컬 Ollama 서버와 vision 모델을 사용합니다. 모델 이름을 입력하세요.':'Codex는 이 Mac에서 실행되며 온라인 모델을 사용할 수 있습니다.';$('model').placeholder=local?'설치한 vision 모델 이름':'Codex 기본 모델 사용';}
async function loadStorage(){const s=await invoke('storage_status');$('data-path').value=s.path;$('recovery-state').textContent=s.migrated?'이전 데이터 복구 기록이 있습니다. 원본 복사본도 저장소의 recovery 폴더에 보존합니다.':'이 저장 위치는 앱 버전과 설치 위치에 따라 바뀌지 않습니다.';}
async function saveSettings(){for(const key of ['vault','provider','model','instruction','codex','ffmpeg'])state.settings[key]=$(key).value;await invoke('update_settings',{value:state.settings});updateVault();$('settings-status').textContent='설정을 저장했습니다.';}
async function importImage(){if(state.busy)return;const paths=await invoke('choose_photos');if(paths)await importPaths(paths);}
function bind(){
 $('dismiss-notice').onclick=clearNotice;
 for(const page of ['camera','library','videos','settings'])$('nav-'+page).onclick=()=>attempt(()=>navigate(page));
 $('first-capture').onclick=$('new-capture').onclick=()=>attempt(()=>navigate('camera'));
 $('import').onclick=$('first-import').onclick=()=>attempt(importImage);$('refresh').onclick=()=>attempt(refreshDevices);$('start').onclick=()=>attempt(startCamera);$('stop').onclick=()=>attempt(stopCamera);$('capture').onclick=()=>attempt(captureScene);$('record').onclick=()=>attempt(state.recording?stopRecording:startRecording);$('video-camera').onclick=()=>attempt(()=>navigate('camera'));
 $('iphone-help').onclick=()=>{$('connection-help').open=true;$('connection-help').scrollIntoView({behavior:'smooth',block:'nearest'});};
 $('zoom-out').onclick=()=>stepZoom(-25);$('zoom-in').onclick=()=>stepZoom(25);
 $('camera-zoom').oninput=selectZoom;$('autofocus').onclick=refocus;
 $('device').onchange=()=>{state.settings.camera_name=$('device').value;attempt(()=>invoke('update_settings',{value:state.settings}));};
 $('original').onclick=()=>attempt(()=>chooseRevision(null));$('generated').onclick=()=>{const h=state.scene?.chat;if(h?.revisions.length)attempt(()=>chooseRevision(h.active||h.revisions.at(-1).id));};
 $('revision').onchange=()=>attempt(()=>chooseRevision($('revision').value||null));$('save-photo').onclick=()=>attempt(async()=>{const path=await invoke('save_photo',{path:state.scene.path});if(path)notice('현재 사진을 저장했습니다.');});
 $('tab-chat').onclick=()=>setDetailTab('chat');$('tab-note').onclick=()=>setDetailTab('note');$('chat-engine').onclick=()=>attempt(()=>navigate('settings'));$('chat-mode').onchange=$('chat-input').oninput=updateChatComposer;$('chat-form').onsubmit=e=>{e.preventDefault();attempt(sendChat);};$('chat-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();attempt(sendChat);}};
 $('transform-toggle').onclick=()=>{$('transform-form').hidden=!$('transform-form').hidden;if(!$('transform-form').hidden)$('image-prompt').focus();};$('transform').onclick=()=>attempt(()=>processScene('image'));$('diagram').onclick=()=>attempt(()=>processScene('diagram'));
 $('summarize').onclick=$('resummarize').onclick=()=>attempt(()=>processScene('note'));
 $('write-manually').onclick=()=>{state.manual=true;showNote(true);$('note').focus();};
 $('note').oninput=()=>{state.dirty=true;state.saveVersion++;$('save-state').textContent='저장 중…';clearTimeout(state.saveTimer);state.saveTimer=setTimeout(()=>attempt(flushNote),600);};
 $('note').onblur=()=>attempt(flushNote);
 $('send').onclick=()=>attempt(async()=>{await flushNote();if(!state.settings.vault){await navigate('settings');$('choose-vault').focus();return;}try{await invoke('export_note',{path:state.scene.path,body:$('note').value});$('save-state').textContent='Obsidian 저장됨';}catch(e){if(!String(e).includes('기존'))throw e;notice('이미 Obsidian에 저장한 장면입니다. 기존 노트를 열어 편집하세요.');}state.exported=true;$('send').hidden=true;$('reopen').hidden=false;});
 $('reopen').onclick=()=>attempt(()=>invoke('reopen_note',{path:state.scene.path}));
 $('choose-vault').onclick=()=>attempt(async()=>{const p=await invoke('pick_vault');if(p){$('vault').value=p;await saveSettings();}});
 $('recover-data').onclick=()=>attempt(async()=>{await flushNote();setBusy(true,'recovery');try{const r=await invoke('recover_data');if(r){state.settings=await invoke('settings');fillSettings();updateVault();state.scenes=await invoke('library');renderLibrary();await loadStorage();$('settings-status').textContent=r.already_done?'이미 복구한 폴더입니다.':`복구 완료 · ${r.copied}개 파일 저장. 보관함에서 확인하세요.`;}}finally{setBusy(false,'recovery');}});
 $('save-settings').onclick=()=>attempt(saveSettings);$('provider').onchange=providerHint;$('install-plugin').onclick=()=>attempt(async()=>{await saveSettings();await invoke('plugin_install');$('settings-status').textContent='설치 완료 · Obsidian에서 CamNote 플러그인을 켜세요.';});
 document.addEventListener('keydown',event=>{const editing=/INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName);if(event.metaKey&&event.key===','){event.preventDefault();attempt(()=>navigate('settings'));}else if(event.metaKey&&event.key==='o'){event.preventDefault();attempt(importImage);}else if(event.metaKey&&event.key==='s'){event.preventDefault();attempt(flushNote);}else if(event.code==='Space'&&!editing&&state.page==='camera'){event.preventDefault();attempt(state.frameAt?captureScene:state.session?async()=>{}:startCamera);}});
 setInterval(()=>{if(state.recording){const sec=state.recordAt?Math.floor((Date.now()-state.recordAt)/1000):0;$('record-timer').textContent=String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');}if(state.session&&state.frameAt&&Date.now()-state.frameAt>3000){renderCamera();$('camera-footnote').textContent='영상 수신이 멈췄습니다. iPhone 연결을 확인하거나 카메라를 다시 시작하세요.';}},1000);
}
async function init(){bind();try{
 await window.__TAURI__.event.listen('camera-frame',event=>{const f=event.payload;if(f.session!==state.session||f.zoom!==state.zoom)return;state.frameZoom=f.zoom;state.frameAt=Date.now();if(state.recording&&!state.recordAt)state.recordAt=Date.now();$('live-image').src=f.data;renderCamera();void checkAutofocus(f.session);});
 await window.__TAURI__.event.listen('camera-ended',event=>{if(event.payload!==state.session)return;if(state.recording){attempt(async()=>{await stopRecording();notice('카메라 연결이 종료되었습니다. 동영상 목록에서 저장된 파일을 확인하세요.');});return;}state.session=null;state.live=false;renderCamera();notice('카메라 연결이 종료됐습니다. 장치를 확인한 뒤 다시 시작하세요.');});
 await window.__TAURI__.event.listen('photos-available',()=>attempt(drainOpenPhotos));
 if(window.__TAURI__.webview?.getCurrentWebview)await window.__TAURI__.webview.getCurrentWebview().onDragDropEvent(event=>{if(event.payload.type==='enter')$('drop-overlay').hidden=state.busy;else if(event.payload.type==='drop'){$('drop-overlay').hidden=true;if(state.busy)notice('작업이 끝난 뒤 사진을 다시 놓아주세요.');else attempt(()=>importPaths(event.payload.paths));}else if(event.payload.type==='leave')$('drop-overlay').hidden=true;});
 state.settings=await invoke('settings');fillSettings();updateVault();await loadStorage();state.scenes=await invoke('library');state.videos=await invoke('recordings');renderPage();await refreshDevices();
 const bounds=$('start').getBoundingClientRect();await invoke('frontend_ready',{report:{version:'0.4.0',ready:true,width:innerWidth,height:innerHeight,startVisible:bounds.width>0&&bounds.height>=40,startLabel:$('start').textContent.trim(),devices:state.devices.map(d=>d.name),sceneCount:state.scenes.length,photoImport:$('import').textContent.trim(),chatAvailable:!!$('chat-form'),videoRecording:!!$('record'),videoCount:state.videos.length}});await drainOpenPhotos();
 }catch(e){notice('앱을 준비하지 못했습니다. '+e);await invoke('frontend_ready',{report:{ready:false,error:String(e)}}).catch(()=>{});}}
init();
