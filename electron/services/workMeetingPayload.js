const crypto=require('node:crypto');
function transcript(session){return(session.transcript||[]).map(t=>`${t.source||'fala'}: ${String(t.text||'')}${String(t.pendingText||'')}`.trim()).join('\n');}
function payload(session){if(!session.config?.workspaceId)throw new Error('Reunião sem workspace explícito');return {workspace:session.config.workspaceId,title:session.title||'Reunião',summary:session.summary||session.hermesMemory?.summary||session.mcpMemory?.summary||null,...(session.config.syncTranscript?{transcript:transcript(session)}:{}),start:session.startedAt||session.createdAt,end:session.endedAt||session.updatedAt,action_items:session.actionItems||[],...(session.config.learnAfterFinish?{learn:true}:{})};}
function fingerprint(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
module.exports={payload,transcript,fingerprint};
