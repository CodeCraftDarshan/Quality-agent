import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createPageLogger } from '../../utils/pageLogger';
import { useInvestigationWorkspace } from '../../hooks/useInvestigationWorkspace';
import {
  createTodo,
  fetchResolutionRecord,
  fetchTodos,
  healthCheckV2,
  sendChatMessageV2,
} from '../../services/copilotService';

const pageLogger = createPageLogger('ClusterInvestigation');

function normalizeChecklistText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseConfidencePercent(hypothesis) {
  if (hypothesis?.confidence == null) return null;
  return Math.round(hypothesis.confidence * 100);
}

function deriveRecommendedActions(cluster, copilotResponse) {
  const deduped = new Set();
  const actions = [];

  const pushAction = (value) => {
    const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
    if (!cleaned) {
      return;
    }
    const key = normalizeChecklistText(cleaned);
    if (deduped.has(key)) {
      return;
    }
    deduped.add(key);
    actions.push(cleaned);
  };

  if (Array.isArray(copilotResponse?.next_actions)) {
    copilotResponse.next_actions.forEach(pushAction);
  }

  if (actions.length < 2 && Array.isArray(copilotResponse?.reasoning_chain)) {
    copilotResponse.reasoning_chain
      .slice(0, 2)
      .forEach(step => pushAction(`Validate this causal step with evidence owners: ${step}`));
  }

  if (actions.length < 3 && copilotResponse?.hypotheses?.[0]?.title) {
    pushAction(`Confirm the lead hypothesis before release: ${copilotResponse.hypotheses[0].title}`);
  }

  if (actions.length < 3 && cluster?.ai_summary) {
    pushAction(`Contain the impacted scope for ${cluster.cluster_id} and verify against: ${cluster.ai_summary}`);
  }

  return actions.slice(0, 3);
}

function formatResolutionStatus(resolution) {
  if (!resolution) {
    return { label: 'Loading status', tone: 'var(--surface-container-high)', color: 'var(--on-surface)' };
  }
  if (resolution.locked) {
    return { label: 'Locked for execution', tone: 'var(--error-container)', color: 'var(--on-error-container)' };
  }
  if ((resolution.total_count || 0) > 0) {
    return {
      label: `${resolution.progress || 0}% checklist complete`,
      tone: '#dcfce7',
      color: '#166534',
    };
  }
  return { label: 'Investigation active', tone: 'var(--surface-container-high)', color: 'var(--on-surface)' };
}

