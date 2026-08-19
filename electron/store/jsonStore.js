const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const { normalizeWindowOpacity } = require('../windows/windowOpacity');

/**
 * JsonStore provides a centralized persistence layer for the application.
 * It manages various JSON files for tasks, history, personas, and configuration.
 * This is the Single Source of Truth for on-disk data.
 */
class JsonStore {
  constructor() {
    this.userDataPath = app.getPath('userData');
    
    this.paths = {
      tasks: path.join(this.userDataPath, 'tasks.json'),
      history: path.join(this.userDataPath, 'chat_history.json'),
      tokens: path.join(this.userDataPath, 'tokens.json'),
      susurro: path.join(this.userDataPath, 'susurro_history.json'),
      personas: path.join(this.userDataPath, 'personas.json'),
      settings: path.join(this.userDataPath, 'settings.json'),
      sessions: path.join(this.userDataPath, 'sessions.json'),
      interviewSessions: path.join(this.userDataPath, 'interview_sessions.json'),
      interviewDocuments: path.join(this.userDataPath, 'interview_documents.json')
    };

    /** Default settings schema */
    const defaultSettings = {
      audio: {
        inputDeviceId: 'default',
        outputDeviceId: 'default',
        micEnabled: true,
        micVolume: 100,
        systemAudioEnabled: true,
        systemAudioVolume: 100
      },
      general: {
        openaiApiKey: '',
        tavilyApiKey: '',
        stealthMode: true,
        windowOpacity: 0.9,
        dreamingEnabled: true,
        dreamingModel: 'gpt-5.6-luna'
      },
      hermes: {
        enabled: false,
        baseUrl: 'http://127.0.0.1:8642',
        apiKey: '',
        sessionKey: 'hades-default',
        model: 'hermes-agent',
        timeoutMs: 30000,
        maxContextChars: 3200,
        meetingSummaryMaxChars: 12000,
        useAsPrimaryAgent: true,
        useForExternalActions: true,
        useForMemory: true,
        autoForwardConversations: false,
        autoForwardTasksPersonas: false,
        autoSummarizeMeetings: true
      },
      assistant: {
        mode: 'auto',
        delegationEnabled: true,
        compactContext: true,
        preferredAnswerStyle: 'auto'
      },
      interview: {
        mode: 'meeting',
        title: '',
        description: '',
        role: '',
        company: '',
        topics: '',
        resume: '',
        jobDescription: '',
        language: 'pt-BR',
        answerStyle: 'natural',
        transcriptionProvider: 'whisper-local',
        extraInstructions: '',
        transcribeMicrophone: false,
        saveTranscript: true,
        retainAudio: true,
        contextDocumentIds: []
      },
      layout: {
        commandBounds: null,
        floatingHeadBounds: null
      },
      shortcuts: {
        toggleCommand: 'Alt+D',
        toggleSettings: 'Alt+S',
        toggleSusurro: 'Alt+B',
        toggleVoice: 'Alt+V',
        selectedTextActions: 'Alt+E',
        interviewQuickAnswer: 'F4',
        interviewCaptureScreen: 'F5'
      }
    };

    /** In-memory cache of stored data */
    this.cache = {
      tasks: [],
      chatHistory: [],
      personas: [],
      susurroHistory: [],
      sessions: [],
      interviewSessions: [],
      interviewDocuments: [],
      totalTokens: 0,
      settings: defaultSettings
    };

    this._defaultSettings = defaultSettings;

    this.loadAll();
  }

  /**
   * Helper to encrypt settings string
   * @private
   */
  encrypt(text) {
    try {
      const algorithm = 'aes-256-cbc';
      const key = crypto.scryptSync(os.userInfo().username || 'hades', 'hades-salt-secure', 32);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return iv.toString('hex') + ':' + encrypted;
    } catch (e) {
      console.error('[STORE] Encryption error:', e.message);
      return text;
    }
  }

