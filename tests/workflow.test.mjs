import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const stub=`
export class Plugin {constructor(){this.app=globalThis.testApp;}loadData(){return this.settings;}addSettingTab(){}addRibbonIcon(){}addCommand(c){this.command=c.callback;}saveData(){}}
export class Modal {constructor(app){this.app=app;this.contentEl=document.createElement('div');globalThis.testModal=this;}open(){document.body.append(this.contentEl);this.onOpen();}close(){this.onClose();}}
export const Platform={isDesktopApp:true}; export class App {} export class PluginSettingTab {} export class Setting {} export class Notice {constructor(text){globalThis.testNotices.push(text);}}
export const normalizePath=p=>p;export const requestUrl=options=>globalThis.testRequest(options);`;
const {outputFiles}=await build({entryPoints:['src/main.ts'],bundle:true,write:false,format:'esm',platform:'browser',external:['electron','@electron/remote'],plugins:[{name:'test-obsidian',setup(b){b.onResolve({filter:/\/audio-capture$/},()=>({path:'capture',namespace:'capture'}));b.onLoad({filter:/.*/,namespace:'capture'},()=>({contents:`export async function captureAudio(){const stream=await navigator.mediaDevices.getUserMedia({audio:true});return{stream,levels:()=>({microphone:0,system:0}),onEnded(){},stop(){stream.getTracks().forEach(t=>t.stop());}}}`,loader:'js'}));b.onResolve({filter:/\/pcm-chunks$/},()=>({path:'pcm',namespace:'pcm'}));b.onLoad({filter:/.*/,namespace:'pcm'},()=>({contents:`export async function capturePcmChunks(stream,emit){let stopped=false;globalThis.testPcm={emit};return{stop(){if(stopped)return;stopped=true;globalThis.testPcmTail?.(emit);}}}`,loader:'js'}));b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:stub,loader:'js'}));}}]});
const Plugin=(await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))).default;
function setup(autoSave){
 const dom=new JSDOM('<body></body>');globalThis.document=dom.window.document;
 const proto=dom.window.HTMLElement.prototype;
 proto.createEl=function(tag,options={}){const el=document.createElement(tag);if(options.text)el.textContent=options.text;if(options.type)el.type=options.type;if(options.cls)el.className=options.cls;for(const [key,value]of Object.entries(options.attr||{}))el.setAttribute(key,value);this.append(el);return el;};
 proto.createDiv=function(){return this.createEl('div');};proto.addClass=function(x){this.classList.add(x);};proto.empty=function(){this.replaceChildren();};proto.setText=function(x){this.textContent=x;};proto.appendText=function(x){this.append(document.createTextNode(x));};proto.hide=function(){this.hidden=true;};
 const files=new Map();const calls=[];
 const entry=(path,extra)=>({path,extension:path.split('.').pop().toLowerCase(),stat:{mtime:Date.now(),size:extra.data?.byteLength||extra.text?.length||0},...extra});globalThis.testNotices=[];let opened;const done=new Promise(resolve=>opened=resolve);
 globalThis.testApp={vault:{getFiles:()=>[...files.values()].filter(f=>f.stat),readBinary:async file=>{if(!files.has(file.path))throw new Error('missing recording');return files.get(file.path).data;},getAbstractFileByPath:path=>files.get(path),createFolder:async path=>files.set(path,{path}),createBinary:async(path,data)=>{if(files.has(path))throw new Error('File already exists');files.set(path,entry(path,{data}));return files.get(path);},create:async(path,text)=>{if(files.has(path))throw new Error('File already exists');files.set(path,entry(path,{text}));return files.get(path);}},workspace:{getLeaf:()=>({openFile:async file=>opened(file)})}};
 const transcript='민수가 금요일까지 시안을 작성한다.';
 globalThis.testRequest=async options=>{calls.push(options);if(options.url.endsWith('/health'))return {status:200,json:{mode:'ai',provider:'Codex OAuth',audio:true,audioProvider:'처리 서버 Whisper'}};if(options.url.endsWith('/transcribe'))return {status:200,json:{text:transcript}};return {status:200,json:{mode:'ai',result:{summary:['시안 작성'],decisions:[],actions:[{task:'시안 작성',owner:'민수',due:'금요일',evidence:transcript}]}}};};
 const plugin=new Plugin();plugin.settings={mode:'server',endpoint:'http://127.0.0.1:8787',token:'test-token',folder:'회의록',autoSave};return {plugin,files,calls,done,dom};
}
async function upload(){await new Promise(resolve=>setTimeout(resolve,0));document.querySelector('input[type=checkbox]').checked=true;const file=document.querySelector('input[type=file]');Object.defineProperty(file,'files',{value:[new Blob(['synthetic audio'],{type:'audio/webm'})]});file.onchange();}
test('음성 파일 → 전사 → 분석 → 원음 연결한 회의록 자동 저장·열기',async()=>{
 const env=setup(true);await env.plugin.onload();env.plugin.command();await upload();const result=await Promise.race([env.done,new Promise((_,reject)=>setTimeout(()=>reject(new Error('자동 저장 미실행')),1500))]);
 const note=env.files.get(result.path);assert.ok(note.text.includes('AI 작성 초안'));assert.ok(note.text.includes('## 회의 원문'));assert.ok([...env.files.values()].some(x=>x.path.startsWith('회의녹음/')&&x.text?.includes('# 전사 원문')));assert.ok(note.text.includes('담당: 민수'));assert.ok(note.text.includes('## 원음'));const audio=[...env.files.values()].find(x=>x.data);assert.ok(note.text.includes(`[[${audio.path}]]`));assert.deepEqual(env.calls.map(x=>new URL(x.url).pathname),['/health','/transcribe','/summarize']);assert.ok(env.calls[1].body instanceof ArrayBuffer);env.dom.window.close();
});
test('자동 저장 OFF면 결과 편집 후 사용자 저장까지 노트를 만들지 않음',async()=>{
 const env=setup(false);await env.plugin.onload();env.plugin.command();await upload();await new Promise(resolve=>setTimeout(resolve,20));assert.equal([...env.files.values()].filter(x=>x.text&&x.path.startsWith('회의록/')).length,0);const draft=document.querySelector('textarea[aria-label="회의록 내용"]');assert.ok(draft.value.includes('시안 작성'));draft.value+='\n사용자 수정';[...document.querySelectorAll('button')].find(x=>x.textContent==='회의록 저장').click();const file=await env.done;assert.ok(env.files.get(file.path).text.endsWith('사용자 수정'));env.dom.window.close();
});
test('상용 분석 실패에도 원음·전사 원문 보존, 회의록 자동 작성은 하지 않음',async()=>{
 const env=setup(true);const original=globalThis.testRequest;globalThis.testRequest=options=>options.url.endsWith('/summarize')?Promise.resolve({status:502,json:{error:'synthetic failure'}}):original(options);
 await env.plugin.onload();env.plugin.command();await upload();await new Promise(resolve=>setTimeout(resolve,20));assert.ok([...env.files.values()].some(x=>x.data));assert.ok([...env.files.values()].some(x=>x.text?.includes('# 전사 원문')));assert.equal([...env.files.values()].filter(x=>x.path.startsWith('회의록/')).length,0);assert.ok(document.body.textContent.includes('정리 실패'));env.dom.window.close();
});

