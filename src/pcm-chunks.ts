export type PcmChunk={data:ArrayBuffer;start:number;end:number};

// MediaRecorder 이벤트 조각은 독립 파일이 아닙니다. 전사용으로만 별도 PCM WAV를 만듭니다.
export function pcmWav(input:Float32Array,rate:number):ArrayBuffer{
 if(!Number.isFinite(rate)||rate<8000||rate>192000)throw new Error('오디오 샘플 속도 오류');
 const count=Math.floor(input.length*16000/rate),buffer=new ArrayBuffer(44+count*2),v=new DataView(buffer);
 const word=(at:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
 word(0,'RIFF');v.setUint32(4,36+count*2,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,count*2,true);
 for(let i=0;i<count;i++){const position=i*rate/16000,left=Math.floor(position),fraction=position-left;const sample=input[left]*(1-fraction)+(input[Math.min(left+1,input.length-1)]||0)*fraction;const n=Math.max(-1,Math.min(1,sample));v.setInt16(44+i*2,Math.round(n*(n<0?32768:32767)),true);}
 return buffer;
}
export class PcmSegmenter {
 private blocks:Float32Array[]=[];private length=0;private position=0;private quiet=0;
 constructor(private rate:number,private emit:(chunk:PcmChunk)=>void,private targetSeconds=30,private maximumSeconds=45,private exactMaximum=false){}
 push(block:Float32Array){
  if(!block.length)return;
  if(this.exactMaximum){const remaining=Math.round(this.maximumSeconds*this.rate)-this.length;if(block.length>remaining){this.push(block.subarray(0,remaining));this.push(block.subarray(remaining));return;}}
  this.blocks.push(block.slice());this.length+=block.length;
  let energy=0;for(const x of block)energy+=x*x;
  this.quiet=Math.sqrt(energy/block.length)<0.008?this.quiet+block.length/this.rate:0;
  if((this.length/this.rate>=this.targetSeconds&&this.quiet>=0.4)||this.length/this.rate>=this.maximumSeconds)this.flush();
 }
 flush(){
  if(!this.length)return;
  const data=new Float32Array(this.length);let offset=0;for(const block of this.blocks){data.set(block,offset);offset+=block.length;}
  const start=this.position/this.rate;this.position+=this.length;
  this.blocks=[];this.length=0;this.quiet=0;
  this.emit({data:pcmWav(data,this.rate),start,end:this.position/this.rate});
 }
}
export async function capturePcmChunks(stream:MediaStream,emit:(chunk:PcmChunk)=>void,options:{targetSeconds?:number;maximumSeconds?:number;exactMaximum?:boolean}={}):Promise<{stop:()=>void}>{
 const context=new AudioContext({sampleRate:16000});
 let input:MediaStreamAudioSourceNode|undefined,processor:ScriptProcessorNode|undefined,mute:GainNode|undefined,stopped=false;
 let segmenter:PcmSegmenter|undefined;
 const stop=()=>{if(stopped)return;stopped=true;if(processor)processor.onaudioprocess=null;input?.disconnect();processor?.disconnect();mute?.disconnect();segmenter?.flush();void context.close().catch(()=>{});};
 try{
  await context.resume();
  input=context.createMediaStreamSource(stream);processor=context.createScriptProcessor(4096,1,1);mute=context.createGain();mute.gain.value=0;
  segmenter=new PcmSegmenter(context.sampleRate,emit,options.targetSeconds??30,options.maximumSeconds??45,options.exactMaximum??false);
  processor.onaudioprocess=event=>{if(!stopped)segmenter!.push(event.inputBuffer.getChannelData(0));};
  input.connect(processor);processor.connect(mute);mute.connect(context.destination);
  return{stop};
 }catch(error){stop();throw error;}
}
