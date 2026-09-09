const {summary,visibleThread}=require('./visible.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
module.exports=async function handle(input,invoke){
 if(input.method==='status')return {protocol:1,capabilities:['list','read']};
 if(input.method==='list'){
  const page=Number.isInteger(input.page)&&input.page>0?input.page:1;
  const result=await invoke('list',{page,size:30,transport:'local'});
  if(!Array.isArray(result?.items))throw new Error('WORKBUDDY_INCOMPATIBLE: missing conversation list');
  if(result.partial&&result.items.length===0)throw new Error('WORKBUDDY_LIST_UNAVAILABLE');
  return {threads:result.items.map(summary),nextCursor:page*30<result.total?String(page+1):null};
 }
 if(input.method==='read'){
  if(typeof input.id!=='string'||!input.id||input.id.length>200)throw new Error('INVALID_CONVERSATION_ID');
  const snapshot=await invoke('get',input.id);
  if(!snapshot?.info||snapshot.info.id!==input.id)throw new Error('WORKBUDDY_CONVERSATION_NOT_FOUND');
  const deadline=Date.now()+25000;
  let ready;
  do {
   ready=await invoke('requestEntries',input.id,{});
   if(ready?.historyReady)break;
   await pause(150);
  }while(Date.now()<deadline);
  if(!ready?.historyReady)throw new Error('WORKBUDDY_HISTORY_NOT_READY');
  let result=await invoke('requests',input.id,{});
  const requests=new Map();let anchor;
  for(let page=0;page<500;page++){
   if(!Array.isArray(result?.items))throw new Error('WORKBUDDY_INCOMPATIBLE: missing visible requests');
   for(const request of result.items)requests.set(request.id,request);
   if(!result.hasOlder)return visibleThread(snapshot.info,[...requests.values()]);
   const oldest=[...requests.values()].sort((a,b)=>(a.requestSeq-b.requestSeq)||(a.timestamp-b.timestamp))[0]?.id;
   if(!oldest||oldest===anchor)throw new Error('WORKBUDDY_HISTORY_INCOMPLETE');
   anchor=oldest;
   result=await invoke('requests',input.id,{beforeRequestId:anchor});
  }
  throw new Error('WORKBUDDY_HISTORY_TOO_LARGE');
 }
 throw new Error('UNKNOWN_METHOD');
};
