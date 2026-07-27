const DEFAULT_CONFIG = {
  role: '',
  company: '',
  jobDescription: '',
  language: 'auto',
  answerStyle: 'natural',
  extraInstructions: '',
  transcribeMicrophone: false,
  retainAudio: false
};

const SOURCE_LABELS = {
  interviewer: 'Interviewer',
  candidate: 'Candidate',
  screen: 'Screen',
  manual: 'Manual'
};

function clip(value, maxChars) {
  const text = String(value || '').trim();
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

function buildInterviewContext(args = {}) {
  const config = { ...DEFAULT_CONFIG, ...(args.config || {}) };
  const turns = Array.isArray(args.turns) ? args.turns : [];
  const recentTurns = turns
    .filter(turn => turn?.isFinal && turn.id !== args.turnId && String(turn.text || '').trim())
    .slice(-6)
    .map(turn => `${SOURCE_LABELS[turn.source] || turn.source}: ${String(turn.text).trim()}`)
    .join('\n');

  return clip([
    config.role ? `Target role: ${config.role}` : '',
    config.company ? `Company: ${config.company}` : '',
    config.jobDescription ? `Job description: ${clip(config.jobDescription, 1200)}` : '',
    config.extraInstructions ? `Candidate instructions: ${clip(config.extraInstructions, 600)}` : '',
    config.language !== 'auto' ? `Response language: ${config.language}` : 'Response language: same as the question',
    recentTurns ? `Recent interview context:\n${recentTurns}` : '',
    args.visualContext ? `Current screen context from Gemini:\n${clip(args.visualContext, 1600)}` : ''
  ].filter(Boolean).join('\n\n'), 4800);
}

function buildInterviewInstruction(args = {}) {
  const style = args.config?.answerStyle || 'natural';
  const variant = args.variant || 'answer';
  const variantInstruction = {
    shorter: 'Rewrite as a much shorter answer that takes at most 30 seconds to say.',
    detail: 'Add useful concrete detail while keeping the answer easy to speak.',
    star: 'Use a compact STAR structure grounded in the candidate resume or memory.',
    code: 'Treat this as a coding question. Explain the approach and trade-offs briefly, then provide correct Markdown code.',
    retry: 'Produce a better alternative without referring to the previous answer.',
    answer: ''
  }[variant] || '';

  return [
    'Act as a real-time interview copilot for the candidate.',
    'Answer in first person as words the candidate can naturally say aloud.',
    'Use the Hermes persistent memory for the candidate resume and experiences when relevant.',
    'Never invent a personal experience; when memory lacks one, give a truthful adaptable framing.',
    'Default length is 45 to 90 seconds. Avoid headings and bullets unless the question is technical.',
    'For behavioral questions, use a compact STAR flow without naming the STAR sections.',
    'For coding questions, give the approach and trade-offs before a Markdown code block.',
    `Configured style: ${style}.`,
    variantInstruction,
    'Return only the answer the candidate should use.'
  ].filter(Boolean).join(' ');
}

module.exports = {
  DEFAULT_CONFIG,
  buildInterviewContext,
  buildInterviewInstruction,
  clip
};
