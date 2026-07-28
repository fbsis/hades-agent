function geminiGenerationConfig(modelName, variant) {
  const quick = variant === 'quick';
  const maxOutputTokens = variant === 'code'
    ? 8192
    : quick
      ? 2048
      : 4096;
  return {
    temperature: quick ? 0.15 : 0.25,
    maxOutputTokens,
    ...(quick && /gemini-2\.5-flash/i.test(modelName)
      ? { thinkingConfig: { thinkingBudget: 0 } }
      : {})
  };
}

module.exports = { geminiGenerationConfig };
