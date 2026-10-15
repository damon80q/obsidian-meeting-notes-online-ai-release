import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/audio-capture.ts'],bundle:true,write:false,format:'esm',platform:'browser',external:['electron','@electron/remote']});
const {captureAudio,requestSystemAudio}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
class Track extends EventTarget{constructor(kind='audio'){super();this.kind=kind;this.readyState='live';this.stops=0;}stop(){this.stops++;this.readyState='ended';}}
class Stream{constructor(tracks=[]){this.tracks=tracks;}getTracks(){return this.tracks;}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}}
globalThis.MediaStream=Stream;
function fixture(){
 const mic=new Track();const system=new Track();const video=new Track('video');const mixed=new Track();
 const gains=[];const inputs=[];let calls=0;
 const context={state:'running',resume:async()=>{},close:async()=>{context.state='closed';},createMediaStreamDestination:()=>({stream:new Stream([mixed]),disconnect(){}}),createMediaStreamSource:s=>{inputs.push(s);return{connect(){},disconnect(){}};},createAnalyser:()=>({fftSize:256,connect(){},disconnect(){},getFloatTimeDomainData:a=>a.fill(.05)}),createGain:()=>{const n={gain:{value:0},connect(){},disconnect(){}};gains.push(n);return n;}};
 const devices={getUserMedia:async()=>{calls++;return new Stream([mic]);}};
 const options={devices,context:()=>context,system:async()=>new Stream([system,video])};
 return{mic,system,video,mixed,gains,inputs,context,options,calls:()=>calls};
}
test('동시 녹음 출력은 혼합한 단일 오디오, 화면 트랙 제외·전체 자원 해제',async()=>{
 const f=fixture();const c=await captureAudio('microphone-system',f.options);
 assert.deepEqual(c.stream.getTracks(),[f.mixed]);assert.equal(f.inputs.length,2);assert.ok(f.inputs.every(s=>s.getTracks().every(t=>t.kind==='audio')));assert.deepEqual(f.gains.map(n=>n.gain.value),[.5,.5]);assert.ok(c.levels().microphone>0&&c.levels().system>0);
 c.stop();c.stop();assert.deepEqual([f.mic,f.system,f.video,f.mixed].map(t=>t.stops),[1,1,1,1]);assert.equal(f.context.state,'closed');
});
test('마이크만 선택하면 시스템 캡처 요청 없이 기존 녹음 유지',async()=>{
 const f=fixture();f.options.system=()=>{throw new Error('시스템 캡처 호출 금지');};const c=await captureAudio('microphone',f.options);assert.equal(f.inputs.length,1);assert.equal(f.gains[0].gain.value,1);assert.equal(c.levels().system,null);c.stop();assert.equal(f.system.stops,0);
});
test('오디오 없는 화면 공유는 녹음 성공으로 취급하지 않으며 마이크만으로 묵시 전환하지 않음',async()=>{
 const f=fixture();f.options.system=async()=>new Stream([f.video]);await assert.rejects(captureAudio('microphone-system',f.options),/컴퓨터 소리 입력이 없습니다/);assert.equal(f.calls(),0);assert.equal(f.video.stops,1);
});
test('마이크 권한 실패 시 먼저 열린 시스템 소리·화면도 해제',async()=>{
 const f=fixture();f.options.devices.getUserMedia=async()=>{throw new Error('마이크 거절');};await assert.rejects(captureAudio('microphone-system',f.options),/마이크 거절/);assert.equal(f.system.stops,1);assert.equal(f.video.stops,1);
});
test('권한 대기 중 취소하면 뒤늦게 받은 시스템 스트림을 즉시 닫음',async()=>{
 const f=fixture();const abort=new AbortController();let resolve;f.options.system=()=>new Promise(r=>resolve=r);const pending=captureAudio('microphone-system',{...f.options,signal:abort.signal});abort.abort();resolve(new Stream([f.system,f.video]));await assert.rejects(pending,/취소/);assert.equal(f.calls(),0);assert.equal(f.system.stops,1);assert.equal(f.video.stops,1);
});
test('마이크 권한 대기 중 취소하면 기존 시스템과 뒤늦은 마이크 모두 해제',async()=>{
 const f=fixture();const abort=new AbortController();let resolve;f.options.devices.getUserMedia=()=>new Promise(r=>resolve=r);const pending=captureAudio('microphone-system',{...f.options,signal:abort.signal});await new Promise(r=>setImmediate(r));abort.abort();resolve(new Stream([f.mic]));await assert.rejects(pending,/취소/);assert.equal(f.mic.stops,1);assert.equal(f.system.stops,1);
});
test('소리 연결 종료 전달·정상 해제 후 listener 제거',async()=>{
 const f=fixture();const c=await captureAudio('microphone-system',f.options);let ended=0;c.onEnded(()=>ended++);f.system.dispatchEvent(new Event('ended'));assert.equal(ended,1);c.stop();f.video.dispatchEvent(new Event('ended'));assert.equal(ended,1);
});
test('표준 화면 공유 요청은 시스템 오디오를 요구하고 권한 거절을 전달',async()=>{
 let request;const f=fixture();const stream=new Stream([f.system,f.video]);assert.equal(await requestSystemAudio({getDisplayMedia:async o=>{request=o;return stream;}}),stream);assert.equal(request.audio,true);assert.equal(request.video,true);assert.equal(request.systemAudio,'include');await assert.rejects(requestSystemAudio({getDisplayMedia:async()=>{throw new Error('화면 거절');}}),/화면 거절/);
});

