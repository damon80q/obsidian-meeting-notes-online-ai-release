import {TranscriptionTask} from './transcription';
import {PcmChunk} from './pcm-chunks';
export const liveCache='.meeting-notes-cache';
export type LiveStorage={exists:(p:string)=>Promise<boolean>;mkdir:(p:string)=>Promise<void>;write:(p:string,s:string)=>Promise<void>;read:(p:string)=>Promise<string>;writeBinary:(p:string,b:ArrayBuffer)=>Promise<void>;readBinary:(p:string)=>Promise<ArrayBuffer>;remove?:(p:string)=>Promise<void>;list:(p:string)=>Promise<{folders:string[];files:string[]}>};
type Part={index:number;start:number;end:number;state:'pending'|'running'|'completed'|'paused';job?:string;text?:string;partial?:string;terminal?:boolean;mime?:string};
export type LiveManifest={version:1;id:string;profile?:'fast'|'turbo';endpoint:string;original:string;document:string;ended:boolean;cancelled:boolean;incomplete?:boolean;dataPruned?:boolean;parts:Part[]};
const clock=(s:number)=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
export function liveMarkdown(m:LiveManifest){
 const complete=m.ended&&!m.incomplete&&m.parts.length>0&&m.parts.every(p=>p.state==='completed');
 const sections=m.parts.filter(p=>p.text||p.partial).map(p=>`### ${p.end>p.start?clock(p.start)+'–'+clock(p.end):'파일 전사'}${p.state==='completed'?'':' (미완료)'}\n\n${p.text??p.partial}`);
 return `# 녹음 중 전사 원문\n\n${complete?'전사 완료':m.incomplete?'일부 전사용 구간의 보관에 실패했습니다. 전체 원음으로 다시 전사하세요.':m.cancelled?'전사 중단 · 미완료 구간은 보관되어 있습니다.':'전사 진행 중 · 아직 완성된 원문이 아닙니다.'}\n\n${sections.join('\n\n')}\n\n## 원음\n${m.original?'[['+m.original+']]':'녹음 종료 시 전체 원음 파일 하나를 연결합니다.'}\n`;
}
export class LiveTranscription {
 private saving:Promise<void>=Promise.resolve();private incoming:Promise<void>=Promise.resolve();private pumping:Promise<void>|null=null;
 private task:TranscriptionTask|null=null;private paused=false;private detached=false;private stopped=false;
 private constructor(readonly manifest:LiveManifest,private storage:LiveStorage,private config:{endpoint:string;token:string;profile?:'fast'|'turbo';write:(m:LiveManifest)=>Promise<void>;status:(s:string)=>void},private pollMs=1000){}
 get directory(){return liveCache+'/'+this.manifest.id;}
 static async create(storage:LiveStorage,config:{endpoint:string;token:string;profile?:'fast'|'turbo';write:(m:LiveManifest)=>Promise<void>;status:(s:string)=>void},pollMs=1000){
  const id=crypto.randomUUID().replace(/-/g,'');
  const m:LiveManifest={version:1,id,profile:config.profile||'fast',endpoint:config.endpoint,original:'',document:`회의녹음/녹음중-전사-${id}.md`,ended:false,cancelled:false,parts:[]};
  if(!await storage.exists(liveCache))await storage.mkdir(liveCache);
  const live=new LiveTranscription(m,storage,config,pollMs);await storage.mkdir(live.directory);await live.save();return live;
 }
 private static async readManifest(storage:LiveStorage,id:string){
  let last:unknown;
  // Obsidian rename은 기존 파일을 덮어쓰지 않습니다. 중단된 최신 저장 기록부터 검증합니다.
  for(const name of ['session.pending','session.json'])try{
   const m=JSON.parse(await storage.read(liveCache+'/'+id+'/'+name)) as LiveManifest;
   if(!m||m.version!==1||m.id!==id||(m.profile!==undefined&&!['fast','turbo'].includes(m.profile))||typeof m.endpoint!=='string'||m.document!==`회의녹음/녹음중-전사-${id}.md`||!Array.isArray(m.parts)||m.parts.length>200||typeof m.ended!=='boolean'||typeof m.cancelled!=='boolean'||typeof m.original!=='string'||(m.original&&(!m.original.startsWith('회의녹음/')||m.original.includes('..')))||[m.incomplete,m.dataPruned].some(v=>v!==undefined&&typeof v!=='boolean'))throw new Error('복구 자료 또는 처리 서버가 일치하지 않습니다.');
   for(const [i,p] of m.parts.entries())if(!p||p.index!==i||!Number.isFinite(p.start)||!Number.isFinite(p.end)||p.start<0||p.end<p.start||(p.mime!==undefined&&(typeof p.mime!=='string'||p.mime.length>200||!new RegExp('^(audio/(webm|mp4|mpeg|wav|x-wav|ogg|flac|aac)|video/webm)(;[^\\r\\n]*)?$').test(p.mime)))||!['pending','running','completed','paused'].includes(p.state)||(p.job!==undefined&&(typeof p.job!=='string'||!/^[a-f0-9]{32}$/.test(p.job)))||[p.text,p.partial].some(t=>t!==undefined&&(typeof t!=='string'||t.length>30000)))throw new Error('복구 구간 정보 오류');
   return m;
  }catch(error){last=error;}
  throw last instanceof Error?last:new Error('복구 기록을 읽지 못했습니다.');
 }
 static async recover(storage:LiveStorage,id:string,config:{endpoint:string;token:string;profile?:'fast'|'turbo';write:(m:LiveManifest)=>Promise<void>;status:(s:string)=>void},pollMs=1000){
  if(!/^[a-f0-9]{32}$/.test(id))throw new Error('복구 ID 오류');
  const m=await LiveTranscription.readManifest(storage,id);
  if(m.endpoint!==config.endpoint)throw new Error('복구 자료 또는 처리 서버가 일치하지 않습니다.');
  const live=new LiveTranscription(m,storage,config,pollMs);live.paused=true;return live;
 }
 static async unfinished(storage:LiveStorage,endpoint:string):Promise<Array<{id:string;label:string}>>{
  if(!await storage.exists(liveCache))return[];
  const result=[];
  for(const folder of (await storage.list(liveCache)).folders){
   const id=folder.split('/').pop()!;if(!/^[a-f0-9]{32}$/.test(id)||folder!==liveCache+'/'+id)continue;
   try{const m=await LiveTranscription.readManifest(storage,id);if(m.endpoint===endpoint&&(m.incomplete||m.parts?.some(p=>p.state!=='completed')))result.push({id,label:m.original||'종료 전 중단된 녹음 ('+id.slice(0,8)+')'});}catch{}
  }
  return result;
 }
 private save(){
  const snapshot=JSON.stringify(this.manifest);const copy=JSON.parse(snapshot) as LiveManifest;
  this.saving=this.saving.catch(()=>{}).then(async()=>{await this.storage.write(this.directory+'/session.pending',snapshot);await this.storage.write(this.directory+'/session.json',snapshot);try{await this.storage.remove?.(this.directory+'/session.pending');}catch{}await this.config.write(copy);});return this.saving;
 }
 enqueue(chunk:PcmChunk,mime='audio/wav'){
  if(this.stopped)return;
  this.incoming=this.incoming.then(async()=>{
   const p:Part={index:this.manifest.parts.length,start:chunk.start,end:chunk.end,state:'pending',mime};
   await this.storage.writeBinary(this.directory+'/'+p.index+'.audio',chunk.data);
   this.manifest.parts.push(p);await this.save();void this.pump();
  }).catch(error=>{this.paused=true;this.manifest.incomplete=true;this.config.status('전사용 구간 보관 실패. 원음 녹음은 계속됩니다. '+(error instanceof Error?error.message:''));});
 }
 private pump():Promise<void>{
  if(this.pumping)return this.pumping;
  this.pumping=(async()=>{
   await this.incoming;
   while(!this.paused&&!this.detached&&!this.manifest.cancelled){
    const part=this.manifest.parts.find(p=>p.state!=='completed');if(!part)return;
    part.state='running';await this.save();
    if(this.paused||this.detached||this.manifest.cancelled){part.state='paused';await this.save();return;}
    try{
     this.config.status(this.manifest.ended?'남은 음성을 전사하는 중…':'녹음·전사 중…');
     const task=new TranscriptionTask({endpoint:this.config.endpoint,token:this.config.token,jobs:true,fast:(this.manifest.profile||'fast')==='fast',turbo:this.manifest.profile==='turbo',resumeId:part.job,
      onAccepted:async id=>{part.job=id;await this.save();},
      onPartial:async text=>{part.partial=text;await this.save();}},message=>this.config.status(this.manifest.ended?message:'녹음·전사 중…'),this.pollMs);
     this.task=task;const text=await task.run(await this.storage.readBinary(this.directory+'/'+part.index+'.audio'),part.mime||'audio/wav');
     if(text===null){part.state='paused';part.terminal=!this.detached;this.paused=true;await this.save();return;}
     part.state='completed';part.text=text;delete part.partial;await this.save();
    }catch(error){
     part.state='paused';part.terminal=!!(error as {terminal?:string}).terminal;this.paused=true;
     await this.save();this.config.status((error instanceof Error?error.message:'전사 중단')+' 구간을 보관했습니다. 구간 전사 계속으로 이어갈 수 있습니다.');return;
    }finally{this.task=null;}
   }
  })().catch(error=>{this.paused=true;this.config.status('전사 기록 저장을 확인하지 못했습니다. 원음은 유지됩니다. '+(error instanceof Error?error.message:''));}).finally(()=>{this.pumping=null;if(!this.paused&&!this.detached&&!this.manifest.cancelled&&this.manifest.parts.some(p=>p.state!=='completed'))void this.pump();});return this.pumping;
 }
 private async drain(){
  await this.pump();
  while(this.pumping&&!this.paused&&!this.detached&&!this.manifest.cancelled)await this.pumping;
 }
 async finish(original:string){
  this.stopped=true;await this.incoming;this.manifest.ended=true;this.manifest.original=original;await this.save();await this.drain();return this.text();
 }
 text():string|null{return this.manifest.ended&&!this.manifest.cancelled&&!this.manifest.incomplete&&this.manifest.parts.length>0&&this.manifest.parts.every(p=>p.state==='completed')?this.manifest.parts.map(p=>p.text||'').filter(Boolean).join('\n'):null;}
 async resume(){
  if(!this.manifest.ended)throw new Error('녹음이 종료되지 않은 복구 자료입니다. 원음을 먼저 보관한 뒤 다시 정리하세요.');
  if(this.manifest.incomplete)throw new Error('누락된 전사용 구간이 있습니다. 전체 원음 파일을 선택해 다시 전사하세요.');
  this.paused=false;this.detached=false;this.manifest.cancelled=false;
  for(const p of this.manifest.parts)if(p.terminal){delete p.job;delete p.terminal;}
  await this.save();await this.drain();return this.text();
 }
 async pruneCompletedAudio(){
  if(this.text()===null||!this.storage.remove||!this.manifest.original||!await this.storage.exists(this.manifest.original))return;
  // 완료·원음 보관을 확인한 전사용 임시 복사본만 정리합니다. 원음·문서·미완료 구간은 건드리지 않습니다.
  if(!(await this.storage.readBinary(this.manifest.original)).byteLength)return;
  for(const part of this.manifest.parts){const path=this.directory+'/'+part.index+'.audio';if(await this.storage.exists(path))await this.storage.remove(path);}
  this.manifest.dataPruned=true;await this.save();
 }
 async cancel(){this.paused=true;this.manifest.cancelled=true;await this.task?.cancel();await this.pumping;await this.incoming;await this.save();}
 detach(){this.paused=true;this.detached=true;this.task?.detach();}
}
