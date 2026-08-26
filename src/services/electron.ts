import {
  ElectronAPI,
  HermesAskInput,
  HermesDocumentInput,
  HermesMemoryInput,
  HermesStreamEvent,
  IPCResponse,
  SettingsData
} from '../types/electron';
import type { OpenAIChatInput, OpenAIChatResult, OpenAIChatStreamEvent } from '../types/electron';
import type { SelectedTextPayload, TextActionRequest } from '../types/electron';
import type {
  InterviewAnswerEvent,
  InterviewAnswerVariant,
  InterviewConfig,
  InterviewSession,
  InterviewTranscriptDelta,
  InterviewTranscriptionStatus,
  TranscriptTurn
} from '../types/interview';

/**
 * Service to interact with the Electron IPC layer.
 * Provides a typed and safe wrapper around globalThis.electron.
 */
class ElectronService {
  private get electron(): ElectronAPI | undefined {
    // @ts-ignore
    return globalThis.electron;
  }

  /**
   * Helper to handle standardized IPC responses.
   * Unwraps data if success, otherwise logs error and returns fallback.
   */
  private async handleResponse<T>(
    promise: Promise<IPCResponse<T>> | undefined,
    fallback: T,
    context: string
  ): Promise<T> {
    try {
      const response = await promise;
      if (response?.success) {
        return response.data ?? fallback;
      }
      if (response?.error) {
        console.error(`[ElectronService] ${context} error:`, response.error);
      }
      return fallback;
    } catch (error) {
      console.error(`[ElectronService] ${context} exception:`, error);
      return fallback;
    }
  }

  // --- Window Control ---
  async closeWindow() { await this.handleResponse(this.electron?.closeWindow(), undefined, 'closeWindow'); }
  async minimizeWindow() { await this.handleResponse(this.electron?.minimizeWindow(), undefined, 'minimizeWindow'); }
  async minimizeToHead() { await this.handleResponse(this.electron?.minimizeToHead(), undefined, 'minimizeToHead'); }
  async quitApp() { await this.handleResponse(this.electron?.quitApp(), undefined, 'quitApp'); }
  async resizeWindow(width: number, height: number) { await this.handleResponse(this.electron?.resizeWindow(width, height), undefined, 'resizeWindow'); }
  togglePin() { this.electron?.togglePin(); }
  async isPinned() { return await this.electron?.isPinned() ?? false; }
  async isMinimized() { return await this.electron?.isMinimized() ?? false; }
  async isMaximized() { return await this.electron?.isMaximized() ?? false; }
  startResizing() { this.electron?.startResizing(); }
  showSettings() { this.electron?.showSettings(); }
  showSusurro() { this.electron?.showSusurro(); }
  floatingHeadClick() { this.electron?.floatingHeadClick(); }
  moveFloatingHead(delta: { x: number; y: number }) { this.electron?.moveFloatingHead(delta); }
  toggleMic(enabled: boolean) { this.electron?.toggleMic(enabled); }
  toggleAudio(enabled: boolean) { this.electron?.toggleAudio(enabled); }

