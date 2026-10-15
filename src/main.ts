import {App,Modal,Notice,Plugin,PluginSettingTab,Setting,requestUrl,normalizePath,Platform} from 'obsidian';
import {folderPath,fileStem,renderDraft,meetingTitle,validateEndpoint} from './core';
import {RecordingControls} from './recording';
import {ProcessingIndicator} from './progress';

interface Settings {
 endpoint:string;
 token:string;
 folder:string;
 autoSave:boolean;
 mode:'demo'|'server';
}

// 처음에는 서버 없이 저장 흐름을 시험하는 데모입니다.
// 127.0.0.1은 옵시디언 기기 자체입니다. 다른 서버는 담당자가 제공한 주소를 사용합니다.
const defaults:Settings={endpoint:'http://127.0.0.1:8789',token:'',folder:'회의록-온라인AI',autoSave:true,mode:'demo'};

export default class MeetingPlugin extends Plugin {
 settings:Settings=defaults;
 async onload(){
  const saved=await this.loadData();
  this.settings={...defaults,...saved};
  // 이전 기본값만 전환합니다. 기존 노트는 이동하지 않고 사용자 지정 경로는 보존합니다.
  if(['회의록-상용','회의록-AI-온라인'].includes(saved?.folder)){
   this.settings.folder=defaults.folder;
   await this.saveSettings();
  }
  this.addSettingTab(new MeetingSettings(this.app,this));
  this.addRibbonIcon('notebook-pen','AI 회의록 · 온라인 AI',()=>new MeetingModal(this.app,this).open());
  this.addCommand({id:'create-meeting-note',name:'회의 정리 시작',callback:()=>new MeetingModal(this.app,this).open()});
 }
 async saveSettings(){await this.saveData(this.settings);}
}

class MeetingSettings extends PluginSettingTab {
 constructor(app:App,private plugin:MeetingPlugin){super(app,plugin);}
 display(){
  const {containerEl}=this;
  containerEl.empty();
  containerEl.createEl('h2',{text:'AI 회의록 · 온라인 AI 설정'});
  containerEl.createEl('p',{text:'회의 텍스트를 Codex·OpenAI·Claude 등의 온라인 AI로 정리합니다. 기본 음성 전사는 서버의 Whisper가 처리합니다.'});
  // 설치된 manifest에서 읽어 업데이트 후에도 표시 버전이 어긋나지 않게 합니다.
  new Setting(containerEl).setName('현재 버전')
   .setDesc('v'+this.plugin.manifest.version+' · 설치된 플러그인 기준');
  new Setting(containerEl).setName('처리 방식')
   .setDesc('데모는 외부 전송 없이 서식만 만듭니다.')
   .addDropdown(d=>d.addOption('demo','데모 (AI 아님)').addOption('server','정리 서버')
    .setValue(this.plugin.settings.mode).onChange(async v=>{this.plugin.settings.mode=v as Settings['mode'];await this.plugin.saveSettings();}));
  new Setting(containerEl).setName('정리 서버 주소')
   .setDesc('같은 컴퓨터는 localhost, 다른 기기는 서버 담당자가 제공한 주소를 사용합니다. PC의 내부망 HTTP 또는 HTTPS를 사용하며 /health는 붙이지 않습니다.')
   .addText(t=>t.setValue(this.plugin.settings.endpoint).onChange(async v=>{this.plugin.settings.endpoint=v;await this.plugin.saveSettings();}));
  new Setting(containerEl).setName('서버 접속 토큰')
   .setDesc('서버 .env의 SERVER_TOKEN과 같은 값입니다. Codex OAuth 토큰·API 키가 아닙니다. 보관함 플러그인 설정에 저장됩니다.')
   .addText(t=>{t.inputEl.type='password';t.setValue(this.plugin.settings.token).onChange(async v=>{this.plugin.settings.token=v;await this.plugin.saveSettings();});});
  new Setting(containerEl).setName('녹음 후 회의록 자동 작성')
   .setDesc('녹음 종료 후 회의록을 자동 저장하고 엽니다. 끄면 결과를 확인·편집한 뒤 직접 저장합니다.')
   .addToggle(t=>t.setValue(this.plugin.settings.autoSave).onChange(async v=>{this.plugin.settings.autoSave=v;await this.plugin.saveSettings();}));
  new Setting(containerEl).setName('저장 폴더')
   .setDesc('현재 보관함 안의 폴더명입니다. 없으면 자동 생성하며 기존 노트는 덮어쓰지 않습니다.')
   .addText(t=>t.setValue(this.plugin.settings.folder).onChange(async v=>{this.plugin.settings.folder=v;await this.plugin.saveSettings();}));
 }
}

class MeetingModal extends Modal {
 private busy=false;
 private closed=false;
 private generation=0;
 private recording:RecordingControls|null=null;
 private audioPath='';
 constructor(app:App,private plugin:MeetingPlugin){super(app);}

