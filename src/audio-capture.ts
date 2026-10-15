export type RecordingSource = 'microphone' | 'microphone-system';

export interface AudioCapture {
 stream:MediaStream;
 levels:()=>{microphone:number;system:number|null};
 onEnded:(listener:()=>void)=>void;
 stop:()=>void;
}

// Obsidian이 제공하는 Electron API만 사용하며 앱 전역 화면 공유 handler는 바꾸지 않습니다.
export async function requestSystemAudio(devices:MediaDevices):Promise<MediaStream>{
 let capturer:any;
 try{capturer=require('@electron/remote').desktopCapturer;}catch{}
 if(!capturer){try{capturer=require('electron').remote?.desktopCapturer;}catch{}}
 if(capturer){
  const sources=await capturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0}});
  if(!sources.length)throw new Error('컴퓨터 소리를 가져올 화면이 없습니다. 화면·시스템 오디오 권한을 확인하세요.');
  return devices.getUserMedia({
   audio:{mandatory:{chromeMediaSource:'desktop'}},
   video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:sources[0].id,maxFrameRate:1,maxWidth:320,maxHeight:240}}
  } as unknown as MediaStreamConstraints);
 }
 if(!devices.getDisplayMedia)throw new Error('이 기기에서 컴퓨터 소리 녹음을 지원하지 않습니다. 마이크만 녹음하거나 Zoom 녹음 파일을 선택하세요.');
 return devices.getDisplayMedia({audio:true,video:true,systemAudio:'include'} as DisplayMediaStreamOptions);
}

export async function captureAudio(source:RecordingSource,options:{
 signal?:AbortSignal;
 devices?:MediaDevices;
 context?:()=>AudioContext;
 system?:()=>Promise<MediaStream>;
}={}):Promise<AudioCapture>{
 const devices=options.devices||navigator.mediaDevices;
 const streams:MediaStream[]=[];
 const nodes:AudioNode[]=[];
 const endedListeners:Array<[MediaStreamTrack,()=>void]>=[];
 let context:AudioContext|undefined;
 let output:MediaStream|undefined;
 let stopped=false;
 const stop=()=>{
  if(stopped)return;
  stopped=true;
  options.signal?.removeEventListener('abort',stop);
  endedListeners.forEach(([track,listener])=>track.removeEventListener('ended',listener));
  nodes.forEach(node=>{try{node.disconnect();}catch{}});
  streams.forEach(stream=>stream.getTracks().forEach(track=>track.stop()));
  output?.getTracks().forEach(track=>track.stop());
  if(context&&context.state!=='closed')void context.close().catch(()=>{});
 };
 const ensureActive=()=>{if(stopped||options.signal?.aborted)throw new Error('녹음 시작이 취소되었습니다.');};
 const accept=(stream:MediaStream)=>{streams.push(stream);if(stopped){stream.getTracks().forEach(track=>track.stop());}ensureActive();};
 try{
  ensureActive();
  options.signal?.addEventListener('abort',stop,{once:true});
  // 화면 선택은 사용자 클릭에서 먼저 시작합니다. 영상은 녹음 출력에 넣지 않습니다.
  const system=source==='microphone-system'
   ? await (options.system?options.system():requestSystemAudio(devices)):null;
  if(system){
   accept(system);
   if(!system.getAudioTracks().some(track=>track.readyState==='live'))throw new Error('컴퓨터 소리 입력이 없습니다. 화면 선택의 오디오 공유와 시스템 오디오 권한을 확인하세요. 마이크만으로 자동 전환하지 않습니다.');
  }
  const microphone=await devices.getUserMedia({audio:true,video:false});
  accept(microphone);
  if(!microphone.getAudioTracks().some(track=>track.readyState==='live'))throw new Error('마이크 입력이 없습니다. 마이크 권한·입력 장치를 확인하세요.');
  context=options.context?options.context():new AudioContext();
  await context.resume();
  ensureActive();
  if(streams.some(stream=>stream.getTracks().some(track=>track.readyState!=='live')))throw new Error('녹음 소리 연결이 시작 중 끊겼습니다. 권한·공유 상태를 확인하고 다시 시작하세요.');
  const destination=context.createMediaStreamDestination();
  nodes.push(destination);
  output=destination.stream;
  const addInput=(stream:MediaStream)=>{
   // 트랙 둘을 붙이는 대신 실제 혼합합니다. 첫 트랙만 저장되는 문제를 피합니다.
   const input=context!.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
   const analyser=context!.createAnalyser();analyser.fftSize=256;
   const gain=context!.createGain();gain.gain.value=system?0.5:1;
   input.connect(analyser);analyser.connect(gain);gain.connect(destination);
   nodes.push(input,analyser,gain);
   const samples=new Float32Array(analyser.fftSize);
   return()=>{analyser.getFloatTimeDomainData(samples);let power=0;for(const n of samples)power+=n*n;return Math.min(1,Math.sqrt(power/samples.length)*6);};
  };
  const microphoneLevel=addInput(microphone);
  const systemLevel=system?addInput(system):null;
  return{
   stream:output,
   levels:()=>({microphone:microphoneLevel(),system:systemLevel?systemLevel():null}),
   onEnded:listener=>streams.forEach(stream=>stream.getTracks().forEach(track=>{
    track.addEventListener('ended',listener,{once:true});endedListeners.push([track,listener]);
   })),
   stop
  };
 }catch(error){stop();throw error;}
}
