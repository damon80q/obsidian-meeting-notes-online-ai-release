import http from 'node:http';
import {transcriptionJob} from './stt_proxy.mjs';
import {isIP} from 'node:net';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {analyze,transcribe,validateConfig,validateText,describeProcessing} from './core.mjs';
const MAX_AUDIO=24*1024*1024;
function authorized(req,token){const got=Buffer.from(req.headers.authorization||'');const expected=Buffer.from('Bearer '+token);return got.length===expected.length&&timingSafeEqual(got,expected);}
async function readBody(req,max){let size=0;const parts=[];for await(const p of req){size+=p.length;if(size>max){const e=new Error('업로드 크기 초과');e.status=413;throw e;}parts.push(p);}return Buffer.concat(parts);}
export function createServer(config,dependencies={}){
 if(!config.token||config.token.length<24)throw new Error('SERVER_TOKEN은 24자 이상의 임의 값이어야 합니다.');validateConfig(config);
 let busy=false;
 return http.createServer(async(req,res)=>{const send=(code,data)=>{if(res.destroyed)return;res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(req.method==='GET'&&req.url==='/health')return send(200,{...describeProcessing(config),audioJobs:config.sttProvider==='local',audioTurbo:config.sttProvider==='local',audioFast:config.sttProvider==='local'&&config.fastAudio===true});
  const jobRoute=['/transcriptions','/transcriptions/fast','/transcriptions/turbo'].includes(req.url)||/^\/transcriptions\/[a-f0-9]{32}(\/cancel)?$/.test(req.url);
  if(jobRoute){
   if(!authorized(req,config.token))return send(401,{error:'접속 토큰 오류'});
   if(config.sttProvider!=='local')return send(503,{error:'장시간 전사는 로컬 작업 서버가 필요합니다.'});
   if(req.url==='/transcriptions/fast'&&config.fastAudio!==true)return send(503,{error:'빠른 전사 모델이 설정되지 않았습니다.'});
   const submit=req.method==='POST'&&['/transcriptions','/transcriptions/fast','/transcriptions/turbo'].includes(req.url);
   const query=req.method==='GET'&&/^\/transcriptions\/[a-f0-9]{32}$/.test(req.url);
   const cancel=req.method==='POST'&&req.url.endsWith('/cancel');
   if(!submit&&!query&&!cancel)return send(404,{error:'경로 없음'});
   if(submit&&busy)return send(429,{error:'다른 회의를 처리 중입니다. 잠시 후 다시 시도해 주세요.'});
   if(submit)busy=true;
   try{
    let bytes;const mime=req.headers['content-type']||'';
    if(submit){
     if(!/^(audio\/(webm|mp4|mpeg|wav|x-wav|ogg|flac|aac)|video\/webm)(;|$)/.test(mime))return send(415,{error:'지원하지 않는 음성 형식'});
     bytes=await readBody(req,MAX_AUDIO);if(!bytes.length)return send(400,{error:'빈 녹음 파일'});
    }
    const result=await transcriptionJob(config,req.method,req.url.replace('/transcriptions','/jobs'),bytes,mime,dependencies.fetcher);
    return send(result.status,result.data);
   }catch(error){return send(error.status||502,{error:[404,413,429].includes(error.status)?error.message:'전사 작업 상태를 확인하지 못했습니다. 자동 재전송하지 않습니다.'});}
   finally{if(submit)busy=false;}
  }
  if(req.method!=='POST'||!['/summarize','/transcribe'].includes(req.url))return send(404,{error:'경로 없음'});
  if(!authorized(req,config.token))return send(401,{error:'접속 토큰 오류'});if(busy)return send(429,{error:'다른 회의를 처리 중입니다. 잠시 후 다시 시도해 주세요.'});busy=true;
  try{
   if(req.url==='/summarize'){
    if(config.sttProvider==='local'){
     const response=await (dependencies.fetcher||fetch)(config.sttUrl+'/health',{signal:AbortSignal.timeout(10000),redirect:'error'});
     if(!response.ok)throw new Error('전사 상태 조회 실패');
     if((await response.json()).busy)return send(429,{error:'다른 녹음을 전사 중입니다. 전사가 끝난 뒤 정리해 주세요.'});
    }
    if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'JSON 필요'});let data;
    try{data=JSON.parse((await readBody(req,160000)).toString());validateText(data.text);}catch(e){return send(e.status||400,{error:'텍스트 입력 형식 또는 크기를 확인해 주세요.'});}
    const result=await analyze(data.text,config,dependencies);return send(200,{mode:config.mode==='demo'?'demo':'ai',result});
   }
   if(!describeProcessing(config).audio)return send(503,{error:'음성 전사 서비스를 설정해 주세요.'});
   const contentType=req.headers['content-type']||'';if(!/^(audio\/(webm|mp4|mpeg|wav|x-wav|ogg|flac|aac)|video\/webm)(;|$)/.test(contentType))return send(415,{error:'지원하지 않는 음성 형식'});
   const bytes=await readBody(req,MAX_AUDIO);if(!bytes.length)return send(400,{error:'빈 녹음 파일'});
   return send(200,{text:await transcribe(bytes,contentType,config,dependencies.fetcher)});
  }catch(e){if(config.mode==='codex'&&e.category==='auth')return send(503,{error:'처리 서버 .env의 CODEX_HOME이 로그인 경로와 같은지 확인하세요. 해당 경로의 ChatGPT 로그인을 확인하고, 필요하면 전용 경로에서 재로그인하세요. 다른 앱의 로그인은 변경하지 마세요.'});send(e.status||502,{error:e.status===413?'음성은 24MB 이하로 업로드해 주세요.':e.status===415?e.message:'처리 실패. 로그인·모델·전사 서비스·사용 한도를 확인해 주세요. 자동 재전송하지 않습니다.'});}finally{busy=false;}
 });
}
// LAN_HOST가 있을 때도 기존 loopback을 유지해 Tailscale HTTPS가 계속 동작합니다.
export function serverHosts(env=process.env){
 const host=env.HOST||'127.0.0.1',lan=(env.LAN_HOST||'').trim();
 if(!lan)return [host];
 const [first,second]=lan.split('.').map(Number);
 const privateIp=isIP(lan)===4&&(first===10||(first===172&&second>=16&&second<=31)||(first===192&&second===168));
 if(!privateIp)throw new Error('LAN_HOST에는 사무실 내부 IPv4 주소만 넣으세요. 예: 192.168.1.20');
 if(!['127.0.0.1','localhost','::1'].includes(host))throw new Error('LAN_HOST를 사용할 때 HOST는 기존 loopback 주소로 유지하세요.');
 return [host,lan];
}
export function createListeners(config,env=process.env,dependencies={}){
 const hosts=serverHosts(env),first=createServer(config,dependencies);
 // 같은 요청 핸들러를 공유하므로 LAN과 HTTPS에서 동시에 처리해도 busy·인증 검사가 유지됩니다.
 const handler=first.listeners('request')[0];
 return hosts.map((host,index)=>({host,server:index===0?first:http.createServer(handler)}));
}
export function configFromEnv(env=process.env){return {token:env.SERVER_TOKEN,mode:env.MODE||'codex',codexBin:env.CODEX_BIN,codexModel:env.CODEX_MODEL||'gpt-5.6-sol',openaiKey:env.OPENAI_API_KEY,openaiModel:env.OPENAI_MODEL,anthropicKey:env.ANTHROPIC_API_KEY,anthropicModel:env.ANTHROPIC_MODEL,allowPaidApi:env.ALLOW_PAID_API==='true',sttProvider:env.STT_PROVIDER||'none',sttUrl:env.STT_URL,fastAudio:!!env.WHISPER_FAST_MODEL,transcriptionModel:env.TRANSCRIPTION_MODEL,timeoutMs:180000};}
// .env는 Node의 --env-file 옵션으로 읽습니다. 수정 후에는 기존 프로세스를 재시작해야 합니다.
// 다른 SSH 창에서 같은 명령을 다시 실행하면 서버를 두 번 띄우게 됩니다.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const port=Number(process.env.PORT||8789);
 try{
  const listeners=createListeners(configFromEnv());
  let failed=false;
  for(const {host,server} of listeners){
   server.requestTimeout=660000;
   // 포트 중복은 기존 서버가 실행 중일 때도 발생합니다. 기존 프로세스는 종료하지 않습니다.
   server.on('error',error=>{
    if(failed)return;failed=true;
    if(error.code==='EADDRINUSE'){
     console.error('정리 서버 시작 실패 (EADDRINUSE): '+host+':'+port+' 포트가 이미 사용 중입니다.');
     console.error('기존 회의록 서버가 정상 실행 중이면 그대로 사용하세요. 재시작은 원래 실행 터미널에서 Ctrl+C 후 한 번만 실행하세요.');
     console.error('확인: ss -ltnp '+JSON.stringify('sport = :'+port));
    }else console.error('정리 서버 시작 실패. HOST·LAN_HOST·PORT·실행 권한을 확인해 주세요.');
    // 일부 주소에서만 시작된 상태를 준비 완료로 남기지 않습니다.
    for(const item of listeners)item.server.close();
    process.exitCode=1;
   });
   server.listen(port,host,()=>{if(!failed)console.log('온라인 AI 회의 정리 서버 준비됨 ('+host+':'+port+' · 회의 원문·인증정보 로그 없음)');});
  }
 }catch(error){
  console.error('정리 서버 설정 오류: '+error.message);
  process.exitCode=1;
 }
}
