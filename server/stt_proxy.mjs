import {localUrl} from './core.mjs';
const states=new Set(['running','cancelling','completed','cancelled','failed','interrupted']);
export async function transcriptionJob(config,method,path,bytes,mime,fetcher=fetch){
 const response=await fetcher(localUrl(config.sttUrl)+path,{method,headers:bytes?{'Content-Type':mime}:undefined,body:bytes,redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok){const error=new Error(response.status===429?'다른 녹음을 전사 중입니다. 기존 작업을 기다리거나 해당 작업의 전사 취소를 눌러 주세요.':response.status===404?'전사 작업을 찾을 수 없습니다. 자동 재전송하지 않습니다.':'전사 작업 서버에 연결할 수 없습니다. 자동 재전송하지 않습니다.');error.status=[404,413,429].includes(response.status)?response.status:502;throw error;}
 const data=await response.json();
 if(!/^[a-f0-9]{32}$/.test(data.id)||!states.has(data.state)||!Number.isFinite(data.elapsedSeconds)||data.elapsedSeconds<0)throw new Error('전사 작업 응답 형식 오류');
 const result={id:data.id,state:data.state,elapsedSeconds:data.elapsedSeconds};
 if(['fast','accurate','turbo'].includes(data.profile))result.profile=data.profile;
 if(typeof data.partialText==='string'&&data.partialText.length<=30000)result.partialText=data.partialText;
 if(['loading','preparing','transcribing','completed'].includes(data.phase))result.phase=data.phase;
 if(typeof data.percent==='number'&&Number.isFinite(data.percent)&&data.percent>=0&&data.percent<=100)result.percent=data.percent;
 for(const key of ['processedSeconds','totalSeconds'])if(typeof data[key]==='number'&&Number.isFinite(data[key])&&data[key]>=0)result[key]=data[key];
 if(data.state==='completed'){
  if(typeof data.text!=='string'||(!data.text.trim()&&!['fast','turbo'].includes(data.profile))||data.text.length>30000)throw new Error('전사 결과 형식 오류');
  result.text=data.text;
 }
 if(['failed','interrupted'].includes(data.state))result.error='전사 결과를 확인할 수 없습니다. 원음은 보관되어 있으며 자동 재전송하지 않습니다.';
 return {status:response.status,data:result};
}
