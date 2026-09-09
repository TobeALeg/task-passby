import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {visibleThread}=require('../../integrations/workbuddy-extension/server/visible.cjs');
const handle=require('../../integrations/workbuddy-extension/server/handler.cjs');
const info={id:'session',title:'工作标题',createdAt:100,updatedAt:200,space:{cwd:'/tmp'}};
const request=(id:string,n:number)=>({id,requestSeq:n,timestamp:100+n,userMessage:{content:[{type:'text',text:`user ${n}`}]},assistantMessage:{state:'completed',content:[{type:'reasoning',text:'SECRET THOUGHT'},{type:'text',text:`answer ${n}`},{type:'tool',toolCallId:id,toolName:'Read',rawInput:{path:'/tmp/a'},rawOutput:'visible result'},{type:'file',path:'/tmp/a'}]}});
test('WorkBuddy visible projection excludes reasoning and streaming replies but preserves tool evidence and files',()=>{
 const data=request('r',1);const first=visibleThread(info,[data]);
 assert.equal(JSON.stringify(first).includes('SECRET THOUGHT'),false);
 assert.deepEqual(first.events.map((e:any)=>e.kind),['user.prompt','agent.response','tool.call','tool.result','artifact.added']);
 assert.match(first.events[2].content,/Read/);
 assert.equal(new Set(first.events.map((e:any)=>e.externalId)).size,5);
 data.assistantMessage.state='streaming';
 assert.deepEqual(visibleThread(info,[data]).events.map((e:any)=>e.kind),['user.prompt']);
 assert.deepEqual(visibleThread(info,[request('r',1)]),first);
});
test('WorkBuddy history reads all older pages and rejects stalled pagination',async()=>{
 const calls:any[]=[];
 const invoke=async(method:string,...args:any[])=>{
  calls.push([method,...args]);
  if(method==='get')return {info};
  if(method==='requestEntries')return {historyReady:true};
  return args[1]?.beforeRequestId?{items:[request('older',1),request('newer',2)],hasOlder:false}:{items:[request('newer',2)],hasOlder:true};
 };
 const result=await handle({method:'read',id:'session'},invoke);
 assert.deepEqual(result.events.filter((e:any)=>e.kind==='user.prompt').map((e:any)=>e.content),['user 1','user 2']);
 assert.equal(calls.filter(c=>c[0]==='requests').length,2);
 await assert.rejects(()=>handle({method:'read',id:'session'},async(method:string)=>method==='get'?{info}:method==='requestEntries'?{historyReady:true}:{items:[request('stuck',1)],hasOlder:true}),/INCOMPLETE/);
});