  // --- Messaging ---
  sendMessage(text: string, image?: string | null) { this.electron?.sendMessage(text, image); }
  showNotification(text: string) { this.electron?.showNotification(text); }
  onNewChatMessage(callback: (msg: string, img?: string) => void) {
    return this.electron?.onNewChatMessage(callback) || (() => {});
  }
  async askOpenAIChatStream(args: OpenAIChatInput, onEvent: (event: OpenAIChatStreamEvent) => void) {
    const streamId = `openai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const unsubscribe = this.electron?.onOpenAIChatStreamEvent(event => {
      if (event.streamId === streamId) onEvent(event);
    });
    try {
      return await this.handleResponse<OpenAIChatResult>(
        this.electron?.askOpenAIChatStream({ ...args, streamId }),
        null as unknown as OpenAIChatResult,
        'askOpenAIChatStream'
      );
    } finally {
      unsubscribe?.();
    }
  }
  onFocusInput(callback: () => void) {
    return this.electron?.onFocusInput(callback) || (() => {});
  }
  onOpenCommandPanel(callback: (panel: 'command' | 'chat' | 'history' | 'settings' | 'transcription' | 'voice') => void) {
    return this.electron?.onOpenCommandPanel(callback) || (() => {});
  }
  setActiveCommandPanel(panel: 'command' | 'chat' | 'history' | 'settings' | 'transcription' | 'voice') {
    this.electron?.setActiveCommandPanel(panel);
  }
  onNotify(callback: (message: string) => void) {
    return this.electron?.onNotify(callback) || (() => {});
  }
  notifHidden() { this.electron?.notifHidden(); }

  onSelectedTextCaptured(callback: (payload: SelectedTextPayload) => void) {
    return this.electron?.onSelectedTextCaptured(callback) || (() => {});
  }
  async getSelectedText() {
    return await this.handleResponse(this.electron?.getSelectedText(), null, 'getSelectedText');
  }
  async runSelectedTextAction(args: TextActionRequest) {
    const response = await this.electron?.runSelectedTextAction(args);
    if (!response?.success || !response.data) throw new Error(response?.error || 'Não foi possível processar o texto.');
    return response.data;
  }
  async copySelectedTextResult(text: string) {
    await this.handleResponse(this.electron?.copySelectedTextResult(text), undefined, 'copySelectedTextResult');
  }
  async replaceSelectedText(text: string) {
    const response = await this.electron?.replaceSelectedText(text);
    if (!response?.success) throw new Error(response?.error || 'Não foi possível substituir o texto.');
  }
  async closeTextActions() {
    await this.handleResponse(this.electron?.closeTextActions(), undefined, 'closeTextActions');
  }

  // --- Screen Capture ---
  async getSources() { return await this.electron?.getSources() || []; }
  async captureSource(sourceId: string) { return await this.electron?.captureSource(sourceId) || ''; }
  async captureAllScreens() { return await this.electron?.captureAllScreens() || ''; }
  onCaptureEvent(callback: () => void) {
    return this.electron?.onCaptureEvent(callback) || (() => {});
  }

  // --- Chat & History ---
  async getChat() { 
    return await this.handleResponse(this.electron?.getChat(), [], 'getChat'); 
  }
  saveChat(history: any[]) { this.electron?.saveChat(history); }
  updateChatStatus(hasMessages: boolean) { this.electron?.updateChatStatus(hasMessages); }
  async endSession(type?: string, history?: any[]) {
    return await this.handleResponse(this.electron?.endSession(type, history), null, 'endSession');
  }
  async getTotalTokens() { 
    return await this.handleResponse(this.electron?.getTotalTokens(), 0, 'getTotalTokens'); 
  }
  async updateTokens(count: number) { 
    return await this.handleResponse(this.electron?.updateTokens(count), 0, 'updateTokens'); 
  }
  commandWindowReady() { this.electron?.commandWindowReady(); }
  chatWindowReady() { this.electron?.chatWindowReady(); }

  // --- Susurro ---
  async startSusurroLive(personaPrompt?: string) { 
    return await this.handleResponse(this.electron?.startSusurroLive(personaPrompt), false, 'startSusurroLive'); 
  }
  async stopSusurroLive() { 
    return await this.handleResponse(this.electron?.stopSusurroLive(), undefined, 'stopSusurroLive'); 
  }
  sendSusurroChunk(base64: string, seq: number) { this.electron?.sendSusurroChunk(base64, seq); }
  endSusurroAudioStream() { this.electron?.endSusurroAudioStream?.(); }
  onSusurroLiveDelta(callback: (delta: any) => void) {
    return this.electron?.onSusurroLiveDelta(callback) || (() => {});
  }
  onSusurroLiveStatus(callback: (status: string) => void) {
    return this.electron?.onSusurroLiveStatus(callback) || (() => {});
  }
  onToggleSusurroTranscriptionSignal(callback: () => void) {
    return this.electron?.onToggleSusurroTranscriptionSignal(callback) || (() => {});
  }
  onStartSusurro(callback: () => void) {
    return this.electron?.onStartSusurro(callback) || (() => {});
  }
  onStopSusurro(callback: () => void) {
    return this.electron?.onStopSusurro(callback) || (() => {});
  }
  onInterviewCaptureShortcut(callback: () => void) {
    return this.electron?.onInterviewCaptureShortcut(callback) || (() => {});
  }
  onInterviewQuickAnswerShortcut(callback: () => void) {
    return this.electron?.onInterviewQuickAnswerShortcut(callback) || (() => {});
  }
  async askSusurroTranscript(data: { question: string; transcript: string; personaPrompt?: string }) {
    return await this.handleResponse(this.electron?.askSusurroTranscript(data), null, 'askSusurroTranscript');
  }
  async generateSuggestion(data: { transcription: string, personaPrompt: string }) {
    return await this.handleResponse(this.electron?.generateSuggestion(data), '', 'generateSuggestion');
  }
  async saveSusurroMessage(msg: any) {
    return await this.handleResponse(this.electron?.saveSusurroMessage(msg), undefined, 'saveSusurroMessage');
  }

  // --- Interview Copilot ---
  async createInterviewSession(config: InterviewConfig, options?: { status?: 'active' | 'pending' }) {
    return await this.handleResponse(
      this.electron?.createInterviewSession(config, options),
      null,
      'createInterviewSession'
    );
  }
  async listInterviewSessions() {
    return await this.handleResponse(this.electron?.listInterviewSessions(), [], 'listInterviewSessions');
  }
  async listInterviewDocuments() {
    return await this.handleResponse(this.electron?.listInterviewDocuments(), [], 'listInterviewDocuments');
  }
  async saveInterviewDocument(document: import('../types/interview').InterviewContextDocument | Omit<import('../types/interview').InterviewContextDocument, 'id' | 'createdAt' | 'updatedAt'>) {
    if (!this.electron?.saveInterviewDocument) {
      throw new Error('O recurso de documentos ainda não foi carregado. Reinicie o aplicativo e tente novamente.');
    }
    const response = await this.electron.saveInterviewDocument(document);
    if (!response.success || !response.data) {
      throw new Error(response.error || 'Não foi possível salvar o documento.');
    }
    return response.data;
  }
  async deleteInterviewDocument(documentId: string) {
    return await this.handleResponse(this.electron?.deleteInterviewDocument(documentId), false, 'deleteInterviewDocument');
  }
  async loadInterviewSession(sessionId: string) {
    return await this.handleResponse(this.electron?.loadInterviewSession(sessionId), null, 'loadInterviewSession');
  }
  async updateInterviewSession(sessionId: string, patch: Partial<InterviewSession>) {
    return await this.handleResponse(this.electron?.updateInterviewSession(sessionId, patch), null, 'updateInterviewSession');
  }
  async finishInterviewSession(sessionId: string, options?: { forceCompleted?: boolean }) {
    return await this.handleResponse(this.electron?.finishInterviewSession(sessionId, options), null, 'finishInterviewSession');
  }
  async archiveInterviewSession(sessionId: string) {
    return await this.handleResponse(this.electron?.archiveInterviewSession(sessionId), null, 'archiveInterviewSession');
  }
  async deleteInterviewSession(sessionId: string) {
    return await this.handleResponse(this.electron?.deleteInterviewSession(sessionId), false, 'deleteInterviewSession');
  }
  async summarizeInterviewSession(sessionId: string) {
    return await this.handleResponse(this.electron?.summarizeInterviewSession(sessionId), null, 'summarizeInterviewSession');
  }
  async saveInterviewTurn(sessionId: string, turn: TranscriptTurn) {
    return await this.handleResponse(this.electron?.saveInterviewTurn(sessionId, turn), null, 'saveInterviewTurn');
  }
  async startInterviewSource(options: {
    sessionId: string;
    source: 'interviewer' | 'candidate';
    language: string;
    provider: 'whisper-local';
    customVocabulary?: string[];
  }) {
    return await this.handleResponse(this.electron?.startInterviewSource(options), false, 'startInterviewSource');
  }
  async stopInterviewSource(sessionId: string, source: 'interviewer' | 'candidate') {
    return await this.handleResponse(this.electron?.stopInterviewSource(sessionId, source), false, 'stopInterviewSource');
  }
  async stopInterviewTranscription(sessionId: string) {
    return await this.handleResponse(this.electron?.stopInterviewTranscription(sessionId), false, 'stopInterviewTranscription');
  }
  sendInterviewAudioChunk(payload: { sessionId: string; source: 'interviewer' | 'candidate'; base64: string; sequence: number }) {
    this.electron?.sendInterviewAudioChunk(payload);
  }
  endInterviewAudioStream(sessionId: string, source: 'interviewer' | 'candidate') {
    this.electron?.endInterviewAudioStream(sessionId, source);
  }
  async flushInterviewTranscription(sessionId: string, source: 'interviewer' | 'candidate') {
    return await this.handleResponse(
      this.electron?.flushInterviewTranscription(sessionId, source),
      false,
      'flushInterviewTranscription'
    );
  }
  onInterviewTranscriptDelta(callback: (delta: InterviewTranscriptDelta) => void) {
    return this.electron?.onInterviewTranscriptDelta(callback) || (() => {});
  }
  onInterviewTranscriptionStatus(callback: (status: InterviewTranscriptionStatus) => void) {
    return this.electron?.onInterviewTranscriptionStatus(callback) || (() => {});
  }
  async requestInterviewAnswer(args: {
    sessionId: string;
    answerId: string;
    turnId?: string;
    question: string;
    turns: TranscriptTurn[];
    config: InterviewConfig;
    visualContext?: string;
    sessionSummary?: string;
    quickFragments?: string[];
    quickComment?: string;
    variant: InterviewAnswerVariant;
  }) {
    return await this.handleResponse(this.electron?.requestInterviewAnswer(args), null, 'requestInterviewAnswer');
  }
  async cancelInterviewAnswer(answerId: string) {
    return await this.handleResponse(this.electron?.cancelInterviewAnswer(answerId), false, 'cancelInterviewAnswer');
  }
  onInterviewAnswerEvent(callback: (event: InterviewAnswerEvent) => void) {
    return this.electron?.onInterviewAnswerEvent(callback) || (() => {});
  }
  async analyzeInterviewScreen(question?: string) {
    return await this.handleResponse(this.electron?.analyzeInterviewScreen(question), null, 'analyzeInterviewScreen');
  }
  async startInterviewRecording(sessionId: string, source: 'interviewer' | 'candidate') {
    return await this.handleResponse(this.electron?.startInterviewRecording(sessionId, source), false, 'startInterviewRecording');
  }
  sendInterviewRecordingChunk(sessionId: string, source: 'interviewer' | 'candidate', base64: string) {
    this.electron?.sendInterviewRecordingChunk(sessionId, source, base64);
  }
  async stopInterviewRecording(sessionId: string, source: 'interviewer' | 'candidate') {
    return await this.handleResponse(this.electron?.stopInterviewRecording(sessionId, source), null, 'stopInterviewRecording');
  }

  // --- Tools (IPC wrappers) ---
  async openFileDialog(): Promise<string | null> { return await this.electron?.openFileDialog() ?? null; }
  async searchWeb(query: string) { return await this.electron?.searchWeb(query); }

  
  // --- Skills System ---
  async saveSkill(args: any) { return await this.handleResponse(this.electron?.saveSkill(args), 'Erro ao salvar skill', 'saveSkill'); }
  async listSkills() { return await this.handleResponse(this.electron?.listSkills(), [], 'listSkills'); }
  async loadSkill(name: string) { return await this.handleResponse(this.electron?.loadSkill(name), 'Erro ao carregar skill', 'loadSkill'); }

  // --- Session Logger ---
  async logSession(data: any) { return await this.handleResponse(this.electron?.logSession(data), null, 'logSession'); }
  async getLearnings() { return await this.handleResponse(this.electron?.getLearnings(), 'Nenhuma memória consolidada ainda.', 'getLearnings'); }
  async getHermesDashboard() {
    return await this.handleResponse(this.electron?.getHermesDashboard(), null, 'getHermesDashboard');
  }
  async testHermesConnection() {
    return await this.handleResponse(this.electron?.testHermesConnection(), null, 'testHermesConnection');
  }
  async askHermes(args: HermesAskInput) {
    return await this.handleResponse(this.electron?.askHermes(args), null, 'askHermes');
  }
  async askHermesStream(args: HermesAskInput, onEvent: (event: HermesStreamEvent) => void) {
    const canStream = typeof this.electron?.askHermesStream === 'function'
      && typeof this.electron?.onHermesStreamEvent === 'function';

    if (!canStream) {
      console.warn('[ElectronService] Hermes streaming bridge unavailable; falling back to non-streaming Hermes call.');
      return await this.askHermes(args);
    }

    const streamId = args.streamId || `hermes_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const unsubscribe = this.electron.onHermesStreamEvent((event) => {
      if (event.streamId === streamId) {
        onEvent(event);
      }
    });

    try {
      return await this.handleResponse(
        this.electron.askHermesStream({ ...args, streamId }),
        null,
        'askHermesStream'
      );
    } finally {
      if (unsubscribe) unsubscribe();
    }
  }
  async rememberWithHermes(memory: HermesMemoryInput) {
    return await this.handleResponse(this.electron?.rememberWithHermes(memory), null, 'rememberWithHermes');
  }
  async ingestHermesDocument(document: HermesDocumentInput) {
    return await this.handleResponse(this.electron?.ingestHermesDocument(document), null, 'ingestHermesDocument');
  }
  async syncHermesContext() {
    return await this.handleResponse(this.electron?.syncHermesContext(), null, 'syncHermesContext');
  }

