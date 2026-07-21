import React, { useRef, useEffect } from 'react';
import { Settings, Pin, PinOff, Minus, Plus, Activity, Type, Languages } from 'lucide-react';
import { MenuView, Persona } from '../../types';
import { formatTime } from '../../utils/formatters';
import { SusurroMenu } from './SusurroMenu';

interface SusurroHeaderProps {
  timer: number;
  tokens: number;
  isTranscribing: boolean;
  isConnecting: boolean;
  isPinned: boolean;
  isGlobalTranslationEnabled: boolean;
  targetLanguage: string;
  targetLanguageLabel: string;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  menuView: MenuView;
  setMenuView: (view: MenuView) => void;
  setTargetLanguage: (lang: string) => void;
  setTargetLanguageLabel: (label: string) => void;
  togglePin: () => void;
  handleMinimize: () => void;
  handleToggleGlobalTranslation: () => void;
  isSuggestionsEnabled: boolean;
  setIsSuggestionsEnabled: (enabled: boolean) => void;
  selectedPersona: Persona | null;
  setSelectedPersona: (persona: Persona | null) => void;
  personas: Persona[];
  isCreatingPersona: boolean;
  setIsCreatingPersona: (creating: boolean) => void;
  newPersonaName: string;
  setNewPersonaName: (name: string) => void;
  newPersonaPrompt: string;
  setNewPersonaPrompt: (prompt: string) => void;
  handleSavePersona: () => void;
  handleDeletePersona: (id: string) => void;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
  fontSize: number;
  onCloseSession: () => void;
  embedded?: boolean;
  onClosePanel?: () => void;
}

/**
 * SusurroHeader: Contains status indicators, session controls, and settings access.
 */
export const SusurroHeader: React.FC<SusurroHeaderProps> = (props) => {
  const settingsRef = useRef<HTMLDivElement>(null);

  // Close settings menu when clicking outside the settings container
  useEffect(() => {
    if (!props.isSettingsOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        props.setIsSettingsOpen(false);
        props.setMenuView('main');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [props.isSettingsOpen]);

  return (
    <div className="susurro-header">
      <div className="header-left">
        <div className="title-with-timer">
          <div className={`status-indicator ${props.isTranscribing || props.isConnecting ? 'active' : ''}`} style={{ fontSize: '14px', marginRight: '6px' }}>
            {props.isTranscribing || props.isConnecting ? <Activity size={16} className="pulse" /> : <div className="dot" />}
            <span style={{ fontWeight: 600, color: props.isTranscribing || props.isConnecting ? '#ef4444' : '#fff' }}>
              {props.isTranscribing ? "Escutando..." : props.isConnecting ? "Conectando..." : "Susurro"}
            </span>
          </div>
          <span className="header-separator" />
          <span className="timer-dot" />
          <span className="chat-timer-text">{formatTime(props.timer)}</span>
          <div className="info-wrapper" style={{ marginLeft: '4px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button 
              className="action-btn new-session-btn" 
              onClick={props.onCloseSession}
              title="Nova sessão"
            >
              <Plus size={16} />
            </button>
            <div className="usage-popup" style={{ top: '130%', left: '50%', transform: 'translateX(-50%)', width: 'max-content' }}>
              <div style={{ fontWeight: 600, fontSize: '11px', color: 'rgba(255,255,255,0.95)', whiteSpace: 'nowrap' }}>Nova sessão</div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.45)', marginTop: '2px', whiteSpace: 'nowrap' }}>Histórico atual será salvo</div>
            </div>
          </div>
        </div>
      </div>

      <div className="header-actions">
        <button
          className={`action-btn global-translate-btn ${props.isGlobalTranslationEnabled ? 'active' : ''}`}
          onClick={props.handleToggleGlobalTranslation}
          title="Tradução Global"
        >
          <Languages size={18} />
        </button>

        <div className="token-counter">
          <span className="label">Tokens</span>
          <span className="value">{props.tokens.toLocaleString()}</span>
        </div>

        <div className="settings-container" ref={settingsRef}>
          <button className={`action-btn settings-btn ${props.isSettingsOpen ? 'active' : ''}`} onClick={() => props.setIsSettingsOpen(!props.isSettingsOpen)}>
            <Settings size={18} />
          </button>
          {props.isSettingsOpen && (
            <SusurroMenu
              menuView={props.menuView}
              setMenuView={props.setMenuView}
              targetLanguage={props.targetLanguage}
              targetLanguageLabel={props.targetLanguageLabel}
              setTargetLanguage={props.setTargetLanguage}
              setTargetLanguageLabel={props.setTargetLanguageLabel}
              isSuggestionsEnabled={props.isSuggestionsEnabled}
              setIsSuggestionsEnabled={props.setIsSuggestionsEnabled}
              selectedPersona={props.selectedPersona}
              setSelectedPersona={props.setSelectedPersona}
              personas={props.personas}
              isCreatingPersona={props.isCreatingPersona}
              setIsCreatingPersona={props.setIsCreatingPersona}
              newPersonaName={props.newPersonaName}
              setNewPersonaName={props.setNewPersonaName}
              newPersonaPrompt={props.newPersonaPrompt}
              setNewPersonaPrompt={props.setNewPersonaPrompt}
              handleSavePersona={props.handleSavePersona}
              handleDeletePersona={props.handleDeletePersona}
            />
          )}
        </div>

        {!props.embedded && (
          <button className="action-btn" onClick={props.togglePin}>
            {props.isPinned ? <PinOff size={18} color="var(--accent-light)" /> : <Pin size={18} />}
          </button>
        )}

        <div className="font-controls">
          <button className="action-btn" onClick={props.decreaseFontSize} title="Diminuir fonte">
            <Minus size={14} />
          </button>
          <div className="font-size-indicator">
            <Type size={10} style={{ opacity: 0.5 }} />
            <span>{props.fontSize}</span>
          </div>
          <button className="action-btn" onClick={props.increaseFontSize} title="Aumentar fonte">
            <Plus size={14} />
          </button>
        </div>

        <button
          className="action-btn"
          onClick={props.embedded && props.onClosePanel ? props.onClosePanel : props.handleMinimize}
          title={props.embedded ? 'Voltar' : 'Minimizar'}
        >
          <Minus size={18} />
        </button>
      </div>
    </div>
  );
};
