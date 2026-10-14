// 실제 완료율을 알 수 없으므로 퍼센트 대신 현재 처리 단계만 표시합니다.
export class ProcessingIndicator {
 private panel:HTMLElement;
 private label:HTMLElement;
 constructor(parent:HTMLElement){
  this.panel=parent.createEl('div',{cls:'meeting-processing',attr:{role:'status','aria-live':'polite','aria-atomic':'true'}});
  this.panel.hidden=true;
  this.panel.createEl('span',{cls:'meeting-spinner',attr:{'aria-hidden':'true'}});
  const text=this.panel.createEl('div');
  this.label=text.createEl('strong');
  text.createEl('p',{text:'잠시만 기다려 주세요. 처리가 끝날 때까지 이 화면을 열어 두세요.'});
 }
 get element(){return this.panel;}
 show(message:string){this.label.setText(message);this.panel.hidden=false;}
 hide(){this.panel.hidden=true;}
}