  // --- Settings ---
  async getSettings(): Promise<SettingsData | null> { 
    try {
      return (await this.electron?.getSettings()) ?? null;
    } catch (error) {
      console.error('[ElectronService] getSettings exception:', error);
      return null;
    }
  }
  async saveSettings(settings: any) { return await this.handleResponse(this.electron?.saveSettings(settings), undefined, 'saveSettings'); }
  async setWindowOpacity(opacity: number) {
    return await this.handleResponse(this.electron?.setWindowOpacity(opacity), opacity, 'setWindowOpacity');
  }
  async setCurrentWindowOpacity(opacity: number) {
    return await this.handleResponse(this.electron?.setCurrentWindowOpacity(opacity), opacity, 'setCurrentWindowOpacity');
  }
  async applyStealthMode(enabled: boolean) { return await this.handleResponse(this.electron?.applyStealthMode(enabled), undefined, 'applyStealthMode'); }
  async getHistoryData() { return await this.handleResponse(this.electron?.getHistoryData(), null, 'getHistoryData'); }
  onSettingsUpdated(callback: (settings: SettingsData) => void) {
    return this.electron?.onSettingsUpdated(callback) || (() => {});
  }
  async disableShortcuts() { return await this.handleResponse(this.electron?.disableShortcuts(), undefined, 'disableShortcuts'); }
  async enableShortcuts() { return await this.handleResponse(this.electron?.enableShortcuts(), undefined, 'enableShortcuts'); }

