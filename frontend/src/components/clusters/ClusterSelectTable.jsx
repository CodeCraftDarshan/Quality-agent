import React, { useEffect, useMemo, useState } from 'react';
import { fetchClusters } from '../../services/copilotService';

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function includesQuery(cluster, query) {
  const normalized = normalize(query);
  if (!normalized) return true;
  return [cluster.cluster_id, cluster.title, cluster.sku, cluster.defect_family, cluster.ai_summary]
    .filter(Boolean)
    .some(value => String(value).toLowerCase().includes(normalized));
}

export default function ClusterSelectTable({
  selectedClusterIds,
  onSelectionChange,
  onStartInvestigation,
}) {
  const [clusters, setClusters] = useState([]);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('severity');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadClusters() {
      setLoading(true);
      try {
        const payload = await fetchClusters();
        if (!cancelled) {
          setClusters(Array.isArray(payload) ? payload : []);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load clusters');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadClusters();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleClusters = useMemo(() => {
    const filtered = clusters.filter(cluster => includesQuery(cluster, query));
    const sortedClusters = [...filtered].sort((left, right) => {
      const order = { open: 0, under_investigation: 1, resolved: 2 };
      const statusDelta = (order[left.status] ?? 0) - (order[right.status] ?? 0);
      if (statusDelta !== 0) {
        return statusDelta;
      }
      if (sortBy === 'tickets') {
        return (Number(right.count || 0) - Number(left.count || 0));
      }
      const leftSeverity = SEVERITY_ORDER[normalize(left.severity)] ?? 9;
      const rightSeverity = SEVERITY_ORDER[normalize(right.severity)] ?? 9;
      if (leftSeverity !== rightSeverity) return leftSeverity - rightSeverity;
      return String(left.cluster_id || '').localeCompare(String(right.cluster_id || ''));
    });
    return sortedClusters;
  }, [clusters, query, sortBy]);

  const selectedSet = useMemo(() => new Set(selectedClusterIds), [selectedClusterIds]);

  const toggleCluster = (clusterId) => {
    const next = new Set(selectedClusterIds);
    if (next.has(clusterId)) {
      next.delete(clusterId);
    } else {
      next.add(clusterId);
    }
    onSelectionChange(Array.from(next));
  };

  const selectSameGroup = (cluster, field) => {
    const key = normalize(cluster?.[field]);
    if (!key) return;
    const grouped = clusters.filter(candidate => normalize(candidate?.[field]) === key).map(candidate => candidate.cluster_id);
    onSelectionChange(Array.from(new Set([...selectedClusterIds, ...grouped])));
  };

  const selectVisible = () => {
    onSelectionChange(Array.from(new Set([...selectedClusterIds, ...visibleClusters.map(cluster => cluster.cluster_id)])));
  };

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--outline-variant)' }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--secondary)' }}>Stage 1</p>
          <h2 style={{ margin: '0.2rem 0 0', fontSize: 22, fontWeight: 850 }}>Select clusters to investigate together</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search/filter clusters"
            style={{ minWidth: 280, padding: '0.75rem 0.95rem', borderRadius: '999px', border: '1px solid var(--outline-variant)', background: 'white' }}
          />
          <select value={sortBy} onChange={event => setSortBy(event.target.value)} style={{ padding: '0.75rem 0.9rem', borderRadius: '999px', border: '1px solid var(--outline-variant)', background: 'white' }}>
            <option value="severity">Sort: Severity</option>
            <option value="tickets">Sort: Tickets</option>
          </select>
        </div>
      </div>

      <div style={{ padding: '1.25rem 1.5rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.9rem', gap: '1rem', padding: '0 16px', overflow: 'hidden', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: 'var(--on-surface-variant)' }}>
            {selectedClusterIds.length} clusters selected
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="btn-outline" onClick={selectVisible}>Select All Visible</button>
            <button className="btn-outline" onClick={() => onSelectionChange([])} disabled={!selectedClusterIds.length}>Clear Selection</button>
            <button className="machined-btn" onClick={onStartInvestigation} disabled={!selectedClusterIds.length}>Start Investigation →</button>
          </div>
        </div>

        {error ? <div style={{ marginBottom: '1rem', color: 'var(--error)', fontSize: 13 }}>{error}</div> : null}

        <div style={{ border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius-xl)', overflow: 'hidden', background: 'white' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '40px 1.2fr 0.7fr 0.7fr 0.7fr 1fr', gap: '0.75rem', padding: '0.85rem 1rem', background: 'var(--surface-container-low)' }}>
            <div />
            <strong>Cluster</strong>
            <strong>SKU</strong>
            <strong>Severity</strong>
            <strong>Tickets</strong>
            <strong>Quick Group</strong>
          </div>

          {loading ? (
            <div style={{ padding: '1.25rem 1rem', color: 'var(--on-surface-variant)' }}>Loading clusters...</div>
          ) : visibleClusters.length === 0 ? (
            <div style={{ padding: '1.25rem 1rem', color: 'var(--on-surface-variant)' }}>No clusters match the current filters.</div>
          ) : visibleClusters.map(cluster => {
            const checked = selectedSet.has(cluster.cluster_id);
            const resolvedDate = cluster.resolved_at ? new Date(cluster.resolved_at) : null;
            const resolvedTitle = cluster.status === 'resolved'
              ? `Resolved: ${resolvedDate && !Number.isNaN(resolvedDate.getTime()) ? resolvedDate.toLocaleDateString() : 'Unknown date'}${cluster.resolution_notes ? `\n${cluster.resolution_notes}` : ''}`
              : '';
            return (
              <div key={cluster.cluster_id} style={{ display: 'grid', gridTemplateColumns: '40px 1.2fr 0.7fr 0.7fr 0.7fr 1fr', gap: '0.75rem', padding: '0.95rem 1rem', borderTop: '1px solid var(--outline-variant)', alignItems: 'center', background: checked ? 'rgba(37, 99, 235, 0.04)' : 'white', opacity: cluster.status === 'resolved' ? 0.5 : 1 }} title={resolvedTitle}>
                <input type="checkbox" checked={checked} onChange={() => toggleCluster(cluster.cluster_id)} />
                <div>
                  <div style={{ fontWeight: 800 }}>{cluster.title || cluster.cluster_id}</div>
                  <div style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>{cluster.cluster_id}</div>
                </div>
                <div>{cluster.sku || '—'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ padding: '0.3rem 0.55rem', borderRadius: '999px', background: normalize(cluster.severity) === 'critical' ? 'var(--error-container)' : 'var(--surface-container-high)', color: normalize(cluster.severity) === 'critical' ? 'var(--on-error-container)' : 'var(--on-surface)', fontSize: 12, fontWeight: 800 }}>
                    {cluster.severity || 'Unknown'}
                  </span>
                  {cluster.status === 'resolved' ? (
                    <span style={{
                      backgroundColor: '#d1fae5', color: '#065f46',
                      padding: '2px 8px', borderRadius: '9999px',
                      fontSize: '11px', fontWeight: 600,
                    }}>RESOLVED</span>
                  ) : null}
                  {cluster.status === 'under_investigation' ? (
                    <span style={{
                      backgroundColor: '#dbeafe', color: '#1e40af',
                      padding: '2px 8px', borderRadius: '9999px',
                      fontSize: '11px', fontWeight: 600,
                    }}>IN PROGRESS</span>
                  ) : null}
                </div>
                <div>{cluster.count ?? 0}</div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <button className="btn-outline" onClick={() => selectSameGroup(cluster, 'sku')}>Same SKU</button>
                  <button className="btn-outline" onClick={() => selectSameGroup(cluster, 'defect_family')}>Same Family</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
