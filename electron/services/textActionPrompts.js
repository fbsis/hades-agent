const ACTION_INSTRUCTIONS = {
  translate: 'Traduza o texto. Se estiver em português, traduza para inglês; caso contrário, traduza para pt-BR. Preserve sentido, tom e formatação.',
  simplify: 'Simplifique o texto para torná-lo mais fácil de entender, preservando o significado e as informações importantes. Retorne somente o texto simplificado.',
  explain: 'Explique o texto em pt-BR de maneira clara e objetiva. Preserve termos técnicos importantes.',
  summarize: 'Resuma o texto em pt-BR, preservando as informações essenciais.',
  proofread: 'Corrija gramática, ortografia e pontuação sem alterar o significado ou o tom. Retorne somente o texto corrigido.',
  rewrite: 'Reescreva o texto com mais clareza, fluidez e naturalidade. Retorne somente o texto reescrito.',
  professional: 'Reescreva o texto em tom profissional, direto e respeitoso. Retorne somente o texto reescrito.',
  friendly: 'Reescreva o texto em tom amigável, natural e acolhedor. Retorne somente o texto reescrito.',
  shorten: 'Encurte o texto, removendo redundâncias sem perder informações importantes. Retorne somente o texto encurtado.',
  expand: 'Expanda o texto com detalhes úteis e naturais, sem inventar fatos. Retorne somente o texto expandido.'
};

function buildTextActionPrompt(action, customInstruction) {
  if (action === 'custom') {
    const instruction = String(customInstruction || '').trim();
    if (!instruction) throw new Error('Descreva o que deseja fazer com o texto.');
    return instruction;
  }
  const instruction = ACTION_INSTRUCTIONS[action];
  if (!instruction) throw new Error('Ação de texto inválida.');
  return instruction;
}

module.exports = { ACTION_INSTRUCTIONS, buildTextActionPrompt };
