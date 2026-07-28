import React, { useRef } from 'react';
import { electronService } from '../services/electron';

const DRAG_THRESHOLD = 4;

const FloatingHead: React.FC = () => {
  const dragState = useRef({
    isDown: false,
    moved: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0
  });

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      isDown: true,
      moved: false,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragState.current;
    if (!state.isDown) return;

    const deltaX = event.screenX - state.lastX;
    const deltaY = event.screenY - state.lastY;
    if (Math.abs(deltaX) + Math.abs(deltaY) < 1) return;

    if (Math.abs(event.screenX - state.startX) > DRAG_THRESHOLD || Math.abs(event.screenY - state.startY) > DRAG_THRESHOLD) {
      state.moved = true;
    }

    electronService.moveFloatingHead({ x: deltaX, y: deltaY });
    state.lastX = event.screenX;
    state.lastY = event.screenY;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragState.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragState.current.isDown = false;
    if (!state.moved) {
      electronService.floatingHeadClick();
    }
  };

  const handlePointerCancel = () => {
    dragState.current.isDown = false;
  };

  return (
    <div className="floating-head-window">
      <button
        type="button"
        className="floating-head-button"
        aria-label="Abrir Metis"
        title="Abrir Metis"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <span className="floating-head-glow" />
        <img
          className="floating-head-logo"
          src="/icon/metis-symbol.png"
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      </button>
    </div>
  );
};

export default FloatingHead;
