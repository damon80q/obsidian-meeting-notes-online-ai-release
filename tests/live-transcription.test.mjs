import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/live-transcription.ts'],bundle:true,write:false,format:'esm',plugins:[{name:'stub',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const requestUrl=o=>globalThis.liveRequest(o);',loader:'js'}));}}]});
const {LiveTranscription,liveMarkdown}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const pcm=await build({entryPoints:['src/pcm-chunks.ts'],bundle:true,write:false,format:'esm'});
const {pcmWav,PcmSegmenter}=await import('data:text/javascript;base64,'+Buffer.from(pcm.outputFiles[0].text).toString('base64'));
function fixture(){
 const files=new Map(),folders=new Set(),documents=[],statuses=[];
 const storage={exists:async p=>files.has(p)||folders.has(p),mkdir:async p=>folders.add(p),write:async(p,s)=>files.set(p,s),read:async p=>{if(!files.has(p))throw new Error('missing');return files.get(p);},writeBinary:async(p,b)=>files.set(p,b),readBinary:async p=>{if(!files.has(p))throw new Error('missing audio');return files.get(p);},rename:async(a,b)=>{if(files.has(b))throw new Error('Destination file already exists!');files.set(b,files.get(a));files.delete(a);},list:async p=>({folders:[...folders].filter(f=>f.startsWith(p+'/')&&!f.slice(p.length+1).includes('/')),files:[]})};
 const config={endpoint:'https://example.invalid/api',token:'test-token',write:async m=>documents.push(liveMarkdown(m)),status:s=>statuses.push(s)};
 return{storage,config,files,documents,statuses};
}
const chunk=(start=0)=>({data:new Uint8Array([1,2,3]).buffer,start,end:start+30});
const reply=(id,state,text,extra={})=>({status:state==='running'?202:200,json:{id,state,elapsedSeconds:1,...(text===undefined?{}:{text}),...extra}});
test('PCM WAV는 독립 디코드 헤더·16kHz 모노·clipping을 보존',()=>{
 const wav=pcmWav(new Float32Array([-2,-1,0,1,2]),16000),v=new DataView(wav);
 assert.equal(new TextDecoder().decode(wav.slice(0,4)),'RIFF');assert.equal(v.getUint32(24,true),16000);assert.equal(v.getUint16(22,true),1);assert.equal(v.getUint32(40,true),10);assert.equal(v.getInt16(44,true),-32768);assert.equal(v.getInt16(52,true),32767);
});
test('고정 최대 구간·무음 경계·마지막 꼬리의 전체 샘플을 빠짐없이 분할',()=>{
 const parts=[],s=new PcmSegmenter(16000,p=>parts.push(p),1,2);
 for(let i=0;i<5;i++)s.push(new Float32Array(8000).fill(.1));s.flush();
 assert.equal(parts.length,2);assert.deepEqual(parts.map(p=>[p.start,p.end]),[[0,2],[2,2.5]]);assert.equal(parts.reduce((n,p)=>n+(p.data.byteLength-44)/2,0),40000);
 const quiet=[];const q=new PcmSegmenter(16000,p=>quiet.push(p),1,2);q.push(new Float32Array(16000));q.flush();assert.equal(quiet.length,1);assert.equal(quiet[0].end,1);
});
test('2구간은 순차 전송하고 부분 문서·하나의 원음 연결·빈 무음 구간을 완료',async()=>{
 const f=fixture();let posts=0,gets=0;const ids=['a'.repeat(32),'b'.repeat(32)];
 globalThis.liveRequest=async o=>{if(o.method==='POST'){const id=ids[posts++];return posts===1?reply(id,'running',undefined,{partialText:'앞부분'}):reply(id,'completed','',{profile:'fast'});}gets++;return reply(ids[0],'completed','확정 원문',{profile:'fast'});};
 const live=await LiveTranscription.create(f.storage,f.config,1);live.enqueue(chunk());live.enqueue(chunk(30));assert.equal(await live.finish('회의녹음/전체.webm'),'확정 원문');
 assert.equal(posts,2);assert.equal(gets,1);assert.equal(live.manifest.parts.every(p=>p.state==='completed'),true);assert.ok(f.documents.some(t=>t.includes('앞부분')&&t.includes('미완료')));assert.ok(f.documents.at(-1).includes('[[회의녹음/전체.webm]]'));assert.equal(JSON.stringify(live.manifest).includes('test-token'),false);
});
test('조회 실패 후 복구는 저장된 작업ID를 조회하고 음성을 다시 업로드하지 않음',async()=>{
 const f=fixture();let posts=0,broken=true;const id='c'.repeat(32);
 globalThis.liveRequest=async o=>{if(o.method==='POST'){posts++;return reply(id,'running');}return broken?{status:502,json:{}}:reply(id,'completed','이어받은 원문',{profile:'fast'});};
 const live=await LiveTranscription.create(f.storage,f.config,1);live.enqueue(chunk());assert.equal(await live.finish('회의녹음/전체.webm'),null);assert.equal(posts,1);
 const recovered=await LiveTranscription.recover(f.storage,live.manifest.id,f.config,1);broken=false;assert.equal(await recovered.resume(),'이어받은 원문');assert.equal(posts,1);
});
test('전사 취소는 서버 확인 후 원음·구간·부분 결과를 유지하고 명시 재개만 재접수',async()=>{
 const f=fixture();let posts=0,cancels=0,accepted;const id='d'.repeat(32);
 globalThis.liveRequest=async o=>{if(o.url.endsWith('/cancel')){cancels++;return reply(id,'cancelled');}if(o.method==='POST'){posts++;accepted?.();return posts===1?reply(id,'running',undefined,{partialText:'보관할 앞부분'}):reply('e'.repeat(32),'completed','전체 원문',{profile:'fast'});}return reply(id,'running');};
 const live=await LiveTranscription.create(f.storage,f.config,1);const started=new Promise(r=>accepted=r);live.enqueue(chunk());const finish=live.finish('회의녹음/하나.webm');await started;await live.cancel();assert.equal(await finish,null);assert.equal(cancels,1);assert.ok(f.documents.at(-1).includes('보관할 앞부분'));assert.equal(live.manifest.original,'회의녹음/하나.webm');assert.equal(posts,1);
 assert.equal(await live.resume(),'전체 원문');assert.equal(posts,2);
});
test('구간 저장 실패는 불완전 표기이며 앞부분만으로 회의록 완료를 만들지 않음',async()=>{
 const f=fixture();f.storage.writeBinary=async()=>{throw new Error('disk full');};globalThis.liveRequest=()=>{throw new Error('호출 금지');};
 const live=await LiveTranscription.create(f.storage,f.config,1);live.enqueue(chunk());assert.equal(await live.finish('회의녹음/원음.webm'),null);assert.equal(live.manifest.incomplete,true);assert.ok(f.documents.at(-1).includes('보관에 실패'));await assert.rejects(()=>live.resume(),/누락/);
});
test('서버가 다른 복구 자료·변조된 경로는 전송하지 않음',async()=>{
 const f=fixture(),live=await LiveTranscription.create(f.storage,f.config,1);live.enqueue(chunk());await live.cancel();
 await assert.rejects(()=>LiveTranscription.recover(f.storage,live.manifest.id,{...f.config,endpoint:'https://elsewhere.invalid'}),/일치/);
 await assert.rejects(()=>LiveTranscription.recover(f.storage,'../outside',f.config),/ID/);
});

