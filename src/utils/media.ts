export const getMicrophoneConstraints = (inputDeviceId?: string): boolean | MediaTrackConstraints => (
  inputDeviceId && inputDeviceId !== 'default'
    ? { deviceId: { exact: inputDeviceId } }
    : true
);

export const getAudioCaptureErrorMessage = (error: unknown, isSystemAudio: boolean) => {
  if (isSystemAudio) {
    return 'Não foi possível capturar o áudio do sistema. Verifique a permissão de Gravação de Tela e Áudio do Sistema para o Metis.';
  }

  const name = error && typeof error === 'object' && 'name' in error
    ? String(error.name)
    : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'NotAllowedError' || message === 'MICROPHONE_PERMISSION_DENIED') {
    return 'O acesso ao microfone está bloqueado. Ative o Metis em Ajustes do Sistema → Privacidade e Segurança → Microfone e reinicie o aplicativo.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'O microfone selecionado não está disponível. Conecte o dispositivo ou escolha outro em Configurações → Áudio.';
  }
  if (name === 'NotReadableError') {
    return 'O microfone não pôde ser iniciado. Verifique se o dispositivo está conectado e disponível.';
  }
  return 'Não foi possível iniciar o microfone. Verifique a permissão e o dispositivo selecionado.';
};
