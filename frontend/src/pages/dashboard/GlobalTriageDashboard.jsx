import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { apiFetch } from '../../config';
import { useURLParams } from '../../hooks/useURLParams';
import { supabase } from '../../lib/supabaseClient';
import { createPageLogger } from '../../utils/pageLogger';

const pageLogger = createPageLogger('GlobalTriageDashboard');

function matchesQuery(values, query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return values.filter(Boolean).some(value => String(value).toLowerCase().includes(normalized));
}

function modeMatches(cluster, mode) {
  const severity = String(cluster?.severity || '').toLowerCase();
  if (!mode || mode === 'all') {
    return true;
  }
  if (mode === 'critical') {
    return severity === 'critical' || severity === 'high';
  }
  if (mode === 'watchlist') {
    return severity === 'medium' || severity === 'low';
  }
  return true;
}

function buildAlertFromCluster(cluster) {
  const severity = String(cluster?.severity || '').toLowerCase();
  return {
    type: severity === 'critical' ? 'error' : severity === 'medium' ? 'amber' : 'info',
    label: `${(cluster?.severity || 'Active').toUpperCase()} CLUSTER ${cluster?.cluster_id}`,
    body: cluster?.ai_summary || `Live cluster ${cluster?.cluster_id} requires analyst review.`,
    time: cluster?.last_seen || cluster?.first_seen || 'Unknown',
    prompt: `Answer this exact triage question for cluster ${cluster?.cluster_id}: what is the most important next step based on the current evidence?`,
  };
}

