// PC의 사무실 내부망 HTTP만 허용합니다. 모바일·공인 주소는 HTTPS를 사용합니다.
export function validateEndpoint(value:string,desktop:boolean):{endpoint:string;lanHttp:boolean} {
 const endpoint=value.trim().replace(/\/+$/,'');
 const url=new URL(endpoint);
 if(url.username||url.password||url.search||url.hash)throw new Error('서버 주소에 인증정보·쿼리·해시를 넣을 수 없습니다.');
 if(url.protocol==='https:')return {endpoint,lanHttp:false};
 if(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))return {endpoint,lanHttp:false};
 const octets=url.hostname.split('.');
 const ipv4=octets.length===4&&octets.every(x=>/^\d{1,3}$/.test(x)&&Number(x)<=255);
 const [first,second]=octets.map(Number);
 const privateIp=ipv4&&(first===10||(first===172&&second>=16&&second<=31)||(first===192&&second===168));
 if(url.protocol==='http:'&&desktop&&privateIp)return {endpoint,lanHttp:true};
 throw new Error('PC의 사무실 내부 IP만 HTTP를 사용할 수 있습니다. 외부 주소·모바일은 HTTPS 주소를 사용해 주세요.');
}

// 녹음하는 기기의 현지 시각을 사용합니다. 파일명에도 쓰므로 콜론은 넣지 않습니다.
export function meetingTitle(startedAt:Date=new Date()):string {
 const pad=(value:number)=>String(value).padStart(2,'0');
 return [startedAt.getFullYear(),pad(startedAt.getMonth()+1),pad(startedAt.getDate())].join('-')
  +' '+pad(startedAt.getHours())+'시'+pad(startedAt.getMinutes())+'분 회의';
}
export function folderPath(value: string): string {
 const path=value.trim().replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
 if(!path)return '';
 if(path.split('/').some(part=>part==='.'||part==='..'||!part)||/[:*?"<>|\x00-\x1f]/.test(path)) throw new Error('저장 폴더는 보관함 안의 상대 경로로 입력해 주세요.');
 return path;
}
export function fileStem(title: string): string {
 const name=title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').replace(/^[. ]+|[. ]+$/g,'').slice(0,80);
 return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)?'회의-'+name:name||'회의록';
}
export function renderDraft(title: string,text: string, result: {summary:string[],decisions:{text:string,evidence:string}[],actions:{task:string,owner:string|null,due:string|null,evidence:string}[]}, mode: string): string {
 const line=(s:string)=>s.replace(/[\r\n]+/g,' ');
 return [`# ${line(title)||'회의록'}`,'',`> ${mode==='demo'?'데모 서식 — AI 요약이 아닙니다.':'AI 작성 초안 — 원문과 대조해 주세요.'}`,'','## 요약',...result.summary.map(x=>`- ${line(x)}`),'','## 결정사항',...(result.decisions.length?result.decisions.flatMap(x=>[`- ${line(x.text)}`,`  - 근거: ${line(x.evidence)}`]):['- 확인된 결정사항 없음']),'','## 할 일',...(result.actions.length?result.actions.flatMap(x=>[`- [ ] ${line(x.task)} · 담당: ${line(x.owner||'미정')} · 기한: ${line(x.due||'미정')}`,`  - 근거: ${line(x.evidence)}`]):['- 확인된 할 일 없음']),'','## 회의 원문',text].join('\n');
}
