import {test} from 'node:test';
import net from 'node:net';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {createServer,serverHosts,createListeners} from '../server/index.mjs';
import {analyze,validateResult,localUrl,transcribe,describeProcessing,validateConfig} from '../server/core.mjs';
const text='민수가 금요일까지 시안을 작성한다. 출시 일정은 보류한다.';
const valid={summary:['출시 일정 보류'],decisions:[{text:'출시 일정 보류',evidence:'출시 일정은 보류한다.'}],actions:[{task:'시안 작성',owner:'민수',due:'금요일',evidence:'민수가 금요일까지 시안을 작성한다.'}]};
const openai={mode:'openai',openaiKey:'fake-test-key',openaiModel:'test-model',allowPaidApi:true};
const claude={mode:'anthropic',anthropicKey:'fake-test-key',anthropicModel:'test-model',allowPaidApi:true};
const token='test-token-01234567890123456789';
const response=data=>new Response(JSON.stringify(data));
const modelResponse=result=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
async function invoke(server,path,options={}){
 const req=Object.assign((async function*(){if(options.body)yield Buffer.from(options.body);})(),{method:options.method||'GET',url:path,headers:Object.fromEntries(Object.entries(options.headers||{}).map(([k,v])=>[k.toLowerCase(),v]))});
 let status=0,body='';const res={writeHead(code){status=code;},end(data){body=data;}};
 await server.listeners('request')[0](req,res);return {status,json:JSON.parse(body)};
}
const post={method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({text})};
test('명시된 담당자와 상대 기한은 원문 그대로 보존',()=>assert.deepEqual(validateResult(valid,text),valid));
test('근거 없는 담당자 거부',()=>assert.throws(()=>validateResult({...valid,actions:[{...valid.actions[0],owner:'지수'}]},text)));
test('원문에 없는 인용 거부',()=>assert.throws(()=>validateResult({...valid,decisions:[{text:'승인',evidence:'출시 승인'}]},text)));
test('미정 담당·기한 null 허용',()=>assert.ok(validateResult({...valid,actions:[{...valid.actions[0],owner:null,due:null}]},text)));
test('로컬 전사는 외부 주소·인증·query·hash 거부',()=>{for(const url of ['https://example.com','http://user:password@localhost','http://localhost?key=x','http://localhost/#x'])assert.throws(()=>localUrl(url));});
test('명시적 유료 설정 없이는 API 호출 불가',async()=>{let called=false;await assert.rejects(()=>analyze(text,{...openai,allowPaidApi:false},{fetcher:()=>{called=true;}}));assert.equal(called,false);assert.throws(()=>validateConfig({...claude,allowPaidApi:false}));});
test('OpenAI Responses: 도구 없음·저장 OFF·schema·인용 검증',async()=>{
 let request;const result=await analyze(text,openai,{fetcher:async(url,options)=>{request={url,options,body:JSON.parse(options.body)};return response(modelResponse(valid));}});
 assert.deepEqual(result,valid);assert.equal(request.url,'https://api.openai.com/v1/responses');assert.equal(request.body.store,false);assert.deepEqual(request.body.tools,[]);assert.equal(request.body.text.format.strict,true);assert.equal(request.options.redirect,'error');
});
test('OpenAI 거절·미완료·없는 근거는 실패',async()=>{
 for(const data of [{status:'incomplete',output:[]},{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]},modelResponse({...valid,actions:[{...valid.actions[0],due:'내일'}]})])await assert.rejects(()=>analyze(text,openai,{fetcher:async()=>response(data)}));
});
test('Claude 지정 추출 도구의 JSON만 수용하며 외부 도구는 실행하지 않음',async()=>{
 let request;const result=await analyze(text,claude,{fetcher:async(url,options)=>{request={url,options,body:JSON.parse(options.body)};return response({stop_reason:'tool_use',content:[{type:'tool_use',name:'meeting_notes',input:valid}]});}});
 assert.deepEqual(result,valid);assert.equal(request.url,'https://api.anthropic.com/v1/messages');assert.equal(request.body.tool_choice.name,'meeting_notes');assert.equal(request.body.tool_choice.disable_parallel_tool_use,true);assert.equal(request.body.tools.length,1);
 await assert.rejects(()=>analyze(text,claude,{fetcher:async()=>response({stop_reason:'tool_use',content:[{type:'tool_use',name:'shell',input:valid}]})}));
});
test('상용 API 401·429는 원문 오류 내용 노출 없이 실패',async()=>{
 for(const status of [401,429])await assert.rejects(()=>analyze(text,openai,{fetcher:async()=>new Response('fake-secret-and-private-body',{status})}),e=>!e.message.includes('fake-secret'));
});
test('OAuth 실패 시 API fallback 및 자동 재전송 없음',async()=>{
 let runs=0,calls=0;await assert.rejects(()=>analyze(text,{mode:'codex',codexModel:'test-model'},{codexRunner:async()=>{runs++;throw new Error('offline');},fetcher:async()=>{calls++;}}));assert.equal(runs,1);assert.equal(calls,0);
});
test('같은 처리 서버 Whisper로 음성 전달·전사 텍스트 검사',async()=>{
 let endpoint;assert.equal(await transcribe(Buffer.from('fixture'),'audio/webm',{mode:'codex',codexModel:'test-model',sttProvider:'local',sttUrl:'http://127.0.0.1:8790'},async url=>{endpoint=url;return response({text});}),text);assert.equal(endpoint,'http://127.0.0.1:8790/transcribe');
});
test('OpenAI 전사: multipart 파일·모델 전달, 미지원 OGG는 호출 전 차단',async()=>{
 const config={...openai,sttProvider:'openai',transcriptionModel:'test-transcribe'};
 let called=0;assert.equal(await transcribe(Buffer.from('fixture'),'audio/mp4',config,async(url,options)=>{called++;assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');assert.equal(options.body.get('model'),'test-transcribe');assert.equal(options.body.get('file').name,'meeting.m4a');assert.equal(options.redirect,'error');return response({text});}),text);
 await assert.rejects(()=>transcribe(Buffer.from('fixture'),'audio/ogg',config,async()=>{called++;}),e=>e.status===415);assert.equal(called,1);
});
test('health는 음성/텍스트의 처리 대상을 구분하고 키를 노출하지 않음',()=>{
 const h=describeProcessing({...openai,sttProvider:'openai',transcriptionModel:'test-transcribe',token});assert.ok(h.cloudText);assert.ok(h.cloudAudio);assert.ok(h.audioProvider.includes('별도 과금'));assert.ok(!JSON.stringify(h).includes(openai.openaiKey));assert.ok(!JSON.stringify(h).includes(token));
});
test('서버 인증·입력·데모·전사 미설정·토큰 길이',async()=>{
 const server=createServer({mode:'demo',token});
 assert.equal((await invoke(server,'/health')).status,200);assert.equal((await invoke(server,'/summarize',{method:'POST'})).status,401);
 assert.equal((await invoke(server,'/summarize',{...post,body:'invalid'})).status,400);assert.equal((await invoke(server,'/summarize',{...post,body:JSON.stringify({text:'x'.repeat(30001)})})).status,400);
 assert.equal((await invoke(server,'/summarize',post)).json.mode,'demo');assert.equal((await invoke(server,'/transcribe',post)).status,503);assert.throws(()=>createServer({mode:'demo',token:'short'}));
});
test('업스트림 인증 실패는 클라이언트에 키/원문을 노출하지 않음',async()=>{
 const server=createServer({...openai,token},{fetcher:async()=>new Response('fake-secret-and-private-body',{status:401})});const result=await invoke(server,'/summarize',post);assert.equal(result.status,502);assert.ok(!JSON.stringify(result).includes('fake-secret'));assert.ok(!JSON.stringify(result).includes(text));
});
test('중복 동시 요청은 429이며 첫 완료 뒤 다시 처리 가능',async()=>{
 let release,entered;const begun=new Promise(r=>entered=r);
 const server=createServer({...openai,token},{fetcher:()=>new Promise(resolve=>{release=()=>resolve(response(modelResponse(valid)));entered();})});
 const first=invoke(server,'/summarize',post);await begun;assert.equal((await invoke(server,'/summarize',post)).status,429);release();assert.equal((await first).status,200);
});

test('Codex 인증 갱신 실패는 503 재로그인 안내이며 fallback 없음',async()=>{const server=createServer({mode:'codex',codexModel:'test-model',token},{codexRunner:async()=>{const e=new Error('fake-sensitive-fixture');e.category='auth';throw e;}});const r=await invoke(server,'/summarize',post);assert.equal(r.status,503);assert.ok(r.json.error.includes('재로그인'));assert.ok(!r.json.error.includes('fake-sensitive'));});

test('포트 사용 중: 중복 실행은 한국어 안내로 종료하고 기존 서버를 유지', {timeout:10000}, async t=>{
 const listener=net.createServer();
 await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>listener.close(resolve)));
 const port=listener.address().port;
 const child=spawn(process.execPath,['server/index.mjs'],{
  cwd:new URL('..',import.meta.url),
  env:{...process.env,MODE:'demo',STT_PROVIDER:'none',SERVER_TOKEN:token,HOST:'127.0.0.1',LAN_HOST:'',PORT:String(port)},
  stdio:['ignore','pipe','pipe']
 });
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();});
 let stderr='';child.stderr.on('data',data=>{stderr+=data.toString();});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(code,1);assert.ok(stderr.includes('EADDRINUSE'));assert.ok(stderr.includes(String(port)));
 assert.ok(stderr.includes('Ctrl+C'));assert.ok(!stderr.includes(token));assert.ok(!stderr.includes("Unhandled 'error'"));
 assert.equal(listener.listening,true);
});

