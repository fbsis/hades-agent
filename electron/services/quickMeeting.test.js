import { describe, it, expect, vi } from 'vitest';
import quick from './quickMeeting.js';
const config = { workSync: { lastWorkspace: 'other', workspaces: [{ id: 'client', name: 'Client' }, { id: 'other', name: 'Other' }] } };
function setup(sessions = []) {
  const show = vi.fn(), notify = vi.fn();
  const coordinator = quick.createQuickMeeting({ getSettings: () => config, getSessions: () => sessions, show, notify, id: () => 'request-1', now: () => new Date('2026-10-29T10:00:00Z') });
  return { coordinator, show, notify };
}
describe('quick meetings', () => {
  it('locks the actual client, records locally and waits for completion to learn', () => {
    const { coordinator, show, notify } = setup();
    expect(coordinator.request('client')).toEqual({ queued: true });
    const request = coordinator.peek();
    expect(request.config).toMatchObject({ workspaceId: 'client', company: 'Client', quickMeeting: true, learnAfterFinish: true, retainAudio: true, saveTranscript: true, transcribeMicrophone: true, syncTranscript: false, contextDocumentIds: [] });
    expect(show).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(request);
    coordinator.acknowledge('wrong-request');
    expect(coordinator.peek()).toBe(request);
    coordinator.acknowledge('request-1');
    expect(coordinator.peek()).toBeNull();
  });
  it('coalesces pending launches instead of starting overlapping recordings', () => {
    const { coordinator, show } = setup();
    coordinator.request('client');
    expect(() => coordinator.request('other')).toThrow('andamento');
    expect(show).toHaveBeenCalledOnce();
  });
  it('does not interrupt an active meeting or accept an unknown company', () => {
    expect(() => setup([{ status: 'active' }]).coordinator.request('client')).toThrow('andamento');
    expect(() => setup().coordinator.request('unknown')).toThrow('Empresa');
  });
  it('derives company from the owning main-frame window, not arguments or last selection', () => {
    const frame = { url: 'https://work.example/?desktop_workspace=other' };
    const sender = { mainFrame: frame };
    const event = { sender, senderFrame: frame };
    const windows = new Map([['client:notes:second-window', { webContents: sender, isDestroyed: () => false }]]);
    expect(quick.workspaceForEvent(event, windows, 'https://work.example')).toBe('client');
    expect(() => quick.workspaceForEvent({ ...event, senderFrame: { url: frame.url } }, windows, 'https://work.example')).toThrow('Frame');
    frame.url = 'https://attacker.example/';
    expect(() => quick.workspaceForEvent(event, windows, 'https://work.example')).toThrow('autorizada');
  });
  it('rejects unmapped windows even on the configured server', () => {
    const frame = { url: 'https://work.example/' }, sender = { mainFrame: null };
    sender.mainFrame = frame;
    expect(() => quick.workspaceForEvent({ sender, senderFrame: frame }, new Map(), 'https://work.example')).toThrow('autorizada');
  });
});
