const fs = require('node:fs');
const path = require('node:path');
const logger = require('./logger');
const sessionLogger = require('./sessionLogger');
const { getMetisDataPath } = require('./metisDataPath');
const openaiResponsesService = require('./openaiResponsesService');
const jsonStore = require('../store/jsonStore');
const {
  RECORDED_MEETING_SUMMARY_INSTRUCTIONS,
  buildRecordedMeetingSummaryInput,
  shouldSyncRecordedMeeting
} = require('./recordedMeetingMemory');

const MAX_SYNCED_DREAM_CYCLES = 10;
const HERMES_SYNC_BATCH_SIZE = 3;

function needsHermesSync(entry) {
  return !['synced', 'skipped'].includes(entry.hermesSync?.status);
}

/**
 * DreamService processes accumulated user sessions (conversations, tool calls)
 * to extract behavioral patterns, preferences, and actionable insights.
 */
class DreamService {
  constructor() {
    const userDataPath = getMetisDataPath();
    this.memoryDir = path.join(userDataPath, 'memory');
    
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
    this.activeCycle = null;
  }

  getLearningsPath() {
    return path.join(this.memoryDir, 'learnings.json');
  }

  loadLearningEntries() {
    const learningsPath = this.getLearningsPath();
    if (!fs.existsSync(learningsPath)) return [];

    try {
      const entries = JSON.parse(fs.readFileSync(learningsPath, 'utf-8'));
      if (!Array.isArray(entries)) return [];

      return entries.map((entry, index) => ({
        ...entry,
        id: entry.id || `legacy-dream-${entry.date || index}`,
        provider: entry.provider || 'legacy',
        hermesSync: entry.hermesSync || { status: 'pending', attempts: 0 }
      }));
    } catch (error) {
      logger.error('DreamService', 'Error parsing learnings.json', error);
      return [];
    }
  }

  saveLearningEntries(entries) {
    const pending = entries.filter(needsHermesSync);
    const synced = entries
      .filter(entry => !needsHermesSync(entry))
      .slice(-MAX_SYNCED_DREAM_CYCLES);
    const retained = [...pending, ...synced]
      .sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')));

    fs.writeFileSync(this.getLearningsPath(), JSON.stringify(retained, null, 2), 'utf-8');
    return retained;
  }

  async syncPendingLearnings(entries) {
    const pending = entries.filter(needsHermesSync);
    if (pending.length === 0) return entries;

    const hermesService = require('./hermesService');
    for (let index = 0; index < pending.length; index += HERMES_SYNC_BATCH_SIZE) {
      const batch = pending.slice(index, index + HERMES_SYNC_BATCH_SIZE);
      let result;

      try {
        result = await hermesService.rememberDreamLearnings(batch);
      } catch (error) {
        result = { success: false, error: error.message };
      }

      const attemptedAt = new Date().toISOString();
      batch.forEach(entry => {
        const attempts = Number(entry.hermesSync?.attempts || 0) + 1;
        entry.hermesSync = result?.success
          ? {
              status: 'synced',
              attempts,
              syncedAt: attemptedAt,
              response: String(result.text || '').slice(0, 500)
            }
          : {
              status: 'pending',
              attempts,
              lastAttemptAt: attemptedAt,
              error: result?.error || result?.reason || 'Hermes indisponivel.'
            };
      });

      if (!result?.success) {
        logger.warn('DreamService', `Hermes memory sync pending: ${result?.error || result?.reason || 'unavailable'}`);
        break;
      }
    }

    return entries;
  }

  saveRecordedMeetingMemory(sessionId, hermesMemory) {
    const sessions = jsonStore.getInterviewSessions();
    const index = sessions.findIndex(session => session.id === sessionId);
    if (index < 0) return null;

    sessions[index] = { ...sessions[index], hermesMemory };
    jsonStore.saveInterviewSessions(sessions);
    return sessions[index];
  }

