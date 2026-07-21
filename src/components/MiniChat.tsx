import React from 'react';
import { ChatHeader } from './chat/ChatHeader';
import { SettingsMenu } from './chat/SettingsMenu';
import { ChatList } from './chat/ChatList';
import { useMiniChat } from '../hooks/useMiniChat';
import { electronService } from '../services/electron';

interface MiniChatProps {
  embedded?: boolean;
  isActive?: boolean;
  onClosePanel?: () => void;
  onOpenSettings?: () => void;
  onOpenTranscription?: () => void;
}

/**
 * MiniChat component - Main entry point for the AI chat interface.
 * Orchestrates messages, AI inference, and window controls via useMiniChat hook.
 */
const MiniChat: React.FC<MiniChatProps> = ({
  embedded = false,
  isActive = true,
  onClosePanel,
  onOpenSettings,
  onOpenTranscription
}) => {
  const {
    messages,
    pendingMessages,
    isThinking,
    activeTool,
    isPinned,
    isResizing,
    timer,
    tokens,
    isSettingsOpen,
    menuView,
    currentModel,
    copiedId,
    chatEndRef,
    setCurrentModel,
    setIsSettingsOpen,
    setMenuView,
    togglePin,
    handleMinimize,
    startResizing,
    clearHistory,
    copyToClipboard
  } = useMiniChat({ embedded, isActive, onClosePanel });

  return (
    <div className={`app-container chat-mode ${embedded ? 'embedded-chat' : ''} ${isResizing ? 'resizing' : ''}`}>
      <ChatHeader
        timer={timer}
        tokens={tokens}
        currentModel={currentModel}
        isPinned={isPinned}
        isSettingsOpen={isSettingsOpen}
        togglePin={togglePin}
        setIsSettingsOpen={setIsSettingsOpen}
        onOpenSettings={onOpenSettings}
        onOpenTranscription={onOpenTranscription || (() => electronService.showSusurro())}
        onCloseSession={clearHistory}
        onMinimize={embedded && onClosePanel ? onClosePanel : handleMinimize}
        embedded={embedded}
      />

      {isSettingsOpen && (
        <SettingsMenu
          view={menuView}
          currentModel={currentModel}
          onSetView={setMenuView}
          onSelectModel={setCurrentModel}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      <ChatList
        messages={messages}
        pendingMessages={pendingMessages}
        isThinking={isThinking}
        activeTool={activeTool}
        copiedId={copiedId}
        onCopy={copyToClipboard}
        chatEndRef={chatEndRef}
      />

      {!embedded && (
        <button
          type="button"
          className="resize-handle"
          onMouseDown={startResizing}
          aria-label="Resize chat window"
        >
          <div className="resize-square" />
        </button>
      )}
    </div>
  );
};

export default MiniChat;