test('제목·텍스트 입력 없이 직접 녹음 → 시작 일시 제목 → 전사·정리·자동 저장',async t=>{
 const OriginalDate=globalThis.Date;
 const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const originalRecorder=globalThis.MediaRecorder;
 let now=new OriginalDate(2026,9,14,10,59);
 class ClockDate extends OriginalDate {
  constructor(...args){super(...(args.length?args:[now.getTime()]));}
  static now(){return now.getTime();}
 }
 let recorder;
 let trackStops=0;
 class Recorder {
  constructor(){recorder=this;this.state='inactive';this.mimeType='audio/webm';}
  static isTypeSupported(){return true;}
  start(){this.state='recording';}
  stop(){this.state='inactive';this.ondataavailable({data:new Blob(['synthetic recorded audio'],{type:this.mimeType})});this.onstop();}
 }
 globalThis.Date=ClockDate;
 globalThis.MediaRecorder=Recorder;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>trackStops++}]})}}});
 t.after(()=>{
  if(recorder?.state==='recording')recorder.stop();
  globalThis.Date=OriginalDate;
  if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;
  if(originalRecorder)globalThis.MediaRecorder=originalRecorder;else delete globalThis.MediaRecorder;
 });
 const env=setup(true);t.after(()=>env.dom.window.close());
 await env.plugin.onload();env.plugin.command();
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(document.querySelector('details.meeting-manual').open,false);
 assert.equal(document.querySelector('textarea[aria-label="회의록 내용"]').parentElement.hidden,true);
 assert.equal(document.querySelector('textarea[aria-label="텍스트 직접 입력"]').value,'');
 assert.equal([...document.querySelectorAll('button')].some(b=>b.textContent==='초안 만들기'),false);
 document.querySelector('input[type=checkbox]').checked=true;
 now=new OriginalDate(2026,9,14,11,0);
 await [...document.querySelectorAll('button')].find(b=>b.textContent==='녹음 시작').onclick();
 assert.equal(recorder.state,'recording');
 [...document.querySelectorAll('button')].find(b=>b.textContent==='녹음 종료·정리').click();
 const result=await Promise.race([env.done,new Promise((_,reject)=>setTimeout(()=>reject(new Error('직접 녹음 자동 저장 미실행')),1500))]);
 assert.equal(result.path,'회의록/2026-10-14 11시00분 회의.md');
 assert.ok(env.files.get(result.path).text.startsWith('# 2026-10-14 11시00분 회의\n'));
 assert.deepEqual(env.calls.map(x=>new URL(x.url).pathname),['/health','/transcribe','/summarize']);
 assert.equal(JSON.parse(env.calls[2].body).text,'민수가 금요일까지 시안을 작성한다.');
 assert.equal(trackStops,1);
});

