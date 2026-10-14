import {writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {analyze} from '../server/core.mjs';
import {runProcess} from '../server/codex.mjs';
const source='이번 회의에서는 웹사이트 첫 화면 디자인을 금요일에 확정하기로 했다. 민수가 목요일까지 시안을 작성한다. 지수는 자료를 검토한다. 출시 날짜는 아직 정하지 않았다.';
const started=performance.now();let usage,toolCount=0,itemTypes=[],itemErrors=[];
const runner=async(...args)=>{const r=await runProcess(...args);if(args[1][0]==='exec'){const events=r.stdout.trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));usage=events.find(e=>e.type==='turn.completed')?.usage;itemErrors=events.filter(e=>e.item?.type==='error').map(e=>JSON.stringify(e.item).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/[A-Za-z0-9_\/-]{24,}/g,'[redacted]').slice(0,800));itemTypes=[...new Set(events.filter(e=>e.type?.startsWith('item.')&&e.item?.type).map(e=>e.item.type))];toolCount=events.filter(e=>e.type==='item.completed'&&e.item?.type&&!['reasoning','agent_message'].includes(e.item.type)).length;}return r;};
const model=process.env.CODEX_MODEL||'gpt-5.6-sol';
try{
 const result=await analyze(source,{mode:'codex',codexModel:model,sttProvider:'none',timeoutMs:180000},{codexRunner:runner});
 const receipt={checkedAt:new Date().toISOString(),provider:'Codex CLI · ChatGPT OAuth',cliVersion:'0.154.0',requestedModel:model,synthetic:true,source,result,evidenceValidation:'passed',toolExecutions:toolCount,latencyMs:Math.round(performance.now()-started),usage,scope:'합성 한국어 텍스트 1건. 음성 전사·옵시디언 실기기 검증 아님.'};
 await writeFile(new URL('../docs/CODEX_SMOKE.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({ok:true,latencyMs:receipt.latencyMs,toolExecutions:toolCount,result}));
}catch(error){await writeFile(new URL('../docs/CODEX_SMOKE_FAILED.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),synthetic:true,requestedModel:model,errorSummary:error.errorSummary||null,category:error.category||'response-validation',observedItemTypes:itemTypes,observedItemErrors:itemErrors,usage,exitCode:error.exitCode||null,message:error.name==='SyntaxError'?'응답 JSON 형식 오류':error.message,latencyMs:Math.round(performance.now()-started)},null,2)+'\n');console.error('Codex OAuth 합성 시험 실패: '+(error.category||'response-validation'));process.exitCode=1;}
