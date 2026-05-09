import React, { useEffect, useMemo, useState } from 'react';

import { useAuth } from '../../auth/useAuth';
import { apiFetch } from '../../config';

const EMPTY_GRAPH = {
  nodes: [],
  edges: [],
  columns: { raw_material: [], assembly_unit: [], finished_good: [] },
};

const COLUMN_CONFIG = [
  { title: 'Raw Materials', key: 'raw_material', icon: 'location_on', dot: '#00628d' },
  { title: 'Assembly Units', key: 'assembly_unit', icon: 'precision_manufacturing', dot: 'var(--primary)' },
  { title: 'Finished Goods', key: 'finished_good', icon: 'inventory_2', dot: 'var(--secondary)' },
];

function statusBadge(status) {
  const map = {
    active: { label: 'ACTIVE', cls: 'green' },
    flagged: { label: 'FLAGGED', cls: 'amber' },
    contained: { label: 'CONTAINED', cls: 'slate' },
    recalled: { label: 'RECALLED', cls: 'red' },
  };
  return map[status] || map.active;
}

function traceNodeClass(status, riskScore) {
  if (status === 'recalled') return 'blocked';
  if (status === 'flagged') return riskScore > 0.7 ? 'implicated' : 'suspect';
  if (status === 'contained') return 'normal';
  return riskScore > 0.7 ? 'suspect' : 'normal';
}

function riskColor(riskScore) {
  if (riskScore > 0.7) return '#ba1a1a';
  if (riskScore >= 0.4) return '#d97706';
  return '#166534';
}

function locationLabel(node) {
  return node?.location || node?.supplier || 'Unknown';
}

function summaryText(nodeDetail) {
  if (!nodeDetail) {
    return 'Select a traceability node to inspect linked batches, locations, and downstream impact.';
  }
  if (nodeDetail.metadata?.summary) {
    return nodeDetail.metadata.summary;
  }
  if (nodeDetail.batch_number) {
    return `Batch signal linked to ${nodeDetail.batch_number}.`;
  }
  if (nodeDetail.supplier) {
    return `Supplier-linked traceability signal for ${nodeDetail.supplier}.`;
  }
  return `Traceability record for ${nodeDetail.name}.`;
}

function updateGraphNodeStatus(graphData, nodeId, status) {
  const updateNode = (node) => (node.id === nodeId ? { ...node, status } : node);
  return {
    ...graphData,
    nodes: graphData.nodes.map(updateNode),
    columns: Object.fromEntries(
      Object.entries(graphData.columns || {}).map(([key, nodes]) => [key, (nodes || []).map(updateNode)])
    ),
  };
}

