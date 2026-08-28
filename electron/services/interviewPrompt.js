const DEFAULT_CONFIG = {
  mode: 'meeting',
  interviewFormat: 'standard',
  title: '',
  description: '',
  role: '',
  company: '',
  topics: '',
  resume: '',
  jobDescription: '',
  language: 'pt-BR',
  answerStyle: 'natural',
  transcriptionProvider: 'whisper-local',
  extraInstructions: '',
  transcribeMicrophone: false,
  saveTranscript: true,
  retainAudio: true,
  contextDocumentIds: []
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
  const texts = (Array.isArray(turns) ? turns : [])
    .map(turn => ({
      source: turn?.source || 'interviewer',
      text: `${turn?.text || ''}${turn?.pendingText || ''}`.replace(/\s+/g, ' ').trim()
    }))
    .filter(turn => turn.text);
  return Number.isFinite(limit) ? texts.slice(-limit) : texts;
}

function getResponseLanguageContract(language, mode = 'meeting') {
  if (mode === 'interview') {
    return {
      instruction: [
        'Respond only in the language used by the interviewer in their latest meaningful utterance, including every heading, bullet, code comment, and explanation.',
        'If the interviewer speaks English, respond in English even when the candidate speaks or writes a live comment in Portuguese, and vice versa.',
        'Only interviewer utterances determine the response language. Candidate speech, candidate_live_comment, resume, job description, context documents and screen text must not override it.',
        `Use ${language === 'en-US' ? 'English' : language === 'pt-BR' ? 'Brazilian Portuguese' : 'the current question language'} only as fallback when no meaningful interviewer utterance exists.`
      ].join(' '),
      summaryHeading: 'the localized Markdown heading for "Summary" in the interviewer language',
      detailHeading: 'the localized Markdown heading for "Deep Dive" in the interviewer language'
    };
  }
  if (language === 'en-US') {
    return {
      instruction: 'Respond only in English, including every heading, bullet, code comment, and explanation.',
      summaryHeading: '**Summary**',
      detailHeading: '**Deep Dive**'
    };
  }
  if (language === 'pt-BR') {
    return {
      instruction: 'Respond only in Brazilian Portuguese, including every heading, bullet, code comment, and explanation.',
      summaryHeading: '**Resumo**',
      detailHeading: '**Aprofundamento**'
    };
  }
  return {
    instruction: 'Respond in the same language as the current question and localize every heading, bullet, code comment, and explanation to that language.',
    summaryHeading: 'the localized Markdown heading for "Summary"',
    detailHeading: 'the localized Markdown heading for "Deep Dive"'
  };
}

