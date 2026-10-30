import React, { useEffect, useState } from 'react';
import { electronService } from '../../services/electron';
import type { TextActionsSetupState } from '../../types/electron';

export default function TextActionsSetup({ onShortcutConfigured }: { onShortcutConfigured?: (shortcut: string) => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<TextActionsSetupState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = () => electronService.getTextActionsSetup().then(setStatus);
  useEffect(() => { if (open) void refresh(); }, [open]);
  async function configure(remove = false) {
    setBusy(true); setMessage('');
    try {
      const result = remove ? await electronService.removeTextActionsSetup() : await electronService.configureTextActionsSetup();
      setStatus(result);
      if (!remove && !result.cancelled) onShortcutConfigured?.(result.shortcut);
      if (!result.cancelled) setMessage(result.message || (remove ? 'Serviços Metis removidos.' : 'Configuração concluída.'));
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="setting-row" style={{ display: 'block' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
      <div className="setting-info"><div className="setting-title">Ações de texto neste computador</div><div className="setting-desc">Atalho, permissões e menu Serviços do macOS. Use também ao configurar um Mac novo.</div></div>
      <button type="button" className="settings-action-btn" aria-expanded={open} onClick={() => setOpen(!open)}>Configurar ações de texto neste computador</button>
    </div>
    {open && <div style={{ paddingTop: 14 }}>
      {!status ? <p>Carregando assistente… Se não aparecer, reinicie o Metis.</p> : !status.supported ? <p>O menu Serviços exige macOS 14 ou mais recente. As configurações de texto deste Mac são independentes da integração web.</p> : <>
        <ul style={{ paddingLeft: 20, fontSize: 12, lineHeight: 1.9 }}>
          <li>OpenAI: {status.openaiConfigured ? 'chave configurada neste perfil' : 'salve sua chave OpenAI no campo abaixo'}</li>
          <li>Atalho: {status.shortcut} — {status.shortcutRegistered ? 'ativo' : 'ocupado; pause WritingTools/outro app'}</li>
          <li>Acessibilidade: {status.accessibility ? 'autorizada' : 'autorize o Metis/Electron no sistema'}</li>
          <li>Automação: confira Metis/Electron → System Events nas permissões do sistema</li>
          <li>Menu Serviços: {status.servicesInstalled}/3 itens Metis instalados</li>
          <li>Substituição direta: Traduzir, Corrigir e Reescrever, sem segunda confirmação</li>
        </ul>
        <p className="setting-desc">A configuração instala somente os Serviços Metis e prepara Option+Espaço. O macOS pode exigir ativá-los em Teclado → Atalhos → Serviços. Para o atalho, autorize Electron/Metis em Acessibilidade e Automação; esses consentimentos não podem ser concedidos pelo app.</p>
        {status.error && <p role="alert">{status.error}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button type="button" className="settings-action-btn primary" disabled={busy} onClick={() => void configure()}>{busy ? 'Configurando…' : 'Configurar neste Mac'}</button>
          <button type="button" className="settings-action-btn" onClick={() => electronService.openTextAccessibility()}>Acessibilidade</button>
          <button type="button" className="settings-action-btn" onClick={() => electronService.openTextAccessibility('automation')}>Automação</button>
          <button type="button" className="settings-action-btn" onClick={() => electronService.openTextAccessibility('services')}>Serviços do macOS</button>
          <button type="button" className="settings-action-btn" disabled={busy} onClick={() => void refresh()}>Verificar novamente</button>
          {!!status.servicesInstalled && <button type="button" className="settings-action-btn" disabled={busy} onClick={() => void configure(true)}>Remover Serviços Metis</button>}
        </div>
      </>}
      {message && <p role="status" style={{ marginTop: 10 }}>{message}</p>}
    </div>}
  </section>;
}
