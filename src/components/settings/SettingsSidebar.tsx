import React from 'react';
import { SettingsTab } from '../../hooks/useSettings';
import { Bot, Clock, Volume2, Settings as SettingsIcon, Keyboard } from 'lucide-react';

interface SidebarProps {
  activeTab: SettingsTab;
  setActiveTab: (tab: SettingsTab) => void;
}

const SettingsSidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  return (
    <div className="settings-sidebar">
      <div className="sidebar-title">Menu</div>
      
      <button 
        type="button"
        className={`sidebar-item ${activeTab === 'history' ? 'active' : ''}`}
        onClick={() => setActiveTab('history')}
      >
        <Clock size={16} />
        <span>Histórico</span>
      </button>
      
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
    </div>
  );
};

export default SettingsSidebar;
