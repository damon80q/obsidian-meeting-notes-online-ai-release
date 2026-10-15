import {mkdir,copyFile,readFile,writeFile,mkdtemp,rename,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
const {id,version}=JSON.parse(await readFile('manifest.json','utf8'));
const dist=resolve('dist');
await mkdir(dist,{recursive:true});
// 이전 출력을 섞지 않고 허용한 배포 파일만 새 임시 경로에서 포장합니다.
const staging=await mkdtemp(join(dist,'.package-'));
try {
 const pluginDir=join(staging,id);
 await mkdir(pluginDir);
 for(const file of ['main.js','manifest.json','styles.css'])await copyFile(file,join(pluginDir,file));
 const serverName=id+'-server',serverDir=join(staging,serverName);
 const allowed=['server/codex.mjs','server/core.mjs','server/index.mjs','server/transcribe.py','server/stt_jobs.py','server/stt_proxy.mjs','server/requirements.txt','scripts/start-independent.sh','scripts/codex-smoke.mjs','.env.example','.env.openai.example','.env.anthropic.example','docs/SETUP.md','docs/CONFIGURATION.md','docs/TROUBLESHOOTING.md','docs/TRANSCRIPTION.md','docs/STATUS.md','UPSTREAM.json'];
 for(const file of allowed){
  const target=join(serverDir,file);
  await mkdir(resolve(target,'..'),{recursive:true});
  await copyFile(file,target);
 }
 await writeFile(join(serverDir,'README.md'),`# AI 회의록 · 온라인 AI 서버 v${version}\n\n**[설치·설정·업데이트는 docs/SETUP.md](docs/SETUP.md)**를 확인하세요.\n\n이 ZIP은 서버 코드·환경 예제·일반 사용자 안내입니다. Node/Python/Codex 실행 파일·모델·실제 인증·사용자 원음/설정은 포함하지 않습니다.\n\n기존 .env·로그인·모델·서비스 설정은 보존합니다. v0.1.0에서 업데이트할 때 server/의 새 작업 파일을 포함해 반영하고, 진행 중 작업이 없을 때 이 앱의 두 서버만 재시작합니다. 서버를 제공받는 사용자는 플러그인 ZIP만 설치합니다.\n\n[전사 방식과 복구](docs/TRANSCRIPTION.md) · [오류 해결](docs/TROUBLESHOOTING.md) · [검증 범위](docs/STATUS.md)\n`);
 const outputs=[[id+'-'+version+'.zip',id],[serverName+'-'+version+'.zip',serverName]],sums=[];
 for(const [filename,folder] of outputs){
  execFileSync('zip',['-qr',filename,folder],{cwd:staging});
  sums.push(createHash('sha256').update(await readFile(join(staging,filename))).digest('hex')+'  '+filename);
  await rename(join(staging,filename),join(dist,filename));
 }
 await writeFile(join(dist,'SHA256SUMS.txt'),sums.join('\n')+'\n');
} finally {
 await rm(staging,{recursive:true,force:true});
}
