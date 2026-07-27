const DEFAULT_CONFIG = {
  mode: 'meeting',
  title: '',
  description: '',
  role: '',
  company: '',
  resume: '',
  jobDescription: '',
  language: 'pt-BR',
  answerStyle: 'natural',
  transcriptionProvider: 'whisper-local',
  googleCloudProjectId: '',
  extraInstructions: '',
  transcribeMicrophone: false,
  saveTranscript: true,
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

function clipDocument(value, maxChars) {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  const headLength = Math.floor(maxChars * 0.65);
  const tailLength = maxChars - headLength;
  return `${text.slice(0, headLength)}\n\n[document shortened]\n\n${text.slice(-tailLength)}`;
}

function selectRecentInterviewTexts(turns, limit = 5) {
  return (Array.isArray(turns) ? turns : [])
    .map(turn => ({
      source: turn?.source || 'interviewer',
      text: `${turn?.text || ''}${turn?.pendingText || ''}`.replace(/\s+/g, ' ').trim()
    }))
    .filter(turn => turn.text)
    .slice(-limit);
}

function buildGeminiInterviewPrompt(args = {}) {
  const config = { ...DEFAULT_CONFIG, ...(args.config || {}) };
  const question = String(args.question || '').replace(/\s+/g, ' ').trim();
  const quickFragments = (Array.isArray(args.quickFragments) ? args.quickFragments : [])
    .map(fragment => String(fragment || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-5);
  const recentTexts = selectRecentInterviewTexts(args.turns, 5);
  const recentConversation = recentTexts
    .map(turn => `${SOURCE_LABELS[turn.source] || turn.source}: ${turn.text}`)
    .join('\n');
  const questionAlreadyIncluded = recentTexts.some(turn => turn.text === question);

  return [
    '<meeting_context>',
    `Mode: ${config.mode}`,
    config.title ? `Meeting title: ${config.title}` : '',
    config.description ? `<meeting_description>\n${clipDocument(config.description, 3000)}\n</meeting_description>` : '',
    config.role ? `Target role: ${config.role}` : '',
    config.company ? `Company: ${config.company}` : '',
    config.resume ? `<resume>\n${clipDocument(config.resume, 8000)}\n</resume>` : '<resume>Not provided</resume>',
    config.jobDescription
      ? `<job_description>\n${clipDocument(config.jobDescription, 4000)}\n</job_description>`
      : '<job_description>Not provided</job_description>',
    config.extraInstructions
      ? `<candidate_instructions>\n${clipDocument(config.extraInstructions, 1200)}\n</candidate_instructions>`
      : '',
    quickFragments.length
      ? `<latest_live_fragments>\n${quickFragments.map((fragment, index) => `${index + 1}. ${fragment}`).join('\n')}\n</latest_live_fragments>`
      : '',
    recentConversation && !quickFragments.length
      ? `<last_five_conversation_texts>\n${recentConversation}\n</last_five_conversation_texts>`
      : '',
    args.visualContext
      ? `<screen_context>\n${clipDocument(args.visualContext, 2000)}\n</screen_context>`
      : '',
    args.sessionSummary
      ? `<meeting_summary>\n${clipDocument(args.sessionSummary, 3000)}\n</meeting_summary>`
      : '',
    !quickFragments.length && !questionAlreadyIncluded && question
      ? `<question>\n${question}\n</question>`
      : '',
    '</meeting_context>',
    '',
    args.variant === 'quick'
      ? 'Infer the current question from the latest live fragments, including an incomplete final fragment, and answer as the participant.'
      : 'Answer the current question as the participant.'
  ].filter(Boolean).join('\n');
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
    `Mode: ${config.mode}`,
    config.title ? `Meeting title: ${config.title}` : '',
    config.description ? `Meeting description: ${clip(config.description, 1200)}` : '',
    config.role ? `Target role: ${config.role}` : '',
    config.company ? `Company: ${config.company}` : '',
    config.resume ? `Candidate resume:\n${clipDocument(config.resume, 2400)}` : '',
    config.jobDescription ? `Job description: ${clip(config.jobDescription, 1200)}` : '',
    config.extraInstructions ? `Candidate instructions: ${clip(config.extraInstructions, 600)}` : '',
    config.language !== 'auto' ? `Response language: ${config.language}` : 'Response language: same as the question',
    recentTurns ? `Recent interview context:\n${recentTurns}` : '',
    args.sessionSummary ? `Saved meeting summary:\n${clip(args.sessionSummary, 1600)}` : '',
    args.visualContext ? `Current screen context from Gemini:\n${clip(args.visualContext, 1600)}` : ''
  ].filter(Boolean).join('\n\n'), 4800);
}

function buildInterviewInstruction(args = {}) {
  const style = args.config?.answerStyle || 'natural';
  const variant = args.variant || 'answer';
  const candidateContextInstruction = args.provider === 'gemini'
    ? 'Use the supplied resume, job description and recent conversation as the candidate context.'
    : 'Use the Hermes persistent memory for the candidate resume and experiences when relevant.';
  const variantInstruction = {
    quick: [
      'Infer the current question from the latest live fragments, even when the last fragment ends mid-word.',
      'Answer the inferred question directly using the mandatory two-level bullet format.'
    ].join(' '),
    shorter: 'Rewrite as a much shorter answer that takes at most 30 seconds to say.',
    detail: 'Add useful concrete detail while keeping the answer easy to speak.',
    star: 'Use a compact STAR structure grounded in the candidate resume or memory.',
    code: 'Treat this as a coding question. Explain the approach and trade-offs briefly, then provide correct Markdown code.',
    retry: 'Produce a better alternative without referring to the previous answer.',
    answer: ''
  }[variant] || '';

  return [
    args.config?.mode === 'meeting'
      ? 'Act as a real-time meeting copilot for the participant.'
      : 'Act as a real-time interview copilot for the candidate.',
    'Answer in first person as words the participant can naturally say aloud.',
    candidateContextInstruction,
    'When the supplied context lacks a relevant documented experience, you may create a plausible illustrative example, but frame it explicitly as an opinion, hypothetical approach, or what the candidate would do rather than as a verified past event.',
    variant === 'quick'
      ? ''
      : 'Default length is 45 to 90 seconds. Keep the response easy to scan while the candidate is speaking.',
    'Always use this exact two-level Markdown structure for every answer, regardless of question type:',
    '"**Resumo**" followed by 2 to 4 short bullet points using "- " that give the direct, essential answer.',
    '"**Aprofundamento**" followed by 2 to 4 advanced bullet points using "- " that demonstrate deeper knowledge through relevant details, trade-offs, edge cases, architecture, or concrete examples.',
    'Keep each bullet independently readable while the candidate is speaking. Do not write prose paragraphs, introductions, or conclusions outside the bullets.',
    'For behavioral questions, distribute a compact STAR flow across the summary and advanced bullets without naming the STAR sections.',
    'For coding questions, use the summary and advanced bullets for the approach and trade-offs, then provide a Markdown code block after the bullets.',
    `Configured style: ${style}.`,
    variantInstruction,
    'Return only the answer the candidate should use.'
  ].filter(Boolean).join(' ');
}

module.exports = {
  DEFAULT_CONFIG,
  buildGeminiInterviewPrompt,
  buildInterviewContext,
  buildInterviewInstruction,
  clip,
  selectRecentInterviewTexts
};
