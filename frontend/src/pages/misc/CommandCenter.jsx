import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../config';
import { useURLParams } from '../../hooks/useURLParams';
import { supabase } from '../../lib/supabaseClient';
import { createPageLogger } from '../../utils/pageLogger';

const pageLogger = createPageLogger('CommandCenter');

function buildModeFilter(cluster, mode) {
  if (!mode || mode === 'all') {
    return true;
  }
  const severity = String(cluster?.severity || '').toLowerCase();
  if (mode === 'critical') {
    return severity === 'critical' || severity === 'high';
  }
  if (mode === 'watchlist') {
    return severity === 'medium' || severity === 'low';
  }
  return true;
}

function matchesQuery(values, query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return values.filter(Boolean).some(value => String(value).toLowerCase().includes(normalized));
}

export default function CommandCenter() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { cluster_id, query, mode } = useURLParams();
  const [stats, setStats] = useState({ totalIntake: 0, activeClusters: 0, suppliersAtRisk: 0 });
  const [tickets, setTickets] = useState([]);
  const [clusters, setClusters] = useState([]);
  const [status, setStatus] = useState('syncing');
  const [error, setError] = useState('');
  const [queryInput, setQueryInput] = useState(query || '');

  useEffect(() => {
    setQueryInput(query || '');
  }, [query]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setStatus('syncing');
      try {
        const [statsRes, ticketsRes, clustersRes] = await Promise.all([
          pageLogger.trackFetch('dashboard stats response', () => apiFetch('/api/dashboard/stats')),
          pageLogger.trackFetch('tickets response', () => apiFetch('/api/tickets')),
          pageLogger.trackFetch('clusters response', () => apiFetch('/api/clusters')),
        ]);

        if (!statsRes.ok || !ticketsRes.ok || !clustersRes.ok) {
          throw new Error('data unavailable');
        }

        const [statsPayload, ticketsPayload, clustersPayload] = await Promise.all([
          statsRes.json(),
          ticketsRes.json(),
          clustersRes.json(),
        ]);
        pageLogger.info('Applied fetched page data', {
          stats_keys: Object.keys(statsPayload || {}).length,
          ticket_count: Array.isArray(ticketsPayload) ? ticketsPayload.length : 0,
          cluster_count: Array.isArray(clustersPayload) ? clustersPayload.length : 0,
        });

        if (!cancelled) {
          setStats(statsPayload);
          setTickets(Array.isArray(ticketsPayload) ? ticketsPayload : []);
          setClusters(Array.isArray(clustersPayload) ? clustersPayload : []);
          setStatus('live');
          setError('');
        }
      } catch (err) {
        pageLogger.error('Page data load failed', {
          message: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) {
          setStatus('degraded');
          setError(err instanceof Error ? err.message : 'Failed to load live workspace data');
        }
      }
    }

    void loadData();

    const channel = supabase
      .channel(`command-center-live-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaint_clusters' }, () => {
        pageLogger.info('Realtime refresh triggered from complaint_clusters');
        void loadData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'investigation_tickets' }, () => {
        pageLogger.info('Realtime refresh triggered from investigation_tickets');
        void loadData();
      })
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, []);

  const visibleClusters = useMemo(() => {
    return clusters.filter(cluster => {
      if (cluster_id && cluster.cluster_id !== cluster_id) {
        return false;
      }
      if (!buildModeFilter(cluster, mode || 'all')) {
        return false;
      }
      return matchesQuery([cluster.cluster_id, cluster.title, cluster.sku, cluster.defect_family, cluster.ai_summary], query);
    });
  }, [clusters, cluster_id, mode, query]);

  const visibleClusterIds = useMemo(
    () => new Set(visibleClusters.map(cluster => cluster.cluster_id)),
    [visibleClusters]
  );

  const visibleTickets = useMemo(() => {
    return tickets.filter(ticket => {
      if (visibleClusterIds.size > 0 && !visibleClusterIds.has(ticket.cluster_id)) {
        return false;
      }
      return matchesQuery([ticket.ticket_id, ticket.cluster_id, ticket.associated_sku, ticket.content], query);
    });
  }, [tickets, visibleClusterIds, query]);

  const leadCluster = visibleClusters[0] || clusters[0] || null;
  const leadTicket = visibleTickets[0] || tickets[0] || null;

  const liveMetrics = useMemo(() => {
    const criticalCount = visibleClusters.filter(cluster => String(cluster.severity).toLowerCase() === 'critical').length;
    const avgConfidence = visibleClusters.length
      ? Math.round(
          (visibleClusters.reduce((sum, cluster) => sum + Number(cluster.confidence || 0), 0) / visibleClusters.length) * 100
        )
      : 0;
    return [
      { label: 'Total Intake (24h)', value: Number(stats.totalIntake || 0).toLocaleString(), meta: `${visibleTickets.length} visible tickets` },
      { label: 'Active Clusters', value: Number(stats.activeClusters || 0).toLocaleString(), meta: `${criticalCount} critical in current view` },
      { label: 'Suppliers At Risk', value: Number(stats.suppliersAtRisk || 0).toLocaleString(), meta: `${avgConfidence}% avg confidence` },
    ];
  }, [stats, visibleClusters, visibleTickets]);

  const traceabilitySummary = useMemo(() => {
    return visibleClusters.slice(0, 3).map(cluster => ({
      clusterId: cluster.cluster_id,
      sku: cluster.sku || 'Unknown SKU',
      defectFamily: cluster.defect_family || 'Unclassified',
      summary: cluster.ai_summary || 'No cluster summary available.',
    }));
  }, [visibleClusters]);

  const copilotLaunchQuery = leadCluster
    ? `What is the most important next investigative question for cluster ${leadCluster.cluster_id} based on the current complaint evidence?`
    : 'Summarize the highest-priority issue in the current dashboard view.';

  const setFilterParams = (nextValues) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      const merged = {
        cluster_id: cluster_id || '',
        query: query || '',
        mode: mode || 'all',
        ...nextValues,
      };
      if (merged.cluster_id) next.set('cluster_id', merged.cluster_id); else next.delete('cluster_id');
      if (merged.query) next.set('query', merged.query); else next.delete('query');
      if (merged.mode && merged.mode !== 'all') next.set('mode', merged.mode); else next.delete('mode');
      return next;
    });
  };

  return (
    <main style={{ maxWidth: 'var(--content-max-width)', margin: '0 auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <section style={{ position: 'relative', background: 'linear-gradient(135deg, #f8fafc, white)', borderRadius: 'var(--radius-xl)', border: '1px solid #e2e8f0', padding: '2rem', overflow: 'hidden' }}>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div style={{ maxWidth: '700px' }}>
            <h1 style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>Quality Intelligence Workspace</h1>
            <p style={{ fontSize: '1.125rem', color: '#64748b' }}>
              Live operational dashboard for cluster triage, complaint evidence review, and direct launch into investigation or copilot workflows.
            </p>
            {error ? <p style={{ marginTop: '0.75rem', fontSize: 13, color: 'var(--error)' }}>{error}</p> : null}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0.75rem', background: status === 'live' ? '#dcfce7' : 'var(--error-container)', color: status === 'live' ? '#166534' : 'var(--on-error-container)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: status === 'live' ? '#22c55e' : 'var(--error)' }} />
              {status === 'live' ? 'Systems Live' : status === 'degraded' ? 'Partial Signal' : 'Syncing'}
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              View: {(mode || 'all').toUpperCase()}
            </span>
          </div>
        </div>

        <div style={{ marginTop: '1.5rem', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Search View</span>
            <input
              value={queryInput}
              onChange={event => setQueryInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  setFilterParams({ query: queryInput });
                }
              }}
              placeholder="Search cluster, SKU, ticket, or evidence text"
              style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid #dbe4ee', background: 'white' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Cluster</span>
            <select value={cluster_id || ''} onChange={event => setFilterParams({ cluster_id: event.target.value })} style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid #dbe4ee', background: 'white' }}>
              <option value="">All clusters</option>
              {clusters.map(cluster => (
                <option key={cluster.cluster_id} value={cluster.cluster_id}>{cluster.cluster_id}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Mode</span>
            <select value={mode || 'all'} onChange={event => setFilterParams({ mode: event.target.value })} style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid #dbe4ee', background: 'white' }}>
              <option value="all">All</option>
              <option value="critical">Critical</option>
              <option value="watchlist">Watchlist</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => setFilterParams({ query: queryInput })} className="machined-btn" style={{ padding: '0.75rem 1rem' }}>Apply</button>
            <button onClick={() => { setQueryInput(''); setFilterParams({ cluster_id: '', query: '', mode: 'all' }); }} className="btn-outline" style={{ padding: '0.75rem 1rem' }}>Clear</button>
          </div>
        </div>
      </section>

      <div className="kpi-grid">
        {liveMetrics.map(metric => (
          <div key={metric.label} className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">{metric.label}</span>
            </div>
            <div className="kpi-value">
              <span className="number">{metric.value}</span>
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{metric.meta}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.5rem' }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div className="card-icon cyan"><span className="material-symbols-outlined">dashboard</span></div>
              <h2 style={{ fontWeight: 600, color: '#0f172a' }}>Live Intake Stream</h2>
            </div>
            <Link to={`/triage?${searchParams.toString()}`} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#0891b2' }}>OPEN TRIAGE</Link>
          </div>
          <div style={{ padding: 0, overflow: 'auto', maxHeight: 420 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ticket ID</th>
                  <th>Cluster</th>
                  <th>Product/SKU</th>
                  <th>Severity</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {visibleTickets.length > 0 ? (
                  visibleTickets.map(ticket => (
                    <tr key={ticket.ticket_id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/investigate?clusters=${encodeURIComponent(ticket.cluster_id)}&stage=2`)}>
                      <td className="mono-cell">{ticket.ticket_id}</td>
                      <td style={{ fontWeight: 600, color: 'var(--primary)' }}>{ticket.cluster_id}</td>
                      <td style={{ fontWeight: 500 }}>{ticket.associated_sku}</td>
                      <td>
                        <span className={`severity-badge ${ticket.severity === 'High' ? 'red' : ticket.severity === 'Medium' ? 'amber' : 'slate'}`}>
                          {ticket.severity}
                        </span>
                      </td>
                      <td style={{ color: '#64748b', fontStyle: 'italic', fontSize: 12 }}>{ticket.timestamp}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                      No tickets match the current live filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
            <h2 style={{ fontWeight: 600, color: '#0f172a' }}>Cluster Watchlist</h2>
            {leadCluster ? (
              <Link to={`/investigate?clusters=${encodeURIComponent(leadCluster.cluster_id)}&stage=2`} style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)' }}>
                Open {leadCluster.cluster_id}
              </Link>
            ) : null}
          </div>
          {traceabilitySummary.length > 0 ? traceabilitySummary.map(item => (
            <div key={item.clusterId} style={{ padding: '1rem', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-lg)', background: 'white' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.35rem' }}>
                <strong style={{ fontFamily: 'var(--font-mono)' }}>{item.clusterId}</strong>
                <span style={{ fontSize: 11, color: '#64748b' }}>{item.sku}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--secondary)', marginBottom: '0.25rem' }}>{item.defectFamily}</div>
              <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>{item.summary}</p>
            </div>
          )) : (
            <div style={{ padding: '1rem', border: '1px dashed #cbd5e1', borderRadius: 'var(--radius-lg)', color: '#64748b' }}>
              No clusters match the current filters.
            </div>
          )}
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div className="card-icon purple"><span className="material-symbols-outlined">psychology</span></div>
              <h2 style={{ fontWeight: 600, color: '#0f172a' }}>RCA Copilot Launch</h2>
            </div>
            <span style={{ padding: '0.125rem 0.5rem', background: '#dcfce7', color: '#166534', fontSize: 10, fontWeight: 700, borderRadius: 'var(--radius-sm)' }}>LIVE QUERY</span>
          </div>
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.6 }}>
              {leadCluster
                ? `Launch copilot against ${leadCluster.cluster_id} using the exact filtered dashboard context.`
                : 'Launch copilot using the current live workspace view.'}
            </p>
            <div style={{ padding: '0.85rem', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-md)', background: '#f8fafc', fontSize: 13, color: '#334155' }}>
              {copilotLaunchQuery}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Link
                to={leadCluster
                  ? `/copilot-v2?cluster_id=${encodeURIComponent(leadCluster.cluster_id)}&query=${encodeURIComponent(copilotLaunchQuery)}&auto_submit=true`
                  : '/copilot-v2'}
                style={{ fontSize: 11, fontWeight: 700, color: '#9333ea', background: '#faf5ff', padding: '0.45rem 0.7rem', borderRadius: 'var(--radius-sm)', textTransform: 'uppercase' }}
              >
                Open in Copilot
              </Link>
              {leadCluster ? (
                <Link to={`/investigate?clusters=${encodeURIComponent(leadCluster.cluster_id)}&stage=2`} style={{ fontSize: 11, fontWeight: 700, color: '#64748b', background: 'white', padding: '0.45rem 0.7rem', borderRadius: 'var(--radius-sm)', border: '1px solid #e2e8f0', textTransform: 'uppercase' }}>
                  Review Cluster
                </Link>
              ) : null}
            </div>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
            <h2 style={{ fontWeight: 600, color: '#0f172a' }}>Resolution Readiness</h2>
            {leadCluster ? <Link to={`/investigate?clusters=${encodeURIComponent(leadCluster.cluster_id)}&stage=3`} style={{ fontSize: 11, fontWeight: 700, color: '#059669' }}>OPEN</Link> : null}
          </div>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {(visibleClusters.slice(0, 3).length > 0 ? visibleClusters.slice(0, 3) : clusters.slice(0, 3)).map(cluster => (
              <div key={cluster.cluster_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', background: 'white', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-xl)' }}>
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{cluster.title}</h4>
                  <p style={{ fontSize: 11, color: '#64748b' }}>
                    {cluster.cluster_id} | {cluster.sku || 'Unknown SKU'}
                  </p>
                </div>
                <Link
                  to={`/investigate?clusters=${encodeURIComponent(cluster.cluster_id)}&stage=3`}
                  style={{ padding: '0.25rem 0.75rem', background: '#0f172a', color: 'white', fontSize: 10, fontWeight: 700, borderRadius: 'var(--radius-md)', textTransform: 'uppercase' }}
                >
                  Resolve
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
