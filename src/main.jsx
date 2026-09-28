import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Search,Plus,Paperclip,Image,Video,FileText,Send,Settings,MessageSquare,Globe2,Sparkles,Menu,X} from 'lucide-react';
import './styles.css';

const starterActions=[
  {icon:Globe2,label:'Pesquisar na web',mode:'search'},
  {icon:FileText,label:'Analisar arquivo',mode:'file'},
  {icon:Image,label:'Criar imagem',mode:'image'},
  {icon:Video,label:'Criar vídeo',mode:'video'},
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
      resolve(canvas.toDataURL('image/jpeg',0.9));
    };
    img.onerror=()=>resolve(dataUrl);
    img.src=dataUrl;
  });
}

function wantsFreshImage(text){
  return /\b(nova imagem|imagem nova|do zero|comece do zero|outra imagem|sem relação|reinicie|recomece)\b/i.test(text);
}

function wantsHighImageQuality(text){
  return /\b(máxima qualidade|maxima qualidade|ultra.?real|ultrareal|foto.?real|fotorreal|photoreal|high.?fidelity|cinemat|8k|4k|extremamente detalhad|qualidade máxima|qualidade maxima)\b/i.test(text);
}

function isRichDocument(file){
  return /\.(pdf|docx|xlsx|xlsm|xlsb|xls|ods|odt|numbers)$/i.test(file?.name||'');
}

