// 처리 단계와 작동 중 표시만 제공합니다. 구간 갱신이 늦는 퍼센트·시간 추정치는 표시하지 않습니다.
export class ProcessingIndicator {
 private panel:HTMLElement;
 private label:HTMLElement;
 constructor(parent:HTMLElement){
  this.panel=parent.createEl('div',{cls:'meeting-processing',attr:{role:'status','aria-live':'polite','aria-atomic':'true'}});
  this.panel.hidden=true;
  this.panel.createEl('span',{cls:'meeting-spinner',attr:{'aria-hidden':'true'}});
  const text=this.panel.createEl('div');
  this.label=text.createEl('strong');
  text.createEl('p',{text:'작동 중입니다. 긴 녹음은 처리가 오래 걸릴 수 있습니다.'});
 }
 get element(){return this.panel;}
 show(message:string){this.label.setText(message);this.panel.hidden=false;}
 hide(){this.panel.hidden=true;}
}
