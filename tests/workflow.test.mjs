import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const stub=`
export class Plugin {constructor(){this.app=globalThis.testApp;}loadData(){return this.settings;}addSettingTab(){}addRibbonIcon(){}addCommand(c){this.command=c.callback;}saveData(){}}
export class Modal {constructor(app){this.app=app;this.contentEl=document.createElement('div');}open(){document.body.append(this.contentEl);this.onOpen();}close(){this.onClose();}}
export const Platform={isDesktopApp:true}; export class App {} export class PluginSettingTab {} export class Setting {} export class Notice {constructor(text){globalThis.testNotices.push(text);}}
export const normalizePath=p=>p;export const requestUrl=options=>globalThis.testRequest(options);`;
const {outputFiles}=await build({entryPoints:['src/main.ts'],bundle:true,write:false,format:'esm',platform:'browser',plugins:[{name:'test-obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:stub,loader:'js'}));}}]});
const Plugin=(await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))).default;
function setup(autoSave){
 const dom=new JSDOM('<body></body>');globalThis.document=dom.window.document;
 const proto=dom.window.HTMLElement.prototype;
 proto.createEl=function(tag,options={}){const el=document.createElement(tag);if(options.text)el.textContent=options.text;if(options.type)el.type=options.type;if(options.cls)el.className=options.cls;for(const [key,value]of Object.entries(options.attr||{}))el.setAttribute(key,value);this.append(el);return el;};
 proto.createDiv=function(){return this.createEl('div');};proto.addClass=function(x){this.classList.add(x);};proto.empty=function(){this.replaceChildren();};proto.setText=function(x){this.textContent=x;};proto.appendText=function(x){this.append(document.createTextNode(x));};proto.hide=function(){this.hidden=true;};
 const files=new Map();const calls=[];globalThis.testNotices=[];let opened;const done=new Promise(resolve=>opened=resolve);
 globalThis.testApp={vault:{getAbstractFileByPath:path=>files.get(path),createFolder:async path=>files.set(path,{path}),createBinary:async(path,data)=>{files.set(path,{path,data});return {path};},create:async(path,text)=>{files.set(path,{path,text});return {path};}},workspace:{getLeaf:()=>({openFile:async file=>opened(file)})}};
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
