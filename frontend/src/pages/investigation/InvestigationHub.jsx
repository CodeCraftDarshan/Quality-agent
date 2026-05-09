import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import ClusterSelectTable from '../../components/clusters/ClusterSelectTable';
import CrossClusterSummary from '../../components/investigation/CrossClusterSummary';
import MultiClusterPanel from '../../components/investigation/MultiClusterPanel';
import TodoTracker from '../../components/investigation/TodoTracker';
import {
  bulkResolveClusters,
  createTodo,
  fetchClusters,
  fetchInvestigationQuestionsForClusters,
  fetchTodos,
  sendMultiClusterChatMessage,
  updateClusterStatus,
  updateTodo,
} from '../../services/copilotService';

const STAGE_MAP = {
  '1': 'triage',
  '2': 'investigation',
  '3': 'resolution',
  triage: 'triage',
  investigation: 'investigation',
  resolution: 'resolution',
};

const STAGES = ['triage', 'investigation', 'resolution'];

function normalizeStage(value) {
  return STAGE_MAP[String(value || '').trim().toLowerCase()] || 'triage';
}

function parseClusterIds(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function clusterIdsToQuery(clusterIds) {
  return clusterIds.filter(Boolean).join(',');
}

function stageToNumber(stage) {
  return String(STAGES.indexOf(stage) + 1);
}

function summarizeClusterIds(clusterIds) {
  if (!clusterIds.length) return 'No clusters selected';
  if (clusterIds.length === 1) return clusterIds[0];
  return `${clusterIds.length} clusters selected`;
}

function parseTodoStatus(todo) {
  return todo?.status === 'completed' ? 'completed' : 'pending';
}

function normalizeTodoText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildPromptForResolution(clusterIds) {
  return `Summarize the cross-cluster findings for clusters ${clusterIds.join(', ')}. Include common defect patterns, a short evidence-backed conclusion, and actionable next steps.`;
}

function buildPromptForInvestigation(clusterIds, message) {
  return `Investigate clusters ${clusterIds.join(', ')} together. ${message}\n\nReturn evidence-backed hypotheses, reasoning, and next actions, and label each point with the cluster id when possible.`;
}

function deriveCrossClusterActions(summary, selectedClusters) {
  const normalized = new Set();
  const actions = [];

  const pushAction = value => {
    const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
    if (!cleaned) {
      return;
    }
    const key = normalizeTodoText(cleaned);
    if (normalized.has(key)) {
      return;
    }
    normalized.add(key);
    actions.push(cleaned);
  };

  if (Array.isArray(summary?.next_actions)) {
    summary.next_actions.forEach(pushAction);
  }

  if (!actions.length && Array.isArray(summary?.reasoning_chain)) {
    summary.reasoning_chain
      .slice(0, 3)
      .forEach(item => pushAction(`Validate this cross-cluster finding with owners: ${item}`));
  }

  if (!actions.length && Array.isArray(summary?.hypotheses)) {
    summary.hypotheses
      .slice(0, 2)
      .forEach(item => pushAction(`Test cross-cluster hypothesis: ${item?.title || item}`));
  }

  if (!actions.length && selectedClusters.length) {
    const clusterLabel = selectedClusters.map(cluster => cluster.cluster_id || cluster.id).join(', ');
    pushAction(`Confirm shared containment plan for clusters ${clusterLabel}.`);
    pushAction(`Review the strongest evidence across clusters ${clusterLabel} with operations and quality owners.`);
  }

  return actions.slice(0, 4);
}

export default function InvestigationHub() {
  const [searchParams, setSearchParams] = useSearchParams();

  const stage = normalizeStage(searchParams.get('stage'));
  const selectedClusterIds = useMemo(() => parseClusterIds(searchParams.get('clusters')), [searchParams]);
  const [allClustersMap, setAllClustersMap] = useState({});
  const [chatHistory, setChatHistory] = useState([]);
  const [resolutionSummary, setResolutionSummary] = useState(null);
  const [todos, setTodos] = useState([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [autoSeedingActions, setAutoSeedingActions] = useState(false);
  const [autoSeededKey, setAutoSeededKey] = useState('');

  const reloadClusters = async () => {
    try {
      const payload = await fetchClusters();
      const list = Array.isArray(payload) ? payload : [];
      const map = {};
      list.forEach(cluster => {
        const id = cluster.cluster_id || cluster.id;
        map[id] = cluster;
      });
      setAllClustersMap(map);
    } catch (err) {
      console.error('Failed to load clusters:', err);
    }
  };

  // FIX 1: Fetch full cluster data on mount
  useEffect(() => {
    let cancelled = false;

    async function loadAllClusters() {
      try {
        const payload = await fetchClusters();
        if (cancelled) return;

        const list = Array.isArray(payload) ? payload : [];
        const map = {};
        list.forEach(cluster => {
          const id = cluster.cluster_id || cluster.id;
          map[id] = cluster;
        });
        setAllClustersMap(map);
      } catch (err) {
        console.error('Failed to load clusters:', err);
      }
    }

    void loadAllClusters();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedClusters = useMemo(
    () => selectedClusterIds
      .map(id => allClustersMap[id])
      .filter(Boolean),
    [selectedClusterIds, allClustersMap]
  );
  const totalTickets = useMemo(
    () => selectedClusters.reduce((sum, cluster) => sum + Number(cluster?.tickets?.length || cluster?.count || 0), 0),
    [selectedClusters]
  );
  const resolutionActions = useMemo(
    () => deriveCrossClusterActions(resolutionSummary, selectedClusters),
    [resolutionSummary, selectedClusters]
  );
  const todoKeys = useMemo(
    () => new Set(todos.map(todo => `${todo.cluster_id}::${normalizeTodoText(todo.text)}`)),
    [todos]
  );
  const clusterSelectionKey = useMemo(
    () => clusterIdsToQuery(selectedClusterIds),
    [selectedClusterIds]
  );

  const syncUrl = useCallback((nextStage, nextClusterIds = selectedClusterIds) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('stage', stageToNumber(nextStage));
    if (nextClusterIds.length) {
      nextParams.set('clusters', clusterIdsToQuery(nextClusterIds));
    } else {
      nextParams.delete('clusters');
    }
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, selectedClusterIds, setSearchParams]);

  useEffect(() => {
    if (stage === 'triage' && selectedClusterIds.length === 0) {
      const saved = parseClusterIds(localStorage.getItem('investigationHubClusters'));
      if (saved.length) {
        syncUrl('triage', saved);
      }
    }
    if (selectedClusterIds.length) {
      localStorage.setItem('investigationHubClusters', clusterIdsToQuery(selectedClusterIds));
    }
    if (selectedClusterIds.length === 0 && stage !== 'triage') {
      syncUrl('triage', []);
    }
  }, [selectedClusterIds, stage, syncUrl]);

  // Load todos for selected clusters
  useEffect(() => {
    let cancelled = false;

    async function loadTodos() {
      if (!selectedClusterIds.length) {
        setChatHistory([]);
        setResolutionSummary(null);
        setTodos([]);
        return;
      }

      try {
        const clusterTodos = await Promise.all(selectedClusterIds.map(async clusterId => {
          return await fetchTodos(clusterId).catch(() => []);
        }));
        if (cancelled) return;
        setTodos(clusterTodos.flat());
      } catch {
        if (!cancelled) {
          setTodos([]);
        }
      }
    }

    void loadTodos();
    return () => {
      cancelled = true;
    };
  }, [selectedClusterIds]);

  useEffect(() => {
    let cancelled = false;

    async function loadResolutionSummary() {
      if (stage !== 'resolution' || selectedClusterIds.length === 0 || resolutionSummary) {
        return;
      }
      try {
        const payload = await sendMultiClusterChatMessage(buildPromptForResolution(selectedClusterIds), selectedClusterIds, 'rca');
        if (!cancelled) {
          setResolutionSummary(payload);
          setChatHistory(history => [
            ...history,
            { role: 'assistant', content: payload.reply, citations: payload.citations || [], clusters: selectedClusterIds },
          ]);
        }
      } catch (error) {
        if (!cancelled) {
          setResolutionSummary({ reply: error instanceof Error ? error.message : 'Failed to generate summary', reasoning_chain: [], next_actions: [], citations: [] });
        }
      }
    }

    void loadResolutionSummary();
    return () => {
      cancelled = true;
    };
  }, [resolutionSummary, selectedClusterIds, stage]);

  useEffect(() => {
    if (stage !== 'resolution') {
      setAutoSeededKey('');
    }
  }, [stage]);

  useEffect(() => {
    let cancelled = false;

    async function autoSeedResolutionActions() {
      if (stage !== 'resolution' || !clusterSelectionKey || !resolutionSummary || autoSeedingActions) {
        return;
      }

      const seedKey = `${clusterSelectionKey}::${resolutionActions.join('|')}`;
      if (!resolutionActions.length || autoSeededKey === seedKey) {
        return;
      }

      const missingByCluster = selectedClusterIds.flatMap(clusterId =>
        resolutionActions
          .filter(action => !todoKeys.has(`${clusterId}::${normalizeTodoText(action)}`))
          .map(action => ({ clusterId, action }))
      );

      if (!missingByCluster.length) {
        if (!cancelled) {
          setAutoSeededKey(seedKey);
        }
        return;
      }

      if (!cancelled) {
        setAutoSeedingActions(true);
      }

      try {
        await Promise.all(missingByCluster.map(item => createTodo(item.clusterId, item.action)));
        const refreshedTodos = await Promise.all(selectedClusterIds.map(clusterId => fetchTodos(clusterId).catch(() => [])));
        if (!cancelled) {
          setTodos(refreshedTodos.flat());
          setAutoSeededKey(seedKey);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to auto-seed cross-cluster actions:', error);
        }
      } finally {
        if (!cancelled) {
          setAutoSeedingActions(false);
        }
      }
    }

    void autoSeedResolutionActions();
    return () => {
      cancelled = true;
    };
  }, [
    autoSeededKey,
    autoSeedingActions,
    clusterSelectionKey,
    resolutionActions,
    resolutionSummary,
    selectedClusterIds,
    stage,
    todoKeys,
  ]);

  const openInvestigation = () => {
    if (!selectedClusterIds.length) return;
    syncUrl('investigation');
    void Promise.all(
      selectedClusters.map(cluster =>
        updateClusterStatus(cluster.cluster_id || cluster.id, { status: 'under_investigation' })
      )
    ).then(() => reloadClusters()).catch(error => {
      console.error('Failed to mark clusters under investigation:', error);
    });
  };

  const askCopilot = async (message) => {
    const text = String(message || '').trim();
    if (!text || !selectedClusterIds.length) return;
    setChatHistory(history => [...history, { role: 'user', content: text, clusters: selectedClusterIds }]);
    setLoadingChat(true);
    try {
      const payload = await sendMultiClusterChatMessage(buildPromptForInvestigation(selectedClusterIds, text), selectedClusterIds, 'rca');
      setChatHistory(history => [
        ...history,
        { role: 'assistant', content: payload.reply, citations: payload.citations || [], clusters: selectedClusterIds },
      ]);
    } finally {
      setLoadingChat(false);
    }
  };

  const addTodo = async (text, targetClusterIds) => {
    const clusterScope = Array.isArray(targetClusterIds) && targetClusterIds.length ? targetClusterIds : selectedClusterIds;
    const created = await Promise.all(clusterScope.map(clusterId => createTodo(clusterId, text)));
    setTodos(current => [...created, ...current]);
  };

  const toggleTodo = async (todo) => {
    const nextStatus = parseTodoStatus(todo) === 'completed' ? 'pending' : 'completed';
    const updated = await updateTodo(todo.id, { status: nextStatus });
    setTodos(current => current.map(item => (item.id === todo.id ? updated : item)));
  };

  const exportReport = () => {
    const report = [
      '# Investigation Hub Report',
      '',
      `Clusters: ${selectedClusterIds.join(', ')}`,
      `Tickets: ${totalTickets}`,
      '',
      '## Findings',
      resolutionSummary?.reply || 'No summary generated yet.',
      '',
      '## Todos',
      ...todos.map(todo => `- [${parseTodoStatus(todo) === 'completed' ? 'x' : ' '}] ${todo.cluster_id}: ${todo.text}`),
    ].join('\n');
    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `investigation-hub-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const closeInvestigation = () => {
    setChatHistory([]);
    setResolutionSummary(null);
    setTodos([]);
    setSearchParams(new URLSearchParams({ stage: '1' }), { replace: true });
    void reloadClusters();
  };

  const renderStage = () => {
    if (stage === 'triage') {
      return (
        <ClusterSelectTable
          selectedClusterIds={selectedClusterIds}
          onSelectionChange={(nextIds) => {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set('clusters', clusterIdsToQuery(nextIds));
            nextParams.set('stage', '1');
            setSearchParams(nextParams, { replace: true });
          }}
          onStartInvestigation={openInvestigation}
        />
      );
    }

    if (stage === 'investigation') {
      return (
        <MultiClusterPanel
          selectedClusters={selectedClusters}
          chatHistory={chatHistory}
          onAsk={askCopilot}
          onAddMore={() => syncUrl('triage')}
          onBackToTriage={() => syncUrl('triage')}
          loading={loadingChat}
          fetchQuestions={fetchInvestigationQuestionsForClusters}
        />
      );
    }

    return (
      <div style={{ display: 'grid', gap: '1rem' }}>
        <CrossClusterSummary
          selectedClusters={selectedClusters}
          summary={resolutionSummary}
          totalTickets={totalTickets}
          onBack={() => syncUrl('investigation')}
          onExport={exportReport}
          onClose={closeInvestigation}
          onResolve={async (clusterIds, resolutionNotes) => {
            const result = await bulkResolveClusters(clusterIds, resolutionNotes);
            if ((result.failed || []).length) {
              throw new Error(`Failed to resolve clusters: ${result.failed.join(', ')}`);
            }
            await reloadClusters();
          }}
        />
        <TodoTracker
          todos={todos}
          selectedClusterIds={selectedClusterIds}
          onToggleTodo={toggleTodo}
          onAddTodo={addTodo}
          emptyStateMessage={autoSeedingActions
            ? 'Loading recommended cross-cluster actions...'
            : 'Recommended cross-cluster actions will appear here automatically once the resolution summary is ready.'}
        />
      </div>
    );
  };

  const stageTitle = useMemo(() => {
    if (stage === 'triage') return 'Select one or more clusters to investigate together';
    if (stage === 'investigation') return `Analysing ${summarizeClusterIds(selectedClusterIds)}`;
    return `Resolution for ${summarizeClusterIds(selectedClusterIds)}`;
  }, [selectedClusterIds, stage]);

  if (!searchParams.get('stage') && !searchParams.get('clusters') && stage === 'triage') {
    return <Navigate to="/investigate?stage=1" replace />;
  }

  return (
    <main style={{ padding: '2rem' }}>
      <section style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--secondary)' }}>Linear Workflow</p>
            <h1 style={{ margin: '0.2rem 0 0.35rem', fontSize: '1.95rem', fontWeight: 850, letterSpacing: '-0.03em' }}>Investigation Hub</h1>
            <p style={{ margin: 0, color: 'var(--on-surface-variant)' }}>{stageTitle}</p>
          </div>
          <div style={{ padding: '0.55rem 0.9rem', borderRadius: '999px', background: selectedClusterIds.length ? '#dcfce7' : 'var(--surface-container-high)', color: selectedClusterIds.length ? '#166534' : 'var(--on-surface-variant)', fontSize: 12, fontWeight: 800 }}>
            {selectedClusterIds.length ? `${selectedClusterIds.length} selected` : 'No clusters selected'}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem' }}>
          {STAGES.map((itemStage, index) => {
            const active = stage === itemStage;
            const completed = STAGES.indexOf(stage) > index;
            const locked = index > 0 && selectedClusterIds.length === 0;
            return (
              <button
                key={itemStage}
                type="button"
                onClick={() => {
                  if (!locked) {
                    syncUrl(itemStage);
                  }
                }}
                disabled={locked}
                style={{
                  textAlign: 'left',
                  padding: '1rem',
                  borderRadius: 'var(--radius-xl)',
                  border: active ? '1px solid var(--primary)' : '1px solid var(--outline-variant)',
                  background: active ? 'rgba(15, 23, 42, 0.04)' : 'white',
                  opacity: locked ? 0.55 : 1,
                  cursor: locked ? 'not-allowed' : 'pointer',
                  boxShadow: active ? '0 8px 24px rgba(15, 23, 42, 0.08)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <strong style={{ fontSize: 14 }}>{index + 1}. {itemStage[0].toUpperCase() + itemStage.slice(1)}</strong>
                  <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: active ? 'var(--primary)' : completed ? '#166534' : 'var(--on-surface-variant)' }}>
                    {active ? 'Active' : completed ? 'Done' : locked ? 'Locked' : 'Ready'}
                  </span>
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--on-surface-variant)' }}>
                  {itemStage === 'triage' ? 'Select one or more clusters.' : itemStage === 'investigation' ? 'Merge evidence and chat across clusters.' : 'Summarize findings and track actions.'}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section style={{ background: 'white', borderRadius: 'var(--radius-xl)', border: '1px solid var(--outline-variant)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
        {renderStage()}
      </section>
    </main>
  );
}
