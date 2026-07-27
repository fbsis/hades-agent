function resolveInterviewTranscriptionProvider(provider) {
  if (provider === 'google-cloud') return 'google-cloud';
  if (provider === 'gemini-live') return 'gemini-live';
  return 'whisper-local';
}

module.exports = { resolveInterviewTranscriptionProvider };
