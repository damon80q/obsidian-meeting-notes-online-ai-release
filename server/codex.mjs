import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// CLI가 자기 인증 저장소를 사용합니다. auth.json을 읽거나 복사하지 않습니다.
// .env의 CODEX_HOME을 자식 CLI에도 전달해야 전용 로그인과 분석의 경로가 일치합니다.
// 이 허용 목록에는 SERVER_TOKEN·공급자 API 키를 넣지 않습니다.
export function codexEnvironment(source=process.env){
 const allowed=['PATH','HOME','USERPROFILE','SystemRoot','SYSTEMROOT','COMSPEC','PATHEXT','TMP','TEMP','TMPDIR','CODEX_HOME','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','LANG','LC_ALL'];
 return Object.fromEntries(allowed.filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
}
export function runProcess(command,args,{cwd,env,timeoutMs=180000}={},input=''){
 return new Promise((resolve,reject)=>{
  let output='',errorOutput='',failure=null,finished=false,killTimer;
  const child=spawn(command,args,{cwd,env,stdio:['pipe','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
  const stop=error=>{
   if(finished||failure)return;failure=error;
   const kill=signal=>{try{if(process.platform!=='win32')process.kill(-child.pid,signal);else child.kill(signal);}catch{}};
   kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),1500);killTimer.unref();
  };
  const timer=setTimeout(()=>stop(new Error('Codex 처리 시간 초과')),timeoutMs);
  child.stdout.on('data',data=>{output+=data.toString();if(Buffer.byteLength(output)>2*1024*1024)stop(new Error('Codex 출력 한도 초과'));});
  child.stderr.on('data',data=>{errorOutput+=data.toString();if(Buffer.byteLength(errorOutput)>2*1024*1024)stop(new Error('Codex 진단 출력 한도 초과'));});
  child.stdin.on('error',()=>{});
  child.on('error',()=>{finished=true;clearTimeout(timer);clearTimeout(killTimer);reject(new Error('Codex CLI를 실행할 수 없습니다.'));});
  child.on('close',code=>{finished=true;clearTimeout(timer);clearTimeout(killTimer);if(failure)return reject(failure);if(code!==0){const errors=output.split('\n').flatMap(line=>{try{const e=JSON.parse(line);return e.type==='error'?[e.message||'']:e.type==='turn.failed'?[e.error?.message||'']:[];}catch{return [];}});const diagnostic=errors.join('\n')||errorOutput;let category='cli';for(const [name,pattern] of [['schema',/schema.{0,200}(invalid|required|error)|invalid.{0,50}schema/i],['model',/model.{0,80}(does not exist|not supported|not found)|unsupported model|invalid model|model_not_found/i],['quota',/usage limit|quota|too many requests|429/i],['auth',/authenticat|401|access.token/i],['config',/unrecognized|unexpected argument|unknown.*(field|feature)|invalid.*config/i],['network',/network|dns|proxy|connection|tls|stream.*disconnect/i],['sandbox',/sandbox|bwrap|operation not permitted/i]])if(pattern.test(diagnostic)){category=name;break;}const e=new Error('Codex 실행 실패 ('+category+'). 로그인·사용 한도·모델을 확인해 주세요.');e.category=category;e.exitCode=code;e.errorSummary=diagnostic.replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/[A-Za-z0-9_\/-]{24,}/g,'[redacted]').slice(0,600);return reject(e);}resolve({stdout:output,stderr:errorOutput});});
  child.stdin.end(input);
 });
}
export function parseCodexEvents(output){
 const events=output.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 if(events.some(e=>['turn.failed','error'].includes(e.type))||!events.some(e=>e.type==='turn.completed'))throw new Error('Codex 완료 응답이 없습니다.');
 if(events.some(e=>e.item?.type==='error'))throw new Error('Codex가 오류·경고 이벤트를 반환했습니다.');
 // 회의 정리 과정에서 도구를 실행한 응답은 사용하지 않습니다.
 for(const event of events){if(event.type?.startsWith('item.')&&event.item?.type&&!['agent_message','reasoning'].includes(event.item.type))throw new Error('Codex 회의 분석에서 예상하지 않은 도구 실행이 발생했습니다.');}
 const messages=events.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message');
 if(!messages.length)throw new Error('Codex 정리 결과가 없습니다.');
 return JSON.parse(messages.at(-1).item.text);
}
export async function runCodex(prompt,schema,config,runner=runProcess){
 const env=codexEnvironment();const command=config.codexBin||'codex';
 const status=await runner(command,['login','status'],{env,timeoutMs:15000});
 if(!/^Logged in using ChatGPT\s*$/m.test(status.stdout+'\n'+status.stderr)){const e=new Error('Codex의 ChatGPT OAuth 로그인이 필요합니다. API 키 로그인으로 대체하지 않습니다.');e.category='auth';throw e;}
 const cwd=await mkdtemp(join(tmpdir(),'meeting-codex-'));
 try{
  const schemaPath=join(cwd,'schema.json');await writeFile(schemaPath,JSON.stringify(schema),{mode:0o600});
  const args=['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--color','never','--json','--output-schema',schemaPath,'--model',config.codexModel,'--cd',cwd];
  // Codex 0.154.0의 현행 이름은 apps·memories입니다. 구형 이름의 경고도 오류 이벤트로 옵니다.
  // 경고를 성공 결과로 간주하지 않고, 지원되는 옵션을 사용합니다. 실제 오류·도구 실행은 계속 거부합니다.
  for(const setting of ['web_search="disabled"','features.shell_tool=false','features.multi_agent=false','features.apps=false','features.plugins=false','features.hooks=false','features.memories=false','features.skip_host_skill_discovery=true','features.js_repl=false','features.code_mode=false','model_reasoning_effort="medium"','suppress_unstable_features_warning=true'])args.push('-c',setting);
  args.push('-');
  const result=await runner(command,args,{cwd,env,timeoutMs:config.timeoutMs||180000},prompt);
  return parseCodexEvents(result.stdout);
 }finally{await rm(cwd,{recursive:true,force:true});}
}
