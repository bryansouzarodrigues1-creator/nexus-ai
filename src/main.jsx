import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Search,Plus,Paperclip,Image,Video,FileText,Send,Settings,MessageSquare,Globe2,Sparkles,Menu,X,ThumbsUp,ThumbsDown,Code2,LockKeyhole,BrainCircuit,RefreshCw,Activity} from 'lucide-react';
import './styles.css';
import {wantsFreshImage,shouldContinueImageContext,selectImageChainHistory,selectApprovedChainReferenceKeys} from './image-context.js';

const starterActions=[
  {icon:Globe2,label:'Pesquisar na web',mode:'search'},
  {icon:FileText,label:'Analisar arquivo',mode:'file'},
  {icon:Image,label:'Criar imagem',mode:'image'},
  {icon:Video,label:'Vídeo · futuro',mode:'video'},
  {icon:Code2,label:'Codex · futuro',mode:'codex'},
];

function id(){return crypto.randomUUID?.()||Math.random().toString(36).slice(2)}

function getClientId(){
  let value=localStorage.getItem('nexus_client_id');
  if(!value){
    value=id();
    localStorage.setItem('nexus_client_id',value);
  }
  return value;
}

function apiHeaders(){
  return {
    'content-type':'application/json',
    'x-nexus-client':getClientId()
  };
}

function readThreads(){
  try{
    const parsed=JSON.parse(localStorage.getItem('nexus_threads')||'[]');
    return Array.isArray(parsed)?parsed:[];
  }catch{return []}
}

function openMediaDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('nexus_ai_media',1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('media'))req.result.createObjectStore('media')};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

async function saveMedia(key,blob){
  const db=await openMediaDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('media','readwrite');
    tx.objectStore('media').put(blob,key);
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error);
  });
  db.close();
}

async function loadMedia(key){
  if(!key)return null;
  const db=await openMediaDb();
  const blob=await new Promise((resolve,reject)=>{
    const tx=db.transaction('media','readonly');
    const req=tx.objectStore('media').get(key);
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });
  db.close();
  return blob;
}

async function mediaKeyAsDataUrl(key){
  if(!key)return null;
  try{
    const blob=await loadMedia(key);
    return blob?await blobToDataUrl(blob):null;
  }catch{
    return null;
  }
}

function blobToDataUrl(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function fileToDataUrl(file){return blobToDataUrl(file)}
function fileToText(file){return file.text()}

async function shrinkImageDataUrl(dataUrl,maxSide=500){
  if(!dataUrl||!dataUrl.startsWith('data:image/'))return dataUrl;
  return new Promise(resolve=>{
    const img=new window.Image();
    img.onload=()=>{
      const scale=Math.min(1,maxSide/Math.max(img.width,img.height));
      if(scale===1){resolve(dataUrl);return}
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(img.width*scale));
      canvas.height=Math.max(1,Math.round(img.height*scale));
      const ctx=canvas.getContext('2d');
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const sourceMime=(dataUrl.match(/^data:([^;]+)/i)?.[1]||'').toLowerCase();
      const outputMime=sourceMime==='image/png'?'image/png':'image/jpeg';
      resolve(
        outputMime==='image/png'
          ?canvas.toDataURL('image/png')
          :canvas.toDataURL('image/jpeg',0.94)
      );
    };
    img.onerror=()=>resolve(dataUrl);
    img.src=dataUrl;
  });
}

async function imageDataUrlDimensions(dataUrl){
  if(!dataUrl||!dataUrl.startsWith('data:image/'))return null;
  return new Promise(resolve=>{
    const img=new window.Image();
    img.onload=()=>resolve({
      width:Number(img.naturalWidth||img.width||0),
      height:Number(img.naturalHeight||img.height||0)
    });
    img.onerror=()=>resolve(null);
    img.src=dataUrl;
  });
}

function wantsHighImageQuality(text){
  return /\b(máxima qualidade|maxima qualidade|ultra.?real|ultrareal|foto.?real|fotorreal|photoreal|high.?fidelity|cinemat|8k|4k|extremamente detalhad|qualidade máxima|qualidade maxima)\b/i.test(text);
}

function wantsHighVideoQuality(text){
  return /\b(máxima qualidade|maxima qualidade|qualidade máxima|qualidade maxima|cinemat|high.?quality|high.?fidelity|mais qualidade|melhor qualidade|ultra.?real|fotorreal|photoreal)\b/i.test(String(text||''));
}

function isRichDocument(file){
  return /\.(pdf|docx|xlsx|xlsm|xlsb|xls|ods|odt|numbers)$/i.test(file?.name||'');
}

function wantsAgentMode(text){
  return /(intensidade máxima|intensidade maxima|modo máximo|modo maximo|analise profundamente|análise profunda|investigue profundamente|investigue tudo|auditoria profunda|arquitetura completa|diagnóstico profundo|diagnostico profundo|compare em detalhes|monte um plano completo|raciocine profundamente|pense muito|complexidade máxima|complexidade maxima)/i.test(String(text||""));
}

function detectNaturalFeedback(text){
  const value=String(text||'').trim();
  if(/\b(nada a ver|não foi isso|nao foi isso|ficou ruim|ficou péssim|ficou pesssim|está errado|esta errado|tá errado|ta errado|errou|péssimo|pessimo|horrível|horrivel|não gostei|nao gostei|mudou demais|perdeu a referência|perdeu a referencia)\b/i.test(value))return 'negative';
  if(/\b(agora sim|perfeito|ficou perfeito|ficou ótimo|ficou otimo|muito bom|excelente|isso mesmo|era isso|acertou)\b/i.test(value))return 'positive';
  return null;
}

function feedbackKindForMessage(message){
  if(message?.media?.type==='image'||message?.generationMode==='edit'||message?.generationMode==='new')return 'image';
  if(message?.media?.type==='video'||String(message?.generationMode||'').includes('video'))return 'video';
  if(message?.route==='agent')return 'agent';
  if(message?.route==='search')return 'search';
  if(message?.route==='code')return 'code';
  return 'chat';
}

function sleep(ms){
  return new Promise(resolve=>setTimeout(resolve,ms));
}

async function waitForAgent(taskId){
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    const res=await fetch('/api/agent/'+encodeURIComponent(taskId),{
      headers:{'x-nexus-client':getClientId()}
    });
    const data=await res.json();

    if(!res.ok){
      throw new Error(data.error||data.provider_error||'Falha ao consultar o agente.');
    }

    if(data.status==='complete'){
      return data.output||{};
    }

    if(data.status==='errored'||data.status==='terminated'){
      throw new Error(
        data.error?.message||
        'O agente não conseguiu concluir a tarefa.'
      );
    }

    await sleep(1400);
  }

  throw new Error('A tarefa profunda continua processando por mais tempo que o esperado. Tente consultar novamente em instantes.');
}


async function pollImageJob(taskId,sessionId,timeoutMs=10*60*1000){
  const started=Date.now();
  let delay=900;
  let notFoundCount=0;

  while(Date.now()-started<timeoutMs){
    const res=await fetch(
      '/api/image/jobs/'+encodeURIComponent(taskId)+
      '?sessionId='+encodeURIComponent(sessionId),
      {headers:{'x-nexus-client':getClientId()}}
    );

    const data=await res.json().catch(()=>({}));

    if(!res.ok){
      if(res.status===404&&notFoundCount<4){
        notFoundCount+=1;
        await sleep(1200);
        continue;
      }

      const error=new Error(
        data.error||
        data.provider_error||
        'Não consegui consultar a geração de imagem.'
      );
      error.imageJobStatus=res.status===404?'unknown':'network';
      throw error;
    }

    notFoundCount=0;

    if(data.ready||data.status==='complete'){
      return data;
    }

    if(data.status==='errored'||data.status==='terminated'){
      const error=new Error(
        data.task?.error||
        data.error?.message||
        'A geração de imagem não conseguiu terminar.'
      );
      error.imageJobStatus='errored';
      throw error;
    }

    await sleep(delay);
    delay=Math.min(2500,delay+250);
  }

  const error=new Error(
    'A imagem ainda está processando. A NEXUS continuará procurando o resultado quando você voltar.'
  );
  error.imageJobStatus='pending';
  throw error;
}