export default function TraceabilityMatrix() {
  const { token, role } = useAuth();
  const canManageTraceability = role === 'admin';
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [showContainment, setShowContainment] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [graphData, setGraphData] = useState(EMPTY_GRAPH);
  const [loadingGraph, setLoadingGraph] = useState(true);
  const [nodeDetail, setNodeDetail] = useState(null);
  const [impactData, setImpactData] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [containmentNotes, setContainmentNotes] = useState('');
  const [containing, setContaining] = useState(false);

  useEffect(() => {
    if (!token) {
      return undefined;
    }

    let cancelled = false;

    async function loadGraph() {
      setLoadingGraph(true);
      try {
        let response = await apiFetch('/api/traceability/graph');
        let data = response.ok ? await response.json() : EMPTY_GRAPH;

        const shouldSeed =
          Array.isArray(data.nodes) &&
          (
            data.nodes.length === 0 ||
            !Array.isArray(data.columns?.assembly_unit) ||
            data.columns.assembly_unit.length === 0
          );

        if (!cancelled && shouldSeed && canManageTraceability) {
          const seedResponse = await apiFetch('/api/traceability/seed', { method: 'POST' });
          if (seedResponse.ok) {
            response = await apiFetch('/api/traceability/graph');
            data = response.ok ? await response.json() : EMPTY_GRAPH;
          }
        }

        if (cancelled) {
          return;
        }

        const safeData = {
          nodes: Array.isArray(data.nodes) ? data.nodes : [],
          edges: Array.isArray(data.edges) ? data.edges : [],
          columns: {
            raw_material: Array.isArray(data.columns?.raw_material) ? data.columns.raw_material : [],
            assembly_unit: Array.isArray(data.columns?.assembly_unit) ? data.columns.assembly_unit : [],
            finished_good: Array.isArray(data.columns?.finished_good) ? data.columns.finished_good : [],
          },
        };
        setGraphData(safeData);
        setSelectedId((current) => current || safeData.nodes[0]?.id || '');
      } catch (error) {
        console.error('Traceability load failed:', error);
        if (!cancelled) {
          setGraphData(EMPTY_GRAPH);
        }
      } finally {
        if (!cancelled) {
          setLoadingGraph(false);
        }
      }
    }

    void loadGraph();
    return () => {
      cancelled = true;
    };
  }, [canManageTraceability, token]);

  useEffect(() => {
    if (!token || !selectedId) {
      setNodeDetail(null);
      setImpactData(null);
      return;
    }

    let cancelled = false;

    async function loadDetail() {
      setLoadingDetail(true);
      try {
        const [nodeResponse, impactResponse] = await Promise.all([
          apiFetch(`/api/traceability/nodes/${selectedId}`),
          apiFetch(`/api/traceability/impact/${selectedId}`),
        ]);
        const [nodePayload, impactPayload] = await Promise.all([
          nodeResponse.ok ? nodeResponse.json() : null,
          impactResponse.ok ? impactResponse.json() : null,
        ]);
        if (!cancelled) {
          setNodeDetail(nodePayload);
          setImpactData(impactPayload);
        }
      } catch (error) {
        console.error('Traceability detail load failed:', error);
        if (!cancelled) {
          setNodeDetail(null);
          setImpactData(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedId, token]);

  const selectedNode = useMemo(() => {
    return nodeDetail || graphData.nodes.find((node) => node.id === selectedId) || null;
  }, [graphData.nodes, nodeDetail, selectedId]);

  const columns = useMemo(() => {
    return COLUMN_CONFIG.map((column) => ({
      ...column,
      nodes: graphData.columns?.[column.key] || [],
    }));
  }, [graphData.columns]);

  function filterNodes(nodes) {
    if (!query.trim()) return nodes;
    const q = query.toLowerCase();
    return nodes.filter((node) =>
      (node.name || '').toLowerCase().includes(q) ||
      (node.sku || '').toLowerCase().includes(q) ||
      (node.location || '').toLowerCase().includes(q) ||
      (node.supplier || '').toLowerCase().includes(q) ||
      (node.batch_number || '').toLowerCase().includes(q)
    );
  }

  function handleSimulateImpact() {
    if (!selectedId || !impactData) {
      return;
    }
    setSimulating(true);
  }

  async function handleInitiateContainment() {
    if (!selectedId) return;
    setContaining(true);
    try {
      const response = await apiFetch(`/api/traceability/nodes/${selectedId}/contain`, {
        method: 'POST',
        body: JSON.stringify({
          actions: [
            'Block batch from further distribution',
            'Notify supplier of containment action',
            'Pause downstream production lines',
            'Flag linked clusters for review',
          ],
          notes: containmentNotes,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setGraphData((prev) => updateGraphNodeStatus(prev, selectedId, 'contained'));
        setNodeDetail((prev) => (prev ? { ...prev, ...data, status: 'contained' } : data));
        setShowContainment(false);
        setContainmentNotes('');
        window.alert('Containment protocol initiated successfully.');
      }
    } finally {
      setContaining(false);
    }
  }

  async function handleExportData() {
    const response = await apiFetch('/api/traceability/export', {
      method: 'POST',
      body: JSON.stringify({
        node_id: selectedId || null,
        format: 'json',
      }),
    });
    const data = await response.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `traceability-export-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleGenerateAuditReport() {
    const response = await apiFetch('/api/audit?limit=100');
    const entries = response.ok ? await response.json() : [];
    const traceEntries = (entries || []).filter((entry) =>
      entry.endpoint?.includes('traceability') || entry.cluster_id === nodeDetail?.cluster_id
    );
    const report = {
      generated_at: new Date().toISOString(),
      node: nodeDetail,
      impact: impactData,
      audit_trail: traceEntries,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `audit-report-${nodeDetail?.id || 'all'}-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const selectedRiskScore = Number(selectedNode?.risk_score || 0);
  const selectedRiskPercent = Math.round(selectedRiskScore * 100);
  const selectedRiskColor = riskColor(selectedRiskScore);
  const selectedBadge = statusBadge(selectedNode?.status);
  const downstreamNodes = impactData?.downstream_nodes || [];
  const recommendedActions = impactData?.recommended_actions || [];

  if (loadingGraph) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px', color: '#6b7280', gap: '12px' }}>
        <span style={{ fontSize: '24px' }}>O</span>
        <span>Loading traceability graph...</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - var(--nav-height) - var(--footer-height))' }}>
      {showContainment && selectedNode && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', padding: '2rem', borderRadius: 'var(--radius-xl)', width: 500, boxShadow: 'var(--shadow-xl)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', color: 'var(--error)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 24 }}>auto_awesome</span>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>AI-Driven Containment Workflow</h2>
            </div>
            <p style={{ color: 'var(--on-surface-variant)', fontSize: 14, marginBottom: '2rem' }}>
              Initiating multi-layered containment protocol for {selectedNode.name} across all affected environments.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', background: 'var(--surface-container-low)', borderRadius: 'var(--radius-md)' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>check_circle</span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>Auto-blocking Batch {selectedNode.batch_number || selectedNode.sku || selectedNode.id} globally</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', background: 'var(--surface-container-low)', borderRadius: 'var(--radius-md)' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>check_circle</span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>Notifying supplier: {locationLabel(selectedNode)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', background: 'var(--surface-container-low)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--outline-variant)', borderTopColor: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 14, fontWeight: 500 }}>Pausing downstream production flows linked to this node...</span>
              </div>
            </div>

            <textarea
              placeholder="Containment notes (optional)..."
              value={containmentNotes}
              onChange={(event) => setContainmentNotes(event.target.value)}
              style={{
                width: '100%',
                height: '80px',
                margin: '12px 0',
                padding: '8px',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                resize: 'vertical',
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button className="btn-outline" onClick={() => setShowContainment(false)}>Cancel Workflow</button>
              <button
                className="machined-btn"
                style={{ padding: '0.625rem 1.5rem', borderRadius: 'var(--radius-md)' }}
                onClick={handleInitiateContainment}
                disabled={containing}
              >
                {containing ? 'Initiating...' : 'Confirm Containment'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="custom-scroll" style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', background: 'var(--surface)', padding: '3rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
              {selectedNode?.batch_number || selectedNode?.sku || 'Live Traceability'} Lineage
            </h1>
            <div style={{ height: 16, width: 1, background: 'rgba(193,198,215,0.3)' }} />
            <div style={{ position: 'relative' }}>
              <span className="material-symbols-outlined" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--outline)', fontSize: 16 }}>search</span>
              <input type="text" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search batch, lot, or node..." style={{ paddingLeft: 40, paddingRight: 16, paddingTop: 6, paddingBottom: 6, background: 'var(--surface-container-lowest)', border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, width: 256, boxShadow: 'inset 0 0 0 1px rgba(193,198,215,0.2)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
             {canManageTraceability ? <button onClick={handleExportData} className="btn-outline" style={{ fontSize: 14, fontWeight: 600 }}>Export Data</button> : null}
             {canManageTraceability ? <button onClick={handleGenerateAuditReport} className="machined-btn" style={{ padding: '0.375rem 1.25rem', borderRadius: 'var(--radius-full)', fontSize: 14 }}>Generate Audit Report</button> : null}
           </div>
         </div>

        {graphData.nodes.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px', color: '#6b7280', gap: '12px' }}>
            <span className="material-symbols-outlined">hub</span>
            <span>No traceability nodes available yet.</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4rem', minWidth: 1200, position: 'relative', alignItems: 'start' }}>
            {columns.map((column) => (
              <div key={column.key} style={{ display: 'flex', flexDirection: 'column', gap: '2rem', paddingTop: 0 }}>
                <div className="trace-column-header">
                  <div className="dot" style={{ background: column.dot }} />
                  <span className="label">{column.title}</span>
                </div>
                {filterNodes(column.nodes).length > 0 ? filterNodes(column.nodes).map((node) => {
                  const badge = statusBadge(node.status);
                  const nodeClass = traceNodeClass(node.status, Number(node.risk_score || 0));
                  return (
                    <div key={node.id} style={{ position: 'relative' }} onClick={() => setSelectedId(node.id)}>
                      <div
                        className={`trace-node ${nodeClass}`}
                        style={{
                          outline: selectedId === node.id ? '2px solid var(--primary)' : undefined,
                          ...(node.status === 'flagged' && Number(node.risk_score || 0) > 0.7
                            ? { boxShadow: 'var(--shadow-lg)', transform: 'scale(1.02)' }
                            : {}),
                        }}
                      >
                        <div className="node-top">
                          <span className="node-name">{node.name}</span>
                          <span className={`severity-badge ${badge.cls}`}>{badge.label}</span>
                        </div>
                        <div className="node-sku">SKU: {node.sku || node.batch_number || node.id}</div>
                        <div className="node-location">
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{column.icon}</span>
                          <span>{locationLabel(node)}</span>
                        </div>
                      </div>
                    </div>
                  );
                }) : (
                  <div style={{ minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--outline-variant)', borderRadius: 'var(--radius-xl)', color: 'var(--on-surface-variant)', background: 'var(--surface-container-lowest)', padding: '1rem' }}>
                    No {column.title.toLowerCase()} linked yet.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <aside className="impact-sidebar" style={{ width: 420 }}>
        <div style={{ padding: '1.5rem', borderBottom: '1px solid rgba(193,198,215,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--on-surface-variant)' }}>Node Analysis</h2>
            <button onClick={handleSimulateImpact} style={{ background: simulating ? 'var(--primary)' : 'transparent', color: simulating ? 'white' : 'var(--primary)', border: '1px solid var(--primary)', borderRadius: 'var(--radius-full)', padding: '0.25rem 0.75rem', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>science</span>
              Simulate Impact
            </button>
          </div>

          <div style={{ padding: '1.25rem', background: selectedRiskScore > 0.7 ? 'rgba(255,218,214,0.15)' : 'var(--surface-container-lowest)', borderRadius: 'var(--radius-xl)', border: `1px solid ${selectedRiskScore > 0.7 ? 'rgba(186,26,26,0.3)' : 'var(--outline-variant)'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span className="material-symbols-outlined" style={{ color: selectedRiskColor }}>
                  {selectedRiskScore > 0.7 ? 'report' : selectedRiskScore >= 0.4 ? 'warning' : 'verified'}
                </span>
                <h3 style={{ fontWeight: 800, fontSize: 16 }}>{selectedNode?.name || 'No node selected'}</h3>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 24, fontWeight: 900, color: selectedRiskColor, lineHeight: 1 }}>
                  {selectedRiskPercent}
                </div>
                <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.7, textTransform: 'uppercase' }}>Risk Score</div>
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ height: 8, borderRadius: '999px', background: 'var(--surface-container-high)' }}>
                <div style={{ width: `${selectedRiskPercent}%`, height: '100%', borderRadius: '999px', background: selectedRiskColor, transition: 'width 0.2s ease' }} />
              </div>
            </div>

            <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', marginBottom: '1.25rem', lineHeight: 1.6 }}>
              {loadingDetail ? 'Loading node details...' : summaryText(nodeDetail)}
            </p>

            <div style={{ background: 'var(--surface)', padding: '1rem', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--secondary)', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: 'var(--secondary)' }}>Explainable AI</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--on-surface-variant)' }}>
                  Confidence: <strong style={{ color: 'var(--on-surface)' }}>{selectedRiskPercent}%</strong>
                </div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: '0.25rem' }}>
                Status: <span className={`severity-badge ${selectedBadge.cls}`}>{selectedBadge.label}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--on-surface-variant)', lineHeight: 1.5 }}>
                {recommendedActions.length > 0 ? (
                  <div style={{ display: 'grid', gap: '0.35rem' }}>
                    {recommendedActions.map((action, index) => (
                      <div key={`${selectedId || 'node'}-action-${index}`}>- {action}</div>
                    ))}
                  </div>
                ) : (
                  'No recommendation set yet.'
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ background: 'var(--surface-container-lowest)', padding: '0.5rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: 10, color: 'var(--outline)', textTransform: 'uppercase', fontWeight: 700 }}>Facility</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: selectedRiskColor }}>{locationLabel(selectedNode)}</div>
              </div>
              <div style={{ background: 'var(--surface-container-lowest)', padding: '0.5rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: 10, color: 'var(--outline)', textTransform: 'uppercase', fontWeight: 700 }}>Batch ID</div>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{selectedNode?.batch_number || 'N/A'}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="custom-scroll" style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {simulating && impactData && (
            <div style={{ backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '12px 16px', marginTop: '12px' }}>
              <strong>Impact Simulation</strong>
              <p style={{ margin: '8px 0 0', fontSize: '13px' }}>
                {impactData.downstream_nodes.length} downstream nodes affected. {impactData.total_impacted_units} units at risk. Risk propagation: {(impactData.risk_propagation * 100).toFixed(0)}%.
              </p>
              {impactData.affected_clusters.length > 0 && (
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#92400e' }}>
                  Linked clusters: {impactData.affected_clusters.map((cluster) => cluster.cluster_id).join(', ')}
                </p>
              )}
            </div>
          )}

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: 12, fontWeight: 700 }}>Downstream Impact</h3>
              <span className="font-mono" style={{ fontSize: 10, padding: '0.125rem 0.5rem', background: 'var(--surface-container-high)', borderRadius: 'var(--radius-full)' }}>
                {downstreamNodes.length} NODES
              </span>
            </div>

            {downstreamNodes.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--outline)', fontStyle: 'italic', padding: '1rem', textAlign: 'center', background: 'var(--surface-container-lowest)', borderRadius: 'var(--radius-md)' }}>
                No significant downstream nodes affected.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {downstreamNodes.map((node) => (
                  <div key={node.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', background: 'var(--surface-container-low)', borderRadius: 'var(--radius-md)', transition: 'background 0.15s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span className="material-symbols-outlined" style={{ color: 'var(--outline)', fontSize: 18 }}>
                        {node.type === 'finished_good' ? 'inventory_2' : node.type === 'assembly_unit' ? 'precision_manufacturing' : 'hub'}
                      </span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{node.name}</div>
                        <div className="font-mono" style={{ fontSize: 10, color: 'var(--outline)' }}>{node.id}</div>
                      </div>
                    </div>
                    <span className="material-symbols-outlined" style={{ color: Number(node.risk_score || 0) > 0.7 ? 'var(--error)' : '#f59e0b', fontSize: 18 }}>
                      {Number(node.risk_score || 0) > 0.7 ? 'warning' : 'priority_high'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: '0.75rem', fontSize: 12, color: 'var(--on-surface-variant)', lineHeight: 1.6 }}>
              <div>{impactData?.total_impacted_units || 0} units affected</div>
              <div>
                {(impactData?.affected_clusters || []).length > 0
                  ? `Affected clusters: ${impactData.affected_clusters.map((cluster) => cluster.cluster_id).join(', ')}`
                  : 'Affected clusters: none linked'}
              </div>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 12, fontWeight: 700, marginBottom: '1rem' }}>Facility Location</h3>
            <div style={{ position: 'relative', borderRadius: 'var(--radius-xl)', overflow: 'hidden', height: 128, marginBottom: '1rem', background: '#e2e8f0' }}>
              <img alt="Facility" src="https://lh3.googleusercontent.com/aida-public/AB6AXuC8_IuSGXx_kNWcmi7uKBMBemG53wIli_vxC-WTP-1nd8tw3xgioViqvmz7yn8S8qNg04tmofm9jLNkPQkBU7M6bl0Y7ymvvxP9hVusKRYfOO4JpAOF9GgbUszZxWV8BpTOmIoOW6Ubx1UA9xiwDVRLV4fZ86wfOhuwAgXssoR12bFkjtWe4krOHrZE97jKlnWHuECiD1gPR4rzbXhpm8_QeaH4SXxjztHJ9nQWwgOmWqZ2pBsT2UBvuexApcGQpoqlY6rre1rZ3Xbt" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(1) brightness(0.75)' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)' }} />
              <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: selectedRiskScore > 0.7 ? '#ef4444' : selectedRiskScore >= 0.4 ? '#f59e0b' : '#10b981', animation: 'pulse-dot 2s infinite' }} />
                <span style={{ fontSize: 10, color: 'white', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{locationLabel(selectedNode)}</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: '1.5rem', borderTop: '1px solid rgba(193,198,215,0.1)', background: 'rgba(242,244,246,0.5)' }}>
           {canManageTraceability ? (
             <button onClick={() => setShowContainment(true)} disabled={!selectedNode} style={{ width: '100%', padding: '0.875rem', background: 'var(--on-surface)', color: 'white', borderRadius: 'var(--radius-xl)', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', transition: 'all 0.15s', boxShadow: 'var(--shadow-md)', cursor: 'pointer', opacity: selectedNode ? 1 : 0.6 }}>
               <span className="material-symbols-outlined" style={{ fontSize: 20 }}>auto_awesome</span>
               Initiate Containment Protocol
             </button>
           ) : (
             <div style={{ fontSize: 12, color: 'var(--on-surface-variant)', lineHeight: 1.5 }}>
               Read-only traceability access is enabled for moderator users.
             </div>
           )}
         </div>
       </aside>
     </div>
  );
}
