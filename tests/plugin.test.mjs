import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/core.ts'],bundle:true,write:false,format:'esm',platform:'browser'});const core=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
test('보관함 밖 경로·불법 파일 문자 차단',()=>{assert.equal(core.folderPath('회의록/팀'),'회의록/팀');assert.equal(core.folderPath(''),'');assert.equal(core.fileStem('CON'),'회의-CON');for(const path of ['../outside','a/../b','a//b','a:b'])assert.throws(()=>core.folderPath(path));assert.equal(core.fileStem('../회:의'),' -회-의'.trim());});
test('원문 바이트·미정값·데모 표기 유지',()=>{const text='민수: 검토\r\n  원문 그대로';const md=core.renderDraft('회의',text,{summary:['검토'],decisions:[],actions:[{task:'검토',owner:null,due:null,evidence:'검토'}]},'demo');assert.ok(md.endsWith(text));assert.ok(md.includes('담당: 미정 · 기한: 미정'));assert.ok(md.includes('AI 요약이 아닙니다'));});

test('PC의 사설 IPv4 HTTP는 허용하고 외부 HTTP·주소의 인증정보는 거부',()=>{
 for(const url of ['http://192.168.1.20:8789','http://10.1.2.3:8789','http://172.16.0.1:8789','http://172.31.255.254:8789'])assert.equal(core.validateEndpoint(url,true).lanHttp,true);
 for(const url of ['http://8.8.8.8:8789','http://172.32.0.1:8789','http://192.168.1.20.example.invalid:8789','http://example.invalid','ftp://192.168.1.20','http://user:password@192.168.1.20:8789','http://192.168.1.20:8789?key=x','http://192.168.1.20:8789/#x'])assert.throws(()=>core.validateEndpoint(url,true));
 assert.equal(core.validateEndpoint('https://example.invalid:8443',true).lanHttp,false);
 assert.equal(core.validateEndpoint('http://127.0.0.1:8789',true).lanHttp,false);
});
test('모바일은 사설 IPv4 HTTP도 거부하며 HTTPS는 유지',()=>{
 assert.throws(()=>core.validateEndpoint('http://192.168.1.20:8789',false));
 assert.equal(core.validateEndpoint('https://example.invalid:8443',false).lanHttp,false);
});
