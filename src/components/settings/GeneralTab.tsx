import React, { useState } from 'react';
import { SettingsData } from '../../types/electron';
import { Eye, EyeOff, Key, Shield, Moon, Blend } from 'lucide-react';
import { electronService } from '../../services/electron';

interface GeneralTabProps {
  settings: SettingsData['general'];
  updateSettings: (updates: Partial<SettingsData['general']>) => void;
}

const GeneralTab: React.FC<GeneralTabProps> = ({ settings, updateSettings }) => {
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showTavilyKey, setShowTavilyKey] = useState(false);
  const opacityPercent = Math.round((settings.windowOpacity ?? 0.9) * 100);

  const handleOpacityChange = (value: string) => {
    const windowOpacity = Number.parseInt(value, 10) / 100;
    updateSettings({ windowOpacity });
    void electronService.setWindowOpacity(windowOpacity);
  };

  return (
    <div>
      <div className="tab-header">
        <h2 className="tab-title">Configurações</h2>
        <p className="tab-subtitle">Ajuste privacidade, memória e chaves de acesso.</p>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-title">OpenAI</div>
          <div className="setting-desc">Usada nas respostas e capturas da entrevista e para consolidar os aprendizados do Dreaming.</div>
        </div>
        <div className="setting-control" style={{ position: 'relative' }}>
          <input
            type={showOpenAIKey ? 'text' : 'password'}
            className="settings-input"
            aria-label="API Key da OpenAI"
            placeholder="Insira sua API Key da OpenAI..."
            value={!showOpenAIKey && settings.openaiApiKey ? "••••••••••••••••••••••••••••••••••••••••" : (settings.openaiApiKey || '')}
            onChange={(e) => {
              const val = e.target.value;
              const MASK = "••••••••••••••••••••••••••••••••••••••••";
              if (showOpenAIKey || !settings.openaiApiKey) {
                updateSettings({ openaiApiKey: val });
                return;
              }
              if (val === MASK) return;
              if (!val.includes("•")) {
                updateSettings({ openaiApiKey: val });
                return;
              }
              const newChars = val.replaceAll('•', '');
              if (newChars.length === 0) {
                updateSettings({ openaiApiKey: '' });
              } else if (val.startsWith(MASK)) {
                updateSettings({ openaiApiKey: settings.openaiApiKey + newChars });
              } else {
                updateSettings({ openaiApiKey: newChars });
              }
            }}
            style={{ paddingRight: '40px' }}
          />
          <button
            type="button"
            aria-label={showOpenAIKey ? 'Ocultar chave OpenAI' : 'Mostrar chave OpenAI'}
            onClick={() => setShowOpenAIKey(!showOpenAIKey)}
            style={{
              position: 'absolute',
              right: '10px',
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {showOpenAIKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div className="section-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Key size={16} /> Chaves de API
        </span>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-title">Tavily Search API</div>
        </div>
        <div className="setting-control" style={{ position: 'relative' }}>
          <input 
            type={showTavilyKey ? "text" : "password"}
            className="settings-input"
            aria-label="API Key do Tavily"
            placeholder="Insira sua API Key do Tavily..."
            value={!showTavilyKey && settings.tavilyApiKey ? "••••••••••••••••••••••••••••••••••••••••" : (settings.tavilyApiKey || '')}
            onChange={(e) => {
              const val = e.target.value;
              const MASK = "••••••••••••••••••••••••••••••••••••••••";
              if (showTavilyKey || !settings.tavilyApiKey) {
                updateSettings({ tavilyApiKey: val });
                return;
              }
              if (val === MASK) return;
              if (!val.includes("•")) {
                updateSettings({ tavilyApiKey: val });
                return;
              }
              const newChars = val.replaceAll('•', '');
              if (newChars.length === 0) {
                updateSettings({ tavilyApiKey: '' });
              } else if (val.startsWith(MASK)) {
                updateSettings({ tavilyApiKey: settings.tavilyApiKey + newChars });
              } else {
                updateSettings({ tavilyApiKey: newChars });
              }
            }}
            style={{ paddingRight: '40px' }}
          />
          <button 
            type="button"
            aria-label={showTavilyKey ? "Ocultar chave" : "Mostrar chave"}
            onClick={() => setShowTavilyKey(!showTavilyKey)}
            style={{
              position: 'absolute',
              right: '10px',
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {showTavilyKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div className="section-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Shield size={16} /> Privacidade
        </span>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Blend size={15} /> Opacidade da janela
          </div>
          <div className="setting-desc">Reduza para enxergar o conteúdo atrás do Metis. A bolha flutuante permanece nítida.</div>
        </div>
        <div className="setting-control">
          <span className="opacity-value">{opacityPercent}%</span>
          <input
            type="range"
            aria-label="Opacidade da janela"
            min="50"
            max="100"
            step="5"
            value={opacityPercent}
            onChange={(event) => handleOpacityChange(event.target.value)}
            style={{ width: '140px' }}
          />
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-title">Proteção de captura</div>
          <div className="setting-desc">Sempre ativa para reduzir a exposição do Metis em capturas e compartilhamentos de tela.</div>
        </div>
        <div className="setting-control">
          <label className="switch" aria-label="Proteção de captura sempre ativa">
            <input 
              type="checkbox" 
              aria-label="Proteção de captura sempre ativa"
              checked
              disabled
            />
            <span className="slider"></span>
          </label>
        </div>
      </div>

      <div className="section-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Moon size={16} /> Dreaming (OpenAI + Hermes)
        </span>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-title">Ativar Dreaming</div>
          <div className="setting-desc">A OpenAI filtra conversas e reuniões gravadas; o Hermes recebe somente os resumos úteis para memória persistente.</div>
        </div>
        <div className="setting-control">
          <label className="switch" aria-label="Ativar Dreaming">
            <input 
              type="checkbox" 
              aria-label="Ativar Dreaming"
              checked={settings.dreamingEnabled ?? true}
              onChange={(e) => updateSettings({ dreamingEnabled: e.target.checked })}
            />
            <span className="slider"></span>
          </label>
        </div>
      </div>

    </div>
  );
};

export default GeneralTab;
