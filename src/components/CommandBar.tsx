import React, { useState, useEffect } from 'react';
import { ChevronDown, X, Paperclip } from 'lucide-react';
import { CommandPanel, useCommandBar } from '../hooks/useCommandBar';
import { electronService } from '../services/electron';
import MiniChat from './MiniChat';
import Settings from './Settings';
import Susurro from './Susurro';
import VoiceRecorder from './VoiceRecorder';

/**
 * CommandBar component - A sleek, minimal input bar for AI commands.
 * Supports text input, local image uploads via (+), screen captures, and unified assistant panels.
 */
const CommandBar: React.FC = () => {
  const [activePanel, setActivePanel] = useState<CommandPanel>('command');
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const {
    query,
    setQuery,
    attachedImage,
    setAttachedImage,
    inputRef,
    containerRef,
    MAX_CHARS,
    handleCapture,
    handleKeyDown,
    handlePaste,
    removeAttachment
  } = useCommandBar(activePanel, isOptionsOpen);

  const [isOnTop, setIsOnTop] = useState(true);

  // Sync settings and setup listeners on mount
  useEffect(() => {
    electronService.isPinned().then(setIsOnTop);
  }, []);

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
      setIsOptionsOpen(false);
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

  const handleFileOpen = async () => {
    setIsOptionsOpen(false);
    const base64 = await electronService.openFileDialog();
    if (base64) {
      setAttachedImage(base64);
      // Return focus to the text input so the user can type immediately
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleOpenChat = () => {
    setIsOptionsOpen(false);
    setActivePanel(activePanel === 'chat' ? 'command' : 'chat');
  };

  const handleOpenSettings = () => {
    setIsOptionsOpen(false);
    setActivePanel(activePanel === 'settings' ? 'command' : 'settings');
  };

  const handleOpenTranscription = () => {
    setIsOptionsOpen(false);
    setActivePanel(activePanel === 'transcription' ? 'command' : 'transcription');
  };

  const handleOpenVoice = () => {
    setIsOptionsOpen(false);
    setActivePanel(activePanel === 'voice' ? 'command' : 'voice');
  };

  const handleMinimizeToHead = () => {
    setIsOptionsOpen(false);
    electronService.minimizeToHead();
  };

  const handleQuitApp = () => {
    setIsOptionsOpen(false);
    electronService.quitApp();
  };

  const handleToggleOnTop = () => {
    const next = !isOnTop;
    setIsOnTop(next);
    setIsOptionsOpen(false);
    electronService.togglePin();
  };

  const handleToggleOptions = () => {
    if (activePanel !== 'command') {
      setActivePanel('command');
      setIsOptionsOpen(true);
      return;
    }
    setIsOptionsOpen((open) => !open);
  };

  const handleCaptureOption = async () => {
    setIsOptionsOpen(false);
    await handleCapture();
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
        </div>
      </div>
      
      <div className="command-footer">
        <button
          type="button"
          className={`footer-btn text-btn ${activePanel === 'chat' ? 'active' : ''}`}
          onClick={handleOpenChat}
          title="Abrir chat"
        >
          Conversation
        </button>

        <button
          type="button"
          className={`footer-btn text-btn select-btn ${isOptionsOpen ? 'active' : ''}`}
          onClick={handleToggleOptions}
          title="Abrir opções"
          aria-expanded={isOptionsOpen}
        >
          Opções
          <ChevronDown size={12} />
        </button>

        <div className="footer-spacer" />

        <button
          type="button"
          className="footer-btn text-btn"
          onClick={handleMinimizeToHead}
          title="Minimizar para bolha"
        >
          Minimizar
        </button>
      </div>

      {isOptionsOpen && activePanel === 'command' && (
        <div className="command-options-menu" role="menu">
          <button type="button" className="option-row" onClick={handleFileOpen}>Upload imagem</button>
          <button type="button" className="option-row" onClick={handleCaptureOption}>Capturar tela</button>
          <button type="button" className="option-row" onClick={handleOpenSettings}>Configurações</button>
          <button type="button" className="option-row" onClick={handleOpenTranscription}>Entrevista</button>
          <button type="button" className="option-row" onClick={handleOpenVoice}>Escutar</button>
          <button type="button" className="option-row" onClick={handleToggleOnTop}>
            {isOnTop ? 'Desativar on top' : 'Ativar on top'}
          </button>
          <button type="button" className="option-row danger" onClick={handleQuitApp}>Sair do Hades</button>
        </div>
      )}

      <div className={`unified-panel ${activePanel === 'command' ? 'hidden' : ''}`}>
        <div className={`unified-panel-view ${activePanel === 'chat' ? '' : 'hidden'}`}>
          <MiniChat
            embedded
            isActive={activePanel === 'chat'}
            onClosePanel={() => setActivePanel('command')}
            onOpenSettings={() => setActivePanel('settings')}
            onOpenTranscription={() => setActivePanel('transcription')}
          />
        </div>

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
