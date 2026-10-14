import {App,Notice,requestUrl} from 'obsidian';
export class RecordingControls {
 private recorder:MediaRecorder|null=null;private stream:MediaStream|null=null;private chunks:Blob[]=[];private audio:Blob|null=null;private disposed=false;private processing=false;private timer:ReturnType<typeof setTimeout>|null=null;private bytes=0;
 constructor(private app:App,el:HTMLElement,private config:{endpoint:string;token:string;allowed:()=>boolean;onStart?:(startedAt:Date)=>void;onText:(text:string,path:string)=>void|Promise<void>;onProgress?:(message:string)=>void;onIdle?:()=>void;progressEl?:HTMLElement}){
 el.createEl('h3',{text:'녹음'});el.createEl('p',{text:'마이크 녹음 → 녹음 종료 → 설정한 처리 대상에서 전사·분석. 최대 60분 / 24MB. 다른 앱의 소리는 자동 녹음하지 않습니다.'});
 const record=el.createEl('button',{text:'녹음 시작',cls:'mod-cta'});const stop=el.createEl('button',{text:'녹음 종료·정리',cls:'mod-cta'});stop.disabled=true;
 if(config.progressEl)el.append(config.progressEl);
 const status=el.createEl('p',{attr:{role:'status'}});
 // 파일 업로드·재처리는 기본 녹음 버튼과 분리한 선택 기능입니다.
 const options=el.createEl('details');options.createEl('summary',{text:'녹음 파일 선택·재처리 (선택)'});
 const retry=options.createEl('button',{text:'보관한 녹음으로 다시 정리'});retry.disabled=true;
 const file=options.createEl('input',{type:'file',attr:{accept:'audio/*,video/webm','aria-label':'녹음 파일 선택'}});
 options.createEl('p',{text:'직접 녹음이 지원되지 않으면 음성 메모 등에서 녹음한 파일을 선택하세요. 업로드 전에 녹음을 보관함의 회의녹음 폴더에 저장합니다.'});
 const process=async(blob:Blob)=>{if(this.processing)return;if(!config.allowed()){config.onIdle?.();new Notice('정리 서버의 전사 지원과 전송 동의를 확인해 주세요.');return;}if(blob.size===0||blob.size>24*1024*1024){config.onIdle?.();new Notice('음성 파일은 0~24MB 범위여야 합니다.');return;}
 this.processing=true;config.onProgress?.('녹음을 보관하는 중…');record.disabled=true;file.disabled=true;retry.disabled=true;let saved=false;
 try{const data=await blob.arrayBuffer();const mime=blob.type.split(';')[0];const ext=mime.includes('mp4')?'m4a':mime.includes('mpeg')?'mp3':mime.includes('wav')?'wav':mime.includes('ogg')?'ogg':'webm';const folder='회의녹음';if(!app.vault.getAbstractFileByPath(folder))await app.vault.createFolder(folder);const path=`${folder}/회의-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;await app.vault.createBinary(path,data);saved=true;config.onProgress?.('음성을 전사하는 중…');status.setText(`녹음 보관 완료. 전사 중… (${path})`);
 const r=await requestUrl({url:config.endpoint+'/transcribe',method:'POST',headers:{'Content-Type':blob.type||'audio/webm',Authorization:`Bearer ${config.token}`},body:data,throw:false});if(r.status!==200||typeof r.json.text!=='string'||!r.json.text.trim())throw new Error(`전사 실패 (${r.status}). 보관한 녹음을 다시 정리할 수 있습니다.`);await app.vault.create(path.replace(/\.[^.]+$/,'.md'),`# 전사 원문\n\n${r.json.text}\n\n## 원음\n[[${path}]]\n`);if(this.disposed)return;status.setText('전사 완료. 회의 분석을 시작합니다.');await config.onText(r.json.text,path);
 }catch(e){if(!this.disposed)status.setText(e instanceof Error?e.message:'전사에 실패했습니다.');}finally{this.processing=false;record.disabled=false;file.disabled=false;retry.disabled=!saved;config.onIdle?.();}};
 record.onclick=async()=>{if(this.processing||this.recorder?.state==='recording')return;if(!config.allowed()){new Notice('서버 전사 지원·전송 동의를 먼저 확인하세요.');return;}if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){new Notice('이 기기는 직접 녹음을 지원하지 않습니다. 녹음 파일을 선택하세요.');return;}try{this.stream=await navigator.mediaDevices.getUserMedia({audio:true});if(this.disposed){this.cleanup();return;}const type=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(x=>MediaRecorder.isTypeSupported(x));this.recorder=new MediaRecorder(this.stream,type?{mimeType:type,audioBitsPerSecond:48000}:{audioBitsPerSecond:48000});this.chunks=[];this.bytes=0;this.recorder.ondataavailable=e=>{if(e.data.size){this.chunks.push(e.data);this.bytes+=e.data.size;if(this.bytes>=23*1024*1024&&this.recorder?.state==='recording')this.recorder.stop();}};
 this.recorder.onerror=()=>{config.onIdle?.();status.setText('녹음 오류. 녹음 파일 선택을 이용해 주세요.');this.cleanup();record.disabled=false;file.disabled=false;stop.disabled=true;};
 this.recorder.onstop=()=>{this.audio=new Blob(this.chunks,{type:this.recorder?.mimeType||'audio/webm'});this.cleanup();record.disabled=false;file.disabled=false;stop.disabled=true;if(!this.disposed)void process(this.audio);else if(this.audio.size>0&&this.audio.size<=24*1024*1024)void (async()=>{try{const folder='회의녹음';if(!app.vault.getAbstractFileByPath(folder))await app.vault.createFolder(folder);const ext=this.audio!.type.includes('mp4')?'m4a':'webm';await app.vault.createBinary(`${folder}/중단된-회의-${Date.now()}.${ext}`,await this.audio!.arrayBuffer());new Notice('중단된 녹음을 보관했습니다. 나중에 파일로 정리할 수 있습니다.');}catch{new Notice('중단된 녹음 저장에 실패했습니다.');}})();};this.recorder.start(1000);config.onStart?.(new Date());record.disabled=true;file.disabled=true;stop.disabled=false;status.setText('● 녹음 중 — 이 화면과 앱을 열어 두세요.');this.timer=setTimeout(()=>{if(this.recorder?.state==='recording')this.recorder.stop();},60*60*1000);
 }catch{this.cleanup();status.setText('마이크 접근에 실패했습니다. 앱 권한을 확인하거나 녹음 파일을 선택하세요.');}};
 stop.onclick=()=>{if(this.recorder?.state==='recording'){stop.disabled=true;config.onProgress?.('녹음을 마무리하는 중…');this.recorder.stop();}};
 file.onchange=()=>{const selected=file.files?.[0];if(selected){this.audio=selected;config.onStart?.(new Date());void process(selected);}};
 retry.onclick=()=>{if(this.audio)void process(this.audio);};
 }
 private cleanup(){this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;if(this.timer)clearTimeout(this.timer);this.timer=null;}
 dispose(){this.disposed=true;if(this.recorder?.state==='recording')this.recorder.stop();this.cleanup();}
}
