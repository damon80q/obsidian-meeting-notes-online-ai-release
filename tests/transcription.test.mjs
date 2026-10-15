import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/transcription.ts'],bundle:true,write:false,format:'esm',plugins:[{name:'stub',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const requestUrl=options=>globalThis.jobRequest(options);',loader:'js'}));}}]});
const {TranscriptionTask}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const config={endpoint:'https://example.invalid/api',token:'test-token',jobs:true};
const id='d'.repeat(32);
test('장시간 접수는 한 번만 전송하고 상태를 조회하고 수치 대신 작동 단계만 표시',async()=>{
 const calls=[],progress=[];globalThis.jobRequest=async options=>{calls.push(options);return options.method==='POST'?{status:202,json:{id,state:'running',phase:'transcribing',percent:50,processedSeconds:1500,totalSeconds:3000,elapsedSeconds:60}}:{status:200,json:{id,state:'completed',text:'원문',elapsedSeconds:65,percent:100}};};
 const task=new TranscriptionTask(config,message=>progress.push(message),1);
 assert.equal(await task.run(new ArrayBuffer(1),'audio/webm'),'원문');assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(calls.length,2);assert.ok(progress[0].includes('음성을 전사하는 중'));assert.ok(progress.at(-1).includes('전사 완료'));assert.ok(progress.every(message=>!/%|분|초|남은/.test(message)));
});
test('상태 조회 502는 접수를 반복하지 않고 실패로 반환',async()=>{
 const calls=[];globalThis.jobRequest=async options=>{calls.push(options);return options.method==='POST'?{status:202,json:{id,state:'running',elapsedSeconds:0}}:{status:502,json:{error:'private details'}};};
 const task=new TranscriptionTask(config,()=>{},1);await assert.rejects(()=>task.run(new ArrayBuffer(1),'audio/webm'),/자동 재전송하지 않습니다/);assert.equal(calls.length,2);assert.equal(calls.filter(c=>c.method==='POST').length,1);
});
test('처리 중 429는 별도 안내하며 음성을 자동 재전송하지 않음',async()=>{
 let calls=0;globalThis.jobRequest=async()=>{calls++;return {status:429,json:{error:'private details'}};};
 await assert.rejects(()=>new TranscriptionTask(config,()=>{},1).run(new ArrayBuffer(1),'audio/webm'),/전사 취소/);assert.equal(calls,1);
});
