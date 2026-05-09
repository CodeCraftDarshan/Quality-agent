import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  createTodo,
  fetchTodos,
  sendChatMessage,
  updateResolutionRecord,
  updateTodo,
} from '../../services/copilotService';
import { useResolutionWorkspace } from '../../hooks/useResolutionWorkspace';
import { createPageLogger } from '../../utils/pageLogger';

const pageLogger = createPageLogger('ResolutionHub');

function normalizeChecklistText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function formatBatchLabel(cluster) {
  return cluster?.sku || cluster?.cluster_id || 'UNKNOWN-BATCH';
}

function priorityLabel(index, severity) {
  if (index === 0 || severity === 'Critical') {
    return { text: 'HIGH PRIORITY', background: 'var(--error-container)', color: 'var(--on-error-container)' };
  }
  if (index === 1) {
    return { text: 'MEDIUM', background: 'var(--secondary-container)', color: 'var(--on-secondary-container)' };
  }
  return { text: 'FOLLOW-UP', background: 'var(--surface-container-high)', color: 'var(--on-surface)' };
}

function buildDraftFromCopilot(cluster, copilot) {
  const batchLabel = formatBatchLabel(cluster);
  const actions = Array.isArray(copilot?.next_actions) ? copilot.next_actions.filter(Boolean).slice(0, 3) : [];
  const leadHypothesis = copilot?.hypotheses?.[0]?.title || cluster?.ai_summary || 'Active quality anomaly under investigation.';
  return `URGENT: Quality Control Notice - ${batchLabel}

Dear Supplier Quality Team,

We are investigating a quality anomaly linked to cluster ${cluster?.cluster_id || batchLabel}.

Severity Level: ${cluster?.severity || 'High'}
Working Conclusion: ${leadHypothesis}

Immediate actions requested:
${actions.length ? actions.map(action => `- ${action}`).join('\n') : '- Review recent production, packaging, and handling records for deviations.'}

Please confirm containment status and share supporting evidence with the investigation team.`;
}

function deriveFallbackActions(cluster, copilot) {
  const normalized = new Set();
  const actions = [];

  const pushAction = (value) => {
    const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
    if (!cleaned) {
      return;
    }
    const key = normalizeChecklistText(cleaned);
    if (normalized.has(key)) {
      return;
    }
    normalized.add(key);
    actions.push(cleaned);
  };

  if (Array.isArray(copilot?.next_actions)) {
    copilot.next_actions.forEach(pushAction);
  }

  if (actions.length === 0 && Array.isArray(copilot?.reasoning_chain)) {
    copilot.reasoning_chain
      .slice(0, 2)
      .forEach(step => pushAction(`Validate this RCA step with owners: ${step}`));
  }

  if (actions.length < 2 && Array.isArray(copilot?.hypotheses) && copilot.hypotheses[0]?.title) {
    pushAction(`Verify the leading hypothesis: ${copilot.hypotheses[0].title}`);
  }

  if (actions.length < 3 && cluster?.ai_summary) {
    pushAction(`Contain the affected scope for ${cluster.cluster_id} and confirm evidence against: ${cluster.ai_summary}`);
  }

  if (actions.length === 0) {
    pushAction('Review recent production, packaging, and handling records for deviations.');
    pushAction('Hold impacted material tied to this cluster until verification is complete.');
  }

  return actions.slice(0, 3);
}