export default function GlobalTriageDashboard() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const { cluster_id, query, mode } = useURLParams();
  const [stats, setStats] = useState({ totalIntake: 0, activeClusters: 0, suppliersAtRisk: 0 });
  const [clusters, setClusters] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('LIVE FEED');
  const [queryInput, setQueryInput] = useState(query || '');
  const canUseAI = role === 'admin' || role === 'moderator';

  useEffect(() => {
    setQueryInput(query || '');
  }, [query]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const [statsRes, clustersRes, ticketsRes] = await Promise.all([
          pageLogger.trackFetch('dashboard stats response', () => apiFetch('/api/dashboard/stats')),
          pageLogger.trackFetch('clusters response', () => apiFetch('/api/clusters')),
          pageLogger.trackFetch('tickets response', () => apiFetch('/api/tickets')),
        ]);
        if (!statsRes.ok || !clustersRes.ok || !ticketsRes.ok) throw new Error('Could not load triage data');
        const [statsPayload, clustersPayload, ticketsPayload] = await Promise.all([
          statsRes.json(),
          clustersRes.json(),
          ticketsRes.json(),
        ]);
        pageLogger.info('Applied fetched page data', {
          stats_keys: Object.keys(statsPayload || {}).length,
          cluster_count: Array.isArray(clustersPayload) ? clustersPayload.length : 0,
          ticket_count: Array.isArray(ticketsPayload) ? ticketsPayload.length : 0,
        });
        if (!cancelled) {
          setStats(statsPayload);
          setClusters(Array.isArray(clustersPayload) ? clustersPayload : []);
          setTickets(Array.isArray(ticketsPayload) ? ticketsPayload : []);
          setError('');
        }
      } catch (err) {
        pageLogger.error('Page data load failed', {
          message: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unexpected error');
      }
    }

    void loadData();

    const channel = supabase
      .channel(`triage-dashboard-${Date.now()}`)
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
      if (!modeMatches(cluster, mode || 'all')) {
        return false;
      }
      return matchesQuery([cluster.cluster_id, cluster.title, cluster.sku, cluster.defect_family, cluster.ai_summary], query);
    });
  }, [clusters, cluster_id, mode, query]);

  const visibleClusterIds = useMemo(() => new Set(visibleClusters.map(cluster => cluster.cluster_id)), [visibleClusters]);
  const visibleTickets = useMemo(() => {
    return tickets.filter(ticket => {
      if (visibleClusterIds.size > 0 && !visibleClusterIds.has(ticket.cluster_id)) {
        return false;
      }
      return matchesQuery([ticket.ticket_id, ticket.cluster_id, ticket.associated_sku, ticket.content], query);
    });
  }, [tickets, visibleClusterIds, query]);

  const liveFeed = useMemo(() => visibleClusters.slice(0, 4).map(buildAlertFromCluster), [visibleClusters]);
  const leadCluster = visibleClusters[0] || clusters[0] || null;
  const highSeverityCount = visibleClusters.filter(cluster => String(cluster.severity).toLowerCase() === 'critical').length;
  const avgConfidence = visibleClusters.length
    ? Math.round((visibleClusters.reduce((sum, cluster) => sum + Number(cluster.confidence || 0), 0) / visibleClusters.length) * 100)
    : 0;
  const openCount = visibleClusters.filter(cluster => String(cluster.status || 'open').toLowerCase() !== 'resolved').length;

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

  const openCopilotForCluster = (cluster, prompt) => {
    if (!cluster?.cluster_id) {
      navigate('/copilot-v2');
      return;
    }
    navigate(`/copilot-v2?cluster_id=${encodeURIComponent(cluster.cluster_id)}&query=${encodeURIComponent(prompt)}&auto_submit=true`);
  };

  return (
    <main style={{ maxWidth: 'var(--content-max-width)', margin: '0 auto', padding: '1.5rem 1.5rem 4rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--primary)', letterSpacing: '-0.02em', lineHeight: 1 }}>Operational Quality Pulse</h1>
          <p style={{ color: 'var(--on-surface-variant)', marginTop: '0.5rem' }}>
            {canUseAI
              ? 'Live triage board for cluster prioritization, evidence review, and direct copilot escalation.'
              : 'Read-only cluster and intake visibility for registrars.'}
          </p>
          {error ? <p style={{ marginTop: '0.5rem', color: 'var(--error)', fontSize: 13 }}>{error}</p> : null}
        </div>
        {canUseAI && leadCluster ? (
          <button
            onClick={() => openCopilotForCluster(leadCluster, `What is the immediate triage recommendation for cluster ${leadCluster.cluster_id}?`)}
            className="machined-btn"
            style={{ padding: '0.625rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 14 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>smart_toy</span>
            Triage with Copilot
          </button>
        ) : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase' }}>Search Feed</span>
          <input
            value={queryInput}
            onChange={event => setQueryInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                setFilterParams({ query: queryInput });
              }
            }}
            placeholder="Search cluster, SKU, ticket, or evidence"
            style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)', background: 'white' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase' }}>Cluster</span>
          <select value={cluster_id || ''} onChange={event => setFilterParams({ cluster_id: event.target.value })} style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)', background: 'white' }}>
            <option value="">All clusters</option>
            {clusters.map(cluster => (
              <option key={cluster.cluster_id} value={cluster.cluster_id}>{cluster.cluster_id}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase' }}>Mode</span>
          <select value={mode || 'all'} onChange={event => setFilterParams({ mode: event.target.value })} style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)', background: 'white' }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
        {[
          { label: 'Total Intake', icon: 'inbox', value: Number(stats.totalIntake || 0).toLocaleString(), delta: `${visibleTickets.length} visible tickets`, deltaColor: 'var(--secondary)', iconColor: 'var(--primary)' },
          { label: 'Active Clusters', icon: 'hub', value: Number(stats.activeClusters || 0).toLocaleString(), delta: `${highSeverityCount} critical now`, deltaColor: 'var(--error)', iconColor: 'var(--secondary)' },
          canUseAI
            ? { label: 'Confidence Avg', icon: 'query_stats', value: `${avgConfidence}%`, delta: `${visibleClusters.length} clusters in view`, deltaColor: 'var(--on-surface-variant)', iconColor: 'var(--primary-container)' }
            : { label: 'Open Status', icon: 'flag', value: String(openCount), delta: `${visibleClusters.length - openCount} resolved`, deltaColor: 'var(--on-surface-variant)', iconColor: 'var(--primary-container)' },
        ].map(kpi => (
          <div key={kpi.label} className="card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
              <span style={{ color: 'var(--on-surface-variant)', fontWeight: 500, fontSize: 14 }}>{kpi.label}</span>
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: kpi.iconColor }}>{kpi.icon}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.875rem', fontWeight: 700 }}>{kpi.value}</span>
            </div>
            <span className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: kpi.deltaColor }}>{kpi.delta}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: canUseAI ? '2fr 1fr' : '1fr', gap: '1.5rem', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--surface-container)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontWeight: 700, color: 'var(--primary)' }}>Active Cluster Queue</h3>
              <span className="font-mono" style={{ background: 'var(--surface-container-high)', padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-sm)', fontSize: 10 }}>
                {visibleClusters.length} VISIBLE
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cluster ID</th>
                    <th>Product/SKU</th>
                    <th>Signal</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Conf.</th>
                    <th>Time</th>
                    {canUseAI ? <th>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visibleClusters.length > 0 ? visibleClusters.map((row, idx) => (
                    <tr key={row.cluster_id} style={{ background: idx % 2 === 1 ? 'rgba(242,244,246,0.3)' : undefined }}>
                      <td
                        className="mono-cell"
                        onClick={canUseAI ? () => navigate(`/investigate/${row.cluster_id}?stage=investigation`) : undefined}
                        style={canUseAI ? { cursor: 'pointer' } : undefined}
                      >
                        {row.cluster_id}
                      </td>
                      <td>{row.sku}</td>
                      <td>{row.defect_family}</td>
                      <td><span className={`severity-badge ${row.severity === 'Critical' ? 'red' : row.severity === 'Medium' ? 'amber' : 'green'}`}>{row.severity}</span></td>
                      <td>
                        <span className={`severity-badge ${String(row.status || 'open').toLowerCase() === 'resolved' ? 'green' : String(row.status || 'open').toLowerCase() === 'under_investigation' ? 'amber' : 'red'}`}>
                          {String(row.status || 'open').replaceAll('_', ' ')}
                        </span>
                      </td>
                      <td className="font-mono">{row.confidence ? `${(row.confidence * 100).toFixed(1)}%` : 'N/A'}</td>
                      <td style={{ color: 'var(--on-surface-variant)' }}>{row.last_seen}</td>
                      {canUseAI ? (
                        <td>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <button onClick={() => navigate(`/investigate/${row.cluster_id}?stage=investigation`)} className="btn-outline" style={{ fontSize: 10, padding: '0.25rem 0.5rem' }}>Investigate</button>
                            <button onClick={() => openCopilotForCluster(row, `Answer this exact triage question for cluster ${row.cluster_id}: what is the key risk and next action?`)} className="btn-outline" style={{ fontSize: 10, padding: '0.25rem 0.5rem' }}>Copilot</button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  )) : (
                    <tr><td colSpan={canUseAI ? 8 : 7} style={{ textAlign: 'center', padding: '2rem' }}>No live clusters match the current filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {canUseAI ? (
            <div className="card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ color: 'var(--primary)', fontWeight: 600 }}>Visible Ticket Evidence</h3>
                <span className="font-mono" style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--outline)' }}>
                  {visibleTickets.length} tickets
                </span>
              </div>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {visibleTickets.slice(0, 6).map(ticket => (
                  <div key={ticket.ticket_id} style={{ padding: '0.85rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)', background: 'var(--surface-container-lowest)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.35rem' }}>
                      <strong style={{ fontFamily: 'var(--font-mono)' }}>{ticket.ticket_id}</strong>
                      <span style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>{ticket.cluster_id} • {ticket.timestamp}</span>
                    </div>
                    <p style={{ fontSize: 13, lineHeight: 1.5 }}>{ticket.content}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {canUseAI ? (
        <aside className="card copilot-panel" style={{ minHeight: 600 }}>
          <div className="copilot-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>smart_toy</span>
              <h3>QC Copilot</h3>
            </div>
            <p>Live triage escalations and evidence-backed launch actions.</p>
          </div>
          <div className="copilot-tabs">
            <button className={activeTab === 'LIVE FEED' ? 'active' : ''} onClick={() => setActiveTab('LIVE FEED')}>LIVE FEED</button>
            <button className={activeTab === 'SUGGESTIONS' ? 'active' : ''} onClick={() => setActiveTab('SUGGESTIONS')}>SUGGESTIONS</button>
            <button className={activeTab === 'HISTORY' ? 'active' : ''} onClick={() => setActiveTab('HISTORY')}>HISTORY</button>
          </div>
          <div className="custom-scroll" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', maxHeight: 500, flex: 1 }}>
            {activeTab === 'LIVE FEED' ? (
              liveFeed.length > 0 ? liveFeed.map((item, i) => (
                <div key={`${item.label}-${i}`} className={`alert-tile ${item.type === 'error' ? 'critical' : item.type === 'amber' ? 'warning' : 'info'}`}>
                  <div className="alert-header">
                    <div className="alert-title">
                      <span className={`alert-dot ${item.type === 'error' ? 'critical' : item.type === 'amber' ? 'warning' : 'info'}`} />
                      <span className="alert-label">{item.label}</span>
                    </div>
                    <span className="alert-time">{item.time}</span>
                  </div>
                  <p className="alert-body">{item.body}</p>
                  <div className="alert-actions">
                    <button onClick={() => openCopilotForCluster(visibleClusters[i] || leadCluster, item.prompt)}>OPEN IN COPILOT</button>
                    <button className="secondary" onClick={() => {
                      const targetCluster = (visibleClusters[i] || leadCluster)?.cluster_id;
                      if (targetCluster) {
                        navigate(`/investigate/${targetCluster}?stage=investigation`);
                      }
                    }}>VIEW INVESTIGATION</button>
                  </div>
                </div>
              )) : (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--outline)', fontSize: 13, fontStyle: 'italic' }}>
                  No live feed items match the current filters.
                </div>
              )
            ) : activeTab === 'SUGGESTIONS' ? (
              visibleClusters.slice(0, 3).map(cluster => (
                <div key={cluster.cluster_id} style={{ padding: '1rem', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius-md)', background: 'var(--surface-container-lowest)' }}>
                  <strong style={{ display: 'block', marginBottom: '0.35rem' }}>{cluster.cluster_id}</strong>
                  <p style={{ fontSize: 13, lineHeight: 1.5, marginBottom: '0.5rem' }}>
                    Ask Copilot: what is the strongest evidence-backed explanation for {cluster.defect_family || 'this defect'}?
                  </p>
                  <button onClick={() => openCopilotForCluster(cluster, `What is the strongest evidence-backed explanation for cluster ${cluster.cluster_id}?`)} className="btn-outline" style={{ fontSize: 11, padding: '0.35rem 0.55rem' }}>
                    Ask Copilot
                  </button>
                </div>
              ))
            ) : (
              <div style={{ padding: '1rem', color: 'var(--on-surface-variant)', fontSize: 13 }}>
                History is intentionally empty until live triage audit history is exposed here.
              </div>
            )}
          </div>
          <div style={{ marginTop: 'auto', padding: '1rem', borderTop: '1px solid var(--surface-container)', background: 'rgba(242,244,246,0.3)' }}>
            <h4 style={{ fontSize: 11, fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>Current View</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--on-surface-variant)' }}>Visible Clusters</span>
                <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{visibleClusters.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--on-surface-variant)' }}>Visible Tickets</span>
                <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{visibleTickets.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--on-surface-variant)' }}>Critical Clusters</span>
                <span style={{ fontWeight: 700, color: 'var(--error)' }}>{highSeverityCount}</span>
              </div>
            </div>
          </div>
        </aside>
        ) : null}
      </div>
    </main>
  );
}