test('LAN 접속은 loopback을 유지하고 사설 IPv4만 추가',()=>{
 assert.deepEqual(serverHosts({}),['127.0.0.1']);
 assert.deepEqual(serverHosts({HOST:'127.0.0.1',LAN_HOST:'192.168.1.20'}),['127.0.0.1','192.168.1.20']);
 for(const lan of ['0.0.0.0','8.8.8.8','127.0.0.1','192.168.1.999','192.168.1.20.example.invalid'])assert.throws(()=>serverHosts({LAN_HOST:lan}));
 assert.throws(()=>serverHosts({HOST:'0.0.0.0',LAN_HOST:'192.168.1.20'}));
});
test('LAN·HTTPS 공용 핸들러는 접속 토큰과 동시성 1을 함께 검사',async()=>{
 let release,entered;const begun=new Promise(r=>entered=r);
 const listeners=createListeners({...openai,token},{HOST:'127.0.0.1',LAN_HOST:'192.168.1.20'},{fetcher:()=>new Promise(resolve=>{release=()=>resolve(response(modelResponse(valid)));entered();})});
 assert.equal(listeners[0].server.listeners('request')[0],listeners[1].server.listeners('request')[0]);
 assert.equal((await invoke(listeners[1].server,'/summarize',{method:'POST'})).status,401);
 const first=invoke(listeners[0].server,'/summarize',post);await begun;
 assert.equal((await invoke(listeners[1].server,'/summarize',post)).status,429);
 release();assert.equal((await first).status,200);
});

