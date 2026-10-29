import React, { Children, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import SettingsSidebar from './SettingsSidebar';
import type { SettingsTab } from '../../hooks/useSettings';

const tabs: SettingsTab[] = ['audio', 'general', 'hermes', 'mcp', 'shortcuts'];
describe('web integration entry in settings', () => {
  it.each(tabs)('is visible from the %s tab, without opening general settings first', activeTab => {
    const html = renderToStaticMarkup(<SettingsSidebar activeTab={activeTab} setActiveTab={vi.fn()} onQuit={vi.fn()} onOpenWorkSettings={vi.fn()} />);
    expect(html).toContain('Configurar integração com o Metis web');
    expect(html).toContain('Metis web</span>');
  });

  it('opens native integration settings directly, independently of tab navigation', () => {
    const onOpenWorkSettings = vi.fn();
    const setActiveTab = vi.fn();
    const tree = SettingsSidebar({ activeTab: 'shortcuts', setActiveTab, onQuit: vi.fn(), onOpenWorkSettings }) as React.ReactElement<{ children: React.ReactNode }>;
    const button = Children.toArray(tree.props.children).find(child => isValidElement(child) && (child.props as { 'aria-label'?: string })['aria-label'] === 'Configurar integração com o Metis web') as React.ReactElement<{ onClick: () => void }>;
    button.props.onClick();
    expect(onOpenWorkSettings).toHaveBeenCalledOnce();
    expect(setActiveTab).not.toHaveBeenCalled();
  });
});
