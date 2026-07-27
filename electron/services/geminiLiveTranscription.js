function buildTranscriptionInstruction(record) {
  const language = record.language === 'pt-BR'
    ? 'The audio is Brazilian Portuguese. Never interpret it as Spanish.'
    : record.language === 'en-US'
      ? 'The audio is English.'
      : 'The audio is Brazilian Portuguese or English. Never interpret Portuguese as Spanish.';
  return record.personaPrompt || [
    'You are a high precision audio transcription engine.',
    'Transcribe exactly what is spoken through input_audio_transcription.',
    'Do not answer, comment, summarize or emit model text/audio.',
    'Preserve personal names, company names and other proper nouns in their original language.',
    language
  ].join(' ');
}

function buildAudioTranscriptionConfig(record) {
  const languageCodes = record.language === 'en-US'
    ? ['en-US']
    : record.language === 'pt-BR'
      ? ['pt-BR']
      : ['pt-BR', 'en-US'];
  return {
    languageHints: { languageCodes },
    ...(record.customVocabulary?.length ? { customVocabulary: record.customVocabulary } : {})
  };
}

module.exports = {
  buildAudioTranscriptionConfig,
  buildTranscriptionInstruction
};
