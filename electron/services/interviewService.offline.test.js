import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import syncModule from './workMeetingSync.js';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('./interviewService.js', import.meta.url), 'utf8');
function setup(workSync) {
  let settings = { general: { openaiApiKey: 'unit-test-only' }, workSync };
  let sessions = [];
  const store = {
    getSettings: () => settings,
    saveSettings: value => { settings = value; },
    getInterviewSessions: () => sessions,
    saveInterviewSessions: value => { sessions = value; },
    getSusurroHistory: () => [],
    getInterviewDocuments: () => []
  };
  const generateText = vi.fn().mockResolvedValue({ text: 'Resumo e decisões.' });
  const dependencies = {
    '../store/jsonStore': store,
    './logger': { warn: vi.fn(), error: vi.fn() },
    './openaiResponsesService': { generateText },
    './mcpClientService': { recallMemoryContext: vi.fn().mockResolvedValue({ text: '', sources: [], failures: [] }) }
  };
  const context = {
    module: { exports: {} },
    require: name => dependencies[name] || require(name),
    setTimeout: () => ({ unref() {} })
  };
  vm.runInNewContext(source, context, { filename: 'interviewService.js' });
  return { service: context.module.exports, store, generateText };
}
const cached = { lastWorkspace: 'qad', workspaces: [{ id: 'globo' }, { id: 'qad' }] };

describe('meetings independent of the work server', () => {
  it.each([undefined, { workspaces: [] }, cached])('allows local-only sessions without guessing a workspace (%j)', work => {
    const { service } = setup(work);
    const session = service.createSession({ mode: 'meeting', workspaceId: '', retainAudio: false });
    service.upsertTurn(session.id, { id: 'turn-1', source: 'interviewer', text: 'Decidimos lançar amanhã.' });
    service.finishSession(session.id, { forceCompleted: true });
    const saved = service.getSession(session.id);
    expect(saved.status).toBe('completed');
    expect(saved.config.workspaceId).toBe('');
    expect(saved.transcript[0].text).toContain('amanhã');
  });

  it('captures and summarizes a cached company offline, retaining the session for retry', async () => {
    const { service, store, generateText } = setup(cached);
    const session = service.createSession({ mode: 'meeting', workspaceId: 'globo', retainAudio: true });
    expect(session.config.retainAudio).toBe(false);
    expect(() => service.updateSession(session.id, { config: { workspaceId: 'qad' } })).toThrow('não pode ser alterado');
    service.upsertTurn(session.id, { id: 'turn-1', source: 'interviewer', text: 'Decidimos publicar amanhã, responsável Ana.' });
    service.finishSession(session.id, { forceCompleted: true });
    await service.summarizeSession(session.id);
    expect(generateText).toHaveBeenCalledOnce();
    const request = vi.fn().mockRejectedValueOnce(new Error('work.home offline')).mockResolvedValue({ status: 'ready' });
    const sync = syncModule.createSyncer({ store, request, summarize: id => service.summarizeSession(id) });
    await sync.syncPending(true);
    expect(service.getSession(session.id).workSync.status).toBe('failed');
    expect(service.getSession(session.id).summaryProvider).toBe('openai');
    expect(service.getSession(session.id).transcript).toHaveLength(1);
    await sync.syncPending(true);
    expect(service.getSession(session.id).workSync.status).toBe('synced');
    expect(generateText).toHaveBeenCalledOnce();
  });

  it('rejects unknown explicit destinations instead of silently changing scope', () => {
    const { service } = setup(cached);
    expect(() => service.createSession({ workspaceId: 'unknown' })).toThrow('não está configurada');
  });

  it('does not upload local-only sessions', async () => {
    const { service, store } = setup(cached);
    const session = service.createSession({ workspaceId: '' });
    expect(() => service.updateSession(session.id, { config: { workspaceId: 'globo' } })).toThrow('não pode ser alterado');
    service.finishSession(session.id, { forceCompleted: true });
    const request = vi.fn();
    const sync = syncModule.createSyncer({ store, request, summarize: vi.fn() });
    await sync.syncPending(true);
    expect(request).not.toHaveBeenCalled();
  });
});
