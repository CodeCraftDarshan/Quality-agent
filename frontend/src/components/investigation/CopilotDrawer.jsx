import React, { useMemo, useState } from 'react';
import { ACTIVE_COPILOT_VERSION } from '../../config';
import { sendChatMessage } from '../../services/copilotService';
import { useCopilotSession } from '../../hooks/useCopilotSession';

function renderInlineBold(line) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    const isBold = part.startsWith('**') && part.endsWith('**') && part.length > 4;
    if (isBold) {
      return <strong key={`bold-${index}`}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>;
  });
}

function renderAiContent(content) {
  return content.split('\n').map((line, index) => (
    <p key={`line-${index}`} style={{ margin: 0 }}>
      {renderInlineBold(line)}
    </p>
  ));
}

function renderResponseMetadata(metadata = {}) {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  
  const { mode, timing_ms, model, hypotheses } = metadata;
  
  return (
    <div style={{ marginTop: '0.75rem', fontSize: 12, opacity: 0.8, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {model && <span><strong>Model:</strong> {model}</span>}
      {mode && <span><strong>Mode:</strong> {mode === 'ollama' ? '🤖 Ollama Live' : mode}</span>}
      {timing_ms !== null && timing_ms !== undefined && <span><strong>Response time:</strong> {timing_ms}ms</span>}
      {hypotheses && Array.isArray(hypotheses) && hypotheses.length > 0 && (
        <span><strong>Hypotheses identified:</strong> {hypotheses.length}</span>
      )}
    </div>
  );
}

function renderCitationBadges(citations = []) {
  if (!citations.length) {
    return null;
  }

  return (
    <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
      {citations.map((citation, index) => (
        <span
          key={`${citation.id || 'citation'}-${index}`}
          title={citation.excerpt || citation.source || citation.id}
          style={{
            fontSize: 11,
            borderRadius: '999px',
            border: '1px solid var(--border-light)',
            padding: '0.15rem 0.5rem',
            color: 'var(--muted)',
            background: 'var(--bg-light)',
          }}
        >
          {citation.id || 'SOURCE'}
        </span>
      ))}
    </div>
  );
}

export default function CopilotDrawer({ isOpen, onClose, clusterId }) {
  const initialMessages = useMemo(() => ([
    { role: 'ai', content: 'I am your AI Root Cause Analysis Copilot. How can I assist with this investigation? (E.g., "trace batch" or "show raw tickets")' }
  ]), []);
  const [messages, setMessages] = useCopilotSession(`copilot-drawer-${clusterId || 'default'}`, initialMessages);
  
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    
    // Add user message
    const newMessages = [...messages, { role: 'user', content: input }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    
    try {
        const payload = await sendChatMessage(input, clusterId, 'rca', 2, 250);
        
        // Extract response data with proper field names
        const aiResponse = {
          role: 'ai',
          content: payload.reply || 'Unknown: no response generated.',
          metadata: {
            citations: Array.isArray(payload.citations) ? payload.citations : [],
            hypotheses: Array.isArray(payload.hypotheses) ? payload.hypotheses : [],
            mode: payload.mode || 'unknown',
            timing_ms: Number.isFinite(payload.timing_ms) ? payload.timing_ms : null,
            model: payload.model || 'unknown',
            confidence: typeof payload.confidence === 'number' ? payload.confidence : null,
          },
        };
        
        setMessages([...newMessages, aiResponse]);
    } catch(err) {
        const errorMsg = err.message || 'unknown error';
        setMessages([
          ...newMessages, 
          { 
            role: 'ai', 
            content: `⚠️ Error reaching Copilot API (${ACTIVE_COPILOT_VERSION}): ${errorMsg}\n\nTip: Ensure Ollama is running (ollama serve) and the model is available.`,
            metadata: { mode: 'error' }
          }
        ]);
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <div className={`copilot-drawer ${isOpen ? 'open' : ''}`}>
      <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className="material-symbols-outlined text-primary">psychology</span>
          <h3 className="font-bold text-lg">AI RCA Copilot</h3>
        </div>
        <button onClick={onClose} className="text-muted hover:text-text-primary">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
        {messages.map((msg, index) => (
          <div key={index} className={`chat-bubble ${msg.role}`}>
            {msg.role === 'ai' ? (
                <div>
                  {renderAiContent(msg.content)}
                  {renderCitationBadges(msg.metadata?.citations || [])}
                  {renderResponseMetadata(msg.metadata)}
                </div>
            ) : (
                msg.content
            )}
          </div>
        ))}
        {isLoading && (
            <div className="chat-bubble ai opacity-70">
               <span style={{ fontStyle: 'italic', color: 'var(--muted)' }}>Analyzing contextual vectors...</span>
            </div>
        )}
      </div>

      <div style={{ padding: '1.25rem', borderTop: '1px solid var(--border-light)' }}>
        <form onSubmit={handleSend} style={{ display: 'flex', gap: '0.5rem' }}>
          <input 
            type="text" 
            placeholder="Ask about this cluster..." 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
            style={{ 
              flex: 1, 
              padding: '0.75rem 1rem', 
              borderRadius: '6px', 
              border: '1px solid var(--border-light)',
              outline: 'none',
              fontSize: '0.875rem',
              backgroundColor: isLoading ? '#f8fafc' : 'white'
            }} 
          />
          <button type="submit" disabled={isLoading} style={{ 
            backgroundColor: isLoading ? '#94a3b8' : 'var(--primary)', 
            color: 'white', 
            padding: '0.75rem', 
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: isLoading ? 'not-allowed' : 'pointer'
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>send</span>
          </button>
        </form>
      </div>
    </div>
  );
}
