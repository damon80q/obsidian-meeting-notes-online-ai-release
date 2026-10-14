import {test} from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import {codexEnvironment,parseCodexEvents,runCodex,runProcess} from '../server/codex.mjs';
const valid={summary:['검토'],decisions:[],actions:[]};
const stream=extra=>[{type:'thread.started',thread_id:'test-id'},...(extra||[]),{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(valid)}},{type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}].map(e=>JSON.stringify(e)).join('\n');
test('OAuth 실행 환경에서 API 키·서비스 토큰·기타 secret 제외',()=>{
 const env=codexEnvironment({PATH:'/bin',HOME:'/test-home',CODEX_HOME:'/test-codex',OPENAI_API_KEY:'fake-key',CODEX_API_KEY:'fake-key',SERVER_TOKEN:'fake-token',OTHER_SECRET:'fake-secret'});assert.deepEqual(Object.keys(env).sort(),['CODEX_HOME','HOME','PATH']);
});
test('Codex 최종 JSON 및 실제 turn.completed 필요',()=>{
 assert.deepEqual(parseCodexEvents(stream()),valid);assert.throws(()=>parseCodexEvents('{"type":"turn.started"}'));assert.throws(()=>parseCodexEvents(stream([{type:'turn.failed'}])));
});
test('Codex 도구 실행 응답은 최종 JSON이 있어도 거부',()=>{
 for(const type of ['command_execution','mcp_tool_call','web_search','file_change','collab_tool_call'])assert.throws(()=>parseCodexEvents(stream([{type:'item.completed',item:{type}}])));
});
test('Codex 오류·경고 항목은 완료 이벤트가 있어도 성공으로 처리하지 않음',()=>{
 assert.throws(()=>parseCodexEvents(stream([{type:'item.completed',item:{type:'error',message:'fixture warning'}}])),/오류·경고/);
});
test('OAuth CLI는 임시 cwd·read-only·stdin·schema 사용 후 임시 파일 정리',async()=>{
 let dir,calls=0;
 const runner=async(command,args,options,input)=>{
  calls++;assert.equal(command,'codex');
  if(args[0]==='login')return {stdout:'',stderr:'Logged in using ChatGPT'};
  dir=options.cwd;assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('--ephemeral'));assert.equal(args[args.indexOf('--sandbox')+1],'read-only');assert.equal(args.at(-1),'-');assert.ok(args.includes('features.shell_tool=false'));assert.ok(!args.join(' ').includes('private-fixture'));assert.equal(input,'private-fixture');
  assert.equal(JSON.parse(await readFile(args[args.indexOf('--output-schema')+1],'utf8')).type,'object');return {stdout:stream(),stderr:''};
 };
 assert.deepEqual(await runCodex('private-fixture',{type:'object'},{codexModel:'test-model'},runner),valid);assert.equal(calls,2);await assert.rejects(()=>access(dir));
});
test('API 키 로그인은 OAuth 모드에서 수용하지 않음',async()=>{
 let calls=0;await assert.rejects(()=>runCodex('fixture',{}, {codexModel:'test-model'},async()=>{calls++;return {stdout:'',stderr:'Logged in using an API key'};}));assert.equal(calls,1);
});
test('Codex 실패 진단 원문은 오류 메시지에 노출하지 않음',async()=>{
 await assert.rejects(()=>runProcess(process.execPath,['-e','console.error("fake-sensitive-fixture");process.exit(1)'],{timeoutMs:5000}),e=>!e.message.includes('fake-sensitive-fixture'));
});
test('Codex 처리 시간 한도는 실제 자식 종료 뒤 오류 반환',async()=>{
 await assert.rejects(()=>runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:100}),/시간 초과/);
});
