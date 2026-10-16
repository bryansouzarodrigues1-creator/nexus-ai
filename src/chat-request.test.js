import assert from "node:assert/strict";
import { fetchChatJson } from "./chat-request.js";
const ok=await fetchChatJson("/api/chat",{},1000,async()=>new Response('{"answer":"Olá"}',{headers:{"content-type":"application/json"}}));
assert.equal(ok.data.answer,"Olá");
await assert.rejects(
  fetchChatJson("/api/chat",{},30,(_url,{signal})=>new Promise((_,reject)=>{
    signal.addEventListener("abort",()=>reject(new Error("aborted")),{once:true});
  })),
  /demorou mais que o limite/
);
console.log("chat HTTP timeout tests passed");