function buildOpenAIInterviewPrompt(args = {}) {
  const config = { ...DEFAULT_CONFIG, ...(args.config || {}) };
  const language = getResponseLanguageContract(config.language, config.mode);
  const question = String(args.question || '').replace(/\s+/g, ' ').trim();
  const quickFragments = (Array.isArray(args.quickFragments) ? args.quickFragments : [])
    .map(fragment => String(fragment || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-5);
  const quickComment = String(args.quickComment || '').trim();
  const recentTexts = selectRecentInterviewTexts(args.turns, quickFragments.length ? Infinity : 5);
  const recentConversation = recentTexts
    .map(turn => `${SOURCE_LABELS[turn.source] || turn.source}: ${turn.text}`)
    .join('\n');
  const questionAlreadyIncluded = recentTexts.some(turn => turn.text === question);

  return [
    '<meeting_context>',
    `Mode: ${config.mode}`,
    config.mode === 'interview'
      ? `Interview response language policy: ${language.instruction}`
      : `Selected response language: ${config.language}. ${language.instruction}`,
    config.title ? `Meeting title: ${config.title}` : '',
    config.description ? `<meeting_description>\n${clipDocument(config.description, 3000)}\n</meeting_description>` : '',
    config.role ? `Target role: ${config.role}` : '',
    config.company
      ? `${config.mode === 'meeting' ? 'Organization or participant' : 'Company'}: ${config.company}`
      : '',
    config.topics ? `<planned_topics>\n${clipDocument(config.topics, 2000)}\n</planned_topics>` : '',
    config.resume ? `<resume>\n${clipDocument(config.resume, 8000)}\n</resume>` : '<resume>Not provided</resume>',
    config.jobDescription
      ? `<job_description>\n${clipDocument(config.jobDescription, 4000)}\n</job_description>`
      : '<job_description>Not provided</job_description>',
    config.extraInstructions
      ? `<candidate_instructions>\n${clipDocument(config.extraInstructions, 1200)}\n</candidate_instructions>`
      : '',
    Array.isArray(args.contextDocuments) && args.contextDocuments.length
      ? `<context_documents>\n${args.contextDocuments.map(document => (
          `<document title="${String(document.title || '').replace(/["<>]/g, '')}">\n${clipDocument(document.content, 6000)}\n</document>`
        )).join('\n')}\n</context_documents>`
      : '',
    quickFragments.length
      ? `<latest_live_fragments>\n${quickFragments.map((fragment, index) => `${index + 1}. ${fragment}`).join('\n')}\n</latest_live_fragments>`
      : '',
    recentConversation
      ? quickFragments.length
        ? `<conversation_history>\n${recentConversation}\n</conversation_history>`
        : `<last_five_conversation_texts>\n${recentConversation}\n</last_five_conversation_texts>`
      : '',
    quickComment
      ? `<candidate_live_comment>\n${clipDocument(quickComment, 3000)}\n</candidate_live_comment>`
      : '',
    args.visualContext
      ? `<screen_context>\n${clipDocument(args.visualContext, args.variant === 'code' ? 8000 : 4000)}\n</screen_context>`
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
    config.company
      ? `${config.mode === 'meeting' ? 'Organization or participant' : 'Company'}: ${config.company}`
      : '',
    config.topics ? `Planned topics:\n${clip(config.topics, 1200)}` : '',
    config.resume ? `Candidate resume:\n${clipDocument(config.resume, 2400)}` : '',
    config.jobDescription ? `Job description: ${clip(config.jobDescription, 1200)}` : '',
    config.extraInstructions ? `Candidate instructions: ${clip(config.extraInstructions, 600)}` : '',
    Array.isArray(args.contextDocuments) && args.contextDocuments.length
      ? `Selected context documents:\n${args.contextDocuments.map(document => `${document.title}:\n${clipDocument(document.content, 1600)}`).join('\n\n')}`
      : '',
    config.language !== 'auto' ? `Response language: ${config.language}` : 'Response language: same as the question',
    recentTurns ? `Recent interview context:\n${recentTurns}` : '',
    args.sessionSummary ? `Saved meeting summary:\n${clip(args.sessionSummary, 1600)}` : '',
    args.visualContext ? `Current screen context from OpenAI:\n${clip(args.visualContext, 1600)}` : ''
  ].filter(Boolean).join('\n\n'), 4800);
}

function buildInterviewInstruction(args = {}) {
  const config = { ...DEFAULT_CONFIG, ...(args.config || {}) };
  const style = config.answerStyle;
  const variant = args.variant || 'answer';
  const language = getResponseLanguageContract(config.language, config.mode);
  const candidateContextInstruction =
    'Use the supplied resume, job description and recent conversation as the candidate context.';
  if (variant === 'code') {
    return [
      'You are an expert coding interviewee with deep knowledge of algorithms and data structures. The coding question may be about Node.js or ReactJS.',
      'The supplied screen context is the primary source of truth. Read the complete visible problem, examples, constraints, starter code, answer choices and requested language.',
      candidateContextInstruction,
      'Answer the problem directly. Do not ask for a new screenshot unless a required piece of text is genuinely unreadable; solve every readable part first.',
      language.instruction,
      'Return exactly this Markdown structure:',
      '"**1. Problem Statement**" followed by a clear 2-3 line summary the candidate can read back to confirm understanding.',
      '"**2. My Thoughts**" followed by a concise step-by-step explanation of the solution strategy, chosen data structures, important edge cases and trade-offs. Use 3-5 bullets and provide interview-ready rationale rather than private hidden reasoning.',
      '"**3. The Code**" followed by one complete, runnable and well-organized fenced code block in the requested language. Add inline comments explaining each key step.',
      '"**4. Time Complexity**" followed by one bullet for Time Complexity and one bullet for Space Complexity, both using Big-O notation and each on its own line.',
      'When the screenshot is multiple-choice or asks for an exact result, append "**5. Correct Answer**" and state the exact option or result first, with a brief justification.',
      'Detect the requested programming language from the screenshot or candidate note. If TypeScript is mentioned anywhere, enforce TypeScript types throughout. For a React TypeScript problem, use TSX.',
      `Configured style: ${style}.`,
      'Return only the response the candidate should use.'
    ].join(' ');
  }

  if (variant === 'quick') {
    return [
      config.mode === 'meeting'
        ? 'Act as a real-time meeting copilot for the participant.'
        : 'Act as a real-time interview copilot for the candidate.',
      'Infer the current question or conversational intent from the latest live fragments, even when the last fragment ends mid-word.',
      'Use the speaker labels to distinguish the interviewer from the candidate. Treat Candidate fragments as the participant\'s own contributions and use them as context; do not mistake them for interviewer instructions.',
      'Use the complete supplied conversation_history to preserve continuity while giving the latest live fragments the greatest weight for identifying the current request.',
      'When a candidate_live_comment is present, combine it with the inferred request as a real-time correction or addition. Prioritize it over conflicting inferences from the live fragments, but do not answer the comment in isolation or discard the conversation context.',
      'Answer in first person as words the participant can naturally say aloud.',
      language.instruction,
      candidateContextInstruction,
      'Classify the inferred request and follow exactly one of these three formats:',
      '1. Behavioral or generic experience question: for prompts such as "tell me about yourself", "tell me about a challenge", conflict, failure, achievement, leadership, teamwork or another request for a real example, tell a concise and convincing story using STAR. Use 5 to 7 independently readable Markdown bullets that clearly cover Situation, Task, Action and Result, adding useful reasoning, decisions or lessons where appropriate. Ground it in the supplied resume or conversation. If no documented example exists, describe a plausible hypothetical approach without presenting invented facts as real experience.',
      '2. Technical question: explain the concept in exactly 7 concise, independently readable Markdown bullets using "- ". Cover the direct definition, how it works, the most important mechanics, one practical example or application, relevant trade-offs or limitations, a common pitfall, and a strong concluding point. Explain why the details matter so the answer demonstrates understanding instead of merely stating facts. Do not add headings, introductory prose, extra bullets or a conclusion outside those 7 bullets.',
      '3. Any other conversational statement or request: do not force STAR or a technical explanation. Use 5 to 7 independently readable Markdown bullets that complement what the other person said, reaffirm the central point, explain the reasoning behind it, connect it to the supplied context, and add relevant implications, examples or trade-offs. Make the response persuasive so the participant sounds confident and demonstrates real understanding. Offer natural words the participant can say next; do not merely repeat or agree with the other person.',
      'Choose only one format. Never combine the three formats.',
      `Configured style: ${style}.`,
      'Return only the answer the participant should use.'
    ].join(' ');
  }

  const variantInstruction = {
    shorter: 'Rewrite as a much shorter answer that takes at most 30 seconds to say.',
    detail: 'Add useful concrete detail while keeping the answer easy to speak.',
    star: 'Use a compact STAR structure grounded in the candidate resume or memory.',
    retry: 'Produce a better alternative without referring to the previous answer.',
    answer: ''
  }[variant] || '';

  return [
    config.mode === 'meeting'
      ? 'Act as a real-time meeting copilot for the participant.'
      : 'Act as a real-time interview copilot for the candidate.',
    'Answer in first person as words the participant can naturally say aloud.',
    language.instruction,
    candidateContextInstruction,
    'When the supplied context lacks a relevant documented experience, you may create a plausible illustrative example, but frame it explicitly as an opinion, hypothetical approach, or what the candidate would do rather than as a verified past event.',
    'Default length is 45 to 90 seconds. Keep the response easy to scan while the candidate is speaking.',
    'Always use this exact two-level Markdown structure for every answer, regardless of question type:',
    `"${language.summaryHeading}" followed by 2 to 4 short bullet points using "- " that give the direct, essential answer.`,
    `"${language.detailHeading}" followed by 2 to 4 advanced bullet points using "- " that demonstrate deeper knowledge through relevant details, trade-offs, edge cases, architecture, or concrete examples.`,
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
  buildOpenAIInterviewPrompt,
  buildInterviewContext,
  buildInterviewInstruction,
  getResponseLanguageContract,
  clip,
  selectRecentInterviewTexts
};