export default function ClusterInvestigation() {
  const navigate = useNavigate();
  const { id } = useParams();
  const {
    data,
    resolution,
    setResolution,
    todos,
    setTodos,
    error,
    setError,
    isLoading,
  } = useInvestigationWorkspace(id, pageLogger);
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotHealthy, setCopilotHealthy] = useState(null);
  const [copilotResponse, setCopilotResponse] = useState(null);
  const [executingAction, setExecutingAction] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkCopilot() {
      const healthy = await healthCheckV2();
      if (!cancelled) {
        setCopilotHealthy(healthy);
      }
    }

    void checkCopilot();
    return () => {
      cancelled = true;
    };
  }, []);

  const cluster = data?.cluster || null;
  const tickets = Array.isArray(data?.tickets) ? data.tickets : [];
  const displayClusterId = cluster?.cluster_id || id;
  const normalizedTodoTexts = useMemo(
    () => new Set(todos.map(todo => normalizeChecklistText(todo.text))),
    [todos]
  );
  const recommendedActions = useMemo(
    () => deriveRecommendedActions(cluster, copilotResponse),
    [cluster, copilotResponse]
  );
  const resolutionStatus = formatResolutionStatus(resolution);
  const completedCount = todos.filter(todo => todo.status === 'completed').length;
  const latestTicket = tickets[0] || null;

  const queryCopilot = async (prompt, taskType = 'rca') => {
    const text = String(prompt || '').trim();
    if (!text || !displayClusterId || copilotLoading) {
      return;
    }

    setCopilotLoading(true);
    setError('');
    setCopilotInput('');

    try {
      const payload = await sendChatMessageV2(text, displayClusterId, taskType);
      setCopilotResponse(payload);
    } catch (err) {
      setCopilotResponse({
        reply: err instanceof Error ? err.message : 'Copilot request failed.',
        mode: 'error',
        model: 'unavailable',
        citations: [],
        hypotheses: [],
        reasoning_chain: [],
        next_actions: [],
        anti_gravity_challenge: null,
      });
      setError(err instanceof Error ? err.message : 'Copilot request failed');
    } finally {
      setCopilotLoading(false);
    }
  };

  const handleAutonomousExecute = async () => {
    if (!recommendedActions.length) {
      navigate(`/investigate/${displayClusterId}?stage=resolution`);
      return;
    }

    const firstAction = recommendedActions[0];
    if (normalizedTodoTexts.has(normalizeChecklistText(firstAction))) {
      navigate(`/investigate/${displayClusterId}?stage=resolution`);
      return;
    }

    setExecutingAction(true);
    setError('');
    try {
      await createTodo(displayClusterId, firstAction);
      const [refreshedTodos, refreshedResolution] = await Promise.all([
        fetchTodos(displayClusterId),
        fetchResolutionRecord(displayClusterId),
      ]);
      setTodos(Array.isArray(refreshedTodos) ? refreshedTodos : []);
      setResolution(refreshedResolution);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute recommended action');
    } finally {
      setExecutingAction(false);
    }
  };

  return (
    <div style={{ paddingTop: 0 }}>
      <div style={{ padding: '2rem 2rem 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1.5rem', paddingBottom: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxWidth: 860 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span className={`incident-badge ${(cluster?.severity || 'Critical').toLowerCase() === 'critical' ? 'critical' : 'active'}`}>
                {cluster?.severity || 'Active'} Investigation
              </span>
              <span className="mono-id">ID: #{displayClusterId}</span>
              <span
                style={{
                  background: resolutionStatus.tone,
                  color: resolutionStatus.color,
                  padding: '0.2rem 0.55rem',
                  borderRadius: '999px',
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {resolutionStatus.label}
              </span>
            </div>
            <h1 style={{ fontSize: '1.875rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '0.35rem' }}>
              {cluster?.title || `Investigation ${displayClusterId}`}
            </h1>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--on-surface-variant)' }}>
              {cluster?.ai_summary || 'Loading live cluster summary...'}
            </p>
            {isLoading ? <p style={{ color: 'var(--on-surface-variant)', fontSize: 12 }}>Refreshing investigation context...</p> : null}
            {error ? <p style={{ color: 'var(--error)', fontSize: 12 }}>{error}</p> : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', color: 'var(--on-surface-variant)', fontSize: 13 }}>
              <span>SKU: {cluster?.sku || 'Unassigned'}</span>
              <span>Defect Family: {cluster?.defect_family || 'Under investigation'}</span>
              <span>Complaints: {cluster?.count || tickets.length || 0}</span>
              <span>First Seen: {cluster?.first_seen || 'Unknown'}</span>
              <span>Last Seen: {cluster?.last_seen || 'Unknown'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => navigate(`/investigate/${displayClusterId}?stage=resolution`)}
              className="btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: resolution?.locked ? 'var(--error)' : '#16a34a' }} />
              <span style={{ fontWeight: 600 }}>{resolution?.locked ? 'Execution Locked' : 'Open Resolution Hub'}</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(`/investigate/${displayClusterId}?stage=resolution`)}
              className="machined-btn"
              style={{ padding: '0.625rem 1.5rem', borderRadius: 'var(--radius-full)', fontSize: 14 }}
            >
              Assign Task
            </button>
          </div>
        </div>
      </div>

      <main style={{ padding: '0 2rem 3rem', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--on-surface-variant)', marginBottom: '0.45rem' }}>
                Resolution Progress
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>{resolution?.progress || 0}%</div>
              <div style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>
                {completedCount}/{todos.length} checklist items complete
              </div>
            </div>
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--on-surface-variant)', marginBottom: '0.45rem' }}>
                Cluster Confidence
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>
                {typeof cluster?.confidence === 'number' ? `${Math.round(cluster.confidence * 100)}%` : 'N/A'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>Grounded from live cluster data</div>
            </div>
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--on-surface-variant)', marginBottom: '0.45rem' }}>
                Latest Complaint
              </div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{latestTicket?.ticket_id || 'No tickets yet'}</div>
              <div style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>
                {latestTicket?.severity || 'Awaiting evidence'}{latestTicket?.timestamp ? ` • ${latestTicket.timestamp}` : ''}
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Evidence Registry</h3>
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>
                {tickets.length} live tickets loaded
              </span>
            </div>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {tickets.length > 0 ? tickets.map(ticket => (
                <div key={ticket.ticket_id} style={{ padding: '1rem', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius-md)', background: 'var(--surface-container-lowest)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14 }}>{ticket.ticket_id}</strong>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)' }}>
                      {ticket.severity || 'Unknown severity'}{ticket.timestamp ? ` • ${ticket.timestamp}` : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--on-surface)' }}>{ticket.content}</div>
                  <div style={{ marginTop: '0.45rem', fontSize: 11, color: 'var(--on-surface-variant)' }}>
                    Associated SKU: {ticket.associated_sku || cluster?.sku || 'Unknown'}
                  </div>
                </div>
              )) : (
                <div style={{ padding: '1rem', border: '1px dashed var(--outline-variant)', borderRadius: 'var(--radius-md)', color: 'var(--on-surface-variant)' }}>
                  No tickets available for this cluster yet.
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '1.5rem' }}>
            <div className="card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Checklist Snapshot</h3>
                <span style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>
                  {completedCount}/{todos.length} done
                </span>
              </div>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {todos.length > 0 ? todos.map(todo => (
                  <div key={todo.id} style={{ padding: '0.85rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)', background: 'var(--surface-container-lowest)', display: 'flex', gap: '0.75rem' }}>
                    <span className="material-symbols-outlined" style={{ color: todo.status === 'completed' ? 'var(--primary)' : 'var(--outline)' }}>
                      {todo.status === 'completed' ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{todo.text}</div>
                      <div style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>
                        {todo.status === 'completed' ? 'Completed' : 'Pending'}
                      </div>
                    </div>
                  </div>
                )) : (
                  <div style={{ padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px dashed var(--outline-variant)', color: 'var(--on-surface-variant)' }}>
                    No checklist items yet. Use the copilot action plan to seed the first response tasks.
                  </div>
                )}
              </div>
            </div>

            <div className="card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '0.5rem' }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recommended Actions</h3>
                <button
                  type="button"
                  onClick={() => void queryCopilot(`Provide an execution-ready action plan for cluster ${displayClusterId}. Include next actions, reasoning, and one challenge.`, 'rca')}
                  className="btn-outline"
                  disabled={copilotLoading}
                  style={{ fontSize: 11, padding: '0.35rem 0.7rem' }}
                >
                  {copilotLoading ? 'Refreshing…' : 'Refresh Plan'}
                </button>
              </div>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {recommendedActions.length > 0 ? recommendedActions.map((action, index) => {
                  const inChecklist = normalizedTodoTexts.has(normalizeChecklistText(action));
                  return (
                    <div key={`${action}-${index}`} style={{ padding: '0.9rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)', background: 'var(--surface-container-lowest)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.35rem' }}>
                        <strong style={{ fontSize: 14 }}>{action}</strong>
                        <span style={{ fontSize: 11, fontWeight: 700, color: inChecklist ? '#166534' : 'var(--primary)' }}>
                          {inChecklist ? 'In checklist' : `Action ${index + 1}`}
                        </span>
                      </div>
                      {copilotResponse?.hypotheses?.[0]?.title ? (
                        <div style={{ fontSize: 12, color: 'var(--on-surface-variant)', lineHeight: 1.5 }}>
                          Justification: {copilotResponse.hypotheses[0].title}
                        </div>
                      ) : null}
                    </div>
                  );
                }) : (
                  <div style={{ padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px dashed var(--outline-variant)', color: 'var(--on-surface-variant)' }}>
                    Ask the copilot for an execution-ready action plan to populate this section.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className="card" style={{ position: 'sticky', top: 92, height: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--surface-container)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>bolt</span>
              <h2 style={{ fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.01em' }}>RCA Copilot</h2>
            </div>
            <span style={{ background: copilotHealthy === false ? 'var(--error-container)' : 'var(--tertiary-fixed)', color: copilotHealthy === false ? 'var(--on-error-container)' : 'var(--on-tertiary-fixed-variant)', fontSize: 10, fontWeight: 700, padding: '0.125rem 0.5rem', borderRadius: 'var(--radius-sm)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {copilotHealthy === false ? 'Service Degraded' : 'Ollama Linked'}
            </span>
          </div>
          <div className="custom-scroll" style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--primary)' }}>Live Copilot Assessment</h4>
                <div style={{ fontSize: 10, fontWeight: 900, background: copilotResponse?.mode === 'error' ? 'var(--error-container)' : '#dcfce7', color: copilotResponse?.mode === 'error' ? 'var(--on-error-container)' : '#166534', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
                  {copilotLoading
                    ? 'Thinking...'
                    : copilotResponse?.hypotheses?.[0]
                      ? `Confidence = ${parseConfidencePercent(copilotResponse.hypotheses[0]) || 'N/A'}%`
                      : 'Awaiting query'}
                </div>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--on-surface-variant)' }}>
                {copilotResponse?.reply
                  ? copilotResponse.reply.split('\n').filter(Boolean)[0]
                  : 'Ask the investigation copilot for a grounded RCA view tied to this cluster and its live complaint evidence.'}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, background: 'var(--surface-container-low)', color: 'var(--on-surface)', padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: 600, border: '1px solid var(--outline-variant)' }}>Model: {copilotResponse?.model || 'standby'}</span>
                <span style={{ fontSize: 10, background: 'var(--surface-container-low)', color: 'var(--on-surface)', padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: 600, border: '1px solid var(--outline-variant)' }}>Mode: {copilotResponse?.mode || 'standby'}</span>
                <span style={{ fontSize: 10, background: 'var(--surface-container-low)', color: 'var(--on-surface)', padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: 600, border: '1px solid var(--outline-variant)' }}>Cluster: {displayClusterId}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                <button
                  className="btn-outline"
                  style={{ flex: 1, fontSize: 12, padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem', fontWeight: 700 }}
                  disabled={copilotLoading}
                  onClick={() => void queryCopilot(`Explain the strongest root cause conclusion for cluster ${displayClusterId} and cite the supporting evidence.`, 'hypothesis')}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>manage_search</span> Why This Conclusion?
                </button>
                <button
                  className="btn-outline"
                  style={{ flex: 1, fontSize: 12, padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem', color: 'var(--error)', borderColor: 'var(--error)', fontWeight: 700 }}
                  disabled={copilotLoading}
                  onClick={() => void queryCopilot(`Challenge the current RCA conclusion for cluster ${displayClusterId} with alternative explanations and missing evidence checks.`, 'challenge')}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>alt_route</span> Challenge This
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-variant)' }}>Contributing Factors</h4>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {(copilotResponse?.hypotheses?.length
                  ? copilotResponse.hypotheses.map(item => ({
                      confirmed: true,
                      title: item.title,
                      desc: item.confidence != null ? `Confidence ${Math.round(item.confidence * 100)}%` : 'Active working hypothesis',
                    }))
                  : [
                      { confirmed: true, title: cluster?.defect_family || 'Cluster evidence pending', desc: cluster?.ai_summary || 'Run the copilot to generate grounded hypotheses.' },
                    ]).map(f => (
                  <li key={f.title} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', opacity: f.confirmed ? 1 : 0.5 }}>
                    <span className="material-symbols-outlined" style={{ color: f.confirmed ? 'var(--primary)' : 'var(--on-surface-variant)', fontSize: 20 }}>{f.confirmed ? 'check_circle' : 'radio_button_unchecked'}</span>
                    <div style={{ fontSize: 12 }}>
                      <p style={{ fontWeight: 700 }}>{f.title}</p>
                      <p style={{ color: 'var(--on-surface-variant)' }}>{f.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ background: 'rgba(0,35,111,0.03)', border: '1px solid rgba(0,35,111,0.2)', padding: '1.25rem', borderRadius: 'var(--radius-xl)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--primary)' }}>lightbulb</span>
                  <h4 style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--primary)' }}>Recommended Next Action</h4>
                </div>
                <span style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', background: 'var(--primary)', color: 'white', padding: '0.125rem 0.375rem', borderRadius: 'var(--radius-sm)', letterSpacing: '0.05em' }}>
                  {copilotResponse?.mode === 'local-analysis' ? 'LOCAL ANALYSIS' : 'LIVE RCA'}
                </span>
              </div>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)' }}>
                {recommendedActions[0] || 'Generate a copilot action plan to seed the first execution step.'}
              </p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 10, color: 'var(--on-surface-variant)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em' }}>Checklist</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--primary)', marginTop: '0.125rem' }}>{todos.length} items</span>
                </div>
                <div style={{ width: 1, height: 28, background: 'var(--outline-variant)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'right' }}>
                  <span style={{ fontSize: 10, color: 'var(--on-surface-variant)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em' }}>Completed</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#16a34a', marginTop: '0.125rem' }}>{completedCount}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleAutonomousExecute()}
                disabled={executingAction}
                className="machined-btn"
                style={{ width: '100%', padding: '0.75rem', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', opacity: executingAction ? 0.7 : 1 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>robot_2</span>
                {executingAction ? 'Executing...' : normalizedTodoTexts.has(normalizeChecklistText(recommendedActions[0] || '')) ? 'Open Resolution Workspace' : 'Autonomous Execute'}
              </button>
            </div>
          </div>
          <div style={{ padding: '1rem', background: 'var(--surface-container-low)', borderTop: '1px solid rgba(193,198,215,0.1)' }}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={copilotInput}
                onChange={event => setCopilotInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void queryCopilot(copilotInput, 'rca');
                  }
                }}
                placeholder="Query Copilot for deeper investigation insight..."
                style={{ width: '100%', background: 'var(--on-surface)', color: 'var(--surface)', padding: '0.75rem 3rem 0.75rem 1rem', borderRadius: 'var(--radius-xl)', fontSize: 12, fontWeight: 500, border: 'none', outline: 'none' }}
              />
              <button
                type="button"
                onClick={() => void queryCopilot(copilotInput, 'rca')}
                disabled={copilotLoading || !copilotInput.trim()}
                style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--primary-fixed-dim)', opacity: copilotLoading || !copilotInput.trim() ? 0.45 : 1 }}
              >
                <span className="material-symbols-outlined">send</span>
              </button>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