async function fetchImageJobResult(taskId,sessionId){
  return fetch(
    '/api/image/jobs/'+encodeURIComponent(taskId)+
    '/result?sessionId='+encodeURIComponent(sessionId),
    {headers:{'x-nexus-client':getClientId()}}
  );
}

function ackImageJob(taskId,sessionId){
  if(!taskId||!sessionId)return;
  void fetch(
    '/api/image/jobs/'+encodeURIComponent(taskId)+
    '/ack?sessionId='+encodeURIComponent(sessionId),
    {
      method:'POST',
      headers:apiHeaders(),
      body:'{}'
    }
  ).catch(()=>{});
}

function detectExplicitMediaIntent(text){
  const value=String(text||'').trim();

  const imageIntent=
    /\b(gere|gera|gerar|crie|cria|criar|faça|faca|fazer|desenhe|desenha|desenhar|produza|produzir|generate|create|make|draw)\b[\s\S]{0,100}\b(imagem|image|foto|photo|picture|ilustração|ilustracao|desenho|artwork)\b/i.test(value) ||
    /\b(imagem|image|foto|photo|picture|ilustração|ilustracao|desenho|artwork)\b[\s\S]{0,70}\b(gere|gera|crie|cria|faça|faca|desenhe|produza|generate|create|make|draw)\b/i.test(value);

  const videoIntent=
    /\b(gere|gera|gerar|crie|cria|criar|faça|faca|fazer|produza|produzir|generate|create|make)\b[\s\S]{0,100}\b(vídeo|video|filme|clipe|animação|animacao)\b/i.test(value) ||
    /\b(vídeo|video|filme|clipe|animação|animacao)\b[\s\S]{0,70}\b(gere|gera|crie|cria|faça|faca|produza|generate|create|make)\b/i.test(value);

  if(videoIntent)return 'video';
  if(imageIntent)return 'image';
  return null;
}