test('전사 작업 접수·조회·취소는 전부 인증하고 upstream 원문/경로를 필터',async()=>{
 const job='a'.repeat(32);const calls=[];
 const server=createServer({mode:'codex',codexModel:'test',token,sttProvider:'local',sttUrl:'http://127.0.0.1:8790'},{fetcher:async(url,options)=>{calls.push({url,options});return response({id:job,state:url.endsWith('/cancel')?'cancelled':'running',elapsedSeconds:9,percent:25,processedSeconds:25,totalSeconds:100,phase:'transcribing',private:'private-context'});}});
 for(const [url,method] of [['/transcriptions','POST'],['/transcriptions/'+job,'GET'],['/transcriptions/'+job+'/cancel','POST']]){
  assert.equal((await invoke(server,url,{method})).status,401);
  const result=await invoke(server,url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'audio/webm'},body:method==='POST'?'fixture':undefined});
  assert.ok([200,202].includes(result.status));assert.equal(result.json.percent,25);assert.ok(!JSON.stringify(result).includes('private-context'));
 }
 assert.equal(calls.length,3);assert.equal(calls[0].url,'http://127.0.0.1:8790/jobs');
 assert.equal(calls[2].url,'http://127.0.0.1:8790/jobs/'+job+'/cancel');
});

