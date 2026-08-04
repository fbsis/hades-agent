import { describe, expect, it, vi } from 'vitest';
import openaiResponsesService from './openaiResponsesService.js';

const {
  OPENAI_RESPONSES_URL,
  OPENAI_TRANSCRIPTIONS_URL,
  extractResponseText,
  generateText,
  generateTextStream,
  transcribeAudio
} = openaiResponsesService;

describe('openaiResponsesService', () => {
  it('extracts text from Responses API output items', () => {
    expect(extractResponseText({
      output: [{
        type: 'message',
        content: [
          { type: 'output_text', text: '- Prefere respostas curtas.' },
          { type: 'refusal', refusal: 'ignored' }
        ]
      }]
    })).toBe('- Prefere respostas curtas.');
  });

  it('uses the low-cost stateless Dreaming request contract', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        id: 'resp_123',
        model: 'gpt-5.6-luna',
        output_text: '- Usa TypeScript.'
      })
    });

    const result = await generateText({
      apiKey: 'test-key',
      instructions: 'Consolide.',
      input: 'session logs',
      fetchImpl
    });

    expect(result.text).toBe('- Usa TypeScript.');
    expect(fetchImpl).toHaveBeenCalledWith(
      OPENAI_RESPONSES_URL,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' })
      })
    );

    const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(request).toMatchObject({
      model: 'gpt-5.6-luna',
      reasoning: { effort: 'none' },
      text: { verbosity: 'low' },
      store: false
    });
  });

  it('keeps multimodal interview images stateless', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        model: 'gpt-5.6-sol',
        output_text: '{"detectedQuestion":"What is the output?"}'
      })
    });
    const input = [{
      role: 'user',
      content: [
        { type: 'input_text', text: 'Read the question.' },
        { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'high' }
      ]
    }];

    await generateText({
      apiKey: 'test-key',
      model: 'gpt-5.6-sol',
      instructions: 'Analyze the image.',
      input,
      reasoningEffort: 'low',
      verbosity: 'medium',
      fetchImpl
    });

    const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(request).toMatchObject({
      model: 'gpt-5.6-sol',
      input,
      reasoning: { effort: 'low' },
      text: { verbosity: 'medium' },
      store: false
    });
  });

  it('streams OpenAI interview answer deltas in order', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: response.output_text.delta\n'
          + 'data: {"type":"response.output_text.delta","delta":"**Resumo**\\n"}\n\n'
        ));
        controller.enqueue(encoder.encode(
          'event: response.output_text.delta\n'
          + 'data: {"type":"response.output_text.delta","delta":"- Event loop"}\n\n'
          + 'event: response.completed\n'
          + 'data: {"type":"response.completed","response":{"id":"resp_456","model":"gpt-5.6-sol"}}\n\n'
        ));
        controller.close();
      }
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, body });
    const deltas = [];

    const result = await generateTextStream({
      apiKey: 'test-key',
      instructions: 'Answer the interview question.',
      input: 'Explain the event loop.',
      onDelta: delta => deltas.push(delta),
      fetchImpl
    });

    expect(deltas).toEqual(['**Resumo**\n', '- Event loop']);
    expect(result.text).toBe('**Resumo**\n- Event loop');
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(request).toMatchObject({
      model: 'gpt-5.6-sol',
      stream: true,
      store: false
    });
  });

  it('sends one-shot voice audio only to the OpenAI transcription endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ text: 'Explique o event loop.' })
    });

    const text = await transcribeAudio({
      apiKey: 'test-key',
      base64Audio: Buffer.from('wav-data').toString('base64'),
      fetchImpl
    });

    expect(text).toBe('Explique o event loop.');
    expect(fetchImpl).toHaveBeenCalledWith(
      OPENAI_TRANSCRIPTIONS_URL,
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
        body: expect.any(FormData)
      })
    );
    const form = fetchImpl.mock.calls[0][1].body;
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(form.get('language')).toBe('pt');
  });
});
