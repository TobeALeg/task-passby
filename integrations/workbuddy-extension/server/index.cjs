const {createServer}=require('node:net');
const {mkdir,chmod,unlink}=require('node:fs/promises');
const {join}=require('node:path');
const {homedir}=require('node:os');
const pending=new Map(); let sequence=0;
function invoke(method,...args){return new Promise((resolve,reject)=>{
 const id=`worket-${++sequence}`;
 const timer=setTimeout(()=>{pending.delete(id);reject(new Error('WORKBUDDY_TIMEOUT'));},30000);
 pending.set(id,{resolve,reject,timer});
 process.send({type:'invoke:request',requestId:id,channel:`wb:conversations:${method}`,args:[null,...args]});
});}
process.on('message',message=>{
 if(message?.type!=='invoke:response')return;
 const call=pending.get(message.requestId); if(!call)return;
 clearTimeout(call.timer);pending.delete(message.requestId);
 if(message.error)call.reject(new Error(JSON.stringify(message.error)));else call.resolve(message.result);
});
const handle=input=>require('./handler.cjs')(input,invoke);
const socketPath=join(homedir(),'.workpet','workbuddy.sock');
(async()=>{
 await mkdir(join(homedir(),'.workpet'),{recursive:true,mode:0o700});
 await unlink(socketPath).catch(error=>{if(error.code!=='ENOENT')throw error;});
 const server=createServer(socket=>{
  let data='';socket.setTimeout(60000,()=>socket.destroy());
  socket.on('data',chunk=>{
   data+=chunk;if(data.length>8192){socket.destroy();return;}
   if(!data.includes('\n'))return;
   socket.removeAllListeners('data');
   Promise.resolve().then(()=>handle(JSON.parse(data.trim()))).then(result=>socket.end(JSON.stringify({result})+'\n'),error=>socket.end(JSON.stringify({error:error.message})+'\n'));
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
 await chmod(socketPath,0o600);
 process.send({type:'wb-extension-ready'});
 process.on('disconnect',()=>{server.close();process.exit(0);});
})().catch(error=>{console.error(error.message);process.exit(1);});