test('작업 429는 사용량 한도와 구분하며 자동 재접수하지 않음',async()=>{
 let calls=0;
 const server=createServer({mode:'codex',codexModel:'test',token,sttProvider:'local',sttUrl:'http://127.0.0.1:8790'},{fetcher:async()=>{calls++;return new Response('private error',{status:429});}});
 const result=await invoke(server,'/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'audio/webm'},body:'fixture'});
 assert.equal(result.status,429);assert.ok(result.json.error.includes('전사 취소'));assert.ok(!result.json.error.includes('private error'));assert.equal(calls,1);
});

test('빠른 전사 경로도 인증·OFF 차단을 지키고 지원 여부를 알림',async()=>{
 let called=0;const config={mode:'codex',codexModel:'test',token,sttProvider:'local',sttUrl:'http://127.0.0.1:8790'};
 const off=createServer(config,{fetcher:async()=>{called++;throw new Error('not allowed');}});
 assert.equal((await invoke(off,'/health')).json.audioFast,false);
 assert.equal((await invoke(off,'/transcriptions/fast',{method:'POST'})).status,401);
 assert.equal((await invoke(off,'/transcriptions/fast',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'audio/wav'},body:'fixture'})).status,503);assert.equal(called,0);
});
test('빠른 전사는 같은 인증 프록시의 jobs/fast로만 보내고 무음·부분 결과를 보존',async()=>{
 let target;const server=createServer({mode:'codex',codexModel:'test',token,sttProvider:'local',sttUrl:'http://127.0.0.1:8790',fastAudio:true},{fetcher:async url=>{target=url;return response({id:'f'.repeat(32),state:'completed',elapsedSeconds:1,profile:'fast',text:'',partialText:'앞서 확인한 부분',private:'private-fixture'});}});
 assert.equal((await invoke(server,'/health')).json.audioFast,true);
 const r=await invoke(server,'/transcriptions/fast',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'audio/wav'},body:'fixture'});
 assert.equal(r.status,200);assert.equal(target,'http://127.0.0.1:8790/jobs/fast');assert.equal(r.json.text,'');assert.equal(r.json.partialText,'앞서 확인한 부분');assert.ok(!JSON.stringify(r).includes('private-fixture'));
});

test('터보 구간 전사는 인증·로컬 경계·프로필·무음 완료를 지키며 jobs/turbo만 사용',async()=>{
 let calls=0;const config={mode:'codex',codexModel:'test',token,sttProvider:'local',sttUrl:'http://127.0.0.1:8790'};
 const server=createServer(config,{fetcher:async url=>{calls++;assert.equal(url,'http://127.0.0.1:8790/jobs/turbo');return response({id:'e'.repeat(32),state:'completed',elapsedSeconds:1,profile:'turbo',text:''});}});
 assert.equal((await invoke(server,'/health')).json.audioTurbo,true);
 assert.equal((await invoke(server,'/transcriptions/turbo',{method:'POST'})).status,401);assert.equal(calls,0);
 const result=await invoke(server,'/transcriptions/turbo',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'audio/wav'},body:'fixture'});assert.equal(result.status,200);assert.equal(result.json.profile,'turbo');assert.equal(result.json.text,'');assert.equal(calls,1);
 const off=createServer({mode:'demo',token,sttProvider:'none'});assert.equal((await invoke(off,'/health')).json.audioTurbo,false);assert.equal((await invoke(off,'/transcriptions/turbo',{method:'POST',headers:{Authorization:'Bearer '+token}})).status,503);
});