export default function ResolutionHub() {
  const navigate = useNavigate();
  const { id } = useParams();
  const clusterId = id || '';
  const {
    clusterData,
    resolution,
    todos,
    setTodos,
    draft,
    setDraft,
    draftDirty,
    setDraftDirty,
    loading,
    error,
    setError,
    setResolution,
  } = useResolutionWorkspace(clusterId, pageLogger);
  const [copilotPlan, setCopilotPlan] = useState(null);
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [showChallenge, setShowChallenge] = useState(false);
  const [addingAction, setAddingAction] = useState('');
  const [togglingTodoId, setTogglingTodoId] = useState(null);
  const [autoSeedingActions, setAutoSeedingActions] = useState(false);
  const [hasAutoSeeded, setHasAutoSeeded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadCopilotPlan() {
      if (!clusterId) {
        setCopilotPlan(null);
        return;
      }
      setCopilotLoading(true);
      try {
        const payload = await pageLogger.trackFetch(
          'copilot corrective action plan',
          () => sendChatMessage(
            `Provide a concise corrective action plan for cluster ${clusterId}. Include evidence-backed next actions, one counter-argument, and a short conclusion.`,
            clusterId,
            'rca'
          ),
          { cluster_id: clusterId }
        );
        if (!cancelled) {
          setCopilotPlan(payload);
          setDraft(currentDraft => {
            if (currentDraft?.trim()) {
              return currentDraft;
            }
            return buildDraftFromCopilot(clusterData?.cluster || null, payload);
          });
        }
      } catch (err) {
        pageLogger.error('Failed to load copilot plan', {
          cluster_id: clusterId,
          message: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) {
          setCopilotPlan(null);
          setError(previous => previous || (err instanceof Error ? err.message : 'Failed to load copilot plan'));
        }
      } finally {
        if (!cancelled) {
          setCopilotLoading(false);
        }
      }
    }

    void loadCopilotPlan();
    return () => {
      cancelled = true;
    };
  }, [clusterData?.cluster, clusterId, setDraft, setError]);

  const cluster = clusterData?.cluster || null;
  const tickets = clusterData?.tickets || [];
  const locked = Boolean(resolution?.locked);
  const logItems = Array.isArray(resolution?.log_items) ? resolution.log_items : [];
  const progress = resolution?.progress ?? 0;
  const completedCount = resolution?.completed_count ?? 0;
  const totalCount = resolution?.total_count ?? 0;
  const normalizedTodoTexts = useMemo(
    () => new Set(todos.map(todo => normalizeChecklistText(todo.text))),
    [todos]
  );

  const recommendedActions = useMemo(() => {
    const actions = deriveFallbackActions(cluster, copilotPlan);
    return actions.map((action, index) => ({
      id: `${clusterId}-${index}`,
      title: action,
      priority: priorityLabel(index, cluster?.severity),
      justification:
        copilotPlan?.hypotheses?.[0]?.title ||
        cluster?.ai_summary ||
        'Action prioritized using current cluster evidence and copilot output.',
      confidence: typeof copilotPlan?.confidence === 'number' ? Math.round(copilotPlan.confidence * 100) : null,
      inChecklist: normalizedTodoTexts.has(normalizeChecklistText(action)),
    }));
  }, [cluster, clusterId, copilotPlan, normalizedTodoTexts]);

  useEffect(() => {
    setHasAutoSeeded(false);
  }, [clusterId]);

  useEffect(() => {
    let cancelled = false;

    async function autoSeedRecommendedActions() {
      if (!clusterId || locked || hasAutoSeeded || autoSeedingActions) {
        return;
      }
      if (todos.length > 0 || recommendedActions.length === 0) {
        if (!cancelled) {
          setHasAutoSeeded(true);
        }
        return;
      }

      const missingActions = recommendedActions
        .map(action => action.title)
        .filter(action => !normalizedTodoTexts.has(normalizeChecklistText(action)));

      if (missingActions.length === 0) {
        if (!cancelled) {
          setHasAutoSeeded(true);
        }
        return;
      }

      if (!cancelled) {
        setAutoSeedingActions(true);
      }

      try {
        for (const action of missingActions) {
          if (cancelled) {
            return;
          }
          await createTodo(clusterId, action);
        }
        const refreshedTodos = await fetchTodos(clusterId);
        if (!cancelled) {
          setTodos(refreshedTodos);
          syncResolutionStatsFromTodos(refreshedTodos);
          setHasAutoSeeded(true);
        }
      } catch (err) {
        pageLogger.error('Failed to auto-seed recommended checklist actions', {
          cluster_id: clusterId,
          message: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) {
          setError(previous => previous || (err instanceof Error ? err.message : 'Failed to load recommended actions'));
          setHasAutoSeeded(true);
        }
      } finally {
        if (!cancelled) {
          setAutoSeedingActions(false);
        }
      }
    }

    void autoSeedRecommendedActions();
    return () => {
      cancelled = true;
    };
  }, [
    autoSeedingActions,
    clusterId,
    hasAutoSeeded,
    locked,
    normalizedTodoTexts,
    recommendedActions,
    setError,
    setTodos,
    syncResolutionStatsFromTodos,
    todos.length,
  ]);

  const whatIfCards = useMemo(() => {
    const complaintCount = Number(cluster?.count || tickets.length || 0);
    const confidencePercent = Math.round(Number(cluster?.confidence || 0.75) * 100);
    return [
      {
        title: 'No Immediate Containment',
        body: `Complaint volume could continue across ${Math.max(1, Math.ceil(complaintCount / 2))} downstream lots.`,
        tone: 'var(--error-container)',
        color: 'var(--on-error-container)',
      },
      {
        title: 'Full Supplier Escalation',
        body: `High coordination cost, but strongest risk reduction when confidence is already at ${confidencePercent}%.`,
        tone: 'rgba(34, 197, 94, 0.1)',
        color: '#166534',
      },
      {
        title: 'Targeted Hold + Verification',
        body: `Balanced path that focuses on the highest-risk actions first while the checklist moves toward completion.`,
        tone: 'white',
        color: 'var(--primary)',
      },
    ];
  }, [cluster?.confidence, cluster?.count, tickets.length]);

  const impactStats = useMemo(() => {
    const pendingCount = Math.max(0, totalCount - completedCount);
    return {
      secured: completedCount,
      riskReduction: totalCount ? Math.round((completedCount / totalCount) * 100) : Math.round(Number(cluster?.confidence || 0.65) * 100),
      delay: pendingCount * 2,
    };
  }, [cluster?.confidence, completedCount, totalCount]);

  const syncResolutionStatsFromTodos = useCallback((todoList) => {
    const completed = todoList.filter(item => item.status === 'completed').length;
    const total = todoList.length;
    setResolution(current => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        completed_count: completed,
        total_count: total,
        progress: total ? Math.round((completed / total) * 100) : 0,
      };
    });
  }, [setResolution]);

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      const payload = await updateResolutionRecord(clusterId, {
        draft_text: draft,
        append_log: {
          actor: 'Analyst',
          message: 'Saved draft supplier notice',
          status: 'done',
          time: 'Just now',
        },
      });
      setResolution(payload);
      setDraft(payload.draft_text || draft);
      setDraftDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSendAndLock = async () => {
    if (locked) return;
    try {
      const payload = await updateResolutionRecord(clusterId, {
        draft_text: draft,
        locked: true,
        append_log: {
          actor: 'Quality Lead',
          message: 'Approved and locked batch actions',
          status: 'critical',
          time: 'Just now',
        },
      });
      setResolution(payload);
      setDraftDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to lock resolution workspace');
    }
  };

  const handleToggleTodo = async todo => {
    setError('');
    setTogglingTodoId(todo.id);
    try {
      await updateTodo(todo.id, {
        status: todo.status === 'completed' ? 'pending' : 'completed',
      });
      const refreshedTodos = await fetchTodos(clusterId);
      setTodos(refreshedTodos);
      syncResolutionStatsFromTodos(refreshedTodos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update checklist item');
    } finally {
      setTogglingTodoId(null);
    }
  };

  const handleAddTodo = async text => {
    const normalizedText = normalizeChecklistText(text);
    if (!normalizedText || normalizedTodoTexts.has(normalizedText)) {
      return;
    }
    setError('');
    setAddingAction(normalizedText);
    try {
      await createTodo(clusterId, text);
      const refreshedTodos = await fetchTodos(clusterId);
      setTodos(refreshedTodos);
      syncResolutionStatsFromTodos(refreshedTodos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add checklist item');
    } finally {
      setAddingAction('');
    }
  };

  return (
    <main className="resolution-shell">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <button
          onClick={() => navigate(`/investigate/${clusterId}?stage=investigation`)}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 14, fontWeight: 500, color: 'var(--on-surface-variant)' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>arrow_back</span>
          Back to Investigation
        </button>
        <span className="font-mono" style={{ fontSize: 13, color: 'var(--on-surface-variant)' }}>
          Cluster ID: <strong style={{ color: 'var(--on-surface)' }}>{clusterId}</strong>
        </span>
      </div>

      <div className="card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1.5rem' }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--secondary)', marginBottom: '0.25rem' }}>
              Execution Workspace
            </p>
            <h1 style={{ fontSize: '1.875rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>Resolution Hub</h1>
            <p style={{ color: 'var(--on-surface-variant)' }}>
            {cluster
                ? `Execute corrective actions for ${cluster.title} (${cluster.defect_family || 'active defect family'}).`
                : clusterId
                  ? 'Loading live resolution context...'
                  : 'Select an investigation cluster to open the resolution workspace.'}
            </p>
            {error ? <p style={{ color: 'var(--error)', fontSize: 12, marginTop: '0.75rem' }}>{error}</p> : null}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              borderRadius: 'var(--radius-full)',
              background: locked ? 'var(--error-container)' : '#dcfce7',
              color: locked ? 'var(--on-error-container)' : '#166534',
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{locked ? 'lock' : 'bolt'}</span>
            {locked ? 'Locked' : loading ? 'Loading' : 'Editable'}
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ fontSize: '1.5rem' }}>{progress}%</strong>
            <span style={{ fontSize: 13, color: 'var(--on-surface-variant)' }}>
              Checklist completion ({completedCount}/{totalCount || 0})
            </span>
          </div>
          <div className="resolution-progress-track"><div style={{ width: `${progress}%` }} /></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.5rem' }}>
          <div className="card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>psychology</span>
                Recommended Action Plan
              </h2>
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--primary)', background: 'var(--primary-container)', padding: '0.25rem 0.625rem', borderRadius: 'var(--radius-full)', letterSpacing: '0.05em' }}>
                {copilotLoading ? 'ANALYZING' : 'AI OPTIMIZED'}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {recommendedActions.length > 0 ? recommendedActions.map(action => (
                <div key={action.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '1rem', background: 'var(--surface-container-lowest)', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--primary)', marginTop: 2 }}>
                    {action.inChecklist ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.25rem' }}>
                      <strong style={{ fontSize: 14 }}>{action.title}</strong>
                      <span style={{ fontSize: 11, background: action.priority.background, color: action.priority.color, padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: 800, whiteSpace: 'nowrap' }}>
                        {action.priority.text}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--on-surface-variant)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                      <strong>Justification:</strong> {action.justification}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', gap: '1rem', fontSize: 11, fontWeight: 700 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--error)' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>warning</span>
                          Confidence: {action.confidence != null ? `${action.confidence}%` : 'Evidence-backed'}
                        </span>
                      </div>
                      {action.inChecklist ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#166534' }}>
                          Added to checklist
                        </span>
                      ) : !locked ? (
                        <button
                          onClick={() => void handleAddTodo(action.title)}
                          disabled={addingAction === normalizeChecklistText(action.title)}
                          className="btn-outline"
                          style={{ fontSize: 11, padding: '0.35rem 0.75rem', opacity: addingAction === normalizeChecklistText(action.title) ? 0.7 : 1 }}
                        >
                          {addingAction === normalizeChecklistText(action.title) ? 'Adding…' : 'Add to Checklist'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )) : (
                <div style={{ padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px dashed var(--outline-variant)', color: 'var(--on-surface-variant)' }}>
                  {copilotLoading ? 'Building evidence-backed action plan...' : 'No live action plan available yet for this cluster.'}
                </div>
              )}
            </div>

            <button
              onClick={() => setShowChallenge(current => !current)}
              style={{
                marginTop: '1.5rem',
                width: '100%',
                padding: '0.75rem',
                fontSize: 13,
                fontWeight: 700,
                borderRadius: 'var(--radius-md)',
                background: showChallenge ? 'var(--secondary-container)' : 'white',
                color: showChallenge ? 'var(--on-secondary-container)' : 'var(--secondary)',
                border: `1px solid ${showChallenge ? 'transparent' : 'var(--outline-variant)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                transition: 'all 0.2s',
                cursor: 'pointer',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>alt_route</span>
              Challenge the Decision
            </button>

            {showChallenge ? (
              <div style={{ marginTop: '1rem', padding: '1.25rem', background: 'var(--surface-container)', borderRadius: 'var(--radius-md)', borderLeft: '4px solid var(--secondary)', animation: 'fade-in 0.3s ease' }}>
                <h4 style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--secondary)', marginBottom: '0.75rem' }}>
                  Alternative Perspective (Anti-Gravity)
                </h4>
                <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', lineHeight: 1.6 }}>
                  {resolution?.challenge_notes || copilotPlan?.anti_gravity_challenge || 'No counter-argument available yet for this cluster.'}
                </p>
              </div>
            ) : null}
          </div>

          <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>edit_document</span>
                Context-Aware Supplier Notice
              </h2>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--secondary)', background: 'var(--secondary-fixed)', padding: '0.125rem 0.5rem', borderRadius: 'var(--radius-sm)' }}>
                Persisted draft
              </span>
            </div>
            <textarea
              value={draft}
              onChange={event => {
                setDraft(event.target.value);
                setDraftDirty(true);
              }}
              disabled={locked}
              style={{
                flex: 1,
                minHeight: 220,
                padding: '1rem',
                border: '1px solid var(--outline-variant)',
                borderRadius: 'var(--radius-md)',
                fontSize: 13,
                lineHeight: 1.6,
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'var(--font-mono)',
                background: locked ? 'var(--surface-container-low)' : 'white',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>
                {draftDirty ? 'Unsaved changes' : 'Draft saved'}
              </span>
              <button onClick={() => void handleSaveDraft()} disabled={locked || savingDraft || !draft.trim()} className="btn-outline" style={{ opacity: locked ? 0.5 : 1 }}>
                {savingDraft ? 'Saving…' : 'Save Draft'}
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '1.5rem' }}>
          <div className="card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>task_alt</span>
                Execution Checklist
              </h2>
              <span className="font-mono" style={{ fontSize: 10, padding: '0.125rem 0.375rem', background: 'var(--surface-container-high)', borderRadius: 'var(--radius-full)' }}>
                {totalCount || 0} items
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {todos.length > 0 ? todos.map(todo => (
                <button
                  type="button"
                  key={todo.id}
                  onClick={() => !locked && void handleToggleTodo(todo)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    padding: '0.85rem 1rem',
                    background: 'var(--surface-container-lowest)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--outline-variant)',
                    textAlign: 'left',
                    cursor: locked ? 'default' : 'pointer',
                    opacity: locked ? 0.75 : togglingTodoId === todo.id ? 0.7 : 1,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ color: todo.status === 'completed' ? 'var(--primary)' : 'var(--outline)' }}>
                    {todo.status === 'completed' ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, textDecoration: todo.status === 'completed' ? 'line-through' : 'none' }}>
                      {todo.text}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--on-surface-variant)', marginTop: '0.25rem' }}>
                      {togglingTodoId === todo.id
                        ? 'Updating...'
                        : `${todo.status === 'completed' ? 'Completed' : 'Pending'} • Cluster ${clusterId}`}
                    </div>
                  </div>
                </button>
              )) : (
                <div style={{ padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px dashed var(--outline-variant)', color: 'var(--on-surface-variant)' }}>
                  {autoSeedingActions
                    ? 'Loading recommended actions into the checklist...'
                    : 'No persisted checklist items yet. Recommended actions will load here automatically once the AI plan is ready.'}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>science</span>
                  What-If Simulation Engine
                </h2>
                <span className="font-mono" style={{ fontSize: 10, padding: '0.125rem 0.375rem', background: 'var(--surface-container-high)', borderRadius: 'var(--radius-full)' }}>
                  3 scenarios
                </span>
              </div>
              <div style={{ display: 'grid', gap: '0.9rem' }}>
                {whatIfCards.map(card => (
                  <div key={card.title} style={{ padding: '1rem', background: card.tone, borderRadius: 'var(--radius-md)', border: '1px solid rgba(15, 23, 42, 0.08)' }}>
                    <strong style={{ display: 'block', fontSize: 12, color: card.color, textTransform: 'uppercase', marginBottom: '0.45rem' }}>{card.title}</strong>
                    <div style={{ fontSize: 13, color: card.color, lineHeight: 1.5 }}>{card.body}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card" style={{ padding: '1.5rem', background: 'linear-gradient(145deg, rgba(240,247,255,0.94), rgba(255,255,255,0.98))' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, color: 'var(--primary)', marginBottom: '1.5rem' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>monitoring</span>
                Resolution Impact
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--outline-variant)', paddingBottom: '0.75rem' }}>
                  <span style={{ color: 'var(--on-surface-variant)', fontSize: 13, fontWeight: 500 }}>Checklist Items Secured</span>
                  <strong style={{ color: 'var(--on-surface)', fontSize: '1.15rem' }}>{impactStats.secured}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--outline-variant)', paddingBottom: '0.75rem' }}>
                  <span style={{ color: 'var(--on-surface-variant)', fontSize: 13, fontWeight: 500 }}>Risk Reduced By</span>
                  <strong style={{ color: '#16a34a', fontSize: '1.15rem' }}>{impactStats.riskReduction}%</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--on-surface-variant)', fontSize: 13, fontWeight: 500 }}>Pending Execution Hours</span>
                  <strong style={{ color: 'var(--error)', fontSize: '1.15rem' }}>{impactStats.delay} Hours</strong>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>history</span>
              Activity Log
            </h2>
            <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>{logItems.length} events</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {logItems.map(item => (
              <div key={item.id} style={{ padding: '0.85rem 1rem', background: 'var(--surface-container-lowest)', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.2rem' }}>
                  <strong style={{ fontSize: 13 }}>{item.actor}</strong>
                  <span style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>{item.time}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--on-surface-variant)' }}>{item.message}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
          <button onClick={() => void handleSaveDraft()} disabled={locked || savingDraft || !draft.trim()} className="btn-outline" style={{ opacity: locked ? 0.5 : 1 }}>
            Save Draft
          </button>
          <button
            onClick={() => void handleSendAndLock()}
            disabled={locked || !draft.trim()}
            className="machined-btn"
            style={{ padding: '0.625rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: locked ? 0.5 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>lock</span>
            Send & Lock Batch
          </button>
        </div>
      </div>
    </main>
  );
}
