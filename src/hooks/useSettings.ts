import { useState, useEffect } from 'react';
import { electronService } from '../services/electron';
import { SettingsData } from '../types/electron';

export type SettingsTab = 'history' | 'audio' | 'general' | 'hermes' | 'shortcuts';

export function useSettings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('history');
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadSettings();

    const unsubscribe = electronService.onSettingsUpdated((updatedData) => {
      if (updatedData) {
        setSettings(updatedData);
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const data = await electronService.getSettings();
      if (data) setSettings(data);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const updateAudioSettings = (updates: Partial<SettingsData['audio']>) => {
    setSettings((prev) => prev ? { ...prev, audio: { ...prev.audio, ...updates } } : null);
  };

  const updateGeneralSettings = (updates: Partial<SettingsData['general']>) => {
    setSettings((prev) => {
      if (!prev) return null;
      const nextGeneral = { ...prev.general, ...updates };
      // Apply stealth mode immediately for preview
      if (updates.stealthMode !== undefined) {
        electronService.applyStealthMode(updates.stealthMode);
      }
      return { ...prev, general: nextGeneral };
    });
  };

  const updateShortcutsSettings = (updates: Partial<SettingsData['shortcuts']>) => {
    setSettings((prev) => {
      if (!prev) return null;
      const nextShortcuts = { ...prev.shortcuts, ...updates };
      return { ...prev, shortcuts: nextShortcuts };
    });
  };

  const updateHermesSettings = (updates: Partial<SettingsData['hermes']>) => {
    setSettings((prev) => {
      if (!prev) return null;
      const nextHermes = { ...prev.hermes, ...updates };
      return { ...prev, hermes: nextHermes };
    });
  };

  const updateAssistantSettings = (updates: Partial<SettingsData['assistant']>) => {
    setSettings((prev) => {
      if (!prev) return null;
      const nextAssistant = { ...prev.assistant, ...updates };
      return { ...prev, assistant: nextAssistant };
    });
  };

  const saveAll = async () => {
    if (!settings) return;
    setIsSaving(true);
    try {
      await electronService.saveSettings(settings);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return {
    activeTab,
    setActiveTab,
    settings,
    isLoading,
    isSaving,
    updateAudioSettings,
    updateGeneralSettings,
    updateShortcutsSettings,
    updateHermesSettings,
    updateAssistantSettings,
    saveAll
  };
}
