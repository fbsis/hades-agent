import { describe, it, expect, vi } from 'vitest';
import presentation from './macPresentation.js';
describe('discreet macOS presentation', () => {
  it('hides Dock and application menu without disabling windows or shortcuts', () => {
    const app = { setActivationPolicy: vi.fn(), dock: { hide: vi.fn() } };
    const Menu = { setApplicationMenu: vi.fn() };
    presentation.configureMacPresentation(app, Menu, 'darwin');
    expect(app.setActivationPolicy).toHaveBeenCalledWith('accessory');
    expect(app.dock.hide).toHaveBeenCalledOnce();
    expect(Menu.setApplicationMenu).toHaveBeenCalledWith(null);
  });
  it('does not change other platforms', () => {
    const app = { setActivationPolicy: vi.fn(), dock: { hide: vi.fn() } };
    const Menu = { setApplicationMenu: vi.fn() };
    presentation.configureMacPresentation(app, Menu, 'win32');
    expect(app.setActivationPolicy).not.toHaveBeenCalled();
    expect(Menu.setApplicationMenu).not.toHaveBeenCalled();
  });
});
