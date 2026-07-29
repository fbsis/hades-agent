import React, { useState } from 'react';
import { SettingsData } from '../../types/electron';
import { Eye, EyeOff, Key, Shield, Moon } from 'lucide-react';

interface GeneralTabProps {
  settings: SettingsData['general'];
  updateSettings: (updates: Partial<SettingsData['general']>) => void;
}

const GeneralTab: React.FC<GeneralTabProps> = ({ settings, updateSettings }) => {
  const [showKey, setShowKey] = useState(false);
  const [showTavilyKey, setShowTavilyKey] = useState(false);

  return (
    <div>
      <div className="tab-header">
        <h2 className="tab-title">Configurações</h2>
        <p className="tab-subtitle">Ajuste privacidade, memória e chaves de acesso.</p>
      </div>

      <div className="section-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Key size={16} /> Chaves de API
        </span>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-title">Google AI Studio</div>
        </div>
        <div className="setting-control" style={{ position: 'relative' }}>
          <input 
            type={showKey ? "text" : "password"}
            className="settings-input"
            aria-label="API Key do Google"
            placeholder="Insira sua API Key do Google..."
            value={!showKey && settings.apiKey ? "••••••••••••••••••••••••••••••••••••••••" : (settings.apiKey || '')}
            onChange={(e) => {
              const val = e.target.value;
              const MASK = "••••••••••••••••••••••••••••••••••••••••";
              if (showKey || !settings.apiKey) {
                updateSettings({ apiKey: val });
                return;
              }
              if (val === MASK) return;
              if (!val.includes("•")) {
                updateSettings({ apiKey: val });
                return;
              }
              const newChars = val.replaceAll('•', '');
              if (newChars.length === 0) {
                updateSettings({ apiKey: '' });
              } else if (val.startsWith(MASK)) {
                updateSettings({ apiKey: settings.apiKey + newChars });
              } else {
                updateSettings({ apiKey: newChars });
              }
            }}
            style={{ paddingRight: '40px' }}
          />
          <button 
            type="button"
            aria-label={showKey ? "Ocultar chave" : "Mostrar chave"}
            onClick={() => setShowKey(!showKey)}
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
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
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
          <Moon size={16} /> Sistema de Dreaming (Memória e Aprendizado)
        </span>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-title">Ativar Dreaming</div>
          <div className="setting-desc">Permite que o Metis consolide aprendizados das conversas e interações em segundo plano.</div>
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
