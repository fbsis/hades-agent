function textItems(params) {
  if (!params.selectionText?.trim() || params.inputFieldType === 'password') return [];
  const actions = [['translate', 'Traduzir com o Metis'], ['proofread', 'Corrigir com o Metis'], ['rewrite', 'Reescrever com o Metis'], ['summarize', 'Resumir com o Metis'], ['explain', 'Explicar com o Metis']];
  return actions.map(([action, label]) => ({ label, click: async () => {
    const selection = require('./selectedTextService');
    try {
      const captured = await selection.capture(process.pid);
      if (captured.text?.trim() !== params.selectionText.trim()) selection.adopt(params.selectionText, 'Não foi possível confirmar a seleção original; resultado disponível para copiar.');
    } catch { selection.adopt(params.selectionText, selection.getSelection().error); }
    selection.setAction(action);
    require('../windows/windowManager').showTextActions(selection.getSelection());
  } }));
}
module.exports = { textItems };
