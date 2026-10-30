const { captureBookmark } = require('./textSelectionBookmark');
function textItems(params, win) {
  if (!params.selectionText?.trim() || params.inputFieldType === 'password') return [];
  if (params.selectionText.length > 30000) return [{ label: 'Selecione até 30.000 caracteres para transformar', enabled: false }];
  const bookmark = win && params.isEditable ? captureBookmark(win, params.selectionText).catch(() => null) : Promise.resolve(null);
  const actions = [['translate', 'Traduzir com o Metis'], ['proofread', 'Corrigir com o Metis'], ['rewrite', 'Reescrever com o Metis'], ['summarize', 'Resumir com o Metis'], ['explain', 'Explicar com o Metis']];
  return actions.map(([action, label]) => ({ label, click: async () => {
    const selection = require('./selectedTextService');
    const manager = require('../windows/windowManager');
    let result = '';
    try {
      const source = await bookmark;
      result = await require('./textActionService').runTextAction({ action, text: params.selectionText });
      if (!['summarize', 'explain'].includes(action) && source && await source.replace(result)) return;
      const error = !['summarize', 'explain'].includes(action) ? 'A seleção não é editável ou mudou. O original foi mantido; o resultado está disponível para copiar.' : '';
      selection.presentResult(params.selectionText, result, error);
    } catch {
      selection.presentResult(params.selectionText, result, 'Não foi possível aplicar a transformação. O original foi mantido. Confira a seleção e a configuração OpenAI.');
    }
    manager.showTextActions(selection.getSelection());
  } }));
}
module.exports = { textItems };