test('선택형 텍스트 정리도 제목을 비우면 자동 제목을 사용하며 원음 링크는 붙이지 않음',async()=>{
 const env=setup(true);await env.plugin.onload();env.plugin.command();
 await new Promise(resolve=>setTimeout(resolve,0));
 document.querySelector('details.meeting-manual').open=true;
 document.querySelector('input[type=checkbox]').checked=true;
 document.querySelector('input[aria-label="회의 제목"]').value='';
 document.querySelector('textarea[aria-label="텍스트 직접 입력"]').value='민수가 금요일까지 시안을 작성한다.';
 [...document.querySelectorAll('button')].find(b=>b.textContent==='텍스트로 정리').click();
 await new Promise(resolve=>setTimeout(resolve,20));
 const draft=document.querySelector('textarea[aria-label="회의록 내용"]');
 assert.equal(draft.parentElement.hidden,false);
 assert.match(draft.value,/^# \d{4}-\d{2}-\d{2} \d{2}시\d{2}분 회의/);
 assert.ok(!draft.value.includes('## 원음'));
 [...document.querySelectorAll('button')].find(b=>b.textContent==='회의록 저장').click();
 await env.done;env.dom.window.close();
});


test('기존 접속 주소·토큰·사용자 폴더·자동 저장 설정은 업데이트 후에도 보존',async()=>{
 const env=setup(false);
 const saved={...env.plugin.settings,endpoint:'https://private.example.invalid/api',folder:'개인/기존 회의록'};
 env.plugin.settings={...saved};
 await env.plugin.onload();
 assert.deepEqual(env.plugin.settings,saved);
 assert.equal(env.calls.length,0);
 assert.equal(env.files.size,0);
 env.dom.window.close();
});

test('HTTPS 경로 프록시 주소의 음성→정리 요청은 경로 접두어와 기존 토큰 유지',async()=>{
 const env=setup(true);
 env.plugin.settings.endpoint='https://meeting.example.invalid/meeting-notes-api';
 await env.plugin.onload();env.plugin.command();await upload();
 await env.done;
 assert.deepEqual(env.calls.map(x=>new URL(x.url).pathname),['/meeting-notes-api/health','/meeting-notes-api/transcribe','/meeting-notes-api/summarize']);
 assert.ok(env.calls.slice(1).every(x=>x.headers.Authorization==='Bearer test-token'));
 env.dom.window.close();
});


const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
function savedRecording(env,path,body,mtime=Date.now()){
 const data=new TextEncoder().encode(body).buffer;
 env.files.set(path,{path,data,extension:path.split('.').pop(),stat:{mtime,size:data.byteLength}});
 return data;
}
async function openExisting(env){await env.plugin.onload();env.plugin.command();await tick();}

test('다시 연 창은 보관 원음을 찾고 이전 창의 Blob 없이 재정리하며 원음을 중복 저장하지 않음',async()=>{
 const env=setup(false);await openExisting(env);await upload();await tick();
 const original=[...env.files.values()].find(f=>f.data);const originalText=env.files.get(original.path.replace(/\.[^.]+$/,'.md')).text;
 globalThis.testModal.close();env.plugin.command();await tick();
 const retry=button('보관한 녹음으로 다시 정리');assert.equal(retry.disabled,false);
 assert.equal(document.querySelector('select[aria-label="보관한 녹음 선택"]').value,original.path);
 document.querySelector('input[type=checkbox]').checked=true;retry.click();await tick();
 assert.equal(env.calls.filter(c=>c.url.endsWith('/transcribe')).length,2);
 assert.equal(env.calls.filter(c=>c.url.endsWith('/summarize')).length,2);
 assert.equal([...env.files.values()].filter(f=>f.data).length,1);
 assert.equal(env.files.get(original.path.replace(/\.[^.]+$/,'.md')).text,originalText);
 assert.ok(env.files.has(original.path.replace(/\.[^.]+$/,' (전사 2).md')));
 assert.ok(document.querySelector('textarea[aria-label="회의록 내용"]').value.includes(`[[${original.path}]]`));
 env.dom.window.close();
});

test('선택한 오래된 M4A의 실제 바이트·MIME을 전송하며 기존 전사문·회의록을 덮어쓰지 않음',async()=>{
 const env=setup(true);
 const older='회의녹음/이전 회의.m4a',latest='회의녹음/새 회의.wav';
 const bytes=savedRecording(env,older,'older recording',1);savedRecording(env,latest,'latest recording',2);
 env.files.set('회의녹음/이전 회의.md',{path:'회의녹음/이전 회의.md',text:'사용자가 수정한 전사문'});
 env.files.set('회의녹음/이전 회의 (전사 2).md',{path:'회의녹음/이전 회의 (전사 2).md',text:'두번째 전사문'});
 await openExisting(env);
 const select=document.querySelector('select[aria-label="보관한 녹음 선택"]');assert.equal(select.value,latest);
 const notePath='회의록/'+document.querySelector('input[aria-label="회의 제목"]').value+'.md';
 env.files.set(notePath,{path:notePath,text:'기존 회의록'});
 select.value=older;select.onchange();document.querySelector('input[type=checkbox]').checked=true;
 button('보관한 녹음으로 다시 정리').click();const result=await env.done;
 const request=env.calls.find(c=>c.url.endsWith('/transcribe'));
 assert.deepEqual(request.body,bytes);assert.equal(request.headers['Content-Type'],'audio/mp4');
 assert.equal([...env.files.values()].filter(f=>f.data).length,2);
 assert.equal(env.files.get('회의녹음/이전 회의.md').text,'사용자가 수정한 전사문');
 assert.equal(env.files.get('회의녹음/이전 회의 (전사 2).md').text,'두번째 전사문');
 assert.ok(env.files.has('회의녹음/이전 회의 (전사 3).md'));
 assert.equal(env.files.get(notePath).text,'기존 회의록');assert.notEqual(result.path,notePath);
 assert.ok(env.files.get(result.path).text.includes(`[[${older}]]`));env.dom.window.close();
});

test('전사 실패 후 재시도는 같은 보관 원음으로 성공하고 동의 전에는 보내지 않음',async()=>{
 const env=setup(false);const path='회의녹음/재시도.webm';savedRecording(env,path,'saved audio');
 const original=globalThis.testRequest;let attempts=0;
 globalThis.testRequest=options=>options.url.endsWith('/transcribe')&&++attempts===1?Promise.resolve({status:502,json:{error:'failure'}}):original(options);
 await openExisting(env);const retry=button('보관한 녹음으로 다시 정리');retry.click();await tick();
 assert.equal(attempts,0);assert.ok(globalThis.testNotices.some(s=>s.includes('동의')));
 document.querySelector('input[type=checkbox]').checked=true;retry.click();await tick();
 assert.equal(attempts,1);assert.equal(retry.disabled,false);assert.ok(document.body.textContent.includes('전사 실패 (502)'));
 retry.click();await tick();assert.equal(attempts,2);
 assert.equal(env.calls.filter(c=>c.url.endsWith('/summarize')).length,1);
 assert.equal([...env.files.values()].filter(f=>f.data).length,1);assert.ok(env.files.has('회의녹음/재시도.md'));
 env.dom.window.close();
});

test('보관 원음 읽기·전사 중 중복 재처리와 녹음 시작을 막고 오류 후 복구',async()=>{
 const env=setup(false);savedRecording(env,'회의녹음/읽기.webm','saved audio');
 let release;let reads=0;const read=globalThis.testApp.vault.readBinary;
 globalThis.testApp.vault.readBinary=async file=>{reads++;await new Promise(resolve=>release=resolve);return read(file);};
 await openExisting(env);document.querySelector('input[type=checkbox]').checked=true;
 const retry=button('보관한 녹음으로 다시 정리');retry.click();retry.onclick();
 assert.equal(reads,1);assert.equal(retry.disabled,true);assert.equal(button('녹음 시작').disabled,true);
 assert.equal(document.querySelector('select[aria-label="보관한 녹음 선택"]').disabled,true);
 release();await tick();assert.equal(retry.disabled,false);assert.equal(button('녹음 시작').disabled,false);
 assert.equal(env.calls.filter(c=>c.url.endsWith('/transcribe')).length,1);env.dom.window.close();
});

test('보관 원음이 없으면 비활성 이유를 안내하고 삭제·크기 오류 때 전송하지 않음',async()=>{
 const env=setup(false);await openExisting(env);
 assert.equal(button('보관한 녹음으로 다시 정리').disabled,true);assert.ok(document.body.textContent.includes('보관된 녹음이 없습니다'));
 globalThis.testModal.close();const path='회의녹음/삭제.webm';savedRecording(env,path,'saved audio');env.plugin.command();await tick();
 document.querySelector('input[type=checkbox]').checked=true;env.files.delete(path);button('보관한 녹음으로 다시 정리').click();await tick();
 assert.ok(document.body.textContent.includes('파일을 찾을 수 없습니다'));assert.equal(button('보관한 녹음으로 다시 정리').disabled,true);
 globalThis.testModal.close();savedRecording(env,path,'too large');env.files.get(path).stat.size=25*1024*1024;env.plugin.command();await tick();
 document.querySelector('input[type=checkbox]').checked=true;button('보관한 녹음으로 다시 정리').click();await tick();
 assert.ok(document.body.textContent.includes('24MB'));assert.equal(env.calls.filter(c=>c.url.endsWith('/transcribe')).length,0);env.dom.window.close();
});

test('보관 원음을 읽다가 창을 닫으면 전송·전사·새 회의록 생성 없이 종료',async()=>{
 const env=setup(false);savedRecording(env,'회의녹음/닫기.webm','saved audio');
 let release;const read=globalThis.testApp.vault.readBinary;
 globalThis.testApp.vault.readBinary=async file=>{await new Promise(resolve=>release=resolve);return read(file);};
 await openExisting(env);document.querySelector('input[type=checkbox]').checked=true;
 button('보관한 녹음으로 다시 정리').click();globalThis.testModal.close();release();await tick();
 assert.equal(env.calls.filter(c=>c.url.endsWith('/transcribe')).length,0);
 assert.equal(env.files.size,1);env.dom.window.close();
});

test('비동기 전사: 수치 없는 작동 중 표시·취소는 서버 요청 후 확인·원음 보존',async()=>{
 const env=setup(false);const path='회의녹음/긴-녹음.webm';savedRecording(env,path,'saved synthetic audio');
 const original=globalThis.testRequest;const job='a'.repeat(32);let cancelled=false;
 globalThis.testRequest=async options=>{
  if(options.url.endsWith('/health')){const r=await original(options);r.json.audioJobs=true;return r;}
  env.calls.push(options);
  if(options.url.endsWith('/transcriptions'))return {status:202,json:{id:job,state:'running',phase:'transcribing',elapsedSeconds:40,percent:25,processedSeconds:750,totalSeconds:3000}};
  if(options.url.endsWith('/cancel')){cancelled=true;return {status:200,json:{id:job,state:'cancelled',elapsedSeconds:42}};}
  throw new Error('unexpected inference or upload');
 };
 await openExisting(env);document.querySelector('input[type=checkbox]').checked=true;
 button('보관한 녹음으로 다시 정리').click();await tick();
 assert.ok(document.body.textContent.includes('음성을 전사하는 중'));
 assert.ok(!document.body.textContent.includes('25.0%'));
 assert.equal(document.querySelector('progress'),null);
 assert.equal(button('전사 취소').disabled,false);
 await button('전사 취소').onclick();await tick();
 assert.equal(cancelled,true);assert.ok(document.body.textContent.includes('전사를 취소했습니다'));
 assert.equal(button('전사 취소').disabled,true);assert.equal(button('보관한 녹음으로 다시 정리').disabled,false);
 assert.equal(env.files.size,1);assert.ok(env.files.get(path).data);assert.equal(env.calls.filter(c=>c.url.endsWith('/summarize')).length,0);
 assert.equal(env.calls.filter(c=>c.url.endsWith('/transcriptions')).length,1);env.dom.window.close();
});

test('접수 중 취소는 작업ID를 받은 뒤 서버를 취소하고 회의록을 만들지 않음',async()=>{
 const env=setup(false);savedRecording(env,'회의녹음/접수중.webm','saved audio');
 const original=globalThis.testRequest;let accepted;let cancelled=0;
 globalThis.testRequest=async options=>{
  if(options.url.endsWith('/health')){const r=await original(options);r.json.audioJobs=true;return r;}
  env.calls.push(options);
  if(options.url.endsWith('/transcriptions'))return new Promise(resolve=>accepted=()=>resolve({status:202,json:{id:'b'.repeat(32),state:'running',elapsedSeconds:0}}));
  if(options.url.endsWith('/cancel')){cancelled++;return {status:200,json:{id:'b'.repeat(32),state:'cancelled',elapsedSeconds:1}};}
  throw new Error('unexpected request');
 };
 await openExisting(env);document.querySelector('input[type=checkbox]').checked=true;
 button('보관한 녹음으로 다시 정리').click();await tick();
 await button('전사 취소').onclick();assert.equal(cancelled,0);accepted();await tick();
 assert.equal(cancelled,1);assert.equal(env.files.size,1);assert.ok(document.body.textContent.includes('전사를 취소했습니다'));env.dom.window.close();
});

test('비동기 전사 조회 실패는 재업로드하지 않으며 창 닫기는 서버 취소와 구분',async()=>{
 const env=setup(false);savedRecording(env,'회의녹음/닫기.webm','saved audio');
 const original=globalThis.testRequest;
 globalThis.testRequest=async options=>{
  if(options.url.endsWith('/health')){const r=await original(options);r.json.audioJobs=true;return r;}
  env.calls.push(options);
  if(options.url.endsWith('/transcriptions'))return {status:202,json:{id:'c'.repeat(32),state:'running',phase:'loading',elapsedSeconds:0}};
  throw new Error('must not replay');
 };
 await openExisting(env);document.querySelector('input[type=checkbox]').checked=true;
 button('보관한 녹음으로 다시 정리').click();await tick();
 assert.ok(document.body.textContent.includes('모델을 준비'));
 globalThis.testModal.close();await tick();assert.equal(env.calls.filter(c=>c.url.endsWith('/transcriptions')).length,1);
 assert.equal(env.calls.filter(c=>c.url.endsWith('/cancel')).length,0);assert.equal(env.files.size,1);env.dom.window.close();
});

function fastStorage(env){
 const cache=new Map(),folders=new Set();
 const vault=globalThis.testApp.vault;
 vault.read=async file=>env.files.get(file.path).text;
 vault.modify=async(file,text)=>{env.files.get(file.path).text=text;};
 vault.adapter={exists:async p=>cache.has(p)||folders.has(p)||env.files.has(p),mkdir:async p=>folders.add(p),write:async(p,s)=>cache.set(p,s),read:async p=>cache.get(p),writeBinary:async(p,b)=>cache.set(p,b),readBinary:async p=>cache.get(p)||env.files.get(p).data,remove:async p=>cache.delete(p),rename:async(a,b)=>{cache.set(b,cache.get(a));cache.delete(a);},list:async p=>({folders:[...folders].filter(f=>f.startsWith(p+'/')&&!f.slice(p.length+1).includes('/')),files:[]})};
 return cache;
}
test('빠른 파일 재처리는 원음 1회 업로드·부분 문서 누적·원음 하나·완료 임시 사본 정리',async()=>{
 const env=setup(true),cache=fastStorage(env),original=globalThis.testRequest;
 const source='회의녹음/보관한 원음.m4a';const bytes=savedRecording(env,source,'synthetic fast file');let uploads=0;
 globalThis.testRequest=async options=>{
  if(options.url.endsWith('/health')){const r=await original(options);r.json.audioJobs=true;r.json.audioFast=true;return r;}
  if(options.url.endsWith('/transcriptions/fast')){env.calls.push(options);uploads++;assert.deepEqual(options.body,bytes);assert.equal(options.headers['Content-Type'],'audio/mp4');return {status:200,json:{id:'f'.repeat(32),state:'completed',profile:'fast',elapsedSeconds:1,text:'민수가 금요일까지 시안을 작성한다.',partialText:'민수가 금요일까지 시안을 작성한다.'}};}
  return original(options);
 };
 await openExisting(env);assert.equal(document.querySelector('select[aria-label="전사 방식"]').value,'fast');document.querySelector('input[type=checkbox]').checked=true;button('보관한 녹음으로 다시 정리').click();const result=await env.done;
 assert.equal(uploads,1);assert.equal([...env.files.values()].filter(f=>f.data).length,1);assert.deepEqual(env.files.get(source).data,bytes);assert.ok(env.files.get(result.path).text.includes(`[[${source}]]`));assert.ok([...env.files.values()].some(f=>f.text?.includes('# 녹음 중 전사 원문')&&f.text.includes('전사 완료')));assert.equal([...cache.keys()].filter(p=>p.endsWith('.audio')).length,0);env.dom.window.close();
});
test('빠른 직접 녹음은 종료 전 전사하고 마지막 꼬리만 이어서 처리하며 원음 1개 보관',async t=>{
 const oldNav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),oldRecorder=globalThis.MediaRecorder;let recorder;
 class Recorder{constructor(){recorder=this;this.state='inactive';this.mimeType='audio/webm';}static isTypeSupported(){return true;}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['whole original recording'],{type:this.mimeType})});this.onstop();}}
 globalThis.MediaRecorder=Recorder;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}}});
 t.after(()=>{globalThis.MediaRecorder=oldRecorder;if(oldNav)Object.defineProperty(globalThis,'navigator',oldNav);else delete globalThis.navigator;delete globalThis.testPcmTail;});
 const env=setup(true),cache=fastStorage(env),original=globalThis.testRequest;let posts=0;
 globalThis.testRequest=async options=>{
  if(options.url.endsWith('/health')){const r=await original(options);r.json.audioJobs=true;r.json.audioFast=true;return r;}
  if(options.url.endsWith('/transcriptions/fast')){env.calls.push(options);posts++;return {status:200,json:{id:String(posts).repeat(32),state:'completed',profile:'fast',elapsedSeconds:1,text:posts===1?'민수가 금요일까지 시안을 작성한다.':'추가 발언.'}};}
  return original(options);
 };
 await openExisting(env);document.querySelector('input[type=checkbox]').checked=true;await button('녹음 시작').onclick();
 globalThis.testPcm.emit({data:new Uint8Array([1,2]).buffer,start:0,end:30});await tick();assert.equal(recorder.state,'recording');assert.equal(posts,1);assert.ok(document.querySelector('textarea[aria-label="진행 중 전사문"]').value.includes('시안을 작성한다.'));
 globalThis.testPcmTail=emit=>emit({data:new Uint8Array([3,4]).buffer,start:30,end:34});button('녹음 종료·정리').click();const note=await env.done;assert.equal(posts,2);assert.equal([...env.files.values()].filter(f=>f.data).length,1);assert.ok(env.files.get(note.path).text.includes('추가 발언.'));assert.equal([...cache.keys()].filter(p=>p.endsWith('.audio')).length,0);env.dom.window.close();
});
test('진행 중 전사문을 직접 수정하면 내용 보존·자동 회의록 정리 중단',async()=>{
 const env=setup(false);fastStorage(env);const original=globalThis.testRequest;let calls=0;
 globalThis.testRequest=async options=>{
  if(options.url.endsWith('/health')){const r=await original(options);r.json.audioJobs=true;r.json.audioFast=true;return r;}
  if(options.url.endsWith('/transcriptions/fast')){const journal=[...env.files.values()].find(f=>f.path.includes('녹음중-전사-'));journal.text='사용자가 수정한 중요 원문';calls++;return {status:200,json:{id:'a'.repeat(32),state:'completed',elapsedSeconds:1,text:'모델 원문',profile:'fast'}};}
  return original(options);
 };
 await openExisting(env);await upload();await tick();assert.equal(calls,1);assert.ok([...env.files.values()].some(f=>f.text==='사용자가 수정한 중요 원문'));assert.equal(env.calls.filter(o=>o.url.endsWith('/summarize')).length,0);assert.ok([...env.files.values()].some(f=>f.data));env.dom.window.close();
});

