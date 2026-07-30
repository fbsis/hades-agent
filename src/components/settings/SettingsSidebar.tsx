import React from 'react';
import { SettingsTab } from '../../hooks/useSettings';
import { Bot, Keyboard, Power, Settings as SettingsIcon, Volume2 } from 'lucide-react';

interface SidebarProps {
  activeTab: SettingsTab;
  setActiveTab: (tab: SettingsTab) => void;
  onQuit: () => void;
}

const SettingsSidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, onQuit }) => {
  return (
    <div className="settings-sidebar">
      <div className="sidebar-title">Menu</div>
      
      <button 
        type="button"
        className={`sidebar-item ${activeTab === 'audio' ? 'active' : ''}`}
        onClick={() => setActiveTab('audio')}
      >
        <Volume2 size={16} />
        <span>Áudio e Sons</span>
      </button>
      
      <button 
        type="button"
        className={`sidebar-item ${activeTab === 'general' ? 'active' : ''}`}
        onClick={() => setActiveTab('general')}
      >
        <SettingsIcon size={16} />
        <span>Configurações</span>
      </button>

      <button
        type="button"
        className={`sidebar-item ${activeTab === 'hermes' ? 'active' : ''}`}
        onClick={() => setActiveTab('hermes')}
      >
        <Bot size={16} />
        <span>Agente</span>
      </button>

      <button 
        type="button"
        className={`sidebar-item ${activeTab === 'shortcuts' ? 'active' : ''}`}
        onClick={() => setActiveTab('shortcuts')}
        style={{ marginTop: 'auto' }}
      >
        <Keyboard size={16} />
        <span>Teclas de Atalho</span>
      </button>

      <button
        type="button"
        className="sidebar-item sidebar-quit"
        onClick={onQuit}
      >
        <Power size={16} />
        <span>Fechar Metis</span>
      </button>
    </div>
  );
};

export default SettingsSidebar;
