import React, { useState, useEffect, useRef } from 'react';
import { Camera, Cog, History, MessageCircle, Minus, Paperclip, Pin, PinOff, Plus, Users, X } from 'lucide-react';
import { CommandPanel, useCommandBar } from '../hooks/useCommandBar';
import { electronService } from '../services/electron';
import MiniChat from './MiniChat';
import Settings from './Settings';
import Susurro from './Susurro';
import VoiceRecorder from './VoiceRecorder';
import HistoryTab from './settings/HistoryTab';

/**
 * CommandBar component - A sleek, minimal input bar for AI commands.
 * Supports text input, local image uploads via (+), screen captures, and unified assistant panels.
 */
const CommandBar: React.FC = () => {
  const [activePanel, setActivePanel] = useState<CommandPanel>('command');
  const [isChatBusy, setIsChatBusy] = useState(false);
  const newConversationHandlerRef = useRef<(() => void) | null>(null);
  const {
    query,
    setQuery,
    attachedImage,
    inputRef,
    containerRef,
    MAX_CHARS,
    handleCapture,
    handleKeyDown,
    handlePaste,
    removeAttachment
  } = useCommandBar(activePanel, false);

  const [isOnTop, setIsOnTop] = useState(true);

  // Sync settings and setup listeners on mount
  useEffect(() => {
    electronService.isPinned().then(setIsOnTop);
  }, []);

  useEffect(() => {
    electronService.setActiveCommandPanel(activePanel);
  }, [activePanel]);

  useEffect(() => {
    const unsubscribe = electronService.onOpenCommandPanel((panel) => {
      setActivePanel(panel);
      if (panel === 'command') {
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    });

    electronService.commandWindowReady();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [inputRef]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tagName = target.tagName.toLowerCase();
      return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    };

    const handleTypingFocus = (event: KeyboardEvent) => {
      if (
        activePanel === 'transcription' ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.isComposing ||
        event.key.length !== 1 ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      setQuery((current) => {
        if (current.length >= MAX_CHARS) return current;
        return `${current}${event.key}`;
      });

      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    };

    globalThis.addEventListener('keydown', handleTypingFocus, true);
    return () => {
      globalThis.removeEventListener('keydown', handleTypingFocus, true);
    };
  }, [MAX_CHARS, activePanel, inputRef, setQuery]);

  const handleOpenChat = () => {
    setActivePanel(activePanel === 'chat' ? 'command' : 'chat');
  };

  const handleNewConversation = () => {
    if (isChatBusy) return;
    newConversationHandlerRef.current?.();
    setActivePanel('chat');
  };

  const handleOpenSettings = () => {
    setActivePanel(activePanel === 'settings' ? 'command' : 'settings');
  };

  const handleOpenHistory = () => {
    setActivePanel(activePanel === 'history' ? 'command' : 'history');
  };

  const handleOpenTranscription = () => {
    setActivePanel(activePanel === 'transcription' ? 'command' : 'transcription');
  };

  const handleMinimizeToHead = () => {
    electronService.minimizeToHead();
  };

  const handleToggleOnTop = () => {
    const next = !isOnTop;
    setIsOnTop(next);
    electronService.togglePin();
  };

  return (
    <div
      className={`app-container command-mode panel-${activePanel} ${activePanel !== 'command' ? 'unified-expanded' : ''}`}
      ref={containerRef}
    >
      <div className="command-main">
        <div className="input-wrapper" style={{ flex: 1, display: 'flex', alignItems: 'center', position: 'relative' }}>
          <textarea
            ref={inputRef}
            placeholder="O que você precisa?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className="command-input"
            rows={1}
            autoFocus
            maxLength={MAX_CHARS}
            style={{ 
              width: '100%', 
              paddingRight: attachedImage ? '130px' : '0',
              transition: 'padding-right 0.2s ease',
              lineHeight: '24px',
              marginTop: '2px'
            }}
          />

          {attachedImage && (
            <AttachmentIndicator 
              fileName="imagem.png" 
              onRemove={removeAttachment} 
            />
          )}
          <button
            type="button"
            className="command-input-action"
            onClick={handleCapture}
            title="Capturar tela"
            aria-label="Capturar tela"
          >
            <Camera size={14} />
          </button>
        </div>
      </div>
      
      <div className="command-footer">
        <button
          type="button"
          className={`footer-btn icon-btn ${activePanel === 'chat' ? 'active' : ''}`}
          onClick={handleOpenChat}
          title="Abrir conversa"
          aria-label="Abrir conversa"
          data-tooltip="Conversa"
        >
          <MessageCircle size={14} />
        </button>
        <button
          type="button"
          className="footer-btn icon-btn"
          onClick={handleNewConversation}
          disabled={isChatBusy}
          title={isChatBusy ? 'Aguarde a resposta atual terminar' : 'Criar nova conversa'}
          aria-label={isChatBusy ? 'Nova conversa indisponível durante a resposta' : 'Criar nova conversa'}
          data-tooltip={isChatBusy ? 'Resposta em andamento' : 'Nova conversa'}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          className={`footer-btn icon-btn ${activePanel === 'history' ? 'active' : ''}`}
          onClick={handleOpenHistory}
          title="Histórico de conversas"
          aria-label="Histórico de conversas"
          data-tooltip="Histórico"
        >
          <History size={14} />
        </button>

        <div className="footer-spacer" />

        <button
          type="button"
          className={`footer-btn icon-btn ${activePanel === 'settings' ? 'active' : ''}`}
          onClick={handleOpenSettings}
          title="Configurações"
          aria-label="Configurações"
          data-tooltip="Configurações"
        >
          <Cog size={14} />
        </button>
        <button
          type="button"
          className={`footer-btn icon-btn ${activePanel === 'transcription' ? 'active' : ''}`}
          onClick={handleOpenTranscription}
          title="Reunião"
          aria-label="Reunião"
          data-tooltip="Reunião"
        >
          <Users size={14} />
        </button>
        <button
          type="button"
          className={`footer-btn icon-btn ${isOnTop ? 'active' : ''}`}
          onClick={handleToggleOnTop}
          title={isOnTop ? 'Desativar always-on-top' : 'Ativar always-on-top'}
          aria-label={isOnTop ? 'Desativar always-on-top' : 'Ativar always-on-top'}
          data-tooltip={isOnTop ? 'Desativar on top' : 'Ativar on top'}
        >
          {isOnTop ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
        <button
          type="button"
          className="footer-btn icon-btn"
          onClick={handleMinimizeToHead}
          title="Minimizar para bolha"
          aria-label="Minimizar para bolha"
          data-tooltip="Minimizar"
        >
          <Minus size={14} />
        </button>
      </div>

      <div className={`unified-panel ${activePanel === 'command' ? 'hidden' : ''}`}>
        <div className={`unified-panel-view ${activePanel === 'chat' ? '' : 'hidden'}`}>
          <MiniChat
            embedded
            isActive={activePanel === 'chat'}
            onClosePanel={() => setActivePanel('command')}
            onOpenSettings={() => setActivePanel('settings')}
            onOpenTranscription={() => setActivePanel('transcription')}
            onRegisterNewSession={(handler) => {
              newConversationHandlerRef.current = handler;
            }}
            onBusyChange={setIsChatBusy}
          />
        </div>

        {activePanel === 'history' && (
          <div className="standalone-history">
            <HistoryTab />
          </div>
        )}

        {activePanel === 'settings' && (
          <Settings
            embedded
            onClosePanel={() => setActivePanel('command')}
          />
        )}

        {activePanel === 'transcription' && (
          <Susurro
            embedded
            onClosePanel={() => setActivePanel('command')}
          />
        )}

        {activePanel === 'voice' && (
          <VoiceRecorder
            embedded
            autoStart
            onClosePanel={() => setActivePanel('command')}
          />
        )}
      </div>
    </div>
  );
};

/**
 * Sub-component for showing attached files.
 */
const AttachmentIndicator: React.FC<{ fileName: string; onRemove: () => void }> = ({ fileName, onRemove }) => (
  <div className="attachment-indicator" style={{ 
    display: 'flex', 
    alignItems: 'center', 
    gap: '6px', 
    padding: '3px 8px',
    background: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '6px',
    fontSize: '11px',
    color: 'rgba(255,255,255,0.8)',
    border: '1px solid rgba(255,255,255,0.15)',
    position: 'absolute',
    right: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 30,
    pointerEvents: 'auto',
    animation: 'appear 0.2s ease-out'
  }}>
    <Paperclip size={12} />
    <span>{fileName}</span>
    <button 
      type="button"
      className="remove-attachment-btn"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onRemove();
      }}
      style={{ 
        background: 'rgba(255,255,255,0.15)', 
        border: 'none', 
        color: 'rgba(255,255,255,0.8)', 
        cursor: 'pointer', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        padding: '4px',
        borderRadius: '4px',
        marginLeft: '6px',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        outline: 'none'
      }}
    >
      <X size={12} />
    </button>
  </div>
);

export default CommandBar;
