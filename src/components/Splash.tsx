import React, { useEffect, useState } from 'react';

const Splash: React.FC = () => {
  const [phase, setPhase] = useState<'entering' | 'visible' | 'leaving'>('entering');

  useEffect(() => {
    const enterTimer = setTimeout(() => setPhase('visible'), 50);
    const leaveTimer = setTimeout(() => setPhase('leaving'), 2400);
    return () => {
      clearTimeout(enterTimer);
      clearTimeout(leaveTimer);
    };
  }, []);

  const visible = phase === 'visible';

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        border: '1px solid rgb(var(--color-primary-rgb) / 0.22)',
        borderRadius: '18px',
        boxSizing: 'border-box',
        background: 'var(--surface-base)',
        opacity: visible ? 1 : 0,
        transform: phase === 'leaving' ? 'scale(0.985)' : visible ? 'scale(1)' : 'scale(0.985)',
        transition: 'opacity 700ms ease, transform 700ms ease',
        WebkitAppRegion: 'drag',
        userSelect: 'none'
      } as React.CSSProperties}
    >
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '28px',
          padding: '28px 42px'
        }}
      >
        <img
          src="./icon/icon.png"
          alt="Metis"
          style={{
            width: '132px',
            height: '132px',
            flexShrink: 0,
            borderRadius: '26px',
            objectFit: 'cover',
            boxShadow: '0 18px 42px rgba(0, 0, 0, 0.36)'
          }}
        />
        <div
          aria-hidden="true"
          style={{
            width: '1px',
            height: '116px',
            background: 'rgba(255, 255, 255, 0.12)'
          }}
        />
        <div style={{ minWidth: '260px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <strong
            style={{
              color: 'var(--text-main)',
              fontFamily: "'Inter', system-ui, sans-serif",
              fontSize: '46px',
              fontWeight: 720,
              lineHeight: 1,
              letterSpacing: 0
            }}
          >
            METIS
          </strong>
          <span
            style={{
              color: 'var(--color-gold)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: 0
            }}
          >
            INTELIGÊNCIA PRÁTICA
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'var(--color-primary)',
                boxShadow: '0 0 10px rgb(var(--color-primary-rgb) / 0.8)'
              }}
            />
            <span style={{ color: 'rgba(255, 255, 255, 0.38)', fontSize: '10px' }}>
              Inicializando assistente
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Splash;
