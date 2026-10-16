import assert from "node:assert/strict";
import { getChatProviderStatus, availableChatProviders, callExternalChat, noteProviderResult, isProviderCoolingDown } from "./chat-providers.js";
const env={ GROQ_API_KEY:"groq-secret", GEMINI_API_KEY:"google-secret", OPENROUTER_API_KEY:"router-secret", AI:{}, HF_TOKEN:"hf" };
assert.equal(availableChatProviders(env).length,3);
assert.deepEqual(availableChatProviders(env,{vision:true}).map(x=>x.name),["gemini","openrouter"]);
assert(availableChatProviders(env,{quickReply:true})[0].model.includes("20b"));
assert.equal(getChatProviderStatus(env).cloudflare,true);
let called=0;
const result=await callExternalChat(availableChatProviders(env)[0],[{role:"user",content:"Oi"}],{timeoutMs:1000},async (url,options)=>{
  called++;
  assert.equal(url,"https://api.groq.com/openai/v1/chat/completions");
  assert(options.headers.Authorization.includes("groq-secret"));
  return new Response(JSON.stringify({ choices:[{message:{content:"Olá, Bryan!"}}] }),{status:200});
});
assert.equal(called,1);
assert(result.ok);
assert.equal(JSON.parse(result.raw).choices[0].message.content,"Olá, Bryan!");
const bad=await callExternalChat(availableChatProviders(env)[1],[],{},async()=>new Response('{"error":{"message":"quota exhausted"}}',{status:429}));
assert.equal(bad.ok,false);
noteProviderResult("gemini",bad,1000);
assert.equal(isProviderCoolingDown("gemini",2000),true);
noteProviderResult("gemini",{ok:true},3000);
assert.equal(isProviderCoolingDown("gemini",3001),false);
const broke=await callExternalChat(availableChatProviders(env)[2],[],{timeoutMs:250},()=>new Promise(()=>{}));
assert.equal(broke.status,504);
noteProviderResult("huggingface",{ok:false,status:402,raw:"You have no remaining credits."},5000);
assert.equal(isProviderCoolingDown("huggingface",7000),true);
const cut = await callExternalChat(
  availableChatProviders(env)[0],
  [{role:"user",content:"Explique detalhadamente"}],
  {maxTokens:1150},
  async (_url,request)=>{
    assert.equal(JSON.parse(request.body).max_tokens,1150);
    return new Response(JSON.stringify({
      choices:[{message:{content:"1. Introdução"},finish_reason:"length"}]
    }),{status:200});
  }
);
assert.equal(JSON.parse(cut.raw).choices[0].finish_reason,"length");
console.log("backup provider tests passed");
