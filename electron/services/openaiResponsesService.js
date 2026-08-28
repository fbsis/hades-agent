const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';

function extractResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  return (data?.output || [])
    .flatMap(item => item?.content || [])
    .filter(part => part?.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim();
}

async function generateText({
  apiKey,
  model = 'gpt-5.6-luna',
  instructions,
  input,
  maxOutputTokens = 700,
  reasoningEffort = 'none',
  verbosity = 'low',
  textFormat,
  signal,
  fetchImpl = globalThis.fetch
}) {
  if (!apiKey) throw new Error('OpenAI API key nao configurada.');
  if (typeof fetchImpl !== 'function') throw new Error('fetch nao esta disponivel.');

  const outputTokenLimit = Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
    ? { max_output_tokens: maxOutputTokens }
    : {};

  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      ...outputTokenLimit,
      reasoning: { effort: reasoningEffort },
      text: { verbosity, ...(textFormat ? { format: textFormat } : {}) },
      store: false
    }),
    signal
  });

  const rawText = await response.text();
  let data;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message = data?.error?.message || rawText || response.statusText;
    throw new Error(`OpenAI HTTP ${response.status}: ${message}`);
  }

  const text = extractResponseText(data);
  if (!text) throw new Error('OpenAI nao retornou texto.');

  return {
    text,
    model: data.model || model,
    usage: data.usage || null,
    responseId: data.id || null
  };
}

async function generateTextStream({
  apiKey,
  model = 'gpt-5.6-sol',
  instructions,
  input,
  maxOutputTokens = 4096,
  reasoningEffort = 'none',
  verbosity = 'low',
  signal,
  onDelta = () => {},
  fetchImpl = globalThis.fetch
}) {
  if (!apiKey) throw new Error('OpenAI API key nao configurada.');
  if (typeof fetchImpl !== 'function') throw new Error('fetch nao esta disponivel.');

  const outputTokenLimit = Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
    ? { max_output_tokens: maxOutputTokens }
    : {};

  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      ...outputTokenLimit,
      reasoning: { effort: reasoningEffort },
      text: { verbosity },
      stream: true,
      store: false
    }),
    signal
  });

  if (!response.ok) {
    const rawText = await response.text();
    let data;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = {};
    }
    const message = data?.error?.message || rawText || response.statusText;
    throw new Error(`OpenAI HTTP ${response.status}: ${message}`);
  }
  if (!response.body) throw new Error('OpenAI nao retornou um stream.');

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let text = '';
  let completedResponse = null;

  const processEvent = eventBlock => {
    const dataLine = eventBlock
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n');
    if (!dataLine || dataLine === '[DONE]') return;

    let event;
    try {
      event = JSON.parse(dataLine);
    } catch {
      return;
    }

    if (event.type === 'response.output_text.delta' && event.delta) {
      text += event.delta;
      onDelta(event.delta);
    } else if (event.type === 'response.completed') {
      completedResponse = event.response || null;
    } else if (event.type === 'response.failed' || event.type === 'error') {
      const message = event.error?.message
        || event.response?.error?.message
        || 'O stream da OpenAI falhou.';
      throw new Error(message);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    blocks.forEach(processEvent);
    if (done) break;
  }
  if (buffer.trim()) processEvent(buffer);

  const finalText = text.trim() || extractResponseText(completedResponse);
  if (!finalText) throw new Error('OpenAI nao retornou texto.');

  return {
    text: finalText,
    model: completedResponse?.model || model,
    usage: completedResponse?.usage || null,
    responseId: completedResponse?.id || null
  };
}

async function transcribeAudio({
  apiKey,
  base64Audio,
  model = 'gpt-4o-mini-transcribe',
  language = 'pt',
  fetchImpl = globalThis.fetch
}) {
  if (!apiKey) throw new Error('OpenAI API key nao configurada.');
  if (!base64Audio) throw new Error('Audio vazio.');
  if (typeof fetchImpl !== 'function') throw new Error('fetch nao esta disponivel.');

  const normalized = String(base64Audio).replace(/^data:[^;]+;base64,/, '');
  const bytes = Buffer.from(normalized, 'base64');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'metis-voice.wav');
  form.append('model', model);
  if (language) form.append('language', language);
  form.append('response_format', 'json');

  const response = await fetchImpl(OPENAI_TRANSCRIPTIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  const rawText = await response.text();
  let data;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const message = data?.error?.message || rawText || response.statusText;
    throw new Error(`OpenAI HTTP ${response.status}: ${message}`);
  }

  const text = String(data.text || '').trim();
  if (!text) throw new Error('OpenAI nao retornou transcricao.');
  return text;
}

module.exports = {
  OPENAI_RESPONSES_URL,
  OPENAI_TRANSCRIPTIONS_URL,
  extractResponseText,
  generateText,
  generateTextStream,
  transcribeAudio
};