function wantsAgentMode(text){
  return /(intensidade máxima|intensidade maxima|modo máximo|modo maximo|analise profundamente|análise profunda|investigue profundamente|investigue tudo|auditoria profunda|arquitetura completa|diagnóstico profundo|diagnostico profundo|compare em detalhes|monte um plano completo|raciocine profundamente|pense muito|complexidade máxima|complexidade maxima)/i.test(String(text||""));
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
  const fileRef=useRef(null);

  useEffect(()=>{
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
    const file=e.target.files?.[0];
    e.target.value='';
    if(!file)return;

    const maxImage=5*1024*1024;
    const maxText=2*1024*1024;
    const maxDocument=4*1024*1024;

    try{
      if(file.type.startsWith('image/')){
        if(file.size>maxImage){window.alert('Use uma imagem de até 5 MB.');return}
        const dataUrl=await fileToDataUrl(file);
        setAttachment({kind:'image',name:file.name,dataUrl,file,mime:file.type});
        return;
      }

      if(isRichDocument(file)){
        if(file.size>maxDocument){window.alert('Use um documento de até 4 MB.');return}
        const dataUrl=await fileToDataUrl(file);
        setAttachment({kind:'document',name:file.name,dataUrl,file,mime:file.type});
        setMode('chat');
        return;
      }

      if(file.size>maxText){window.alert('Use um arquivo de texto de até 2 MB.');return}
      const text=await fileToText(file);
      setAttachment({kind:'text',name:file.name,text:text.slice(0,100000),file,mime:file.type});
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

    const activeAttachment=attachment;
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
    setBusy(true);

    try{
      const memoryState=await refreshMemoryIfNeeded(tid,currentThread);
      const creativeHistory=(currentThread?.messages||[])
        .filter(m=>(m.role==='user'||m.role==='assistant')&&typeof m.content==='string')
        .slice(-16)
        .map(m=>({role:m.role,content:m.content}));

      if(requestMode==='image'){
        const previousImage=[...(currentThread?.messages||[])].reverse().find(m=>m.media?.type==='image');
        const continuePrevious=Boolean(previousImage&&!wantsFreshImage(effectiveText));
        const sourceImageRaw=activeAttachment?.kind==='image'
          ?activeAttachment.dataUrl
          :continuePrevious?await mediaAsDataUrl(previousImage):null;
        const sourceImage=sourceImageRaw
          ?await shrinkImageDataUrl(sourceImageRaw,500)
          :null;

        const previousPrompt=(currentThread?.messages||[])
          .filter(m=>m.role==='user'&&m.mode==='image')
          .slice(-6)
          .map(m=>m.content)
          .join(' -> ');

        const res=await fetch('/api/image',{
          method:'POST',
          headers:apiHeaders(),
          body:JSON.stringify({
            prompt:effectiveText,
            sourceImage,
            previousPrompt,
            history:creativeHistory,
            sessionId:tid,
            quality:wantsHighImageQuality(effectiveText)?'quality':'fast'
          })
        });

        const type=res.headers.get('content-type')||'';
        if(!res.ok||type.includes('application/json')){
          const data=await res.json();
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

        const content=imageMode==='edit'
          ?'Imagem editada mantendo a referência.'
          :imageMode==='continuity-fallback'
            ?'Imagem gerada mantendo o contexto visual possível.'
            :'Imagem gerada.';

        addMessage(tid,{
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
          generationMode:imageMode
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
            sessionId:tid
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
        const promptExpanded=res.headers.get('x-nexus-prompt-expanded')==='1';
        const promptModel=res.headers.get('x-nexus-prompt-model')||'';

        addMessage(tid,{
          role:'assistant',
          content:videoMode==='image-to-video'?'Vídeo criado a partir da imagem de referência.':'Vídeo gerado.',
          media,
          model,
          provider,
          promptExpanded,
          promptModel,
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
          verificationScore:result.verification?.score??null
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
    if(m==='video'&&!input)setInput('Crie um vídeo de ');
    if(m==='search')setInput('');
  }

  const modeLabel={
    chat:'Chat',
    search:'Pesquisa web',
    image:hasImage||attachment?.kind==='image'?'Imagem • continuidade':'Imagem',
    video:hasImage||attachment?.kind==='image'?'Vídeo • imagem de referência':'Vídeo'
  }[mode]||'Chat';

  return <div className="app">
    <input
      ref={fileRef}
      className="hidden-file"
      type="file"
      accept="image/*,.pdf,.docx,.xlsx,.xlsm,.xlsb,.xls,.ods,.odt,.numbers,.txt,.md,.json,.csv,.js,.jsx,.ts,.tsx,.html,.htm,.css,.py,.xml,.yaml,.yml,.log"
      onChange={onFileSelected}
    />

    <aside className={menu?'sidebar open':'sidebar'}>
      <div className="brand">
        <div className="orb">N</div>
        <div><strong>NEXUS AI</strong><span>v1.3</span></div>
        <button className="mobile-x" onClick={()=>setMenu(false)}><X size={18}/></button>
      </div>
      <button className="new" onClick={newChat}><Plus size={17}/> Nova conversa</button>
      <div className="history">
        {threads.map(t=><button key={t.id} onClick={()=>{setActive(t.id);setMenu(false)}} className={t.id===active?'active':''}>
          <MessageSquare size={15}/><span>{t.title}</span>
        </button>)}
      </div>
      <div className="sidefoot">
        <button><Settings size={16}/> Configurações</button>
        <div className="status"><i className={status?.providers?.chat?'ok':''}/>{status?.providers?.chat?(status?.behaviorMode==='open-contextual'?'IA na nuvem · modo aberto':'IA na nuvem conectada'):'Nenhum provedor conectado'}</div>
      </div>
    </aside>

    <main>
      <header>
        <button className="hamb" onClick={()=>setMenu(true)}><Menu/></button>
        <div className="mode">
          <button className={mode==='chat'?'sel':''} onClick={()=>setMode('chat')}>Chat</button>
          <button className={mode==='search'?'sel':''} onClick={()=>setMode('search')}><Search size={14}/> Pesquisar</button>
          <button className={mode==='image'?'sel':''} onClick={()=>setMode('image')}><Image size={14}/> Imagem</button>
          <button className={mode==='video'?'sel':''} onClick={()=>setMode('video')}><Video size={14}/> Vídeo</button>
        </div>
        <span className="cloud">☁ nuvem</span>
      </header>

      <section className="chat">
        {!thread?.messages?.length
          ?<div className="hero">
            <div className="hero-orb"><Sparkles/></div>
            <h1>O que vamos descobrir?</h1>
            <p>Chat inteligente, pesquisa web, visão, documentos, imagem e vídeo em uma única interface.</p>
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
                {m.model&&<div className="model-tag">{m.promptExpanded?'✨ Prompt otimizado · ':''}{m.route?m.route+' · ':''}{m.provider?m.provider+' · ':''}{m.model}{typeof m.verificationScore==='number'?' · verificação '+Math.round(m.verificationScore*100)+'%':''}{typeof m.visualScore==='number'?' · visual '+Math.round(m.visualScore*100)+'%':''}{m.visualRetry>0?' · retry visual':''}</div>}
                {m.sources?.length>0&&<div className="sources">
                  {m.sources.slice(0,8).map((s,j)=><a href={s.url} target="_blank" rel="noreferrer" key={j}>{j+1}. {s.title||s.url}</a>)}
                </div>}
              </div>
            </div>)}
            {busy&&<div className="msg assistant"><div className="avatar">N</div><div className="typing"><b/><b/><b/></div></div>}
          </div>
        }
      </section>

      <div className="composer-wrap">
        <div className="composer">
          {attachment&&<div className="attachment-chip">
            {attachment.kind==='image'
              ?<img src={attachment.dataUrl} alt="Anexo"/>
              :<FileText size={18}/>}
            <span>{attachment.name}</span>
            <button onClick={()=>setAttachment(null)} title="Remover"><X size={15}/></button>
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
              <button title="Anexar arquivo ou imagem" onClick={()=>fileRef.current?.click()}><Paperclip size={19}/></button>
              <span>{modeLabel}</span>
            </div>
            <button className="send" disabled={(!input.trim()&&!attachment)||busy} onClick={send}><Send size={18}/></button>
          </div>
        </div>
        <small>Processamento pesado na nuvem. Seu dispositivo apenas envia e exibe os resultados.</small>
      </div>
    </main>
  </div>
}

createRoot(document.getElementById('root')).render(<App/>);
