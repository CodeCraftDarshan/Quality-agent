import React, { useState } from 'react';

function toListItems(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [String(value)];
}

export default function CrossClusterSummary({
  selectedClusters,
  summary,
  totalTickets,
  onBack,
  onExport,
  onClose,
  onResolve,
}) {
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const clusterLabel = selectedClusters.map(cluster => cluster.cluster_id || cluster.id).join(', ');
  const skuLabel = (() => {
    const skus = [...new Set(
      selectedClusters.map(cluster => cluster.sku).filter(Boolean)
    )];
    return skus.length === 1 ? skus[0] : skus.length > 1 ? 'Mixed' : 'N/A';
  })();
  const totalClusterTickets = selectedClusters.reduce((sum, cluster) =>
    sum + (cluster.count || cluster.ticket_count || 0), 0);
  const findings = toListItems(summary?.reasoning_chain);
  const nextActions = toListItems(summary?.next_actions);
  const hypotheses = toListItems(summary?.hypotheses?.map(item => item.title || item));

  async function handleCloseAndResolve() {
    if (typeof onResolve !== 'function') {
      onClose?.();
      return;
    }
    setResolving(true);
    setResolveError('');
    try {
      await onResolve(
        selectedClusters.map(cluster => cluster.cluster_id || cluster.id),
        resolutionNotes
      );
      setShowCloseModal(false);
      setResolutionNotes('');
      onClose?.();
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : 'Failed to resolve clusters');
    } finally {
      setResolving(false);
    }
  }

  return (
    <section style={{ padding: '1.5rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--secondary)' }}>Stage 3</p>
        <h2 style={{ margin: '0.2rem 0 0.35rem', fontSize: 22, fontWeight: 850 }}>Resolution</h2>
        <p style={{ margin: 0, color: 'var(--on-surface-variant)' }}>Unified action plan for clusters {clusterLabel || 'selected in this investigation'}.</p>
      </div>

      <div style={{ display: 'grid', gap: '1rem' }}>
        <div className="card" style={{ padding: '1rem 1.1rem' }}>
          <strong style={{ display: 'block', marginBottom: '0.4rem' }}>Investigation Summary</strong>
          <div style={{ color: 'var(--on-surface-variant)', lineHeight: 1.6 }}>
            Clusters: {clusterLabel || 'None'} | SKU: {skuLabel} | {totalClusterTickets} tickets total
          </div>
          {summary?.reply ? <p style={{ marginTop: '0.85rem', lineHeight: 1.65 }}>{summary.reply}</p> : null}
        </div>

        <div className="card" style={{ padding: '1rem 1.1rem' }}>
          <strong style={{ display: 'block', marginBottom: '0.6rem' }}>Cross-Cluster Findings</strong>
          <ul style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.75 }}>
            {(findings.length ? findings : ['Awaiting generated cross-cluster summary.']).map(item => <li key={item}>{item}</li>)}
          </ul>
          {hypotheses.length ? (
            <div style={{ marginTop: '0.85rem' }}>
              <strong style={{ display: 'block', marginBottom: '0.35rem' }}>Leading Hypotheses</strong>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.75 }}>
                {hypotheses.map(item => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', padding: '16px 0' }}>
          <button className="btn-outline" onClick={onBack}>← Back to Investigation</button>
          <button className="btn-outline" onClick={onExport}>Export PDF</button>
          <button className="machined-btn" onClick={() => setShowCloseModal(true)}>Close Investigation</button>
        </div>
      </div>

      {showCloseModal ? (
        <div style={{
          position: 'fixed', inset: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'white', borderRadius: '12px',
            padding: '24px', width: '480px', maxWidth: '90vw',
          }}>
            <h3>Close Investigation</h3>
            <p>Mark all {selectedClusters.length} cluster(s) as resolved?</p>
            <p style={{ fontSize: '13px', color: '#6b7280' }}>
              {selectedClusters.map(cluster => cluster.cluster_id || cluster.id).join(', ')}
            </p>
            <textarea
              placeholder="Resolution notes (optional)..."
              value={resolutionNotes}
              onChange={event => setResolutionNotes(event.target.value)}
              style={{
                width: '100%', height: '80px', marginTop: '12px',
                padding: '8px', border: '1px solid #e5e7eb',
                borderRadius: '6px', resize: 'vertical',
              }}
            />
            {resolveError ? (
              <div style={{ marginTop: '10px', color: '#b91c1c', fontSize: '13px' }}>
                {resolveError}
              </div>
            ) : null}
            <div style={{
              display: 'flex', gap: '8px',
              justifyContent: 'flex-end', marginTop: '16px',
            }}>
              <button
                onClick={() => setShowCloseModal(false)}
                style={{
                  padding: '8px 16px', border: '1px solid #e5e7eb',
                  borderRadius: '6px', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCloseAndResolve()}
                disabled={resolving}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#1e3a5f', color: 'white',
                  borderRadius: '6px', cursor: 'pointer',
                  opacity: resolving ? 0.7 : 1,
                }}
              >
                {resolving ? 'Resolving...' : 'Close & Resolve'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
