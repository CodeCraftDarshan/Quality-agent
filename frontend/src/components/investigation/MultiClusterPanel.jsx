import React, { useEffect, useMemo, useState } from 'react';

function ticketCount(cluster) {
  return Array.isArray(cluster?.tickets) ? cluster.tickets.length : Number(cluster?.count || 0);
}

export default function MultiClusterPanel({
  selectedClusters,
  chatHistory,
  onAsk,
  onAddMore,
  onBackToTriage,
  loading,
  fetchQuestions,
}) {
  const [input, setInput] = useState('');
  const [expanded, setExpanded] = useState(() => new Set(selectedClusters.map(cluster => cluster.cluster_id)));
  const [questions, setQuestions] = useState([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const selectedClusterSignature = useMemo(
    () => selectedClusters.map(cluster => cluster.cluster_id || cluster.id).join('|'),
    [selectedClusters]
  );

  const totalTickets = useMemo(
    () => selectedClusters.reduce((sum, cluster) => sum + ticketCount(cluster), 0),
    [selectedClusters]
  );

  const submit = async () => {
    const message = String(input || '').trim();
    if (!message) return;
    setInput('');
    await onAsk(message);
  };

  useEffect(() => {
    let active = true;

    async function loadQuestions() {
      if (!selectedClusters.length || typeof fetchQuestions !== 'function') {
        if (active) {
          setQuestions([]);
          setLoadingQuestions(false);
        }
        return;
      }

      setLoadingQuestions(true);
      try {
        const nextQuestions = await fetchQuestions(
          selectedClusters.map(cluster => cluster.cluster_id || cluster.id),
          selectedClusters.map(cluster => cluster.defect_family).filter(Boolean)
        );
        if (active) {
          setQuestions(Array.isArray(nextQuestions) ? nextQuestions : []);
        }
      } catch (error) {
        console.error('Failed to fetch questions:', error);
        if (active) {
          setQuestions([]);
        }
      } finally {
        if (active) {
          setLoadingQuestions(false);
        }
      }
    }

    void loadQuestions();
    const interval = setInterval(() => {
      void loadQuestions();
    }, 30000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [fetchQuestions, selectedClusterSignature]);

  const handleQuestionClick = async (question) => {
    await onAsk(question);
  };

  const toggle = (clusterId) => {
    const next = new Set(expanded);
    if (next.has(clusterId)) {
      next.delete(clusterId);
    } else {
      next.add(clusterId);
    }
    setExpanded(next);
  };

  return (
    <section style={{ display: 'flex', gap: '16px', height: 'calc(100vh - 280px)', overflow: 'hidden' }}>
      <aside style={{ width: '300px', flexShrink: 0, overflowY: 'auto', height: '100%', borderRight: '1px solid var(--outline-variant)', background: 'var(--surface-container-lowest)', padding: '1.25rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--secondary)' }}>Stage 2</p>
          <h2 style={{ margin: '0.2rem 0 0.4rem', fontSize: 22, fontWeight: 850 }}>Investigation</h2>
          <p style={{ margin: 0, color: 'var(--on-surface-variant)' }}>Analysing {selectedClusters.length} clusters and {totalTickets} tickets.</p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <button className="btn-outline" onClick={onBackToTriage}>← Add more clusters</button>
          <button className="btn-outline" onClick={onAddMore}>Add another cluster</button>
        </div>

          <div style={{ display: 'grid', gap: '0.75rem' }}>
          {selectedClusters.map((cluster, index) => {
            const clusterKey = cluster.cluster_id || cluster.id || `cluster-${index}`;
            const open = expanded.has(cluster.cluster_id || cluster.id);
            return (
              <button
                key={clusterKey}
                type="button"
                onClick={() => toggle(cluster.cluster_id || cluster.id)}
                style={{ textAlign: 'left', width: '100%', borderRadius: 'var(--radius-xl)', border: '1px solid var(--outline-variant)', background: open ? 'white' : 'var(--surface-container-low)', padding: '0.95rem', boxShadow: open ? 'var(--shadow-sm)' : 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <strong>
                    {cluster.title || cluster.cluster_name ||
                     cluster.defect_family || cluster.cluster_id || 'Unknown'}
                  </strong>
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--on-surface-variant)' }}>{open ? '▼' : '▶'}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--on-surface-variant)', marginTop: '0.35rem' }}>
                  {cluster.cluster_id || cluster.id}
                    {cluster.sku ? ` · ${cluster.sku}` : ''}
                </div>
                <div style={{ fontSize: 12, color: 'var(--on-surface-variant)', marginTop: '0.2rem' }}>
                  {(cluster.count || cluster.ticket_count || 0)} tickets
                </div>
                {open ? (
                  <div style={{ marginTop: '0.85rem', fontSize: 12, lineHeight: 1.55, color: 'var(--on-surface-variant)' }}>
                    {cluster.ai_summary || cluster.defect_family ||
                     cluster.description || 'No summary available.'}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </aside>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div style={{ flex: 1, padding: '1.25rem', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--secondary)' }}>Copilot</p>
            <h3 style={{ margin: '0.2rem 0 0.35rem', fontSize: 20, fontWeight: 850 }}>Analysing selected clusters together</h3>
            <p style={{ margin: 0, color: 'var(--on-surface-variant)' }}>Context from all selected clusters is merged into one investigation session.</p>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '0.25rem' }}>
            {chatHistory.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', fontSize: '14px', textAlign: 'center', padding: '24px' }}>
                <div>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>💬</div>
                  <div>Ask a question about the selected clusters to start the analysis.</div>
                  <div style={{ marginTop: '8px', fontSize: '12px' }}>Try: "What is common between these clusters?" or "Give me a hypothesis"</div>
                </div>
              </div>
            ) : chatHistory.map((entry, index) => (
              <div key={`${entry.role}-${index}`} style={{ display: 'flex', justifyContent: entry.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ alignSelf: entry.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: entry.role === 'user' ? '70%' : '85%', backgroundColor: entry.role === 'user' ? '#1e3a5f' : '#f9fafb', color: entry.role === 'user' ? 'white' : 'var(--on-surface)', borderRadius: entry.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px', padding: entry.role === 'user' ? '10px 14px' : '12px 16px', wordBreak: 'break-word', border: entry.role === 'user' ? 'none' : '1px solid #e5e7eb', boxShadow: entry.role === 'user' ? 'none' : 'var(--shadow-sm)', marginLeft: entry.role === 'user' ? 'auto' : 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.75, marginBottom: '0.35rem' }}>{entry.role === 'user' ? 'You' : 'Copilot'}</div>
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{entry.content}</div>
                  {Array.isArray(entry.citations) && entry.citations.length ? (
                    <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {entry.citations.map((citation, citationIndex) => (
                        <span key={`${citation.id || citation.source || 'citation'}-${citationIndex}`} style={{ fontSize: 11, fontWeight: 700, padding: '0.2rem 0.45rem', borderRadius: '999px', background: entry.role === 'user' ? 'rgba(255,255,255,0.18)' : 'var(--surface-container-high)', color: entry.role === 'user' ? 'white' : 'var(--on-surface-variant)' }}>
                          {citation.source || citation.id}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {loading ? <div style={{ color: 'var(--on-surface-variant)' }}>Generating response...</div> : null}
          </div>

          <div style={{
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            padding: '16px',
            marginTop: '12px',
            marginBottom: '12px',
            backgroundColor: '#f9fafb',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🔍</span>
                <strong style={{ fontSize: '14px' }}>AI Investigation Engine</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {loadingQuestions ? (
                  <span style={{ fontSize: '12px', color: '#6b7280' }}>
                    ↻ Refreshing...
                  </span>
                ) : null}
                <span style={{
                  backgroundColor: '#1e3a5f', color: 'white',
                  padding: '2px 8px', borderRadius: '4px',
                  fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em',
                }}>
                  AUTONOMOUS
                </span>
              </div>
            </div>

            {questions.length > 0 ? (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
              }}>
                {questions.map((question, index) => (
                  <button
                    key={`${index}-${question}`}
                    onClick={() => void handleQuestionClick(question)}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      border: '1px solid #e5e7eb',
                      borderLeft: '3px solid #1e3a5f',
                      borderRadius: '6px',
                      backgroundColor: 'white',
                      cursor: 'pointer',
                      fontSize: '13px',
                      lineHeight: '1.4',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={event => { event.currentTarget.style.backgroundColor = '#f0f4ff'; }}
                    onMouseLeave={event => { event.currentTarget.style.backgroundColor = 'white'; }}
                  >
                    <div style={{
                      fontSize: '10px', fontWeight: 700,
                      color: '#6b7280', marginBottom: '4px',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                      Question {index + 1}
                    </div>
                    {question}
                  </button>
                ))}
              </div>
            ) : (
              !loadingQuestions ? (
                <div style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center' }}>
                  No questions generated yet.
                </div>
              ) : null
            )}
          </div>
        </div>

        <div style={{ flexShrink: 0, borderTop: '1px solid var(--outline-variant)', padding: '12px 16px', background: 'var(--surface-container-lowest)' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <input
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder="Ask about the selected clusters..."
              style={{ flex: 1, minWidth: 0, padding: '0.85rem 1rem', borderRadius: '999px', border: '1px solid var(--outline-variant)', background: 'white' }}
            />
            <button className="machined-btn" onClick={() => void submit()} disabled={loading || !String(input || '').trim()}>Ask Copilot</button>
          </div>
        </div>
      </main>
    </section>
  );
}
