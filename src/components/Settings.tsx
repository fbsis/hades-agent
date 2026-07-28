import React from 'react';
import { X, Save, Loader } from 'lucide-react';
import { useSettings } from '../hooks/useSettings';
import { electronService } from '../services/electron';
import '../styles/settings.css';

import SettingsSidebar from './settings/SettingsSidebar';
import HistoryTab from './settings/HistoryTab';
import AudioTab from './settings/AudioTab';
import GeneralTab from './settings/GeneralTab';
import HermesTab from './settings/HermesTab';
import ShortcutsTab from './settings/ShortcutsTab';

interface SettingsProps {
  embedded?: boolean;
  onClosePanel?: () => void;
}

const Settings: React.FC<SettingsProps> = ({ embedded = false, onClosePanel }) => {
  const {
    activeTab,
    setActiveTab,
    settings,
    isLoading,
    isSaving,
    updateAudioSettings,
    updateGeneralSettings,
    updateHermesSettings,
    updateAssistantSettings,
    updateShortcutsSettings,
    saveAll
  } = useSettings();

  const handleClose = () => {
    if (embedded && onClosePanel) {
      onClosePanel();
      return;
    }
    electronService.closeWindow();
  };

  if (isLoading || !settings) {
    return (
      <div className={`settings-window ${embedded ? 'embedded-settings' : ''}`} style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Loader className="animate-spin" size={32} color="var(--color-primary)" />
      </div>
    );
  }

  return (
    <div className={`settings-window ${embedded ? 'embedded-settings' : ''}`}>
      <div className="settings-drag-area">
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>
          METIS
        </div>
        <button className="settings-close-btn" onClick={handleClose}>
          <X size={16} />
        </button>
      </div>

      <SettingsSidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <div className="settings-content-wrapper">
        <div className="settings-content">
          {activeTab === 'history' && (
            <HistoryTab />
          )}
          
          {activeTab === 'audio' && (
            <AudioTab 
              settings={settings.audio} 
              updateSettings={updateAudioSettings} 
            />
          )}
          
          {activeTab === 'general' && (
            <GeneralTab 
              settings={settings.general} 
              updateSettings={updateGeneralSettings} 
            />
          )}

          {activeTab === 'hermes' && (
            <HermesTab
              hermes={settings.hermes}
              assistant={settings.assistant}
              updateHermes={updateHermesSettings}
              updateAssistant={updateAssistantSettings}
            />
          )}

          {activeTab === 'shortcuts' && (
            <ShortcutsTab 
              settings={settings.shortcuts} 
              updateSettings={updateShortcutsSettings} 
            />
          )}
        </div>

        <div className="settings-footer">
          <button 
            className="btn-save" 
            onClick={saveAll}
            disabled={isSaving}
          >
            {isSaving ? <Loader className="animate-spin" size={16} /> : <Save size={16} />}
            <span>{isSaving ? 'Salvando...' : 'Salvar configurações'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