  /**
   * Helper to decrypt settings string
   * @private
   */
  decrypt(text) {
    try {
      if (!text.includes(':')) return text; // Probably not encrypted yet
      const parts = text.split(':');
      const iv = Buffer.from(parts.shift(), 'hex');
      const encryptedText = Buffer.from(parts.join(':'), 'hex');
      const algorithm = 'aes-256-cbc';
      const key = crypto.scryptSync(os.userInfo().username || 'hades', 'hades-salt-secure', 32);
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (e) {
      console.error('[STORE] Decryption error (falling back to raw):', e.message);
      return text;
    }
  }

  /**
   * Safely loads and optionally decrypts the settings file.
   * @private
   */
  safeLoadSettings() {
    const filePath = this.paths.settings;
    try {
      if (fs.existsSync(filePath)) {
        const rawContent = fs.readFileSync(filePath, 'utf8').trim();
        if (!rawContent) return {};
        
        // Try parsing directly (if plain JSON)
        try {
          return JSON.parse(rawContent);
        } catch (e) {
          // If direct parsing fails, it's encrypted, so decrypt it
          const decrypted = this.decrypt(rawContent);
          return JSON.parse(decrypted);
        }
      }
    } catch (e) {
      console.error(`[STORE] Load settings error for ${path.basename(filePath)}:`, e.message);
    }
    return {};
  }

  /**
   * Safely encrypts and saves the settings file.
   * @private
   */
  safeSaveSettings(data) {
    const filePath = this.paths.settings;
    try {
      const serialized = JSON.stringify(data, null, 2);
      const encrypted = this.encrypt(serialized);
      fs.writeFileSync(filePath, encrypted, 'utf8');
    } catch (e) {
      console.error(`[STORE] Save settings error for ${path.basename(filePath)}:`, e.message);
    }
  }

  /**
   * Loads all files from disk into memory.
   * @private
   */
  loadAll() {
    this.cache.tasks = this.safeLoad(this.paths.tasks, []);
    this.cache.chatHistory = this.safeLoad(this.paths.history, []);
    this.cache.personas = this.safeLoad(this.paths.personas, []);
    this.cache.susurroHistory = this.safeLoad(this.paths.susurro, []);
    this.cache.sessions = this.safeLoad(this.paths.sessions, []);
    this.cache.interviewSessions = this.safeLoad(this.paths.interviewSessions, []);
    this.cache.interviewDocuments = this.safeLoad(this.paths.interviewDocuments, []);
    this.cache.totalTokens = this.safeLoad(this.paths.tokens, { total: 0 }).total || 0;
    // Deep merge so new keys from defaultSettings survive missing fields in saved file
    const saved = this.safeLoadSettings();
    this.cache.settings = {
      audio: { ...this._defaultSettings.audio, ...(saved.audio || {}) },
      general: { ...this._defaultSettings.general, ...(saved.general || {}) },
      hermes: { ...this._defaultSettings.hermes, ...(saved.hermes || {}) },
      assistant: { ...this._defaultSettings.assistant, ...(saved.assistant || {}) },
      interview: { ...this._defaultSettings.interview, ...(saved.interview || {}) },
      layout: { ...this._defaultSettings.layout, ...(saved.layout || {}) },
      shortcuts: { ...this._defaultSettings.shortcuts, ...(saved.shortcuts || {}) }
    };
    const captureProtectionNeedsMigration = this.cache.settings.general.stealthMode !== true;
    this.cache.settings.general.stealthMode = true;
    this.cache.settings.general.windowOpacity = normalizeWindowOpacity(
      this.cache.settings.general.windowOpacity
    );
    this.cache.settings.interview.transcriptionProvider = 'whisper-local';
    delete this.cache.settings.general.apiKey;
    delete this.cache.settings.general.minichatModel;
    delete this.cache.settings.general.sttModel;
    delete this.cache.settings.general.fullTranscriptionModel;
    if (!saved.general?.localWhisperDefaultMigrated) {
      this.cache.settings.interview.transcriptionProvider = 'whisper-local';
      if (this.cache.settings.interview.language === 'auto') {
        this.cache.settings.interview.language = 'pt-BR';
      }
      this.cache.settings.general.localWhisperDefaultMigrated = true;
      this.safeSaveSettings(this.cache.settings);
    }

    if (!saved.general?.openAiDreamingMigrated) {
      if (!saved.general?.dreamingModel || !String(saved.general.dreamingModel).startsWith('gpt-')) {
        this.cache.settings.general.dreamingModel = 'gpt-5.6-luna';
      }
      this.cache.settings.general.openAiDreamingMigrated = true;
      this.safeSaveSettings(this.cache.settings);
    } else if (captureProtectionNeedsMigration) {
      this.safeSaveSettings(this.cache.settings);
    }

    if (!saved.general?.retainAudioDefaultEnabledMigrated) {
      this.cache.settings.interview.retainAudio = true;
      this.cache.settings.general.retainAudioDefaultEnabledMigrated = true;
      this.safeSaveSettings(this.cache.settings);
    }

    // Populate env variables from settings for backward compatibility & frontend access
    process.env.VITE_TAVILY_API_KEY = this.cache.settings.general.tavilyApiKey || '';
  }

  /**
   * Safely loads a JSON file, returning a default value if it fails.
   * @private
   */
  safeLoad(filePath, defaultValue) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (e) {
      console.error(`[STORE] Load error for ${path.basename(filePath)}:`, e.message);
    }
    return defaultValue;
  }

