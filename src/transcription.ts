import {requestUrl} from 'obsidian';

type Reply={id:string;state:string;elapsedSeconds:number;text?:string;phase?:string;percent?:number;processedSeconds?:number;totalSeconds?:number;partialText?:string;profile?:string};
function failure(status:number){
 const error=new Error(status===429?'다른 녹음을 전사 중입니다 (429). 기존 작업을 기다리거나 그 작업의 전사 취소를 눌러 주세요. 반복 전송하지 마세요.':status===401?'서버 접속 토큰을 확인해 주세요 (401).':`전사 실패 (${status}). 원음은 보관되어 있으며 자동 재전송하지 않습니다.`);
 return Object.assign(error,{status});
}
function jobReply(response:{status:number;json:unknown}):Reply{
 if(![200,202].includes(response.status))throw failure(response.status);
 const data=response.json as Reply;
 if(!data||!/^[a-f0-9]{32}$/.test(data.id)||!['running','cancelling','completed','cancelled','failed','interrupted'].includes(data.state)||!Number.isFinite(data.elapsedSeconds))throw new Error('전사 작업 응답 형식 오류. 자동 재전송하지 않습니다.');
 return data;
}

// 긴 전사는 한 번 접수하고 짧은 상태 요청만 보냅니다. 조회 오류를 재업로드로 바꾸지 않습니다.
export class TranscriptionTask {
 private id='';
 private detached=false;
 private cancelPromise:Promise<void>|null=null;
 private reply:Reply|null=null;
 private wake:(()=>void)|null=null;
 cancelRequested=false;
 constructor(private config:{endpoint:string;token:string;jobs:boolean;fast?:boolean;turbo?:boolean;resumeId?:string;onAccepted?:(id:string)=>Promise<void>;onPartial?:(text:string)=>Promise<void>},private update:(message:string)=>void,private pollMs=3000){}
 private headers(){return {Authorization:'Bearer '+this.config.token};}
 async cancel(){
  this.cancelRequested=true;
  if(!this.id)return;
  if(!this.cancelPromise)this.cancelPromise=(async()=>{
   try{
    this.reply=jobReply(await requestUrl({url:this.config.endpoint+'/transcriptions/'+this.id+'/cancel',method:'POST',headers:this.headers(),throw:false}));
   }catch(error){this.cancelPromise=null;throw error;}
   finally{this.wake?.();}
  })();
  await this.cancelPromise;
 }
 detach(){this.detached=true;this.wake?.();}
 async run(data:ArrayBuffer,mime:string):Promise<string|null>{
  if(!this.config.jobs){
   const response=await requestUrl({url:this.config.endpoint+'/transcribe',method:'POST',headers:{...this.headers(),'Content-Type':mime},body:data,throw:false});
   if(response.status!==200)throw failure(response.status);
   if(typeof response.json.text!=='string'||!response.json.text.trim())throw new Error('전사 결과 형식 오류');
   return this.detached?null:response.json.text;
  }
  let job=this.config.resumeId?jobReply(await requestUrl({url:this.config.endpoint+'/transcriptions/'+this.config.resumeId,headers:this.headers(),throw:false})):jobReply(await requestUrl({url:this.config.endpoint+'/transcriptions'+(this.config.turbo?'/turbo':this.config.fast?'/fast':''),method:'POST',headers:{...this.headers(),'Content-Type':mime},body:data,throw:false}));
  this.id=job.id;
  await this.config.onAccepted?.(job.id);
  let partial='';
  const keepPartial=async(value:Reply)=>{if(typeof value.partialText==='string'&&value.partialText.length<=30000&&value.partialText!==partial){partial=value.partialText;await this.config.onPartial?.(partial);}};
  while(true){
   await keepPartial(job);
   if(this.cancelRequested)await this.cancel();
   if(this.reply){job=this.reply;this.reply=null;await keepPartial(job);}
   if(job.state==='cancelled')return null;
   if(['failed','interrupted'].includes(job.state))throw Object.assign(new Error('전사 결과를 확인할 수 없습니다. 원음은 보관되어 있으며 자동 재전송하지 않습니다.'),{terminal:job.state});
   if(job.state==='completed'){
    if(typeof job.text!=='string'||(!job.text.trim()&&!this.config.fast&&!this.config.turbo)||job.text.length>30000)throw new Error('전사 결과 형식 오류');
    if(!this.detached)this.update('전사 완료. 회의록 정리를 준비하는 중…');
    return this.detached?null:job.text;
   }
   if(this.detached)return null;
   const stage=job.phase==='loading'?'전사 모델을 준비하는 중…':job.phase==='preparing'?'음성 구간을 준비하는 중…':'음성을 전사하는 중…';
   this.update(this.cancelRequested?'서버 전사를 취소하는 중…':stage);
   await new Promise<void>(resolve=>{const timer=setTimeout(()=>{this.wake=null;resolve();},this.pollMs);this.wake=()=>{clearTimeout(timer);this.wake=null;resolve();};});
   if(this.detached)return null;
   if(this.reply)continue;
   job=jobReply(await requestUrl({url:this.config.endpoint+'/transcriptions/'+this.id,headers:this.headers(),throw:false}));
  }
 }
}
