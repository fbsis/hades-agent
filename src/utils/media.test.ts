import { describe, expect, it } from 'vitest';
import { getAudioCaptureErrorMessage, getMicrophoneConstraints } from './media';

describe('getMicrophoneConstraints', () => {
  it('uses the system default when no explicit device is selected', () => {
    expect(getMicrophoneConstraints()).toBe(true);
    expect(getMicrophoneConstraints('default')).toBe(true);
  });

  it('targets the selected microphone exactly', () => {
    expect(getMicrophoneConstraints('usb-microphone')).toEqual({
      deviceId: { exact: 'usb-microphone' }
    });
  });
});

describe('getAudioCaptureErrorMessage', () => {
  it('explains a denied microphone permission', () => {
    expect(getAudioCaptureErrorMessage(new Error('MICROPHONE_PERMISSION_DENIED'), false))
      .toContain('Privacidade e Segurança → Microfone');
  });

  it('explains an unavailable selected device', () => {
    expect(getAudioCaptureErrorMessage({ name: 'OverconstrainedError' }, false))
      .toContain('microfone selecionado não está disponível');
  });

  it('uses the system-audio guidance for system capture failures', () => {
    expect(getAudioCaptureErrorMessage(new Error('capture failed'), true))
      .toContain('Gravação de Tela e Áudio do Sistema');
  });
});