  async scheduleTask(args: any) { 
    return await this.handleResponse(this.electron?.scheduleTask(args), null, 'scheduleTask'); 
  }
  async getTasks() { 
    return await this.handleResponse(this.electron?.getTasks(), [], 'getTasks'); 
  }
  async deleteTask(id: string) { 
    return await this.handleResponse(this.electron?.deleteTask(id), undefined, 'deleteTask'); 
  }
  onExecuteTask(callback: (task: any) => void) {
    return this.electron?.onExecuteTask(callback) || (() => {});
  }
  showChat() { this.electron?.showChat(); }
  async translateText(text: string, targetLanguage: string) { 
    return await this.handleResponse(this.electron?.translateText(text, targetLanguage), text, 'translateText'); 
  }
  async translateIncremental(text: string, previousText: string, targetLanguage: string) {
    return await this.handleResponse(this.electron?.translateIncremental(text, previousText, targetLanguage), '', 'translateIncremental');
  }
  async transcribeAudio(base64: string) {
    return await this.handleResponse(this.electron?.transcribeAudio(base64), '', 'transcribeAudio');
  }
  async getSystemAudioSourceId() { 
    return await this.handleResponse(this.electron?.getSystemAudioSourceId(), '', 'getSystemAudioSourceId'); 
  }
  updateChatPin(pinned: boolean) { this.electron?.updateChatPin(pinned); }
  async getPersonas() { 
    return await this.handleResponse(this.electron?.getPersonas(), [], 'getPersonas'); 
  }
  async savePersona(persona: any) { 
    return await this.handleResponse(this.electron?.savePersona(persona), undefined, 'savePersona'); 
  }
  async deletePersona(id: string) { 
    return await this.handleResponse(this.electron?.deletePersona(id), undefined, 'deletePersona'); 
  }

  // --- Voice Recording ---
  onStartVoice(callback: () => void) {
    return this.electron?.onStartVoice(callback) || (() => {});
  }
  onVoiceSend(callback: () => void) {
    return this.electron?.onVoiceSend(callback) || (() => {});
  }


  // --- Suggestions ---
  toggleSuggestions(enabled: boolean) { this.electron?.toggleSuggestions(enabled); }
  onNewSuggestion(callback: (text: string) => void) {
    return this.electron?.onNewSuggestion(callback) || (() => {});
  }

  // --- Misc ---
  openExternal(url: string) { this.electron?.openExternal(url); }
  copyToClipboard(text: string) { this.electron?.copyToClipboard?.(text); }
}

export const electronService = new ElectronService();