 onOpen(){
  this.closed=false;
  const el=this.contentEl;
  const mode=this.plugin.settings.mode;
  const endpoint=this.plugin.settings.endpoint.trim().replace(/\/+$/,'');
  let providerReady=mode==='demo';
  let audioReady=false;
  let audioJobs=false;
  let audioFast=false;
  let audioTurbo=false;
  let automaticTitle=meetingTitle();
  el.addClass('meeting-notes');
  el.createEl('h2',{text:'회의를 노트로 · 온라인 AI'});
  el.createEl('p',{text:mode==='server'
   ? '녹음 시작 → 녹음 중 전사 → 종료·정리 → 회의록 저장. 제목과 회의 내용은 직접 입력하지 않아도 됩니다.'
   : '데모에서는 텍스트로 저장 흐름을 시험합니다. 실제 녹음은 설정에서 정리 서버를 연결하세요.'});
  const titleInfo=el.createEl('p',{text:'자동 제목: '+automaticTitle});
  const disclosure=el.createEl('p');
  const consent=el.createEl('label');
  const checkbox=consent.createEl('input',{type:'checkbox'});
  consent.appendText(' 표시된 음성·텍스트 처리 대상으로 회의 자료를 보내는 데 동의합니다.');
  const status=el.createEl('p',{attr:{role:'status','aria-live':'polite'}});
  const progress=new ProcessingIndicator(el);

  // 녹음을 기본 동작으로 배치합니다. 텍스트 직접 입력·제목 변경은 선택 기능입니다.
  const audioEl=mode==='server'?el.createDiv():null;
  const manual=el.createEl('details');
  manual.addClass('meeting-manual');
  manual.open=mode==='demo';
  manual.createEl('summary',{text:'제목 수정·텍스트로 정리 (선택)'});
  manual.createEl('label',{text:'회의 제목 (자동 생성 · 수정 선택)'});
  const title=manual.createEl('input',{attr:{'aria-label':'회의 제목'}});
  title.value=automaticTitle;
  manual.createEl('label',{text:'텍스트 직접 입력 (선택)'});
  const input=manual.createEl('textarea',{attr:{placeholder:'기존 회의 메모나 전사문이 있을 때만 붙여넣으세요. 녹음에는 입력하지 않아도 됩니다.','aria-label':'텍스트 직접 입력'}});
  const generate=manual.createEl('button',{text:'텍스트로 정리',cls:'mod-cta'});

  // 자동 녹음 모드에서는 편집 패널을 보여 주지 않고 저장된 옵시디언 노트를 엽니다.
  // 수동 입력 또는 자동 저장 OFF인 경우에만 저장 전 편집을 제공합니다.
  const editor=el.createDiv();
  editor.hidden=true;
  editor.createEl('label',{text:'회의록 내용 (직접 편집 가능)'});
  const draft=editor.createEl('textarea',{attr:{'aria-label':'회의록 내용'}});
  const save=editor.createEl('button',{text:'회의록 저장',cls:'mod-cta'});
  save.disabled=true;

  const refreshTitle=(startedAt:Date)=>{
   // 사용자가 직접 제목을 바꿨다면 보존합니다. 빈 제목은 자동 제목으로 되돌립니다.
   if(title.value.trim()===automaticTitle||!title.value.trim()){
    automaticTitle=meetingTitle(startedAt);
    title.value=automaticTitle;
    titleInfo.setText('자동 제목: '+automaticTitle);
   }
   this.audioPath='';
  };

  const saveNote=async()=>{
   if(this.busy||!draft.value.trim())return;
   this.busy=true;
   save.disabled=true;
   generate.disabled=true;
   progress.show('회의록을 저장하는 중…');
   try{
    const folder=folderPath(this.plugin.settings.folder);
    const parts=folder?folder.split('/'):[];
    for(let i=1;i<=parts.length;i++){
     const path=parts.slice(0,i).join('/');
     if(!this.app.vault.getAbstractFileByPath(path))await this.app.vault.createFolder(path);
    }
    const effectiveTitle=title.value.trim()||automaticTitle;
    const now=new Date();
    const date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
    // 자동 제목에 날짜가 이미 들어 있습니다. 자정을 넘겨 종료해도 시작 일시를 그대로 씁니다.
    const name=effectiveTitle===automaticTitle?fileStem(effectiveTitle):date+' '+fileStem(effectiveTitle);
    const base=normalizePath((folder?folder+'/':'')+name);
    let path=base+'.md';
    let n=2;
    while(this.app.vault.getAbstractFileByPath(path))path=base+' ('+(n++)+').md';
    const file=await this.app.vault.create(path,draft.value);
    new Notice('저장 완료: '+path);
    this.close();
    await this.app.workspace.getLeaf(false).openFile(file);
   }catch(e){
    status.setText(e instanceof Error?e.message:'저장에 실패했습니다.');
    editor.hidden=false;
    save.disabled=false;
   }finally{this.busy=false;generate.disabled=false;progress.hide();}
  };

  const analyzeText=async(fromAudio:boolean)=>{
   if(this.busy)return;
   const source=input.value;
   if(!source.trim()){new Notice('텍스트로 정리하려면 내용을 입력해 주세요. 녹음은 입력 없이 시작할 수 있습니다.');return;}
   if(source.length>30000){new Notice('회의 텍스트는 30,000자 이하로 입력해 주세요.');return;}
   if(mode==='server'&&(!providerReady||!checkbox.checked)){new Notice('전송 대상을 확인하고 동의 항목을 선택해 주세요.');return;}
   let completed=false;
   this.busy=true;
   generate.disabled=true;
   save.disabled=true;
   editor.hidden=true;
   const seq=++this.generation;
   status.setText('회의 내용을 정리하는 중…');
   progress.show('회의록을 정리하는 중…');
   try{
    let result;
    let resultMode='demo';
    if(mode==='demo'){
     result={summary:['AI를 연결하지 않은 서식입니다. 원문을 보고 내용을 작성해 주세요.'],decisions:[],actions:[]};
    }else{
     const r=await requestUrl({
      url:endpoint+'/summarize',method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.plugin.settings.token},
      body:JSON.stringify({text:source}),throw:false
     });
     if(r.status!==200)throw new Error('정리 실패 ('+r.status+'). 서버 설정을 확인해 주세요.');
     result=r.json.result;
     resultMode=r.json.mode;
     if(!result||!Array.isArray(result.summary)||!Array.isArray(result.decisions)||!Array.isArray(result.actions))throw new Error('서버 응답 형식이 올바르지 않습니다.');
    }
    if(this.closed||seq!==this.generation)return;
    draft.value=renderDraft(title.value.trim()||automaticTitle,source,result,resultMode)
     +(this.audioPath?'\n\n## 원음\n[['+this.audioPath+']]\n':'');
    completed=true;
    save.disabled=false;
    if(fromAudio&&this.plugin.settings.autoSave){
     status.setText('정리 완료. 회의록을 저장하는 중…');
    }else{
     editor.hidden=false;
     status.setText('회의록 내용을 확인하고 저장하세요.');
    }
   }catch(e){
    if(!this.closed)status.setText(e instanceof Error?e.message:'정리 중 오류가 발생했습니다.');
   }finally{
    this.busy=false;
    generate.disabled=false;
    if(completed&&fromAudio&&this.plugin.settings.autoSave&&!this.closed)await saveNote();
    progress.hide();
   }
  };

