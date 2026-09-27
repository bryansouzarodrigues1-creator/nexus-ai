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
function App(){
  const [threads,setThreads]=useState(()=>JSON.parse(localStorage.getItem('nexus_threads')||'[]'));
  const [active,setActive]=useState(threads[0]?.id||null);
  const [input,setInput]=useState('');
  const [mode,setMode]=useState('chat');
  const [busy,setBusy]=useState(false);
  const [menu,setMenu]=useState(false);
  const [status,setStatus]=useState(null);

  useEffect(()=>{localStorage.setItem('nexus_threads',JSON.stringify(threads.map(t=>({...t,messages:t.messages.map(m=>({...m,media:null}))}))))},[threads]);
  useEffect(()=>{fetch('/api/status').then(r=>r.json()).then(setStatus).catch(()=>{})},[]);
  const thread=useMemo(()=>threads.find(t=>t.id===active),[threads,active]);

  function newChat(){const t={id:id(),title:'Nova conversa',messages:[]};setThreads(p=>[t,...p]);setActive(t.id);setMenu(false)}
  function addMessage(tid,msg){setThreads(p=>p.map(t=>t.id===tid?{...t,messages:[...t.messages,msg]}:t))}

  async function send(){
    const text=input.trim(); if(!text||busy)return;
    let tid=active;
    if(!tid){const t={id:id(),title:text.slice(0,40),messages:[]};tid=t.id;setThreads(p=>[t,...p]);setActive(tid)}
    const user={role:'user',content:text,mode};
    setThreads(p=>p.map(t=>t.id===tid?{...t,title:t.messages.length?t.title:text.slice(0,40),messages:[...t.messages,user]}:t));
    setInput('');setBusy(true);
    try{
      if(mode==='image'||mode==='video'){
        const endpoint=mode==='image'?'/api/image':'/api/video';
        const res=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:text})});
        const type=res.headers.get('content-type')||'';
        if(!res.ok||type.includes('application/json')){
          const data=await res.json(); throw new Error(data.error||'Falha no motor.');
        }
        const blob=await res.blob();
        const url=URL.createObjectURL(blob);
        addMessage(tid,{role:'assistant',content:mode==='image'?'Imagem gerada.':'Vídeo gerado.',media:{type:mode,url}});
      }else{
        const currentThread=threads.find(t=>t.id===tid);
        const history=(currentThread?.messages||[])
          .filter(m=>(m.role==='user'||m.role==='assistant')&&typeof m.content==='string')
          .slice(-20)
          .map(m=>({role:m.role,content:m.content}));
        const res=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:text,mode,history})});
        const data=await res.json();
        addMessage(tid,{role:'assistant',content:data.answer||data.error||'O motor ainda não está configurado.',sources:data.sources||[]});
      }
    }catch(e){
      addMessage(tid,{role:'assistant',content:e.message||'Falha ao conectar com o backend.'});
    }finally{setBusy(false)}
  }

  function chooseTool(m){
    if(m==='file'){setMode('chat');setInput('Analise este arquivo: ');return}
    setMode(m);
    if(m==='image')setInput('Crie uma imagem de ');
    if(m==='video')setInput('Crie um vídeo de ');
    if(m==='search')setInput('');
  }

  const modeLabel={chat:'Chat',search:'Pesquisa web',image:'Imagem',video:'Vídeo'}[mode]||'Chat';

  return <div className="app">
    <aside className={menu?'sidebar open':'sidebar'}>
      <div className="brand"><div className="orb">N</div><div><strong>NEXUS AI</strong><span>v0.4</span></div><button className="mobile-x" onClick={()=>setMenu(false)}><X size={18}/></button></div>
      <button className="new" onClick={newChat}><Plus size={17}/> Nova conversa</button>
      <div className="history">{threads.map(t=><button key={t.id} onClick={()=>{setActive(t.id);setMenu(false)}} className={t.id===active?'active':''}><MessageSquare size={15}/><span>{t.title}</span></button>)}</div>
      <div className="sidefoot"><button><Settings size={16}/> Configurações</button><div className="status"><i/>{status?.providers?.chat?'IA conectável':'Aguardando segredo HF_TOKEN'}</div></div>
    </aside>
    <main>
      <header>
        <button className="hamb" onClick={()=>setMenu(true)}><Menu/></button>
        <div className="mode">
          <button className={mode==='chat'?'sel':''} onClick={()=>setMode('chat')}>Chat</button>
          <button className={mode==='search'?'sel':''} onClick={()=>setMode('search')}><Search size={14}/> Pesquisar</button>
          <button className={mode==='image'?'sel':''} onClick={()=>setMode('image')}><Image size={14}/> Imagem</button>
          <button className={mode==='video'?'sel':''} onClick={()=>setMode('video')}><Video size={14}/> Vídeo</button>
        </div><span className="cloud">☁ nuvem</span>
      </header>
      <section className="chat">
        {!thread?.messages?.length?<div className="hero"><div className="hero-orb"><Sparkles/></div><h1>O que vamos descobrir?</h1><p>Chat, pesquisa, imagem e vídeo em uma única interface.</p><div className="actions">{starterActions.map(({icon:Icon,label,mode:m})=><button key={label} onClick={()=>chooseTool(m)}><Icon size={18}/>{label}</button>)}</div></div>
        :<div className="messages">{thread.messages.map((m,i)=><div className={'msg '+m.role} key={i}><div className="avatar">{m.role==='user'?'V':'N'}</div><div>{m.content}{m.media?.type==='image'&&<img className="generated" src={m.media.url} alt="Imagem gerada"/>}{m.media?.type==='video'&&<video className="generated" src={m.media.url} controls/>}{m.sources?.length>0&&<div className="sources">{m.sources.slice(0,5).map((s,j)=><a href={s.url} target="_blank" rel="noreferrer" key={j}>{j+1}. {s.title||s.url}</a>)}</div>}</div></div>)}{busy&&<div className="msg assistant"><div className="avatar">N</div><div className="typing"><b/><b/><b/></div></div>}</div>}
      </section>
      <div className="composer-wrap"><div className="composer"><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} placeholder={mode==='search'?'Pesquise qualquer coisa na web…':mode==='image'?'Descreva a imagem…':mode==='video'?'Descreva o vídeo…':'Pergunte qualquer coisa…'} rows="1"/><div className="composebar"><div><button title="Anexar"><Paperclip size={19}/></button><span>{modeLabel}</span></div><button className="send" disabled={!input.trim()||busy} onClick={send}><Send size={18}/></button></div></div><small>Processamento na nuvem. Tokens permanecem no servidor.</small></div>
    </main>
  </div>
}
createRoot(document.getElementById('root')).render(<App/>);