const {outputFiles:common}=await build({entryPoints:['src/audio-capture.ts'],bundle:true,write:false,format:'cjs',platform:'browser',external:['electron','@electron/remote']});
const {runInNewContext}=await import('node:vm');
test('Obsidian Electron 브리지는 화면 source와 desktop audio를 요청하며 전역 handler를 바꾸지 않음',async()=>{
 let sourceOptions;let constraints;
 const module={exports:{}};runInNewContext(common[0].text,{module,exports:module.exports,require:name=>{assert.equal(name,'@electron/remote');return{desktopCapturer:{getSources:async o=>{sourceOptions=o;return[{id:'screen:1:0'}];}}};}});
 const result={fixture:true};assert.equal(await module.exports.requestSystemAudio({getUserMedia:async o=>{constraints=o;return result;}}),result);
 assert.equal(sourceOptions.types[0],'screen');assert.equal(sourceOptions.thumbnailSize.width,0);assert.equal(constraints.audio.mandatory.chromeMediaSource,'desktop');assert.equal(constraints.video.mandatory.chromeMediaSourceId,'screen:1:0');
});
test('Electron 화면 권한 거절은 자동 재요청·마이크 단독 전환 없이 전달',async()=>{
 const module={exports:{}};runInNewContext(common[0].text,{module,exports:module.exports,require:()=>({desktopCapturer:{getSources:async()=>{throw new Error('Electron 화면 권한 거절');}}})});
 await assert.rejects(module.exports.requestSystemAudio({getUserMedia:()=>{throw new Error('호출 금지');}}),/Electron 화면 권한 거절/);
});


test('마이크 권한 대기 중 시스템 공유가 끝나면 녹음을 시작하지 않고 모두 해제',async()=>{
 const f=fixture();let resolve;f.options.devices.getUserMedia=()=>new Promise(r=>resolve=r);const pending=captureAudio('microphone-system',f.options);await new Promise(r=>setImmediate(r));f.system.readyState='ended';resolve(new Stream([f.mic]));await assert.rejects(pending,/시작 중 끊겼습니다/);assert.equal(f.mic.stops,1);assert.equal(f.video.stops,1);assert.equal(f.context.state,'closed');
});