function App(){
  const initialThreads=useMemo(()=>readThreads(),[]);
  const [threads,setThreads]=useState(initialThreads);
  const [active,setActive]=useState(initialThreads[0]?.id||null);
  const [input,setInput]=useState('');
  const [mode,setMode]=useState('chat');
  const [busy,setBusy]=useState(false);
  const [menu,setMenu]=useState(false);
  const [status,setStatus]=useState(null);
  const [attachment,setAttachment]=useState(null);
  const [extraImageRefs,setExtraImageRefs]=useState([]);
  const [learningOpen,setLearningOpen]=useState(false);
  const [learningStatus,setLearningStatus]=useState(null);
  const [learningBusy,setLearningBusy]=useState(false);
  const fileRef=useRef(null);
  const threadsRef=useRef(initialThreads);
  const imageJobsInFlight=useRef(new Set());

  useEffect(()=>{
    threadsRef.current=threads;
    const serializable=threads.map(t=>({
      ...t,
      messages:t.messages.map(m=>({
        ...m,
        media:m.media?{...m.media,url:null}:null
      }))
    }));
    localStorage.setItem('nexus_threads',JSON.stringify(serializable));
  },[threads]);

  useEffect(()=>{
    fetch('/api/status').then(r=>r.json()).then(setStatus).catch(()=>{});
  },[]);

  useEffect(()=>{
    const timer=setTimeout(()=>resumeAllPendingImageJobs(),450);
    const onOnline=()=>resumeAllPendingImageJobs();
    const onVisibility=()=>{
      if(document.visibilityState==='visible'){
        resumeAllPendingImageJobs();
      }
    };

    window.addEventListener('online',onOnline);
    document.addEventListener('visibilitychange',onVisibility);

    return()=>{
      clearTimeout(timer);
      window.removeEventListener('online',onOnline);
      document.removeEventListener('visibilitychange',onVisibility);
    };
  },[]);

  async function loadLearningStatus(){
    setLearningBusy(true);
    try{
      const res=await fetch('/api/learning/status',{
        headers:{'x-nexus-client':getClientId()}
      });
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||'Falha ao carregar aprendizado.');
      setLearningStatus(data);
    }catch(e){
      setLearningStatus({error:e.message||'Falha ao carregar aprendizado.'});
    }finally{
      setLearningBusy(false);
    }
  }

  function openLearningPanel(){
    setLearningOpen(true);
    setMenu(false);
    void loadLearningStatus();
  }

  function pct(value){
    return Number.isFinite(Number(value))
      ?Math.round(Number(value)*100)+'%'
      :'—';
  }

  function ms(value){
    const n=Number(value);
    if(!Number.isFinite(n)||n<=0)return '—';
    return n>=1000?(n/1000).toFixed(1)+'s':Math.round(n)+'ms';
  }

  useEffect(()=>{
    if(!active)return;
    let cancelled=false;
    const current=threads.find(t=>t.id===active);
    const missing=(current?.messages||[]).filter(m=>m.media?.key&&!m.media?.url);
    if(!missing.length)return;

    (async()=>{
      for(const msg of missing){
        try{
          const blob=await loadMedia(msg.media.key);
          if(!blob||cancelled)continue;
          const url=URL.createObjectURL(blob);
          setThreads(prev=>prev.map(t=>t.id!==active?t:{
            ...t,
            messages:t.messages.map(m=>m.id===msg.id?{...m,media:{...m.media,url}}:m)
          }));
        }catch{}
      }
    })();

    return()=>{cancelled=true};
  },[active]);

  const thread=useMemo(()=>threads.find(t=>t.id===active),[threads,active]);
  const hasImage=Boolean(thread?.messages?.some(m=>m.media?.type==='image'));

  function newChat(){
    const t={id:id(),title:'Nova conversa',messages:[]};
    setThreads(p=>[t,...p]);
    setActive(t.id);
    setAttachment(null);
    setExtraImageRefs([]);
    setMenu(false);
  }

  function addMessage(tid,msg){
    setThreads(p=>p.map(t=>t.id===tid?{...t,messages:[...t.messages,{id:id(),...msg}]}:t));
  }

  function updateMessage(tid,msgId,patch){
    setThreads(p=>p.map(t=>t.id===tid?{
      ...t,
      messages:t.messages.map(m=>m.id===msgId?{...m,...patch}:m)
    }:t));
  }

  function removeMessage(tid,msgId){
    setThreads(p=>p.map(t=>t.id===tid?{
      ...t,
      messages:t.messages.filter(m=>m.id!==msgId)
    }:t));
  }

  async function sendLearningFeedback({
    tid,
    message,
    messageIndex,
    signal,
    note=''
  }){
    const current=threads.find(t=>t.id===tid);
    const messages=current?.messages||[];
    const previousUser=[...messages.slice(0,messageIndex)].reverse().find(m=>m.role==='user');
    const payload={
      sessionId:tid,
      kind:feedbackKindForMessage(message),
      signal,
      prompt:previousUser?.content||'',
      outputPreview:message?.content||'',
      note,
      provider:message?.provider||'',
      model:message?.model||'',
      route:message?.route||message?.generationMode||'',
      score:Number.isFinite(message?.visualScore)
        ?message.visualScore
        :Number.isFinite(message?.verificationScore)
          ?message.verificationScore
          :null,
      meta:{
        generationMode:message?.generationMode||null,
        imageTask:message?.imageTask||null,
        imageCaseId:message?.imageCaseId||null,
        preservationLevel:message?.preservationLevel||null,
        identityScore:Number.isFinite(message?.identityScore)?message.identityScore:null,
        fulfillmentScore:Number.isFinite(message?.fulfillmentScore)?message.fulfillmentScore:null,
        artifactScore:Number.isFinite(message?.artifactScore)?message.artifactScore:null,
        textScore:Number.isFinite(message?.textScore)?message.textScore:null,
        deterministicTextScore:Number.isFinite(message?.deterministicTextScore)?message.deterministicTextScore:null,
        exactTextMatches:Number.isFinite(message?.exactTextMatches)?message.exactTextMatches:null,
        exactTextTotal:Number.isFinite(message?.exactTextTotal)?message.exactTextTotal:null,
        referenceScore:Number.isFinite(message?.referenceScore)?message.referenceScore:null,
        referenceLeakageRisk:Number.isFinite(message?.referenceLeakageRisk)?message.referenceLeakageRisk:null,
        qualityGateState:message?.qualityGateState||null,
        qualityGateScore:Number.isFinite(message?.qualityGateScore)?message.qualityGateScore:null,
        candidateArenaUsed:Boolean(message?.candidateArenaUsed),
        selectedImageQuality:message?.selectedImageQuality||null,
        retryClass:message?.retryClass||null,
        retryEditStrength:Number.isFinite(message?.retryEditStrength)?message.retryEditStrength:null,
        retries:Number(message?.visualRetry||message?.videoFallbacks||0),
        adaptiveRouter:message?.adaptiveRouter||null,
        rootReferenceUsed:Boolean(message?.rootReferenceUsed),
        visualRootKey:message?.visualRootKey||null
      }
    };

    try{
      const res=await fetch('/api/feedback',{
        method:'POST',
        headers:apiHeaders(),
        body:JSON.stringify(payload)
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(data.error||'Falha ao salvar feedback.');
      updateMessage(tid,message.id,{
        feedback:signal,
        feedbackLessonStored:Boolean(data.lessonStored),
        feedbackCaseUpdated:Boolean(data.imageCaseFeedbackApplied)
      });
      return data;
    }catch{
      updateMessage(tid,message.id,{feedbackError:true});
      return null;
    }
  }

  async function submitMessageFeedback(message,messageIndex,signal){
    if(!active||!message?.id)return;
    let note='';
    if(signal==='negative'){
      note=window.prompt(
        'O que ficou ruim? Isso é opcional, mas ajuda a NEXUS a aprender uma regra melhor.'
      )||'';
    }
    await sendLearningFeedback({
      tid:active,
      message,
      messageIndex,
      signal,
      note
    });
  }

  function learnFromNaturalFeedback(tid,currentThread,text){
    const signal=detectNaturalFeedback(text);
    if(!signal)return;

    const messages=currentThread?.messages||[];
    let assistantIndex=-1;
    for(let i=messages.length-1;i>=0;i--){
      if(messages[i]?.role==='assistant'){
        assistantIndex=i;
        break;
      }
    }
    if(assistantIndex<0)return;

    const message=messages[assistantIndex];
    void sendLearningFeedback({
      tid,
      message,
      messageIndex:assistantIndex,
      signal,
      note:text
    });
  }

  async function mediaAsDataUrl(msg){
    if(!msg?.media)return null;
    try{
      let blob=null;
      if(msg.media.url)blob=await fetch(msg.media.url).then(r=>r.blob());
      if(!blob&&msg.media.key)blob=await loadMedia(msg.media.key);
      return blob?await blobToDataUrl(blob):null;
    }catch{return null}
  }

  async function storeGeneratedMedia(blob,type){
    const key=id();
    try{await saveMedia(key,blob)}catch{}
    return {type,key,url:URL.createObjectURL(blob)};
  }


  async function consumeImageResponse({
    tid,
    messageId,
    res,
    imageChainId,
    visualRootKey,
    imageJobId=''
  }){
    const type=res.headers.get('content-type')||'';
    if(!res.ok||type.includes('application/json')){
      const data=await res.json().catch(()=>({}));
      throw new Error(
        [data.error,data.provider_error].filter(Boolean).join(' — ')||
        'Falha no motor de imagem.'
      );
    }

    const blob=await res.blob();
    const media=await storeGeneratedMedia(blob,'image');
    const imageMode=res.headers.get('x-nexus-image-mode')||'new';
    const model=res.headers.get('x-nexus-model')||'';
    const provider=res.headers.get('x-nexus-provider')||'';
    const promptExpanded=res.headers.get('x-nexus-prompt-expanded')==='1';
    const promptModel=res.headers.get('x-nexus-prompt-model')||'';
    const visualVerified=res.headers.get('x-nexus-visual-verified')==='1';
    const visualScoreRaw=res.headers.get('x-nexus-visual-score');
    const visualScore=visualScoreRaw!==null&&visualScoreRaw!==''?Number(visualScoreRaw):null;
    const visualRetry=Number(res.headers.get('x-nexus-visual-retry')||0);
    const imageTask=res.headers.get('x-nexus-image-task')||imageMode;
    const imageCaseId=res.headers.get('x-nexus-image-case-id')||'';
    const preservationLevel=res.headers.get('x-nexus-preservation')||'';
    const rootReferenceUsed=res.headers.get('x-nexus-root-reference')==='1';
    const extraReferencesUsed=Number(res.headers.get('x-nexus-extra-references')||0);
    const autoApprovedReferencesHeader=res.headers.get('x-nexus-auto-approved-references');
    const autoApprovedReferencesFinal=
      autoApprovedReferencesHeader!==null&&autoApprovedReferencesHeader!==''
        ?Number(autoApprovedReferencesHeader)
        :0;
    const identityScoreRaw=res.headers.get('x-nexus-identity-score');
    const fulfillmentScoreRaw=res.headers.get('x-nexus-fulfillment-score');
    const artifactScoreRaw=res.headers.get('x-nexus-artifact-score');
    const textScoreRaw=res.headers.get('x-nexus-text-score');
    const deterministicTextScoreRaw=res.headers.get('x-nexus-deterministic-text-score');
    const exactTextMatchesRaw=res.headers.get('x-nexus-exact-text-matches');
    const exactTextTotalRaw=res.headers.get('x-nexus-exact-text-total');
    const referenceVerified=res.headers.get('x-nexus-reference-verified')==='1';
    const referenceScoreRaw=res.headers.get('x-nexus-reference-score');
    const referenceLeakageRaw=res.headers.get('x-nexus-reference-leakage');
    const qualityGateState=res.headers.get('x-nexus-quality-gate')||'unverified';
    const qualityGateScoreRaw=res.headers.get('x-nexus-quality-gate-score');
    const qualityGateBlockersRaw=res.headers.get('x-nexus-quality-blockers')||'';
    const imageWidth=Number(res.headers.get('x-nexus-image-width')||0);
    const imageHeight=Number(res.headers.get('x-nexus-image-height')||0);
    const identityScore=identityScoreRaw!==null&&identityScoreRaw!==''?Number(identityScoreRaw):null;
    const fulfillmentScore=fulfillmentScoreRaw!==null&&fulfillmentScoreRaw!==''?Number(fulfillmentScoreRaw):null;
    const artifactScore=artifactScoreRaw!==null&&artifactScoreRaw!==''?Number(artifactScoreRaw):null;
    const textScore=textScoreRaw!==null&&textScoreRaw!==''?Number(textScoreRaw):null;
    const deterministicTextScore=deterministicTextScoreRaw!==null&&deterministicTextScoreRaw!==''?Number(deterministicTextScoreRaw):null;
    const exactTextMatches=exactTextMatchesRaw!==null&&exactTextMatchesRaw!==''?Number(exactTextMatchesRaw):null;
    const exactTextTotal=exactTextTotalRaw!==null&&exactTextTotalRaw!==''?Number(exactTextTotalRaw):null;
    const referenceScore=referenceScoreRaw!==null&&referenceScoreRaw!==''?Number(referenceScoreRaw):null;
    const referenceLeakageRisk=referenceLeakageRaw!==null&&referenceLeakageRaw!==''?Number(referenceLeakageRaw):null;
    const qualityGateScore=qualityGateScoreRaw!==null&&qualityGateScoreRaw!==''?Number(qualityGateScoreRaw):null;
    const qualityGateBlockers=qualityGateBlockersRaw
      ?qualityGateBlockersRaw.split(',').map(x=>x.trim()).filter(Boolean)
      :[];
    const candidateArenaUsed=res.headers.get('x-nexus-candidate-arena')==='1';
    const selectedImageQuality=res.headers.get('x-nexus-selected-quality')||'';
    const retryClass=res.headers.get('x-nexus-retry-class')||'';
    const retryEditStrengthRaw=res.headers.get('x-nexus-retry-edit-strength');
    const retryEditStrength=retryEditStrengthRaw!==null&&retryEditStrengthRaw!==''?Number(retryEditStrengthRaw):null;
    const imagePipeline=res.headers.get('x-nexus-image-pipeline')||'';
    const imageTotalMsRaw=res.headers.get('x-nexus-image-total-ms');
    const imageTotalMs=imageTotalMsRaw!==null&&imageTotalMsRaw!==''?Number(imageTotalMsRaw):null;
    const adaptiveUsed=res.headers.get('x-nexus-adaptive-router')==='1';
    const adaptiveScoreRaw=res.headers.get('x-nexus-adaptive-score');
    const adaptiveConfidenceRaw=res.headers.get('x-nexus-adaptive-confidence');
    const adaptiveRouter={
      adaptive:adaptiveUsed,
      selected:{
        model,
        provider,
        score:adaptiveScoreRaw!==null&&adaptiveScoreRaw!==''?Number(adaptiveScoreRaw):null,
        confidence:adaptiveConfidenceRaw!==null&&adaptiveConfidenceRaw!==''?Number(adaptiveConfidenceRaw):null
      }
    };

    const content={
      strict_edit:'Edição localizada concluída com preservação da referência.',
      enhance:'Imagem aprimorada com modo de preservação máxima.',
      remove_replace:'Remoção/substituição concluída com edição localizada.',
      background:'Fundo editado preservando o sujeito principal.',
      identity_lock:'Edição concluída com bloqueio de identidade.',
      poster:'Arte/poster gerado.',
      create:'Imagem gerada.'
    }[imageTask]||(
      imageMode==='edit'
        ?'Imagem editada mantendo a referência.'
        :'Imagem gerada.'
    );

    const patch={
      role:'assistant',
      content,
      media,
      model,
      provider,
      promptExpanded,
      promptModel,
      visualVerified,
      visualScore,
      visualRetry,
      imageTask,
      imageCaseId,
      preservationLevel,
      identityScore,
      fulfillmentScore,
      artifactScore,
      textScore,
      deterministicTextScore,
      exactTextMatches,
      exactTextTotal,
      referenceVerified,
      referenceScore,
      referenceLeakageRisk,
      qualityGateState,
      qualityGateScore,
      qualityGateBlockers,
      candidateArenaUsed,
      selectedImageQuality,
      retryClass,
      retryEditStrength,
      imagePipeline,
      imageTotalMs,
      imageWidth,
      imageHeight,
      visualRootKey:visualRootKey||media.key||null,
      rootReferenceUsed,
      extraReferencesUsed,
      autoApprovedReferencesUsed:autoApprovedReferencesFinal,
      adaptiveRouter,
      imageChainId,
      generationMode:imageMode,
      imageJobId:imageJobId||null,
      imageJobStatus:'complete',
      imageJobResumed:res.headers.get('x-nexus-image-resumed')==='1'
    };

    if(messageId){
      updateMessage(tid,messageId,patch);
    }else{
      addMessage(tid,patch);
    }

    if(imageJobId){
      ackImageJob(imageJobId,tid);
    }

    return patch;
  }

  async function resumePendingImageJob(tid,message){
    const jobId=message?.imageJobId;
    if(!jobId||message?.imageJobStatus==='complete')return;
    if(imageJobsInFlight.current.has(jobId))return;

    imageJobsInFlight.current.add(jobId);

    try{
      updateMessage(tid,message.id,{
        imageJobStatus:'running',
        content:'Gerando imagem em segundo plano… você pode sair desta conversa.'
      });

      await pollImageJob(jobId,tid);
      const res=await fetchImageJobResult(jobId,tid);

      await consumeImageResponse({
        tid,
        messageId:message.id,
        res,
        imageChainId:message.imageChainId||null,
        visualRootKey:message.visualRootKey||null,
        imageJobId:jobId
      });
    }catch(e){
      if(e?.imageJobStatus==='errored'){
        updateMessage(tid,message.id,{
          imageJobStatus:'errored',
          content:e.message||'A geração de imagem falhou.'
        });
      }else{
        updateMessage(tid,message.id,{
          imageJobStatus:'pending',
          content:'A geração continua em segundo plano. Vou recuperar a imagem quando a conexão/tela voltar.'
        });
      }
    }finally{
      imageJobsInFlight.current.delete(jobId);
    }
  }

  function resumeAllPendingImageJobs(){
    const currentThreads=threadsRef.current||[];
    for(const t of currentThreads){
      for(const message of t.messages||[]){
        if(
          message?.role==='assistant' &&
          message?.imageJobId &&
          message?.imageJobStatus!=='complete' &&
          message?.imageJobStatus!=='errored'
        ){
          void resumePendingImageJob(t.id,message);
        }
      }
    }
  }

  async function pollTask(taskId,timeoutMs=120000){
    const started=Date.now();
    let delay=900;

    while(Date.now()-started<timeoutMs){
      const res=await fetch('/api/tasks/'+encodeURIComponent(taskId),{
        headers:{'x-nexus-client':getClientId()}
      });
      const data=await res.json();

      if(!res.ok)throw new Error(data.error||'Falha ao consultar tarefa.');

      if(data.status==='complete'){
        return data.output||{};
      }

      if(data.status==='errored'||data.status==='terminated'){
        throw new Error(
          data.error?.message||
          'A tarefa de raciocínio não conseguiu terminar.'
        );
      }

      await new Promise(resolve=>setTimeout(resolve,delay));
      delay=Math.min(1800,delay+150);
    }

    throw new Error('O raciocínio demorou além do limite de espera.');
  }

  async function refreshMemoryIfNeeded(tid,current){
    const messages=current?.messages||[];
    const previousSummary=current?.summary||'';
    const summaryUpTo=Number(current?.summaryUpTo||0);
    const keepRecent=30;
    const target=Math.max(0,messages.length-keepRecent);

    if(target-summaryUpTo<15){
      return {summary:previousSummary,summaryUpTo};
    }

    const chunk=messages
      .slice(summaryUpTo,target)
      .filter(m=>(m.role==='user'||m.role==='assistant')&&typeof m.content==='string')
      .map(m=>({
        role:m.role,
        content:m.content+(m.attachmentText?'\n\nContexto de '+(m.fileName||'arquivo')+':\n'+m.attachmentText.slice(0,30000):'')
      }));

    if(!chunk.length)return {summary:previousSummary,summaryUpTo};

    try{
      const res=await fetch('/api/memory',{
        method:'POST',
        headers:apiHeaders(),
        body:JSON.stringify({
          previousSummary,
          messages:chunk,
          sessionId:tid
        })
      });
      const data=await res.json();
      const summary=data.summary||previousSummary;
      if(summary){
        setThreads(p=>p.map(t=>t.id===tid?{
          ...t,
          summary,
          summaryUpTo:target
        }:t));
        return {summary,summaryUpTo:target};
      }
    }catch{}

    return {summary:previousSummary,summaryUpTo};
  }

  async function onFileSelected(e){
    const files=Array.from(e.target.files||[]);
    e.target.value='';
    if(!files.length)return;

    const maxImage=5*1024*1024;
    const maxText=2*1024*1024;
    const maxDocument=4*1024*1024;

    try{
      if(
        mode==='image' &&
        files.length>1 &&
        files.every(file=>file.type.startsWith('image/'))
      ){
        const selected=files.slice(0,4);
        if(selected.some(file=>file.size>maxImage)){
          window.alert('Use imagens de até 5 MB cada.');
          return;
        }

        const refs=await Promise.all(
          selected.map(async file=>({
            kind:'image',
            name:file.name,
            dataUrl:await fileToDataUrl(file),
            file,
            mime:file.type
          }))
        );

        setAttachment(refs[0]||null);
        setExtraImageRefs(refs.slice(1));
        return;
      }

      const file=files[0];

      if(file.type.startsWith('image/')){
        if(file.size>maxImage){
          window.alert('Use uma imagem de até 5 MB.');
          return;
        }
        const dataUrl=await fileToDataUrl(file);
        setAttachment({
          kind:'image',
          name:file.name,
          dataUrl,
          file,
          mime:file.type
        });
        setExtraImageRefs([]);
        return;
      }

      setExtraImageRefs([]);

      if(isRichDocument(file)){
        if(file.size>maxDocument){
          window.alert('Use um documento de até 4 MB.');
          return;
        }
        const dataUrl=await fileToDataUrl(file);
        setAttachment({
          kind:'document',
          name:file.name,
          dataUrl,
          file,
          mime:file.type
        });
        setMode('chat');
        return;
      }

      if(file.size>maxText){
        window.alert('Use um arquivo de texto de até 2 MB.');
        return;
      }
      const text=await fileToText(file);
      setAttachment({
        kind:'text',
        name:file.name,
        text:text.slice(0,100000),
        file,
        mime:file.type
      });
      setMode('chat');
    }catch{
      window.alert('Não consegui ler esse arquivo.');
    }
  }

  async function prepareAttachmentMedia(att){
    if(att?.kind!=='image'||!att.file)return null;
    try{
      const key=id();
      await saveMedia(key,att.file);
      return {type:'image',key,url:URL.createObjectURL(att.file)};
    }catch{
      return {type:'image',key:null,url:URL.createObjectURL(att.file)};
    }
  }

  async function send(){
    const text=input.trim();
    if((!text&&!attachment)||busy)return;

    const effectiveText=text||(attachment?.kind==='image'?'Analise esta imagem.':'Analise este arquivo.');
    const autoMediaMode=mode==='chat'?detectExplicitMediaIntent(effectiveText):null;
    const requestMode=autoMediaMode||mode;
    if(autoMediaMode)setMode(autoMediaMode);

    let tid=active;
    let currentThread=threads.find(t=>t.id===tid);

    if(!tid){
      const t={id:id(),title:effectiveText.slice(0,40),messages:[]};
      tid=t.id;
      currentThread=t;
      setThreads(p=>[t,...p]);
      setActive(tid);
    }

    learnFromNaturalFeedback(tid,currentThread,effectiveText);

    if(requestMode==='video'||requestMode==='codex'){
      const user={
        id:id(),
        role:'user',
        content:effectiveText,
        mode:requestMode,
        media:null,
        fileName:attachment?.name||null,
        attachmentText:null
      };

      setThreads(p=>p.map(t=>t.id===tid?{
        ...t,
        title:t.messages.length?t.title:effectiveText.slice(0,40),
        messages:[
          ...t.messages,
          user,
          {
            id:id(),
            role:'assistant',
            content:requestMode==='video'
              ?'Vídeo está pausado por enquanto para proteger custos. A infraestrutura continua pronta para reativação futura.'
              :'Codex está reservado como função futura. Por enquanto a NEXUS mantém programação pelo chat/agente atual, sem ativar uma API de coding dedicada.'
          }
        ]
      }:t));

      setInput('');
      setAttachment(null);
      setExtraImageRefs([]);
      setBusy(false);
      return;
    }

    const activeAttachment=attachment;
    const activeExtraImageRefs=extraImageRefs;
    const attachedMedia=await prepareAttachmentMedia(activeAttachment);

    const user={
      id:id(),
      role:'user',
      content:effectiveText,
      mode:requestMode,
      media:attachedMedia,
      fileName:activeAttachment?.name||null,
      attachmentText:activeAttachment?.kind==='text'?activeAttachment.text:null
    };

    setThreads(p=>p.map(t=>t.id===tid?{
      ...t,
      title:t.messages.length?t.title:effectiveText.slice(0,40),
      messages:[...t.messages,user]
    }:t));

    setInput('');
    setAttachment(null);
    setExtraImageRefs([]);
    setBusy(true);

    try{
      const memoryState=await refreshMemoryIfNeeded(tid,currentThread);
      const creativeHistory=(currentThread?.messages||[])
        .filter(m=>(m.role==='user'||m.role==='assistant')&&typeof m.content==='string')
        .slice(-16)
        .map(m=>({role:m.role,content:m.content}));

      if(requestMode==='image'){
        const previousImage=[...(currentThread?.messages||[])].reverse().find(m=>m.media?.type==='image');
        const continuePrevious=Boolean(
          !activeAttachment?.kind &&
          previousImage &&
          shouldContinueImageContext(effectiveText,true)
        );
        const imageChainId=activeAttachment?.kind==='image'
          ?id()
          :continuePrevious
            ?(previousImage?.imageChainId||id())
            :id();

        updateMessage(tid,user.id,{imageChainId});

        const sourceImageRaw=activeAttachment?.kind==='image'
          ?activeAttachment.dataUrl
          :continuePrevious?await mediaAsDataUrl(previousImage):null;

        const inheritedRootKey=
          activeAttachment?.kind==='image'
            ?attachedMedia?.key||null
            :continuePrevious
              ?(
                  previousImage?.visualRootKey||
                  previousImage?.media?.key||
                  null
                )
              :null;

        const previousMediaKey=previousImage?.media?.key||null;
        const shouldSendRootReference=
          Boolean(
            continuePrevious &&
            inheritedRootKey &&
            previousMediaKey &&
            inheritedRootKey!==previousMediaKey
          );

        const rootReferenceRaw=shouldSendRootReference
          ?await mediaKeyAsDataUrl(inheritedRootKey)
          :null;

        const rootReferenceImage=rootReferenceRaw
          ?await shrinkImageDataUrl(rootReferenceRaw,500)
          :null;

        const sourceDimensions=sourceImageRaw
          ?await imageDataUrlDimensions(sourceImageRaw)
          :null;
        const sourceImage=sourceImageRaw
          ?await shrinkImageDataUrl(sourceImageRaw,500)
          :null;

        const maxSupplementarySlots=sourceImage
          ?Math.max(0,3-(rootReferenceImage?1:0))
          :0;

        const manualReferenceImages=(
          await Promise.all(
            (activeExtraImageRefs||[])
              .slice(0,maxSupplementarySlots)
              .map(ref=>shrinkImageDataUrl(ref.dataUrl,500))
          )
        ).filter(Boolean);

        const remainingApprovedSlots=Math.max(
          0,
          maxSupplementarySlots-manualReferenceImages.length
        );

        const approvedReferenceKeys=(
          continuePrevious&&remainingApprovedSlots>0
        )
          ?selectApprovedChainReferenceKeys(
              currentThread?.messages||[],
              imageChainId,
              {
                excludeKeys:[
                  previousMediaKey,
                  inheritedRootKey
                ].filter(Boolean),
                limit:remainingApprovedSlots
              }
            )
          :[];

        const approvedReferenceImages=(
          await Promise.all(
            approvedReferenceKeys.map(async key=>{
              const raw=await mediaKeyAsDataUrl(key);
              return raw
                ?shrinkImageDataUrl(raw,500)
                :null;
            })
          )
        ).filter(Boolean);

        const extraReferenceImages=[
          ...manualReferenceImages,
          ...approvedReferenceImages
        ].slice(0,maxSupplementarySlots);

        const autoApprovedReferencesUsed=
          approvedReferenceImages.length;

        const priorImagePrompts=(currentThread?.messages||[])
          .filter(m=>m.role==='user'&&m.mode==='image');

        const sameChainPrompts=priorImagePrompts
          .filter(m=>m.imageChainId&&m.imageChainId===imageChainId);

        const previousPrompt=(
          sameChainPrompts.length
            ?sameChainPrompts
            :continuePrevious&&!previousImage?.imageChainId
              ?priorImagePrompts.slice(-3)
              :[]
        )
          .slice(-6)
          .map(m=>m.content)
          .join(' -> ');

        const imageScopedHistory=selectImageChainHistory(
          currentThread?.messages||[],
          imageChainId,
          {
            legacyContinuation:
              Boolean(
                continuePrevious &&
                !previousImage?.imageChainId
              ),
            max:12
          }
        );

        const imagePayload={
          prompt:effectiveText,
          sourceImage,
          rootReferenceImage,
          extraReferenceImages,
          autoApprovedReferenceCount:autoApprovedReferencesUsed,
          previousPrompt,
          history:imageScopedHistory,
          sessionId:tid,
          sourceWidth:sourceDimensions?.width||0,
          sourceHeight:sourceDimensions?.height||0,
          quality:wantsHighImageQuality(effectiveText)?'quality':'fast'
        };

        let directRes=null;
        const useImageWorkflow=status?.providers?.imageWorkflow!==false;

        if(useImageWorkflow){
          const imageJobId=id();
          const pendingMessage={
            id:id(),
            role:'assistant',
            content:'Preparando geração de imagem em segundo plano…',
            imageJobId,
            imageJobStatus:'starting',
            imageChainId,
            visualRootKey:inheritedRootKey||null,
            generationMode:'pending'
          };

          setThreads(p=>p.map(t=>t.id===tid?{
            ...t,
            messages:[...t.messages,pendingMessage]
          }:t));

          setBusy(false);

          let startRes=null;
          try{
            startRes=await fetch('/api/image/start',{
              method:'POST',
              headers:apiHeaders(),
              body:JSON.stringify({
                ...imagePayload,
                taskId:imageJobId
              })
            });
          }catch{
            updateMessage(tid,pendingMessage.id,{
              imageJobStatus:'pending',
              content:'A solicitação foi enviada. Vou verificar o job em segundo plano quando a conexão estabilizar.'
            });
            void resumePendingImageJob(tid,{
              ...pendingMessage,
              imageJobStatus:'pending'
            });
            return;
          }

          if(startRes.ok){
            updateMessage(tid,pendingMessage.id,{
              imageJobStatus:'running',
              content:'Gerando imagem em segundo plano… você pode sair desta conversa.'
            });
            void resumePendingImageJob(tid,{
              ...pendingMessage,
              imageJobStatus:'running'
            });
            return;
          }

          const startData=await startRes.json().catch(()=>({}));
          if(
            startRes.status===503 &&
            startData.error_kind==='image-workflow-unavailable'
          ){
            removeMessage(tid,pendingMessage.id);
          }else{
            updateMessage(tid,pendingMessage.id,{
              imageJobStatus:'errored',
              content:[
                startData.error,
                startData.provider_error
              ].filter(Boolean).join(' — ')||
              'Não consegui iniciar a geração de imagem.'
            });
            return;
          }
        }

        directRes=await fetch('/api/image',{
          method:'POST',
          headers:apiHeaders(),
          body:JSON.stringify(imagePayload)
        });

        await consumeImageResponse({
          tid,
          messageId:null,
          res:directRes,
          imageChainId,
          visualRootKey:inheritedRootKey||null
        });
      }else if(requestMode==='video'){
        const previousImage=[...(currentThread?.messages||[])].reverse().find(m=>m.media?.type==='image');
        const sourceImage=activeAttachment?.kind==='image'
          ?activeAttachment.dataUrl
          :previousImage?await mediaAsDataUrl(previousImage):null;

        const previousPrompt=(currentThread?.messages||[])
          .filter(m=>m.role==='user'&&(m.mode==='image'||m.mode==='video'))
          .slice(-8)
          .map(m=>m.content)
          .join(' -> ');

        const res=await fetch('/api/video',{
          method:'POST',
          headers:apiHeaders(),
          body:JSON.stringify({
            prompt:effectiveText,
            sourceImage,
            previousPrompt,
            history:creativeHistory,
            sessionId:tid,
            quality:wantsHighVideoQuality(effectiveText)?'quality':'fast'
          })
        });

        const type=res.headers.get('content-type')||'';
        if(!res.ok||type.includes('application/json')){
          const data=await res.json();
          throw new Error(
            [data.error,data.provider_error].filter(Boolean).join(' — ')||
            'Falha no motor de vídeo.'
          );
        }

        const blob=await res.blob();
        const media=await storeGeneratedMedia(blob,'video');
        const videoMode=res.headers.get('x-nexus-video-mode')||'text-to-video';
        const model=res.headers.get('x-nexus-model')||'';
        const provider=res.headers.get('x-nexus-provider')||'';
        const videoMethod=res.headers.get('x-nexus-video-method')||videoMode;
        const videoQuality=res.headers.get('x-nexus-video-quality')||'fast';
        const videoPlanned=res.headers.get('x-nexus-video-planned')==='1';
        const videoFallbacks=Number(res.headers.get('x-nexus-video-fallbacks')||0);

        addMessage(tid,{
          role:'assistant',
          content:videoMode==='image-to-video'
            ?'Vídeo criado a partir da imagem de referência.'
            :'Vídeo gerado.',
          media,
          model,
          provider,
          videoMethod,
          videoQuality,
          videoPlanned,
          videoFallbacks,
          generationMode:videoMode
        });
      }else if(
        requestMode==='chat' &&
        wantsAgentMode(effectiveText) &&
        status?.providers?.agentWorkflow
      ){
        const historyLimit=memoryState.summary?32:60;
        const history=(currentThread?.messages||[])
          .filter(m=>(m.role==='user'||m.role==='assistant')&&typeof m.content==='string')
          .slice(-historyLimit)
          .map(m=>({
            role:m.role,
            content:m.content+(m.attachmentText?'\n\nConteúdo do arquivo '+(m.fileName||'anexado')+':\n'+m.attachmentText:'')
          }));

        const startRes=await fetch('/api/agent/start',{
          method:'POST',
          headers:apiHeaders(),
          body:JSON.stringify({
            message:effectiveText,
            history,
            sessionId:tid,
            memorySummary:memoryState.summary||''
          })
        });
        const started=await startRes.json();
        if(!startRes.ok){
          throw new Error(started.error||started.provider_error||'Falha ao iniciar o agente.');
        }

        const result=await waitForAgent(started.id);
        addMessage(tid,{
          role:'assistant',
          content:result.answer||'O agente concluiu sem retornar texto.',
          model:result.model||'@cf/openai/gpt-oss-120b',
          provider:result.provider||'cloudflare',
          route:'agent',
          routeReason:'planner → solver → verifier'+(result.repaired?' → repair':''),
          verificationScore:result.verification?.score??null,
          toolCount:Array.isArray(result.tools)?result.tools.filter(t=>t?.ok).length:0,
          agentRepaired:Boolean(result.repaired)
        });
      }else{
        const historyLimit=memoryState.summary?32:60;
        const history=(currentThread?.messages||[])
          .filter(m=>(m.role==='user'||m.role==='assistant')&&typeof m.content==='string')
          .slice(-historyLimit)
          .map(m=>({
            role:m.role,
            content:m.content+(m.attachmentText?'\n\nConteúdo do arquivo '+(m.fileName||'anexado')+':\n'+m.attachmentText:'')
          }));

        const payloadAttachment=activeAttachment?.kind==='image'
          ?{kind:'image',name:activeAttachment.name,dataUrl:activeAttachment.dataUrl,mime:activeAttachment.mime}
          :activeAttachment?.kind==='document'
            ?{kind:'document',name:activeAttachment.name,dataUrl:activeAttachment.dataUrl,mime:activeAttachment.mime}
            :activeAttachment?.kind==='text'
              ?{kind:'text',name:activeAttachment.name,text:activeAttachment.text,mime:activeAttachment.mime}
              :null;

        const res=await fetch('/api/chat',{
          method:'POST',
          headers:apiHeaders(),
          body:JSON.stringify({
            message:effectiveText,
            mode:requestMode,
            history,
            attachment:payloadAttachment,
            sessionId:tid,
            memorySummary:memoryState.summary||''
          })
        });

        let data=await res.json();

        if(res.status===202&&data.async&&data.taskId){
          const workflowOutput=await pollTask(data.taskId);
          data={
            answer:workflowOutput.answer||'A tarefa terminou sem resposta.',
            model:workflowOutput.model||'',
            provider:workflowOutput.provider||'cloudflare-workflow',
            route:'deep-workflow',
            routeReason:data.routeReason||'raciocínio profundo durável',
            workflow:workflowOutput
          };
        }

        if(data.documentContext&&activeAttachment?.kind==='document'){
          updateMessage(tid,user.id,{attachmentText:data.documentContext});
        }

        addMessage(tid,{
          role:'assistant',
          content:data.answer||data.error||'O motor ainda não está configurado.',
          sources:data.sources||[],
          model:data.model||'',
          provider:data.provider||'',
          route:data.route||'',
          routeReason:data.routeReason||'',
          adaptiveRouter:data.adaptiveRouter||null,
          workflow:data.workflow||null
        });
      }
    }catch(e){
      addMessage(tid,{role:'assistant',content:e.message||'Falha ao conectar com o backend.'});
    }finally{
      setBusy(false);
    }
  }

  function chooseTool(m){
    if(m==='file'){
      setMode('chat');
      fileRef.current?.click();
      return;
    }
    setMode(m);
    if(m==='image'&&!input)setInput('Crie uma imagem de ');
    if(m==='search')setInput('');
    if(m==='video'||m==='codex')setInput('');
  }

  const modeLabel={
    chat:'Chat',
    search:'Pesquisa web',
    image:extraImageRefs.length>0
      ?'Imagem • '+(extraImageRefs.length+1)+' referências'
      :hasImage||attachment?.kind==='image'
        ?'Imagem • continuidade'
        :'Imagem',
    video:'Vídeo · futuro',
    codex:'Codex · futuro'
  }[mode]||'Chat';

  return <div className="app">
    <input
      ref={fileRef}
      className="hidden-file"
      type="file"
      multiple
      accept="image/*,.pdf,.docx,.xlsx,.xlsm,.xlsb,.xls,.ods,.odt,.numbers,.txt,.md,.json,.csv,.js,.jsx,.ts,.tsx,.html,.htm,.css,.py,.xml,.yaml,.yml,.log"
      onChange={onFileSelected}
    />

    <aside className={menu?'sidebar open':'sidebar'}>
      <div className="brand">
        <div className="orb">N</div>
        <div><strong>NEXUS AI</strong><span>v2.9</span></div>
        <button className="mobile-x" onClick={()=>setMenu(false)}><X size={18}/></button>
      </div>
      <button className="new" onClick={newChat}><Plus size={17}/> Nova conversa</button>
      <div className="history">
        {threads.map(t=><button key={t.id} onClick={()=>{setActive(t.id);setMenu(false)}} className={t.id===active?'active':''}>
          <MessageSquare size={15}/><span>{t.title}</span>
        </button>)}
      </div>
      <div className="sidefoot">
        <button onClick={openLearningPanel}><Settings size={16}/> Aprendizado</button>
        <div className="status"><i className={status?.providers?.chat?'ok':''}/>{status?.providers?.chat?(status?.behaviorMode==='open-contextual'?'IA na nuvem · modo aberto':'IA na nuvem conectada'):'Nenhum provedor conectado'}</div>
      </div>
    </aside>

    {learningOpen&&<div className="learning-overlay" onClick={()=>setLearningOpen(false)}>
      <section className="learning-panel" onClick={e=>e.stopPropagation()}>
        <div className="learning-head">
          <div>
            <span className="learning-eyebrow"><BrainCircuit size={14}/> Adaptive Core</span>
            <h2>Aprendizado da NEXUS</h2>
            <p>Telemetria agregada. Conteúdo bruto das conversas não aparece aqui.</p>
          </div>
          <div className="learning-head-actions">
            <button onClick={loadLearningStatus} disabled={learningBusy} title="Atualizar">
              <RefreshCw size={17} className={learningBusy?'spin':''}/>
            </button>
            <button onClick={()=>setLearningOpen(false)} title="Fechar"><X size={18}/></button>
          </div>
        </div>

        {learningStatus?.error
          ?<div className="learning-error">{learningStatus.error}</div>
          :<>
            <div className="learning-summary">
              <div><Activity size={17}/><strong>{learningStatus?.summary?.modelStats??'—'}</strong><span>modelos/rotas</span></div>
              <div><BrainCircuit size={17}/><strong>{learningStatus?.summary?.lessons??'—'}</strong><span>lições</span></div>
              <div><Sparkles size={17}/><strong>{learningStatus?.adaptiveRouter?'ON':'—'}</strong><span>Adaptive Router</span></div>
              <div><Image size={17}/><strong>{learningStatus?.summary?.imageCases??'—'}</strong><span>casos visuais</span></div>
              <div><LockKeyhole size={17}/><strong>{learningStatus?.summary?.rootReferenceCases??'—'}</strong><span>âncoras raiz</span></div>
              <div><Image size={17}/><strong>{learningStatus?.summary?.supplementaryReferenceCases??'—'}</strong><span>multi-ref</span></div>
              <div><Activity size={17}/><strong>{learningStatus?.summary?.candidateArenaCases??'—'}</strong><span>arena visual</span></div>
              <div><Sparkles size={17}/><strong>{learningStatus?.summary?.qualitySelectedCases??'—'}</strong><span>quality venceu</span></div>
              <div><FileText size={17}/><strong>{learningStatus?.summary?.exactTextPerfectCases??'—'}/{learningStatus?.summary?.exactTextCases??'—'}</strong><span>texto exato</span></div>
            </div>

            <div className="learning-section">
              <div className="learning-section-title">
                <h3>Desempenho dos modelos</h3>
                <span>qualidade ≠ falha operacional</span>
              </div>
              <div className="learning-models">
                {(learningStatus?.modelStats||[]).length
                  ?(learningStatus.modelStats||[]).slice(0,18).map((item,i)=><div className="learning-model" key={(item.kind||'')+(item.model||'')+i}>
                    <div className="learning-model-name">
                      <b>{item.kind}</b>
                      <span>{item.model||'modelo desconhecido'}</span>
                      <small>{item.provider||'provider'}</small>
                    </div>
                    <div className="learning-metrics">
                      <span title="Confiabilidade operacional">reliab. <b>{pct(item.reliabilityRate)}</b></span>
                      <span title="Aprovação explícita">👍 <b>{pct(item.explicitApproval)}</b></span>
                      <span title="Score do verificador">score <b>{pct(item.avgScore)}</b></span>
                      <span title="Latência média">lat. <b>{ms(item.avgLatencyMs)}</b></span>
                      <span title="Amostras">n <b>{item.count||0}</b></span>
                    </div>
                    {(item.operationalFailures>0||item.qualityFailures>0)&&<div className="learning-failures">
                      operacional {item.operationalFailures||0} · qualidade {item.qualityFailures||0}
                      {item.lastFailureKind?' · último: '+item.lastFailureKind:''}
                    </div>}
                  </div>)
                  :<div className="learning-empty">{learningBusy?'Carregando…':'Ainda não há amostras suficientes.'}</div>}
              </div>
            </div>

            <div className="learning-section">
              <div className="learning-section-title">
                <h3>Lições reutilizáveis</h3>
                <span>extraídas de feedback/verificação</span>
              </div>
              <div className="learning-lessons">
                {(learningStatus?.lessons||[]).length
                  ?(learningStatus.lessons||[]).slice(0,12).map((item,i)=><div className="learning-lesson" key={(item.at||0)+'-'+i}>
                    <div><b>{item.taskType}</b><span>{pct(item.confidence)} confiança</span></div>
                    {item.trigger&&<small>Quando: {item.trigger}</small>}
                    <p>{item.guidance}</p>
                  </div>)
                  :<div className="learning-empty">{learningBusy?'Carregando…':'Nenhuma lição armazenada ainda.'}</div>}
              </div>
            </div>
          </>}
      </section>
    </div>}

    <main>
      <header>
        <button className="hamb" onClick={()=>setMenu(true)}><Menu/></button>
        <div className="mode">
          <button className={mode==='chat'?'sel':''} onClick={()=>setMode('chat')}>Chat</button>
          <button className={mode==='search'?'sel':''} onClick={()=>setMode('search')}><Search size={14}/> Pesquisar</button>
          <button className={mode==='image'?'sel':''} onClick={()=>setMode('image')}><Image size={14}/> Imagem</button>
          <button className={mode==='video'?'sel future-tab':''} onClick={()=>setMode('video')}><Video size={14}/> Vídeo <small>Futuro</small></button>
          <button className={mode==='codex'?'sel future-tab':''} onClick={()=>setMode('codex')}><Code2 size={14}/> Codex <small>Futuro</small></button>
        </div>
        <span className="cloud">☁ nuvem</span>
      </header>

      <section className="chat">
        {(mode==='video'||mode==='codex')
          ?<div className="future-feature">
            <div className="future-icon">{mode==='video'?<Video/>:<Code2/>}</div>
            <span className="future-badge"><LockKeyhole size={12}/> Futuro</span>
            <h2>{mode==='video'?'Geração de vídeo':'Codex / Agente de código'}</h2>
            <p>
              {mode==='video'
                ?'A infraestrutura foi preservada, mas a geração está pausada por enquanto porque o custo por teste ainda é alto.'
                :'A aba está reservada para um agente de programação mais completo. O chat atual continua capaz de analisar e escrever código sem ativar uma API dedicada mais cara.'}
            </p>
            <div className="future-note">
              Foco da versão atual: <strong>texto + imagens + arquivos + Learning Loop</strong>.
            </div>
          </div>
          :!thread?.messages?.length
          ?<div className="hero">
            <div className="hero-orb"><Sparkles/></div>
            <h1>O que vamos descobrir?</h1>
            <p>Foco atual: chat inteligente, pesquisa, arquivos, visão, imagens e aprendizado contínuo. Vídeo e Codex ficam preparados para uma fase futura.</p>
            <div className="actions">
              {starterActions.map(({icon:Icon,label,mode:m})=><button key={label} onClick={()=>chooseTool(m)}><Icon size={18}/>{label}</button>)}
            </div>
          </div>
          :<div className="messages">
            {thread.messages.map((m,i)=><div className={'msg '+m.role} key={m.id||i}>
              <div className="avatar">{m.role==='user'?'V':'N'}</div>
              <div>
                {m.role==='assistant'
                  ?<div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content||''}</ReactMarkdown></div>
                  :<div className="plain-content">{m.content}</div>}
                {m.fileName&&<div className="file-tag"><Paperclip size={12}/>{m.fileName}</div>}
                {m.media?.type==='image'&&m.media.url&&<img className="generated" src={m.media.url} alt="Imagem"/>}
                {m.media?.type==='video'&&m.media.url&&<video className="generated" src={m.media.url} controls/>}
                {m.imageJobStatus&&m.imageJobStatus!=='complete'&&<div className={'image-job-state '+m.imageJobStatus}>
                  <div>
                    <RefreshCw size={14} className={m.imageJobStatus==='running'||m.imageJobStatus==='starting'?'spin':''}/>
                    <span>{m.imageJobStatus==='errored'?'A geração parou.':'Job de imagem salvo na nuvem'}</span>
                  </div>
                  {m.imageJobStatus!=='errored'&&<button onClick={()=>resumePendingImageJob(thread.id,m)}>Verificar agora</button>}
                </div>}
                {m.model&&<div className="model-tag">{m.promptExpanded?'✨ Prompt otimizado · ':''}{m.route?m.route+' · ':''}{m.provider?m.provider+' · ':''}{m.model}{m.imagePipeline?' · '+(m.imagePipeline.startsWith('fast')?'⚡ ':'')+m.imagePipeline:''}{m.imageJobResumed?' · ↻ retomado':''}{Number.isFinite(m.imageTotalMs)?' · '+(m.imageTotalMs>=1000?(m.imageTotalMs/1000).toFixed(1)+'s':Math.round(m.imageTotalMs)+'ms'):''}{m.imageTask?' · 🖼 '+m.imageTask:''}{m.preservationLevel?' · preservação '+m.preservationLevel:''}{m.rootReferenceUsed?' · 🔒 âncora raiz':''}{m.extraReferencesUsed>0?' · +'+m.extraReferencesUsed+' ref'+(m.extraReferencesUsed>1?'s':''):''}{m.adaptiveRouter?.adaptive?' · 🧠 adaptativo':''}{Number.isFinite(m.adaptiveRouter?.selected?.confidence)?' · confiança '+Math.round(m.adaptiveRouter.selected.confidence*100)+'%':''}{Number.isFinite(m.verificationScore)?' · verificação '+Math.round(m.verificationScore*100)+'%':''}{m.toolCount>0?' · '+m.toolCount+' ferramenta'+(m.toolCount>1?'s':''):''}{m.agentRepaired?' · reparado':''}{Number.isFinite(m.visualScore)?' · visual '+Math.round(m.visualScore*100)+'%':''}{Number.isFinite(m.identityScore)?' · identidade '+Math.round(m.identityScore*100)+'%':''}{Number.isFinite(m.fulfillmentScore)?' · pedido '+Math.round(m.fulfillmentScore*100)+'%':''}{Number.isFinite(m.artifactScore)?' · artefatos '+Math.round(m.artifactScore*100)+'%':''}{Number.isFinite(m.textScore)?' · texto '+Math.round(m.textScore*100)+'%':''}{Number.isFinite(m.exactTextTotal)&&m.exactTextTotal>0?' · texto exato '+(m.exactTextMatches??0)+'/'+m.exactTextTotal:''}{Number.isFinite(m.referenceScore)?' · referência '+Math.round(m.referenceScore*100)+'%':''}{Number.isFinite(m.referenceLeakageRisk)?' · vazamento '+Math.round(m.referenceLeakageRisk*100)+'%':''}{m.qualityGateState==='pass'?' · ✅ gate '+(Number.isFinite(m.qualityGateScore)?Math.round(m.qualityGateScore*100)+'%':'OK'):m.qualityGateState==='fail'?' · ⚠ gate '+(Number.isFinite(m.qualityGateScore)?Math.round(m.qualityGateScore*100)+'%':'falhou'):''}{m.candidateArenaUsed?' · 🥊 arena visual':''}{m.selectedImageQuality?' · selecionado '+m.selectedImageQuality:''}{m.retryClass?' · retry '+m.retryClass:''}{m.visualRetry>0?' · '+m.visualRetry+' retry visual'+(m.visualRetry>1?'s':''):''}{m.imageWidth>0&&m.imageHeight>0?' · '+m.imageWidth+'×'+m.imageHeight:''}{m.videoPlanned?' · video planner':''}{m.videoQuality==='quality'?' · qualidade máxima':''}{m.videoFallbacks>0?' · '+m.videoFallbacks+' fallback'+(m.videoFallbacks>1?'s':''):''}</div>}
                {m.role==='assistant'&&<div className="feedback-row">
                  <button
                    className={m.feedback==='positive'?'active':''}
                    title="Isso ficou bom — ensinar a NEXUS"
                    onClick={()=>submitMessageFeedback(m,i,'positive')}
                  ><ThumbsUp size={13}/></button>
                  <button
                    className={m.feedback==='negative'?'active negative':''}
                    title="Isso ficou ruim — ensinar a NEXUS"
                    onClick={()=>submitMessageFeedback(m,i,'negative')}
                  ><ThumbsDown size={13}/></button>
                  {m.feedbackLessonStored&&<span>lição aprendida</span>}
                  {m.feedbackCaseUpdated&&<span>caso visual atualizado</span>}
                </div>}
                {m.sources?.length>0&&<div className="sources">
                  {m.sources.slice(0,8).map((s,j)=><a href={s.url} target="_blank" rel="noreferrer" key={j}>{j+1}. {s.title||s.url}</a>)}
                </div>}
              </div>
            </div>)}
            {busy&&<div className="msg assistant"><div className="avatar">N</div><div className="typing"><b/><b/><b/></div></div>}
          </div>
        }
      </section>

      {mode!=='video'&&mode!=='codex'&&<div className="composer-wrap">
        <div className="composer">
          {(attachment||extraImageRefs.length>0)&&<div className="attachment-stack">
            {attachment&&<div className="attachment-chip">
              {attachment.kind==='image'
                ?<img src={attachment.dataUrl} alt="Anexo principal"/>
                :<FileText size={18}/>}
              <span>{attachment.name}</span>
              {attachment.kind==='image'&&extraImageRefs.length>0&&<small>principal</small>}
              <button
                onClick={()=>{
                  if(extraImageRefs.length){
                    setAttachment(extraImageRefs[0]);
                    setExtraImageRefs(p=>p.slice(1));
                  }else{
                    setAttachment(null);
                  }
                }}
                title="Remover"
              ><X size={15}/></button>
            </div>}
            {extraImageRefs.map((ref,index)=><div className="attachment-chip reference-chip" key={ref.name+'-'+index}>
              <img src={ref.dataUrl} alt={'Referência '+(index+1)}/>
              <span>{ref.name}</span>
              <small>ref {index+1}</small>
              <button
                onClick={()=>setExtraImageRefs(p=>p.filter((_,i)=>i!==index))}
                title="Remover referência"
              ><X size={15}/></button>
            </div>)}
          </div>}
          <textarea
            value={input}
            onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}}
            placeholder={mode==='search'?'Pesquise qualquer coisa na web…':mode==='image'?(hasImage||attachment?.kind==='image'?'Descreva a mudança na imagem…':'Descreva a imagem…'):mode==='video'?'Descreva o vídeo…':'Pergunte qualquer coisa…'}
            rows="1"
          />
          <div className="composebar">
            <div>
              <button title={mode==='image'?'Anexar até 4 imagens de referência':'Anexar arquivo ou imagem'} onClick={()=>fileRef.current?.click()}><Paperclip size={19}/></button>
              <span>{modeLabel}</span>
            </div>
            <button className="send" disabled={(!input.trim()&&!attachment)||busy} onClick={send}><Send size={18}/></button>
          </div>
        </div>
        <small>Processamento pesado na nuvem. Seu dispositivo apenas envia e exibe os resultados.</small>
      </div>}
    </main>
  </div>
}

createRoot(document.getElementById('root')).render(<App/>);
