function resolveInterviewTranscriptionProvider(provider) {
  return provider === 'google-cloud' ? 'google-cloud' : 'gemini-live';
}

module.exports = { resolveInterviewTranscriptionProvider };
