function geminiGenerationConfig(modelName, variant) {
  const quick = variant === 'quick';
  return {
    temperature: quick ? 0.15 : 0.25,
    ...(quick ? {} : { maxOutputTokens: variant === 'code' ? 1400 : 700 }),
    ...(quick && /gemini-2\.5-flash/i.test(modelName)
      ? { thinkingConfig: { thinkingBudget: 0 } }
      : {})
  };
}

module.exports = { geminiGenerationConfig };
