import { describe, expect, it } from 'vitest';
import dataModule from './interviewData.js';

const {
  buildFinishedSessionPatch,
  isPathInsideDirectory,
  legacyHistoryToInterviewSession,
  sessionHasContent
} = dataModule;

describe('legacy Susurro migration', () => {
  it('preserves finalized and pending text in an archived-compatible interview session', () => {
    const migrated = legacyHistoryToInterviewSession([
      {
        id: 'old-1',
        text: 'parte final ',
        pendingText: 'parte pendente',
        timestamp: '2026-07-20T10:00:00.000Z'
      },
      {
        id: 'old-2',
        text: 'segunda fala',
        timestamp: '2026-07-20T10:01:00.000Z'
      }
    ]);

    expect(migrated).toMatchObject({
      id: 'legacy-susurro',
      status: 'completed',
      startedAt: '2026-07-20T10:00:00.000Z',
      endedAt: '2026-07-20T10:01:00.000Z'
    });
    expect(migrated.transcript).toHaveLength(2);
    expect(migrated.transcript[0]).toMatchObject({
      source: 'interviewer',
      text: 'parte final parte pendente',
      pendingText: '',
      isFinal: true
    });
  });

  it('does not create an empty migrated session', () => {
    expect(legacyHistoryToInterviewSession([])).toBeNull();
    expect(legacyHistoryToInterviewSession([{ text: '', pendingText: '' }])).toBeNull();
  });
});

describe('interview lifecycle', () => {
  it('returns an empty interview to pending when it is finished', () => {
    const session = {
      status: 'active',
      startedAt: '2026-07-28T10:00:00.000Z',
      transcript: [],
      answers: [],
      audioArtifacts: []
    };

    expect(sessionHasContent(session)).toBe(false);
    expect(buildFinishedSessionPatch(session, '2026-07-28T10:05:00.000Z')).toEqual({
      status: 'pending',
      startedAt: undefined,
      endedAt: undefined,
      hasRecording: false
    });
  });

  it.each([
    [{ hasRecording: true }, 'recording'],
    [{ transcript: [{ text: 'Pergunta transcrita' }] }, 'transcript'],
    [{ answers: [{ text: 'Resposta gerada' }] }, 'answer'],
    [{ audioArtifacts: [{ bytes: 32000 }] }, 'saved audio']
  ])('completes an interview with %s', (content) => {
    const session = { transcript: [], answers: [], audioArtifacts: [], ...content };
    expect(sessionHasContent(session)).toBe(true);
    expect(buildFinishedSessionPatch(session, '2026-07-28T10:30:00.000Z')).toEqual({
      status: 'completed',
      endedAt: '2026-07-28T10:30:00.000Z'
    });
  });

  it('only allows deleting audio inside the interview recording directory', () => {
    const audioRoot = '/tmp/metis/interview-audio';
    expect(isPathInsideDirectory(audioRoot, `${audioRoot}/session-interviewer.wav`)).toBe(true);
    expect(isPathInsideDirectory(audioRoot, `${audioRoot}/../settings.json`)).toBe(false);
    expect(isPathInsideDirectory(audioRoot, '/tmp/other/session.wav')).toBe(false);
    expect(isPathInsideDirectory(audioRoot, audioRoot)).toBe(false);
  });
});