test('상태 본문 저장이 끊겨도 최신 저널의 작업ID로 복구하며 재업로드하지 않음',async()=>{
 const f=fixture(),id='f'.repeat(32);let broken=true,posts=0;
 const write=f.storage.write;f.storage.write=async(p,s)=>{if(broken&&p.endsWith('/session.json')&&JSON.parse(s).parts.some(p=>p.job))throw new Error('interrupted checkpoint write');return write(p,s);};
 globalThis.liveRequest=async o=>{if(o.method==='POST'){posts++;return reply(id,'running');}return reply(id,'completed','저널에서 이어받은 원문',{profile:'fast'});};
 const live=await LiveTranscription.create(f.storage,f.config,1);live.enqueue(chunk());assert.equal(await live.finish('회의녹음/전체.webm'),null);assert.equal(posts,1);
 assert.equal(JSON.parse(f.files.get(live.directory+'/session.json')).parts[0].job,undefined);
 assert.equal(JSON.parse(f.files.get(live.directory+'/session.pending')).parts[0].job,id);
 assert.deepEqual((await LiveTranscription.unfinished(f.storage,f.config.endpoint)).map(v=>v.id),[live.manifest.id]);
 broken=false;const recovered=await LiveTranscription.recover(f.storage,live.manifest.id,f.config,1);assert.equal(await recovered.resume(),'저널에서 이어받은 원문');assert.equal(posts,1);
});
test('잘린 임시 저널은 이전 정상 상태로 복구하고 변조 경로를 사용하지 않음',async()=>{
 const f=fixture(),live=await LiveTranscription.create(f.storage,f.config,1);
 f.files.set(live.directory+'/session.pending','{"version":');
 const recovered=await LiveTranscription.recover(f.storage,live.manifest.id,f.config,1);assert.equal(recovered.manifest.id,live.manifest.id);
 f.files.set(live.directory+'/session.pending',JSON.stringify({...live.manifest,document:'../private.md'}));
 assert.equal((await LiveTranscription.recover(f.storage,live.manifest.id,f.config,1)).manifest.document,live.manifest.document);
});
test('완료 저장 뒤에만 임시 저널을 제거하고 기존 목적지 rename을 요구하지 않음',async()=>{
 const f=fixture();let renames=0;f.storage.rename=async()=>{renames++;throw new Error('Destination file already exists!');};f.storage.remove=async p=>f.files.delete(p);
 globalThis.liveRequest=async()=>reply('a'.repeat(32),'completed','저장된 원문',{profile:'fast'});
 const live=await LiveTranscription.create(f.storage,f.config,1);live.enqueue(chunk());assert.equal(await live.finish('회의녹음/전체.webm'),'저장된 원문');
 assert.equal(renames,0);assert.equal(f.files.has(live.directory+'/session.pending'),false);assert.equal(JSON.parse(f.files.get(live.directory+'/session.json')).parts[0].text,'저장된 원문');
});