  /**
   * Safely saves data to a JSON file.
   * @private
   */
  safeSave(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error(`[STORE] Save error for ${path.basename(filePath)}:`, e.message);
    }
  }

  // --- Data Accessors ---

  getTasks() { return this.cache.tasks; }
  saveTasks(tasks) {
    this.cache.tasks = tasks;
    this.safeSave(this.paths.tasks, tasks);
  }

  getChatHistory() { return this.cache.chatHistory; }
  saveChatHistory(history) {
    this.cache.chatHistory = history;
    this.safeSave(this.paths.history, history);
  }

  getPersonas() { return this.cache.personas; }
  savePersonas(personas) {
    this.cache.personas = personas;
    this.safeSave(this.paths.personas, personas);
  }

  getSusurroHistory() { return this.cache.susurroHistory; }
  saveSusurroHistory(history) {
    this.cache.susurroHistory = history;
    this.safeSave(this.paths.susurro, history);
  }

  getSessions() { return this.cache.sessions; }
  saveSessions(sessions) {
    this.cache.sessions = sessions;
    this.safeSave(this.paths.sessions, sessions);
  }

  getInterviewSessions() { return this.cache.interviewSessions; }
  saveInterviewSessions(sessions) {
    this.cache.interviewSessions = sessions;
    this.safeSave(this.paths.interviewSessions, sessions);
  }

  getInterviewDocuments() { return this.cache.interviewDocuments; }
  saveInterviewDocuments(documents) {
    this.cache.interviewDocuments = documents;
    this.safeSave(this.paths.interviewDocuments, documents);
  }

  getTotalTokens() { return this.cache.totalTokens; }
  saveTokens(total) {
    this.cache.totalTokens = total;
    this.safeSave(this.paths.tokens, { total });
  }

  getSettings() { return this.cache.settings; }
  saveSettings(settings = {}) {
    const nextSettings = {
      audio: { ...this._defaultSettings.audio, ...(settings.audio || {}) },
      general: { ...this._defaultSettings.general, ...(settings.general || {}) },
      hermes: { ...this._defaultSettings.hermes, ...(settings.hermes || {}) },
      assistant: { ...this._defaultSettings.assistant, ...(settings.assistant || {}) },
      interview: {
        ...this._defaultSettings.interview,
        ...(this.cache.settings.interview || {}),
        ...(settings.interview || {})
      },
      layout: {
        ...this._defaultSettings.layout,
        ...(this.cache.settings.layout || {}),
        ...(settings.layout || {})
      },
      shortcuts: { ...this._defaultSettings.shortcuts, ...(settings.shortcuts || {}) }
    };
    nextSettings.general.stealthMode = true;
    nextSettings.general.windowOpacity = normalizeWindowOpacity(
      nextSettings.general.windowOpacity
    );
    nextSettings.interview.transcriptionProvider = 'whisper-local';
    delete nextSettings.general.apiKey;
    delete nextSettings.general.minichatModel;
    delete nextSettings.general.sttModel;
    delete nextSettings.general.fullTranscriptionModel;

    this.cache.settings = nextSettings;
    this.safeSaveSettings(nextSettings);
    process.env.VITE_TAVILY_API_KEY = nextSettings.general.tavilyApiKey || '';
  }
}

module.exports = new JsonStore();
