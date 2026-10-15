import {TranscriptionTask} from './transcription';
import {capturePcmChunks} from './pcm-chunks';
import {LiveTranscription,liveMarkdown,LiveManifest} from './live-transcription';
import {App,Notice,Platform} from 'obsidian';
import {captureAudio,AudioCapture,RecordingSource} from './audio-capture';

const recordingTypes:Record<string,string>={webm:'audio/webm',m4a:'audio/mp4',mp4:'audio/mp4',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',flac:'audio/flac',aac:'audio/aac'};
const maxAudioBytes=24*1024*1024;

export class RecordingControls {
 private task:TranscriptionTask|null=null;
 private live:LiveTranscription|null=null;
 private pcm:{stop:()=>void}|null=null;
 private capabilities=()=>{};
 refreshCapabilities(){this.capabilities();}
 private recorder:MediaRecorder|null=null;
 private capture:AudioCapture|null=null;
 private starting=false;
 private abort:AbortController|null=null;
 private levelTimer:ReturnType<typeof setInterval>|null=null;
 private chunks:Blob[]=[];
 private audio:Blob|null=null;
 private audioPath='';
 private disposed=false;
 private processing=false;
 private timer:ReturnType<typeof setTimeout>|null=null;
 private bytes=0;
 constructor(private app:App,el:HTMLElement,private config:{endpoint:string;token:string;allowed:()=>boolean;jobs?:()=>boolean;fast?:()=>boolean;turbo?:()=>boolean;onStart?:(startedAt:Date)=>void;onText:(text:string,path:string)=>void|Promise<void>;onProgress?:(message:string)=>void;onIdle?:()=>void;progressEl?:HTMLElement}){
  el.createEl('h3',{text:'녹음'});
  el.createEl('p',{text:'녹음 중 전사하거나, 종료 후 정밀하게 전사합니다. 보관 원음은 전체 파일 하나입니다. 최대 60분 / 24MB. 영상은 저장·전송하지 않습니다.'});
  const modeLabel=el.createEl('label',{text:'전사 방식 '});
  const modeSelect=modeLabel.createEl('select',{attr:{'aria-label':'전사 방식'}});
  const turboOption=modeSelect.createEl('option',{text:'터보 · 녹음 중 구간 전사 (약30초)',attr:{value:'turbo'}});turboOption.disabled=true;
  const fastOption=modeSelect.createEl('option',{text:'빠르게 · 녹음 중 전사 / 파일 구간 전사',attr:{value:'fast'}});fastOption.disabled=true;
  modeSelect.createEl('option',{text:'정밀하게 · 녹음 종료 후 전체 전사',attr:{value:'accurate'}});modeSelect.value='accurate';
  let modeTouched=false;modeSelect.onchange=()=>{modeTouched=true;};
  this.capabilities=()=>{fastOption.disabled=!(config.fast?.()&&config.jobs?.());turboOption.disabled=!(config.turbo?.()&&config.jobs?.());if(!modeTouched)modeSelect.value=!turboOption.disabled?'turbo':fastOption.disabled?'accurate':'fast';};
  el.createEl('p',{text:'터보는 약30초씩 전사하며 끝부분의 짧은 무음을 우선해 나눕니다. 서버가 느리면 녹음 종료 후 남은 구간을 마저 처리합니다. 빠르게는 가벼운 small 모델이며, 전체 전사는 종료 후 한 번에 처리합니다.'});
  const sourceLabel=el.createEl('label',{text:'녹음 소리 '});
  const sourceSelect=sourceLabel.createEl('select',{attr:{'aria-label':'녹음 소리'}});
  sourceSelect.createEl('option',{text:'마이크 + 컴퓨터 소리 (Zoom·온라인 회의)',attr:{value:'microphone-system'}});
  sourceSelect.createEl('option',{text:'마이크만 (대면 회의·모바일)',attr:{value:'microphone'}});
  sourceSelect.value=Platform.isDesktopApp?'microphone-system':'microphone';
  if(!Platform.isDesktopApp)(sourceSelect.options[0] as HTMLOptionElement).disabled=true;
  el.createEl('p',{text:Platform.isDesktopApp?'Zoom에서는 이어폰 사용을 권장합니다. 컴퓨터 소리에는 다른 앱과 알림 소리도 포함됩니다. 녹음 시작 후 상대방이 말할 때 컴퓨터 소리 막대가 움직이는지 확인하세요.':'모바일은 마이크만 녹음합니다. 상대방 음성은 Zoom 녹음 파일을 선택해 처리하세요.'});
  const meters=el.createDiv({cls:'meeting-audio-levels'});
  const makeMeter=(label:string)=>{const row=meters.createDiv();row.createEl('span',{text:label});const meter=row.createEl('meter',{attr:{min:'0',max:'1',value:'0','aria-label':label+' 입력 크기'}});const text=row.createEl('span',{text:'대기'});return{meter,text};};
  const microphoneMeter=makeMeter('마이크');const systemMeter=makeMeter('컴퓨터 소리');
  const showLevels=()=>{if(!this.capture)return;const levels=this.capture.levels();microphoneMeter.meter.value=levels.microphone;microphoneMeter.text.setText(levels.microphone>0.015?'소리 감지':'소리 대기');systemMeter.meter.value=levels.system||0;systemMeter.text.setText(levels.system===null?'녹음 안 함':levels.system>0.015?'소리 감지':'소리 대기 · Zoom 음성을 확인하세요');};
  const record=el.createEl('button',{text:'녹음 시작',cls:'mod-cta'});
  const stop=el.createEl('button',{text:'녹음 종료·정리',cls:'mod-cta'});stop.disabled=true;
  if(config.progressEl)el.append(config.progressEl);
  const status=el.createEl('p',{attr:{role:'status'}});
  const preview=el.createEl('textarea',{attr:{'aria-label':'진행 중 전사문',readonly:'true'}});preview.hidden=true;
  const cancel=el.createEl('button',{text:'전사 취소'});cancel.disabled=true;
  cancel.onclick=async()=>{
   if(!this.task&&!this.live)return;
   cancel.disabled=true;status.setText('서버 전사를 취소하는 중… 원음은 그대로 보관합니다.');
   try{if(this.live){this.pcm?.stop();this.pcm=null;await this.live.cancel();status.setText('전사를 중단했습니다. 원음 녹음과 보관은 유지됩니다.');}else await this.task!.cancel();}
   catch{cancel.disabled=false;status.setText('전사 취소 여부를 확인하지 못했습니다. 서버 작업은 아직 실행 중일 수 있습니다. 취소를 다시 눌러 확인하세요.');}
  };
  const options=el.createEl('details');options.createEl('summary',{text:'녹음 파일 선택·재처리 (선택)'});
  const savedLabel=options.createEl('label',{text:'보관한 녹음 선택'});
  const savedSelect=savedLabel.createEl('select',{attr:{'aria-label':'보관한 녹음 선택'}});
  const retry=options.createEl('button',{text:'보관한 녹음으로 다시 정리'});
  const savedInfo=options.createEl('p',{attr:{'aria-live':'polite'}});
  const recoveryLabel=options.createEl('label',{text:'미완료 구간 전사 '});
  const recoverySelect=recoveryLabel.createEl('select',{attr:{'aria-label':'미완료 구간 전사'}});
  const resume=options.createEl('button',{text:'구간 전사 계속'});resume.disabled=true;
  const refreshRecovery=async()=>{
   if(!app.vault.adapter)return;
   const items=await LiveTranscription.unfinished(app.vault.adapter,config.endpoint);
   if(this.disposed)return;recoverySelect.replaceChildren();
   for(const item of items)recoverySelect.createEl('option',{text:item.label,attr:{value:item.id}});
   if(!items.length)recoverySelect.createEl('option',{text:'미완료 전사가 없습니다',attr:{value:''}});
   resume.disabled=this.processing||this.starting||this.recorder?.state==='recording'||!items.length;
  };
  void refreshRecovery().catch(()=>{});
  const file=options.createEl('input',{type:'file',attr:{accept:'audio/*,video/webm','aria-label':'녹음 파일 선택'}});
  options.createEl('p',{text:'회의녹음 폴더의 원음을 선택하면 창을 다시 열어도 정리할 수 있습니다. 다른 위치의 파일은 아래 파일 선택을 이용하세요. 새 파일은 전송 전에 회의녹음 폴더에 보관합니다.'});

  const refreshSaved=()=>{
   const recordings=app.vault.getFiles().filter(f=>f.path.startsWith('회의녹음/')&&typeof recordingTypes[f.extension.toLowerCase()]==='string').sort((a,b)=>b.stat.mtime-a.stat.mtime||a.path.localeCompare(b.path));
   if(this.audioPath&&!recordings.some(f=>f.path===this.audioPath))this.audioPath='';
   savedSelect.replaceChildren();
   if(this.audio&&!this.audioPath)savedSelect.createEl('option',{text:'현재 녹음 (보관 재시도)',attr:{value:''}});
   for(const recording of recordings)savedSelect.createEl('option',{text:recording.path,attr:{value:recording.path}});
   if(!recordings.length&&!this.audio)savedSelect.createEl('option',{text:'보관된 녹음이 없습니다',attr:{value:''}});
   if(recordings.some(f=>f.path===this.audioPath))savedSelect.value=this.audioPath;
   else if(!this.audio)this.audioPath=savedSelect.value;
   const locked=this.processing||this.starting||this.recorder?.state==='recording';
   savedSelect.disabled=locked||!recordings.length;modeSelect.disabled=locked;resume.disabled=locked||!recoverySelect.value;
   retry.disabled=locked||(!this.audioPath&&!this.audio);
   savedInfo.setText(this.audioPath?'선택한 원음을 다시 전사·정리합니다. 기존 원음·전사문·회의록은 덮어쓰지 않습니다.':this.audio?'현재 녹음의 보관·정리를 다시 시도할 수 있습니다.':'회의녹음 폴더에 녹음이 없으면 먼저 녹음하거나 아래에서 파일을 선택하세요.');
  };
  refreshSaved();

  const makeLive=async(recoverId?:string)=>{
   if(!app.vault.adapter)throw new Error('이 기기는 구간 전사 임시 저장을 지원하지 않습니다. 종료 후 전체 전사를 선택하세요.');
   let previous:string|undefined;
   const write=async(m:LiveManifest)=>{
    const text=liveMarkdown(m);
    if(!app.vault.getAbstractFileByPath('회의녹음'))await app.vault.createFolder('회의녹음');
    const existing=app.vault.getAbstractFileByPath(m.document) as import('obsidian').TFile|null;
    if(existing){if(previous===undefined||await app.vault.read(existing)!==previous)throw new Error('진행 중 전사문이 직접 수정되었습니다. 수정 내용을 보존하기 위해 자동 갱신을 멈췄습니다.');await app.vault.modify(existing,text);}
    else await app.vault.create(m.document,text);
    previous=text;if(!this.disposed){preview.hidden=false;preview.value=text;}
   };
   const liveConfig={endpoint:config.endpoint,token:config.token,profile:modeSelect.value==='turbo'?'turbo' as const:'fast' as const,write,status:(message:string)=>{if(!this.disposed){status.setText(message);if(this.recorder?.state!=='recording')config.onProgress?.(message);}}};
   if(recoverId){const live=await LiveTranscription.recover(app.vault.adapter,recoverId,liveConfig);previous=liveMarkdown(live.manifest);return live;}
   return LiveTranscription.create(app.vault.adapter,liveConfig);
  };
  const storeOriginal=async(blob:Blob)=>{
   if(!blob.size||blob.size>maxAudioBytes)throw new Error('원음이 0~24MB 범위를 벗어나 보관하지 못했습니다.');
   const folder='회의녹음';if(!app.vault.getAbstractFileByPath(folder))await app.vault.createFolder(folder);
   const ext=blob.type.includes('mp4')?'m4a':'webm';const path=`${folder}/회의-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
   await app.vault.createBinary(path,await blob.arrayBuffer());this.audioPath=path;return path;
  };
  const completeFast=async(text:string|null,path:string)=>{
   if(this.disposed)return;
   if(text===null){status.setText('구간 전사를 중단했습니다. 원음과 처리한 구간은 보관했습니다. 구간 전사 계속으로 이어갈 수 있습니다.');return;}
   if(!text.trim()){status.setText('발화가 감지되지 않았습니다. 원음은 그대로 보관했습니다.');return;}
   if(text.length>30000){status.setText('전사문은 보관했습니다. 회의록 정리 한도인 30,000자를 넘어 텍스트를 나누어 정리해 주세요.');return;}
   await this.live?.pruneCompletedAudio();
   status.setText('전사 완료. 회의록을 정리하는 중…');await config.onText(text,path);
  };
  resume.onclick=async()=>{
   if(this.processing||this.starting||this.recorder?.state==='recording'||!recoverySelect.value)return;
   if(!config.allowed()){new Notice('서버 연결과 전송 동의를 확인해 주세요.');return;}
   this.processing=true;refreshSaved();record.disabled=true;sourceSelect.disabled=true;file.disabled=true;cancel.disabled=false;config.onProgress?.('구간 전사를 이어받는 중…');
   try{this.live=await makeLive(recoverySelect.value);await completeFast(await this.live.resume(),this.live.manifest.original);}
   catch(error){if(!this.disposed)status.setText(error instanceof Error?error.message:'구간 전사 복구 실패');}
   finally{cancel.disabled=true;this.processing=false;record.disabled=false;sourceSelect.disabled=false;file.disabled=false;refreshSaved();void refreshRecovery().catch(()=>{});config.onIdle?.();}
  };

  const process=async(blob:Blob|null,path=this.audioPath)=>{
   if(this.disposed||this.processing||this.starting||this.recorder?.state==='recording')return;
   if(!config.allowed()){config.onIdle?.();new Notice('정리 서버의 전사 지원과 전송 동의를 확인해 주세요.');return;}
   this.processing=true;this.live=null;
   config.onProgress?.(path?'보관한 녹음을 읽는 중…':'녹음을 보관하는 중…');
   record.disabled=true;sourceSelect.disabled=true;file.disabled=true;retry.disabled=true;savedSelect.disabled=true;
   try{
    if(path){
     const recording=app.vault.getFiles().find(f=>f.path===path);
     if(!recording)throw new Error('선택한 녹음 파일을 찾을 수 없습니다. 창을 다시 열어 녹음을 선택하세요.');
     if(recording.stat.size===0||recording.stat.size>maxAudioBytes)throw new Error('음성 파일은 0~24MB 범위여야 합니다.');
     blob=new Blob([await app.vault.readBinary(recording)],{type:recordingTypes[recording.extension.toLowerCase()]||'audio/webm'});
    }
    if(!blob||blob.size===0||blob.size>maxAudioBytes)throw new Error('음성 파일은 0~24MB 범위여야 합니다.');
    const data=await blob.arrayBuffer();
    if(this.disposed)return;
    if(!path){
     const mime=blob.type.split(';')[0];
     const ext=mime.includes('mp4')?'m4a':mime.includes('mpeg')?'mp3':mime.includes('wav')?'wav':mime.includes('ogg')?'ogg':mime.includes('flac')?'flac':mime.includes('aac')?'aac':'webm';
     const folder='회의녹음';
     if(!app.vault.getAbstractFileByPath(folder))await app.vault.createFolder(folder);
     path=`${folder}/회의-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
     await app.vault.createBinary(path,data);
    }
    this.audioPath=path;
    if(this.disposed)return;
    refreshSaved();config.onProgress?.('음성을 전사하는 중…');status.setText(`녹음 보관 완료. 전사 중… (${path})`);
    if(modeSelect.value==='fast'||modeSelect.value==='turbo'){
     if(!config.jobs?.()||!(modeSelect.value==='turbo'?config.turbo?.():config.fast?.()))throw new Error('서버의 선택한 구간 전사 지원을 확인해 주세요.');
     this.live=await makeLive();this.live.enqueue({data,start:0,end:0},blob.type||'audio/webm');cancel.disabled=false;
     await completeFast(await this.live.finish(path),path);return;
    }
    const task=new TranscriptionTask({endpoint:config.endpoint,token:config.token,jobs:config.jobs?.()===true},message=>{if(!this.disposed){config.onProgress?.(message);status.setText(message);}});
    this.task=task;cancel.disabled=config.jobs?.()!==true;
    const text=await task.run(data,blob.type||'audio/webm');
    cancel.disabled=true;
    if(text===null){if(!this.disposed)status.setText(task.cancelRequested?'전사를 취소했습니다. 보관 원음은 그대로이며 다시 정리할 수 있습니다.':'창을 닫아 상태 조회를 종료했습니다. 서버 작업은 보관한 같은 원음을 선택해 다시 확인할 수 있습니다.');return;}
    const base=path.replace(/\.[^.]+$/,'');let transcript=base+'.md';let n=2;
    while(app.vault.getAbstractFileByPath(transcript))transcript=base+` (전사 ${n++}).md`;
    await app.vault.create(transcript,`# 전사 원문\n\n${text}\n\n## 원음\n[[${path}]]\n`);
    if(this.disposed)return;
    if(task.cancelRequested){status.setText('전사는 이미 완료되어 전사문을 보관했습니다. 회의록 정리는 시작하지 않았습니다.');return;}
    status.setText('전사 완료. 회의 분석을 시작합니다.');
    await config.onText(text,path);
   }catch(e){if(!this.disposed)status.setText(e instanceof Error?e.message:'전사에 실패했습니다.');}
   finally{this.task=null;cancel.disabled=true;this.processing=false;record.disabled=false;sourceSelect.disabled=false;file.disabled=false;refreshSaved();void refreshRecovery().catch(()=>{});config.onIdle?.();}
  };

  record.onclick=async()=>{
   if(this.disposed||this.starting||this.processing||this.recorder?.state==='recording')return;
   if(!config.allowed()){new Notice('서버 전사 지원·전송 동의를 먼저 확인하세요.');return;}
   if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){new Notice('이 기기는 직접 녹음을 지원하지 않습니다. 녹음 파일을 선택하세요.');return;}
   this.starting=true;this.abort=new AbortController();record.disabled=true;sourceSelect.disabled=true;file.disabled=true;retry.disabled=true;savedSelect.disabled=true;
   status.setText('녹음 소리 연결 중… 권한 요청이 보이면 허용해 주세요.');
   try{
    this.capture=await captureAudio(sourceSelect.value as RecordingSource,{signal:this.abort.signal});
    if(this.disposed){this.cleanup();return;}
    this.live=null;
    if(modeSelect.value==='fast'||modeSelect.value==='turbo'){
     if(!config.jobs?.()||!(modeSelect.value==='turbo'?config.turbo?.():config.fast?.()))throw new Error('서버의 선택한 구간 전사 지원을 확인해 주세요.');
     this.live=await makeLive();const live=this.live;
     this.pcm=await capturePcmChunks(this.capture.stream,chunk=>live.enqueue(chunk),modeSelect.value==='turbo'?{targetSeconds:28,maximumSeconds:30,exactMaximum:true}:{});
     if(this.disposed){this.pcm.stop();this.pcm=null;live.detach();this.cleanup();return;}
    }
    const type=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(x=>MediaRecorder.isTypeSupported(x));
    const recorder=new MediaRecorder(this.capture.stream,type?{mimeType:type,audioBitsPerSecond:48000}:{audioBitsPerSecond:48000});
    this.recorder=recorder;this.chunks=[];this.bytes=0;
    const finish=()=>{if(recorder.state==='recording'){stop.disabled=true;config.onProgress?.('녹음을 마무리하는 중…');recorder.stop();}};
    recorder.ondataavailable=e=>{if(e.data.size){this.chunks.push(e.data);this.bytes+=e.data.size;if(this.bytes>=23*1024*1024)finish();}};
    recorder.onerror=()=>{if(!this.disposed)status.setText('녹음 오류. 보관된 원음을 확인하거나 녹음 파일 선택을 이용해 주세요.');};
    recorder.onstop=()=>{
     this.pcm?.stop();this.pcm=null;const live=this.live;
     const audio=new Blob(this.chunks,{type:recorder.mimeType||'audio/webm'});this.audio=audio;this.audioPath='';
     this.recorder=null;this.cleanup();record.disabled=false;sourceSelect.disabled=false;file.disabled=false;stop.disabled=true;
     microphoneMeter.meter.value=0;systemMeter.meter.value=0;microphoneMeter.text.setText('종료');systemMeter.text.setText('종료');
     if(live){
      this.processing=true;record.disabled=true;sourceSelect.disabled=true;file.disabled=true;refreshSaved();cancel.disabled=this.disposed||live.manifest.cancelled;
      void(async()=>{
       try{const path=await storeOriginal(audio);await completeFast(await live.finish(path),path);}
       catch(error){if(!this.disposed)status.setText(error instanceof Error?error.message:'원음 보관 또는 전사 마무리 실패');}
       finally{cancel.disabled=true;this.processing=false;record.disabled=false;sourceSelect.disabled=false;file.disabled=false;refreshSaved();void refreshRecovery().catch(()=>{});config.onIdle?.();}
      })();
     }
     else if(!this.disposed)void process(audio);
     else if(audio.size>0&&audio.size<=maxAudioBytes)void(async()=>{try{const folder='회의녹음';if(!app.vault.getAbstractFileByPath(folder))await app.vault.createFolder(folder);const ext=audio.type.includes('mp4')?'m4a':'webm';await app.vault.createBinary(`${folder}/중단된-회의-${Date.now()}.${ext}`,await audio.arrayBuffer());new Notice('중단된 녹음을 보관했습니다. 나중에 파일로 정리할 수 있습니다.');}catch{new Notice('중단된 녹음 저장에 실패했습니다.');}})();
    };
    this.capture.onEnded(()=>{if(this.disposed)return;new Notice('마이크 또는 컴퓨터 소리 연결이 끊겨 녹음을 종료합니다. 지금까지의 원음은 보관·정리합니다.');finish();});
    recorder.start(1000);config.onStart?.(new Date());config.onProgress?.(this.live?'녹음·전사 중…':'녹음 중…');stop.disabled=false;cancel.disabled=!this.live;modeSelect.disabled=true;
    status.setText(sourceSelect.value==='microphone-system'?'● 마이크 + 컴퓨터 소리 녹음 중 — 두 입력 막대를 확인하고 이 화면을 열어 두세요.':'● 마이크만 녹음 중 — 컴퓨터 소리는 포함되지 않습니다.');
    showLevels();this.levelTimer=setInterval(showLevels,150);
    this.timer=setTimeout(finish,60*60*1000);
   }catch(error){
    this.pcm?.stop();this.pcm=null;this.live?.detach();this.cleanup();record.disabled=false;sourceSelect.disabled=false;file.disabled=false;stop.disabled=true;
    if(!this.disposed){const detail=error instanceof Error?error.message:'';status.setText('녹음을 시작하지 못했습니다. '+detail+' 마이크·화면 및 시스템 오디오 권한을 확인하세요. 마이크만 녹음하려면 녹음 소리를 직접 바꿔 주세요.');}
   }finally{this.starting=false;refreshSaved();}
  };
  stop.onclick=()=>{if(this.recorder?.state==='recording'){stop.disabled=true;config.onProgress?.('녹음을 마무리하는 중…');this.recorder.stop();}};
  file.onchange=()=>{const selected=file.files?.[0];if(selected){this.audio=selected;this.audioPath='';config.onStart?.(new Date());void process(selected);}};
  savedSelect.onchange=()=>{this.audio=null;this.audioPath=savedSelect.value;refreshSaved();};
  retry.onclick=()=>{if(this.audioPath||this.audio){config.onStart?.(new Date());void process(this.audioPath?null:this.audio);}};
 }
 private cleanup(){this.capture?.stop();this.capture=null;this.abort?.abort();this.abort=null;if(this.levelTimer)clearInterval(this.levelTimer);this.levelTimer=null;if(this.timer)clearTimeout(this.timer);this.timer=null;}
 dispose(){this.disposed=true;this.task?.detach();this.live?.detach();this.pcm?.stop();this.pcm=null;if(this.recorder?.state==='recording')this.recorder.stop();this.cleanup();}
}