  async summarizeRecordedMeeting(session, settings) {
    const cachedSummary = String(session.hermesMemory?.summary || '').trim();
    if (cachedSummary) {
      return {
        summary: cachedSummary,
        provider: session.hermesMemory?.summaryProvider || 'existing',
        model: session.hermesMemory?.summaryModel,
        responseId: session.hermesMemory?.summaryResponseId,
        usage: session.hermesMemory?.summaryUsage
      };
    }

    const existingSummary = String(session.summary || '').trim();
    if (existingSummary) {
      return { summary: existingSummary, provider: 'existing' };
    }

    const apiKey = settings?.general?.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key ausente para resumir a reuniao gravada.');

    const maxTranscriptChars = settings?.hermes?.meetingSummaryMaxChars || 12000;
    const summaryInput = buildRecordedMeetingSummaryInput(session, maxTranscriptChars);
    if (!summaryInput.transcript) throw new Error('Reuniao gravada sem transcricao para resumir.');

    const model = settings?.general?.dreamingModel || 'gpt-5.6-luna';
    const response = await openaiResponsesService.generateText({
      apiKey,
      model,
      instructions: RECORDED_MEETING_SUMMARY_INSTRUCTIONS,
      input: summaryInput.input,
      maxOutputTokens: 1000,
      reasoningEffort: 'none',
      verbosity: 'low'
    });

    return {
      summary: response.text.trim(),
      provider: 'openai',
      model: response.model || model,
      responseId: response.responseId,
      usage: response.usage
    };
  }

  async syncRecordedMeetings() {
    const candidates = jsonStore.getInterviewSessions().filter(shouldSyncRecordedMeeting);
    if (candidates.length === 0) return 0;

    const settings = jsonStore.getSettings();
    const hermesService = require('./hermesService');
    logger.info('DreamService', `Synchronizing ${candidates.length} recorded meeting(s) with Hermes memory...`);

    let synced = 0;
    for (const candidate of candidates) {
      const attemptedAt = new Date().toISOString();
      const attempts = Number(candidate.hermesMemory?.attempts || 0) + 1;
      let summaryResult;

      try {
        summaryResult = await this.summarizeRecordedMeeting(candidate, settings);
      } catch (error) {
        this.saveRecordedMeetingMemory(candidate.id, {
          ...candidate.hermesMemory,
          status: 'pending',
          attempts,
          lastAttemptAt: attemptedAt,
          error: error.message
        });
        logger.warn('DreamService', `Recorded meeting ${candidate.id} summary pending: ${error.message}`);
        continue;
      }

      const pendingMemory = {
        status: 'pending',
        attempts,
        memoryId: candidate.hermesMemory?.memoryId || `metis-recorded-session:${candidate.id}`,
        lastAttemptAt: attemptedAt,
        summary: summaryResult.summary,
        summaryProvider: summaryResult.provider,
        summaryModel: summaryResult.model,
        summaryResponseId: summaryResult.responseId,
        summaryUsage: summaryResult.usage
      };
      const summarizedSession = this.saveRecordedMeetingMemory(candidate.id, pendingMemory)
        || { ...candidate, hermesMemory: pendingMemory };

      let result;
      try {
        result = await hermesService.rememberRecordedMeeting(summarizedSession);
      } catch (error) {
        result = { success: false, error: error.message };
      }

      const sessions = jsonStore.getInterviewSessions();
      const index = sessions.findIndex(session => session.id === candidate.id);
      if (index < 0) continue;

      sessions[index] = {
        ...sessions[index],
        hermesMemory: result?.success
          ? {
              ...pendingMemory,
              status: 'synced',
              memoryId: result.memoryId || `metis-recorded-session:${candidate.id}`,
              syncedAt: attemptedAt,
              response: String(result.text || '').slice(0, 4000)
            }
          : {
              ...pendingMemory,
              status: 'pending',
              error: result?.error || result?.reason || 'Hermes indisponivel.'
            }
      };
      jsonStore.saveInterviewSessions(sessions);

      if (result?.success) {
        synced += 1;
        logger.info('DreamService', `Recorded meeting ${candidate.id} synchronized with Hermes.`);
      } else {
        logger.warn(
          'DreamService',
          `Recorded meeting ${candidate.id} remains pending: ${result?.error || result?.reason || 'unavailable'}`
        );
      }
    }

    return synced;
  }

  async runDreamCycle() {
    if (this.activeCycle) return this.activeCycle;
    this.activeCycle = this.executeDreamCycle();
    try {
      return await this.activeCycle;
    } finally {
      this.activeCycle = null;
    }
  }

