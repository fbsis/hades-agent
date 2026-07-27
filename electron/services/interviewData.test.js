import { describe, expect, it } from 'vitest';
import dataModule from './interviewData.js';

const { legacyHistoryToInterviewSession } = dataModule;

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
