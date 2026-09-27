import React, {useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Search, Plus, Paperclip, Image, Video, FileText, Send, Settings, MessageSquare, Globe2, Sparkles, Menu, X} from 'lucide-react';
import './styles.css';

const starterActions=[
  {icon:Globe2,label:'Pesquisar na web',mode:'search'},
  {icon:FileText,label:'Analisar arquivo',mode:'file'},
  {icon:Image,label:'Criar imagem',mode:'image'},
  {icon:Video,label:'Criar vídeo',mode:'video'},
];

function id(){return crypto.randomUUID?.() || Math.random().toString(36).slice(2)}
function App(){
  const [threads,setThreads]=useState(()=>JSON.parse(localStorage.getItem('nexus_threads')||'[]'));
  const [active,setActive]=useState(threads[0]?.id||null);
  const [input,setInput]=useState('');
  const [mode,setMode]=useState('chat');
  const [busy,setBusy]=useState(false);
  const [menu,setMenu]=useState(false);
  useEffect(()=>localStorage.setItem('nexus_threads',JSON.stringify(threads)),[threads]);
  const thread=useMemo(()=>threads.find(t=>t.id===active),[threads,active]);

  function newChat(){const t={id:id(),title:'Nova conversa',messages:[]};setThreads(p=>[t,...p]);setActive(t.id);setMenu(false)}
  async function send(){
    const text=input.trim(); if(!text||busy)return;
    let tid=active; let current=thread;
    if(!tid){const t={id:id(),title:text.slice(0,40),messages:[]};tid=t.id;current=t;setThreads(p=>[t,...p]);setActive(tid)}
    const user={role:'user',content:text};
    setThreads(p=>p.map(t=>t.id===tid?{...t,title:t.messages.length?t.title:text.slice(0,40),messages:[...t.messages,user]}:t));
    setInput('');setBusy(true);
    try{
      const res=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:text,mode})});
      const data=await res.json();
      const reply={role:'assistant',content:data.answer||data.error||'O motor ainda não está configurado.'};
      setThreads(p=>p.map(t=>t.id===tid?{...t,messages:[...t.messages,reply]}:t));
    }catch{
      const reply={role:'assistant',content:'O frontend está funcionando. Falta conectar um provedor gratuito no backend /api/chat.'};
      setThreads(p=>p.map(t=>t.id===tid?{...t,messages:[...t.messages,reply]}:t));
    }finally{setBusy(false)}
  }

  return <div className="app">
    <aside className={menu?'sidebar open':'sidebar'}>
      <div className="brand"><div className="orb">N</div><div><strong>NEXUS AI</strong><span>v0.1</span></div><button className="mobile-x" onClick={()=>setMenu(false)}><X size={18}/></button></div>
      <button className="new" onClick={newChat}><Plus size={17}/> Nova conversa</button>
      <div className="history">{threads.map(t=><button key={t.id} onClick={()=>{setActive(t.id);setMenu(false)}} className={t.id===active?'active':''}><MessageSquare size={15}/><span>{t.title}</span></button>)}</div>
      <div className="sidefoot"><button><Settings size={16}/> Configurações</button><div className="status"><i/>Arquitetura pronta • provedor pendente</div></div>
    </aside>
    <main>
      <header><button className="hamb" onClick={()=>setMenu(true)}><Menu/></button><div className="mode"><button className={mode==='chat'?'sel':''} onClick={()=>setMode('chat')}>Chat</button><button className={mode==='search'?'sel':''} onClick={()=>setMode('search')}><Search size={14}/> Pesquisar</button></div><span className="cloud">☁ nuvem</span></header>
      <section className="chat">
        {!thread?.messages?.length ? <div className="hero"><div className="hero-orb"><Sparkles/></div><h1>O que vamos descobrir?</h1><p>Converse, pesquise, analise arquivos e use ferramentas em uma única interface.</p><div className="actions">{starterActions.map(({icon:Icon,label,mode:m})=><button key={label} onClick={()=>{setMode(m==='search'?'search':'chat');setInput(m==='image'?'Crie uma imagem de ':m==='video'?'Crie um vídeo de ':m==='file'?'Analise este arquivo: ':label)}}><Icon size={18}/>{label}</button>)}</div></div>
        : <div className="messages">{thread.messages.map((m,i)=><div className={'msg '+m.role} key={i}><div className="avatar">{m.role==='user'?'V':'N'}</div><div>{m.content}</div></div>)}{busy&&<div className="msg assistant"><div className="avatar">N</div><div className="typing"><b/><b/><b/></div></div>}</div>}
      </section>
      <div className="composer-wrap"><div className="composer"><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} placeholder={mode==='search'?'Pesquise qualquer coisa na web…':'Pergunte qualquer coisa…'} rows="1"/><div className="composebar"><div><button title="Anexar"><Paperclip size={19}/></button><span>{mode==='search'?'Pesquisa web':'Chat'}</span></div><button className="send" disabled={!input.trim()||busy} onClick={send}><Send size={18}/></button></div></div><small>Os motores de IA, imagem e vídeo são plugáveis e ficam no servidor — nenhuma chave é exposta no navegador.</small></div>
    </main>
  </div>
}
createRoot(document.getElementById('root')).render(<App/>);
