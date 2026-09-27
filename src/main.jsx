import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Search,Plus,Paperclip,Image,Video,FileText,Send,Settings,MessageSquare,Globe2,Sparkles,Menu,X} from 'lucide-react';
import './styles.css';

const starterActions=[
  {icon:Globe2,label:'Pesquisar na web',mode:'search'},
  {icon:FileText,label:'Analisar arquivo',mode:'file'},
  {icon:Image,label:'Criar imagem',mode:'image'},
  {icon:Video,label:'Criar vídeo',mode:'video'},
];

function id(){return crypto.randomUUID?.()||Math.random().toString(36).slice(2)}

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

function wantsFreshImage(text){
  return /\b(nova imagem|imagem nova|do zero|comece do zero|outra imagem|sem relação|reinicie|recomece)\b/i.test(text);
}

function App(){
  const [threads,setThreads]=useState(readThreads);
  const [active,setActive]=useState(()=>readThreads()[0]?.id||null);
  const [input,setInput]=useState('');
  const [mode,setMode]=useState('chat');
  const [busy,setBusy]=useState(false);
  const [menu,setMenu]=useState(false);
  const [status,setStatus]=useState(null);

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
    setMenu(false);
  }

  function addMessage(tid,msg){
    setThreads(p=>p.map(t=>t.id===tid?{...t,messages:[...t.messages,{id:id(),...msg}]}:t));
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

  async function send(){
    const text=input.trim();
    if(!text||busy)return;

    let tid=active;
    let currentThread=threads.find(t=>t.id===tid);

    if(!tid){
      const t={id:id(),title:text.slice(0,40),messages:[]};
      tid=t.id;
      currentThread=t;
      setThreads(p=>[t,...p]);
      setActive(tid);
    }

    const user={id:id(),role:'user',content:text,mode};
    setThreads(p=>p.map(t=>t.id===tid?{
      ...t,
      title:t.messages.length?t.title:text.slice(0,40),
      messages:[...t.messages,user]
    }:t));

    setInput('');
    setBusy(true);

    try{
      if(mode==='image'){
        const previousImage=[...(currentThread?.messages||[])].reverse().find(m=>m.role==='assistant'&&m.media?.type==='image');
        const continuePrevious=Boolean(previousImage&&!wantsFreshImage(text));
        const sourceImage=continuePrevious?await mediaAsDataUrl(previousImage):null;
        const previousPrompt=(currentThread?.messages||[])
          .filter(m=>m.role==='user'&&m.mode==='image')
          .slice(-6)
          .map(m=>m.content)
          .join(' -> ');

        const res=await fetch('/api/image',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({prompt:text,sourceImage,previousPrompt})
        });

        const type=res.headers.get('content-type')||'';
        if(!res.ok||type.includes('application/json')){
          const data=await res.json();
          throw new Error(data.error||'Falha no motor de imagem.');
        }

        const blob=await res.blob();
        const media=await storeGeneratedMedia(blob,'image');
        const imageMode=res.headers.get('x-nexus-image-mode')||'new';
        const model=res.headers.get('x-nexus-model')||'';

        const content=imageMode==='edit'
          ?'Imagem editada mantendo a anterior.'
          :imageMode==='continuity-fallback'
            ?'Imagem gerada mantendo o contexto visual possível.'
            :'Imagem gerada.';

        addMessage(tid,{role:'assistant',content,media,model,generationMode:imageMode});
      }else if(mode==='video'){
        const previousImage=[...(currentThread?.messages||[])].reverse().find(m=>m.role==='assistant'&&m.media?.type==='image');
        const sourceImage=previousImage?await mediaAsDataUrl(previousImage):null;

        const res=await fetch('/api/video',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({prompt:text,sourceImage})
        });

        const type=res.headers.get('content-type')||'';
        if(!res.ok||type.includes('application/json')){
          const data=await res.json();
          throw new Error(data.error||'Falha no motor de vídeo.');
        }

        const blob=await res.blob();
        const media=await storeGeneratedMedia(blob,'video');
        const videoMode=res.headers.get('x-nexus-video-mode')||'text-to-video';
        const model=res.headers.get('x-nexus-model')||'';
        addMessage(tid,{
          role:'assistant',
          content:videoMode==='image-to-video'?'Vídeo criado a partir da última imagem.':'Vídeo gerado.',
          media,
          model,
          generationMode:videoMode
        });
      }else{
        const history=(currentThread?.messages||[])
          .filter(m=>(m.role==='user'||m.role==='assistant')&&typeof m.content==='string')
          .slice(-32)
          .map(m=>({role:m.role,content:m.content}));

        const res=await fetch('/api/chat',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({message:text,mode,history})
        });

        const data=await res.json();
        addMessage(tid,{
          role:'assistant',
          content:data.answer||data.error||'O motor ainda não está configurado.',
          sources:data.sources||[],
          model:data.model||''
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
      setInput('Analise este arquivo: ');
      return;
    }
    setMode(m);
    if(m==='image')setInput('Crie uma imagem de ');
    if(m==='video')setInput('Crie um vídeo de ');
    if(m==='search')setInput('');
  }

  const modeLabel={
    chat:'Chat',
    search:'Pesquisa web',
    image:hasImage?'Imagem • continuidade':'Imagem',
    video:hasImage?'Vídeo • usando última imagem':'Vídeo'
  }[mode]||'Chat';

  return <div className="app">
    <aside className={menu?'sidebar open':'sidebar'}>
      <div className="brand">
        <div className="orb">N</div>
        <div><strong>NEXUS AI</strong><span>v0.6</span></div>
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
        <div className="status"><i className={status?.providers?.chat?'ok':''}/>{status?.providers?.chat?'IA na nuvem conectada':'Aguardando HF_TOKEN'}</div>
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
            <p>Chat, pesquisa, imagem e vídeo em uma única interface.</p>
            <div className="actions">
              {starterActions.map(({icon:Icon,label,mode:m})=><button key={label} onClick={()=>chooseTool(m)}><Icon size={18}/>{label}</button>)}
            </div>
          </div>
          :<div className="messages">
            {thread.messages.map((m,i)=><div className={'msg '+m.role} key={m.id||i}>
              <div className="avatar">{m.role==='user'?'V':'N'}</div>
              <div>
                <div>{m.content}</div>
                {m.media?.type==='image'&&m.media.url&&<img className="generated" src={m.media.url} alt="Imagem gerada"/>}
                {m.media?.type==='video'&&m.media.url&&<video className="generated" src={m.media.url} controls/>}
                {m.model&&<div className="model-tag">{m.model}</div>}
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
          <textarea
            value={input}
            onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}}
            placeholder={mode==='search'?'Pesquise qualquer coisa na web…':mode==='image'?(hasImage?'Descreva a mudança na última imagem…':'Descreva a imagem…'):mode==='video'?'Descreva o vídeo…':'Pergunte qualquer coisa…'}
            rows="1"
          />
          <div className="composebar">
            <div>
              <button title="Anexar"><Paperclip size={19}/></button>
              <span>{modeLabel}</span>
            </div>
            <button className="send" disabled={!input.trim()||busy} onClick={send}><Send size={18}/></button>
          </div>
        </div>
        <small>Processamento pesado na nuvem. Seu dispositivo apenas envia e exibe os resultados.</small>
      </div>
    </main>
  </div>
}

createRoot(document.getElementById('root')).render(<App/>);
