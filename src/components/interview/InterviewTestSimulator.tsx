import React, { useState } from 'react';
import { Headphones, Mic } from 'lucide-react';

interface InterviewTestSimulatorProps {
  onAddTurn: (source: 'interviewer' | 'candidate', text: string) => void;
}

export const InterviewTestSimulator: React.FC<InterviewTestSimulatorProps> = ({ onAddTurn }) => {
  const [text, setText] = useState('');
  const add = (source: 'interviewer' | 'candidate') => {
    const value = text.trim();
    if (!value) return;
    onAddTurn(source, value);
    setText('');
  };

  return <div className="interview-test-simulator">
    <label htmlFor="interview-test-message">Simular conversa</label>
    <textarea
      id="interview-test-message"
      value={text}
      onChange={event => setText(event.target.value)}
      placeholder="Digite uma fala para testar o fluxo…"
      rows={2}
    />
    <div>
      <button type="button" onClick={() => add('interviewer')} disabled={!text.trim()}><Headphones size={13} /> Outro lado</button>
      <button type="button" onClick={() => add('candidate')} disabled={!text.trim()}><Mic size={13} /> Eu</button>
    </div>
  </div>;
};
