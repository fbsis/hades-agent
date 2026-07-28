import React from 'react';
import { X } from 'lucide-react';
import { electronService } from '../services/electron';

const TitleBar: React.FC = () => {
  const handleClose = () => {
    electronService.quitApp();
  };

  return (
    <header className="title-bar">
      <div className="drag-region" style={{ display: 'flex', alignItems: 'center' }}>
        <img 
          src="./icon/icon.png"
          alt="Metis"
          style={{ 
            width: '16px', 
            height: '16px', 
            marginRight: '8px', 
            marginLeft: '8px',
            borderRadius: '4px',
            border: '1px solid rgb(var(--color-primary-rgb) / 0.55)',
            objectFit: 'cover'
          }} 
        />
        <span className="app-title">Metis</span>
      </div>
      <div className="window-controls">
        <button onClick={handleClose} className="close-btn" title="Sair do Metis">
          <X size={14} />
        </button>
      </div>
    </header>
  );
};

export default TitleBar;
