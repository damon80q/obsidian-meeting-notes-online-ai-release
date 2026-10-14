import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const {id,version}=JSON.parse(await readFile('manifest.json','utf8'));
// 허용한 파일만 넣고 실제 환경·인증·녹음·사용자 설정은 제외합니다.
const pluginDir='dist/'+id;await mkdir(pluginDir,{recursive:true});
for(const f of ['main.js','manifest.json','styles.css'])await copyFile(f,pluginDir+'/'+f);
const pluginZip=id+'-'+version+'.zip';execFileSync('zip',['-qr',pluginZip,id],{cwd:'dist'});
const serverName=id+'-server',serverDir='dist/'+serverName;
const allowed=["server/codex.mjs", "server/core.mjs", "server/index.mjs", "server/requirements.txt", "server/transcribe.py", "scripts/start-independent.sh", "scripts/codex-smoke.mjs", ".env.example", ".env.openai.example", ".env.anthropic.example", "docs/SETUP.md", "docs/CONFIGURATION.md", "docs/TROUBLESHOOTING.md", "docs/STATUS.md", "UPSTREAM.json"];
for(const f of allowed){const target=serverDir+'/'+f;await mkdir(target.slice(0,target.lastIndexOf('/')),{recursive:true});await copyFile(f,target);}
const readme=(await readFile('docs/SETUP.md','utf8')).replace(/\]\((?!https?:)([A-Z_]+\.md)\)/g,'](docs/$1)');
await writeFile(serverDir+'/README.md',readme);
const serverZip=serverName+'-'+version+'.zip';execFileSync('zip',['-qr',serverZip,serverName],{cwd:'dist'});
const lines=[];for(const f of [pluginZip,serverZip])lines.push(createHash('sha256').update(await readFile('dist/'+f)).digest('hex')+'  '+f);
await writeFile('dist/SHA256SUMS.txt',lines.join('\n')+'\n');