test('터보 프로필은 재개 때 현재 선택과 무관하게 유지하며 빈 마지막 구간을 완료',async()=>{
 const f=fixture();let posts=0,broken=true;
 globalThis.liveRequest=async o=>{if(o.method==='POST'){posts++;assert.ok(o.url.endsWith('/transcriptions/turbo'));return reply('c'.repeat(32),'running',undefined,{profile:'turbo'});}return broken?{status:502,json:{}}:reply('c'.repeat(32),'completed','',{profile:'turbo'});};
 const live=await LiveTranscription.create(f.storage,{...f.config,profile:'turbo'},1);live.enqueue(chunk());assert.equal(await live.finish('회의녹음/터보.webm'),null);assert.equal(posts,1);
 broken=false;const recovered=await LiveTranscription.recover(f.storage,live.manifest.id,{...f.config,profile:'fast'},1);assert.equal(recovered.manifest.profile,'turbo');assert.equal(await recovered.resume(),'');assert.equal(posts,1);
 const m={...live.manifest,profile:'unknown'};f.files.delete(live.directory+'/session.pending');f.files.set(live.directory+'/session.json',JSON.stringify(m));await assert.rejects(()=>LiveTranscription.recover(f.storage,live.manifest.id,f.config,1),/일치/);
});
test('이전 small 기록의 profile 누락은 기존 fast로 복구',async()=>{
 const f=fixture();const live=await LiveTranscription.create(f.storage,f.config,1);await live.cancel();const m=JSON.parse(f.files.get(live.directory+'/session.json'));delete m.profile;f.files.delete(live.directory+'/session.pending');f.files.set(live.directory+'/session.json',JSON.stringify(m));const old=await LiveTranscription.recover(f.storage,live.manifest.id,{...f.config,profile:'turbo'},1);assert.equal(old.manifest.profile,undefined);
});
test('터보는 30초 이후 무음에서 분리하며 연속 발화도 최대 약40초로 제한·꼬리 보존',()=>{
 const parts=[],s=new PcmSegmenter(16000,p=>parts.push(p),30,40);
 for(let i=0;i<41;i++)s.push(new Float32Array(16000).fill(.1));s.flush();assert.deepEqual(parts.map(p=>[p.start,p.end]),[[0,40],[40,41]]);
 const quiet=[],q=new PcmSegmenter(16000,p=>quiet.push(p),30,40);for(let i=0;i<30;i++)q.push(new Float32Array(16000).fill(.1));q.push(new Float32Array(8000));assert.equal(quiet.length,1);assert.equal(quiet[0].end,30.5);
});

test('실제 PCM 블록이 경계를 넘어도 터보 최대30초를 정확히 지키고 모든 샘플을 보존',()=>{
 const parts=[],s=new PcmSegmenter(16000,p=>parts.push(p),28,30,true);let remaining=31*16000;while(remaining){const n=Math.min(4096,remaining);s.push(new Float32Array(n).fill(.1));remaining-=n;}s.flush();assert.deepEqual(parts.map(p=>[p.start,p.end]),[[0,30],[30,31]]);assert.equal(parts.reduce((n,p)=>n+(p.data.byteLength-44)/2,0),31*16000);
 const quiet=[],q=new PcmSegmenter(16000,p=>quiet.push(p),28,30,true);for(let i=0;i<28;i++)q.push(new Float32Array(16000).fill(.1));q.push(new Float32Array(8000));assert.equal(quiet[0].end,28.5);
});