test('터보 기본 선택은 녹음 중 전사·마지막 꼬리·한 원음·자동 회의록 저장을 완료',async t=>{
 const oldNav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),oldRecorder=globalThis.MediaRecorder;let recorder;
 class Recorder{constructor(){recorder=this;this.state='inactive';this.mimeType='audio/webm';}static isTypeSupported(){return true;}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['whole original recording'],{type:this.mimeType})});this.onstop();}}
 globalThis.MediaRecorder=Recorder;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}}});
 t.after(()=>{globalThis.MediaRecorder=oldRecorder;if(oldNav)Object.defineProperty(globalThis,'navigator',oldNav);else delete globalThis.navigator;delete globalThis.testPcmTail;});
 const env=setup(true),cache=fastStorage(env),original=globalThis.testRequest;let posts=0;
 globalThis.testRequest=async options=>{
  if(options.url.endsWith('/health')){const r=await original(options);r.json.audioJobs=true;r.json.audioFast=true;r.json.audioTurbo=true;return r;}
  if(options.url.endsWith('/transcriptions/turbo')){env.calls.push(options);posts++;return {status:200,json:{id:String(posts).repeat(32),state:'completed',profile:'turbo',elapsedSeconds:1,text:posts===1?'민수가 금요일까지 시안을 작성한다.':'추가 발언.'}};}
  return original(options);
 };
 await openExisting(env);assert.equal(document.querySelector('select[aria-label="전사 방식"]').value,'turbo');document.querySelector('input[type=checkbox]').checked=true;await button('녹음 시작').onclick();
 globalThis.testPcm.emit({data:new Uint8Array([1,2]).buffer,start:0,end:30});await tick();assert.equal(recorder.state,'recording');assert.equal(posts,1);assert.ok(document.querySelector('textarea[aria-label="진행 중 전사문"]').value.includes('시안을 작성한다.'));
 globalThis.testPcmTail=emit=>emit({data:new Uint8Array([3,4]).buffer,start:30,end:34});button('녹음 종료·정리').click();const note=await env.done;assert.equal(posts,2);assert.equal([...env.files.values()].filter(f=>f.data).length,1);assert.ok(env.files.get(note.path).text.includes('추가 발언.'));assert.equal([...cache.keys()].filter(p=>p.endsWith('.audio')).length,0);env.dom.window.close();
});