  async executeDreamCycle() {
    logger.info('DreamService', 'Starting dream cycle...');
    const settings = jsonStore.getSettings();
    
    // Check if dreaming is enabled in settings
    if (settings?.general?.dreamingEnabled === false) {
      logger.info('DreamService', 'Dream cycle is disabled in settings. Skipping.');
      return;
    }

    let currentLearnings = this.loadLearningEntries();
    currentLearnings = await this.syncPendingLearnings(currentLearnings);
    currentLearnings = this.saveLearningEntries(currentLearnings);

    await this.syncRecordedMeetings();

    const sessions = sessionLogger.getUnprocessedSessions();
    if (sessions.length === 0) {
      logger.info('DreamService', 'No new sessions to process.');
      return;
    }

    try {
      const apiKey = settings?.general?.openaiApiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        logger.warn('DreamService', 'OpenAI API key missing. Cannot run dream analysis.');
        return;
      }

      logger.info('DreamService', `Analyzing ${sessions.length} sessions...`);
      
      // Combine session logs for analysis
      let combinedLogs = '';
      sessions.forEach(s => {
        try {
           const logData = JSON.stringify(s.data);
           combinedLogs += `\n--- Session ---\n${logData}\n`;
        } catch(e) {
           logger.error('DreamService', 'Error processing session data', e);
        }
      });

      // Avoid hitting token limits by truncating if necessary, 
      // but typically we'll keep the last X chars.
      if (combinedLogs.length > 50000) {
        combinedLogs = combinedLogs.substring(combinedLogs.length - 50000);
      }

      const promptTemplate = fs.readFileSync(path.join(__dirname, '../../prompts/dreamService.md'), 'utf-8');
      const prompt = promptTemplate.replace('{{combinedLogs}}', combinedLogs);

      const dreamingModel = settings?.general?.dreamingModel || 'gpt-5.6-luna';
      logger.info('DreamService', `Generating dream insights using model: ${dreamingModel}`);

      const response = await openaiResponsesService.generateText({
        apiKey,
        model: dreamingModel,
        instructions: [
          'Consolide memoria de um assistente desktop.',
          'Use somente fatos presentes nos logs.',
          'Retorne no maximo cinco bullets curtos e reutilizaveis.',
          'Se nada for relevante, retorne exatamente: Nenhum padrão novo detectado.'
        ].join(' '),
        input: prompt,
        maxOutputTokens: 700
      });

      const insightsText = response.text || 'Nenhum padrão novo detectado.';
      const insights = insightsText.split('\n').map(item => item.trim()).filter(Boolean);
      const hasNewLearnings = insights.some(item => (
        item.toLocaleLowerCase('pt-BR') !== 'nenhum padrão novo detectado.'
      ));
      const date = new Date().toISOString();
      const entry = {
         id: `dream-${date.replace(/[:.]/g, '-')}`,
         date,
         processedSessions: sessions.length,
         provider: 'openai',
         model: response.model || dreamingModel,
         responseId: response.responseId,
         usage: response.usage,
         insights,
         hermesSync: hasNewLearnings
           ? { status: 'pending', attempts: 0 }
           : { status: 'skipped', attempts: 0, reason: 'Nenhum aprendizado novo.' }
      };
      currentLearnings.push(entry);
      currentLearnings = this.saveLearningEntries(currentLearnings);

      currentLearnings = await this.syncPendingLearnings(currentLearnings);
      currentLearnings = this.saveLearningEntries(currentLearnings);

      if (entry.hermesSync?.status === 'pending') {
        logger.warn('DreamService', 'Dream insights saved locally and queued for Hermes memory retry.');
      } else if (entry.hermesSync?.status === 'synced') {
        logger.info('DreamService', 'Dream insights synchronized with Hermes persistent memory.');
      } else {
        logger.info('DreamService', 'No reusable insights found; Hermes sync skipped.');
      }

      sessions.forEach(session => sessionLogger.markSessionAsProcessed(session.file));
      logger.info('DreamService', 'Dream cycle completed successfully.');
    } catch (error) {
      logger.error('DreamService', 'Error during dream cycle', error);
    }
  }

  getLearnings() {
     const currentLearnings = this.loadLearningEntries();
     if (currentLearnings.length > 0) {
       const recentLearnings = currentLearnings.slice(-3);
       const allInsights = recentLearnings
         .flatMap(learning => learning.insights || [])
         .filter(insight => insight.toLocaleLowerCase('pt-BR') !== 'nenhum padrão novo detectado.');
       if (allInsights.length > 0) {
         return allInsights.join('\n');
       }
     }
     return 'Nenhuma memória consolidada ainda.';
  }
}

module.exports = new DreamService();