  generate.onclick=()=>{this.audioPath='';void analyzeText(false);};
  save.onclick=()=>{void saveNote();};
  title.oninput=()=>titleInfo.setText('회의 제목: '+(title.value.trim()||automaticTitle));

  if(mode==='demo'){
   disclosure.setText('데모: 외부 전송 없음 · AI 요약 아님');
   consent.hide();
  }else{
   this.recording=new RecordingControls(this.app,audioEl!,{
    endpoint,token:this.plugin.settings.token,jobs:()=>audioJobs,fast:()=>audioFast,turbo:()=>audioTurbo,
    allowed:()=>providerReady&&audioReady&&checkbox.checked&&!this.busy,
    onStart:refreshTitle,
    progressEl:progress.element,onProgress:message=>{if(!this.closed){progress.show(message);generate.disabled=true;save.disabled=true;}},onIdle:()=>{progress.hide();if(!this.closed)generate.disabled=false;},
    onText:(text,path)=>{
     // 전사문을 분석 입력으로 자동 연결합니다. 사용자가 텍스트 칸에 입력할 필요는 없습니다.
     input.value=text;
     this.audioPath=path;
     return analyzeText(true);
    }
   });
   disclosure.setText('서버 전송 대상을 확인 중입니다.');
   void (async()=>{
    try{
     const connection=validateEndpoint(endpoint,Platform.isDesktopApp);
     const r=await requestUrl({url:endpoint+'/health',throw:false});
     if(r.status!==200)throw new Error('서버 연결 실패');
     const h=r.json;
     if(typeof h.provider!=='string'||!['demo','ai'].includes(h.mode)||(h.audio===true&&typeof h.audioProvider!=='string'))throw new Error('서버 정보 형식 오류');
     if(this.closed)return;
     providerReady=true;
     audioReady=h.audio===true;
     audioJobs=h.audioJobs===true;audioFast=h.audioFast===true;audioTurbo=h.audioTurbo===true;this.recording?.refreshCapabilities();
     if(!audioReady)manual.open=true;
     disclosure.setText('전송 대상: '+endpoint+' → 음성: '+h.audioProvider+' · 텍스트: '+h.provider
      +' ('+(h.mode==='demo'?'서버 데모 · AI 아님':'온라인 AI 처리')+')'
      +(connection.lanHttp?' · 사무실 내부망 HTTP: 전송이 암호화되지 않습니다. 외부에서는 HTTPS를 사용하세요.':''));
    }catch(e){
     if(!this.closed)disclosure.setText(e instanceof Error?e.message:'서버 정보를 확인할 수 없습니다.');
    }
   })();
  }
 }

 onClose(){
  this.recording?.dispose();
  this.recording=null;
  this.closed=true;
  this.generation++;
  this.contentEl.empty();
 }
}
