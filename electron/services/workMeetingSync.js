const {payload,fingerprint,transcript}=require('./workMeetingPayload');
function createSyncer({store,request,summarize}){
 let running=null;
 function update(id,state){const sessions=store.getInterviewSessions();const i=sessions.findIndex(s=>s.id===id);if(i<0)return;sessions[i]={...sessions[i],workSync:{...sessions[i].workSync,...state}};store.saveInterviewSessions(sessions);}
 async function syncOne(candidate,force){
  if(candidate.status!=='completed'||!candidate.config?.workspaceId||candidate.isTestMode)return;
  if(!force&&candidate.workSync?.nextAttemptAt>Date.now())return;
  let session=candidate;
  if(!session.summary&&!session.hermesMemory?.summary&&transcript(session)){
   try{await summarize(session.id);}catch{/* Persisted pending status below; never fabricate a summary. */}
   session=store.getInterviewSessions().find(s=>s.id===session.id)||session;
  }
  const data=payload(session),hash=fingerprint(data),previous=session.workSync||{};
  if(previous.status==='synced'&&previous.hash===hash)return;
  const revision=(previous.revision||0)+(previous.hash===hash?0:1)||1;
  const attempts=(previous.attempts||0)+1;
  update(session.id,{status:'sending',hash,revision,attempts,error:null});
  try{
   const result=await request('/api/v1/integrations/metis/meetings/'+encodeURIComponent(session.id),{method:'PUT',body:JSON.stringify({...data,source_revision:revision})},session.config.workspaceId);
   const ready=result.status==='ready';
   update(session.id,{status:ready?'synced':'pending_summary',learningId:result.learning_id||null,syncedAt:ready?new Date().toISOString():null,error:ready?null:'Resumo ainda não disponível. Configure o provedor ou gere o resumo e tente novamente.',nextAttemptAt:ready?0:Date.now()+Math.min(3600000,30000*2**Math.min(attempts,7))});
  }catch{update(session.id,{status:'failed',error:'Falha ao sincronizar. Confira conexão/credencial do workspace e tente novamente.',nextAttemptAt:Date.now()+Math.min(3600000,30000*2**Math.min(attempts,7))});}
 }
 function syncPending(force=false){if(running)return running;running=(async()=>{for(const s of [...store.getInterviewSessions()])await syncOne(s,force);return store.getInterviewSessions().filter(s=>s.config?.workspaceId).map(s=>({id:s.id,status:s.workSync?.status||'pending',error:s.workSync?.error}));})().finally(()=>{running=null;});return running;}
 return {syncPending};
}
let instance;
function defaultSyncer(){if(!instance)instance=createSyncer({store:require('../store/jsonStore'),request:(...args)=>require('./workSyncService').request(...args),summarize:id=>require('./interviewService').summarizeSession(id)});return instance;}
module.exports={createSyncer,syncPending:(force=true)=>defaultSyncer().syncPending(force),schedule:()=>{const timer=setTimeout(()=>defaultSyncer().syncPending(false).catch(()=>{}),500);timer.unref?.();}};
