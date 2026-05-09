import React, { useEffect, useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { apiFetch } from '../../config';
import { createPageLogger } from '../../utils/pageLogger';

const COLORS = ['#2f855a', '#c53030'];
const pageLogger = createPageLogger('ObservabilityPage');

export default function ObservabilityPage() {
  const [metrics, setMetrics] = useState(null);
  const [audit, setAudit] = useState([]);
  const [risks, setRisks] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ mode: 'all', user: 'all', date: '' });
  const [expandedRow, setExpandedRow] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [metricsRes, auditRes, risksRes, usageRes] = await Promise.all([
          pageLogger.trackFetch('metrics response', () => apiFetch('/api/metrics')).catch(() => ({ ok: false })),
          pageLogger.trackFetch('audit response', () => apiFetch('/api/audit?limit=50')).catch(() => ({ ok: false })),
          pageLogger.trackFetch('risks response', () => apiFetch('/api/risks')).catch(() => ({ ok: false })),
          pageLogger.trackFetch('usage response', () => apiFetch('/api/finops/usage')).catch(() => ({ ok: false })),
        ]);

        if (cancelled) {
          return;
        }

        const metricsPayload = metricsRes.ok ? await metricsRes.json() : null;
        const auditPayload = auditRes.ok ? await auditRes.json() : [];
        const risksPayload = risksRes.ok ? await risksRes.json() : [];
        const usagePayload = usageRes.ok ? await usageRes.json() : null;
        pageLogger.info('Applied fetched page data', {
          metrics_keys: Object.keys(metricsPayload || {}).length,
          audit_count: Array.isArray(auditPayload) ? auditPayload.length : 0,
          risk_count: Array.isArray(risksPayload) ? risksPayload.length : 0,
          usage_keys: Object.keys(usagePayload || {}).length,
        });
        setMetrics(metricsPayload);
        setAudit(auditPayload);
        setRisks(risksPayload);
        setUsage(usagePayload);
        setError(null);
        setLoading(false);
      } catch (err) {
        pageLogger.error('Page data load failed', {
          message: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) {
          setError('Failed to load observability data');
          setLoading(false);
        }
      }
    }

    void load();
    const intervalId = window.setInterval(() => void load(), 10000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const donutData = useMemo(() => {
    const ollama = metrics?.chat_requests_ollama || 0;
    const errors = metrics?.chat_errors_total || 0;
    return [
      { name: 'Ollama', value: ollama },
      { name: 'Errors', value: errors },
    ];
  }, [metrics]);

  const filteredAudit = useMemo(() => {
    return audit.filter(entry => {
      if (filters.mode !== 'all' && entry.mode !== filters.mode) {
        return false;
      }
      if (filters.user !== 'all' && entry.user_id !== filters.user) {
        return false;
      }
      if (filters.date && !String(entry.timestamp || '').startsWith(filters.date)) {
        return false;
      }
      return true;
    });
  }, [audit, filters]);

  const uniqueUsers = useMemo(() => {
    return [...new Set(audit.map(entry => entry.user_id).filter(Boolean))];
  }, [audit]);

  const budget = 100000;
  const totalTokens = usage?.total_tokens || metrics?.tokens_used_today || 0;
  const budgetPercent = Math.min(100, Math.round((totalTokens / budget) * 100));

  if (loading) {
    return (
      <div className="obs-page">
        <header className="obs-page__header">
          <div>
            <p className="obs-page__eyebrow">Observability</p>
            <h1>System telemetry and audit</h1>
          </div>
        </header>
        <div className="obs-loading">Loading observability data...</div>
      </div>
    );
  }

  return (
    <div className="obs-page">
      <header className="obs-page__header">
        <div>
          <p className="obs-page__eyebrow">Observability</p>
          <h1>System telemetry and audit</h1>
        </div>
      </header>
      {error && <div className="obs-error">⚠️ {error}</div>}

      <section className="obs-page__grid">
        <article className="obs-card">
          <div className="obs-card__head">
            <span>Live Metrics</span>
            <strong>{metrics?.chat_requests_total || 0} requests</strong>
          </div>
          <div className="obs-card__chart">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={donutData} dataKey="value" innerRadius={58} outerRadius={90} paddingAngle={3}>
                  {donutData.map((entry, index) => (
                    <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="obs-card__stats">
            <div><span className="dot dot--green" /> Ollama: {metrics?.chat_requests_ollama || 0}</div>
            <div><span className="dot dot--red" /> Errors: {metrics?.chat_errors_total || 0}</div>
          </div>
        </article>

        <article className="obs-card">
          <div className="obs-card__head"><span>Latency</span><strong>{metrics?.avg_latency_ms || 0} ms</strong></div>
          <p className="obs-card__copy">Average latency across all recorded chat requests.</p>
        </article>

        <article className="obs-card">
          <div className="obs-card__head"><span>HITL Flags</span><strong>{metrics?.hitl_flags_total || 0}</strong></div>
          <p className="obs-card__copy">Responses flagged for human review today.</p>
        </article>

        <article className="obs-card">
          <div className="obs-card__head"><span>Token Usage</span><strong>{totalTokens}</strong></div>
          <div className="obs-progress">
            <div className={`obs-progress__fill ${budgetPercent >= 80 ? 'obs-progress__fill--warn' : ''}`} style={{ width: `${budgetPercent}%` }} />
          </div>
          <p className="obs-card__copy">{budgetPercent}% of daily budget used.</p>
        </article>
      </section>

      <section className="obs-panel">
        <div className="obs-panel__head">
          <h2>Audit Log Viewer</h2>
          <div className="obs-filters">
            <select value={filters.mode} onChange={event => setFilters(current => ({ ...current, mode: event.target.value }))}>
              <option value="all">All modes</option>
              <option value="ollama">Ollama</option>
              <option value="error">Error</option>
            </select>
            <select value={filters.user} onChange={event => setFilters(current => ({ ...current, user: event.target.value }))}>
              <option value="all">All users</option>
              {uniqueUsers.map(user => (
                <option key={user} value={user}>{user}</option>
              ))}
            </select>
            <input type="date" value={filters.date} onChange={event => setFilters(current => ({ ...current, date: event.target.value }))} />
          </div>
        </div>

        <div className="obs-table-wrap">
          <table className="obs-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Cluster</th>
                <th>Mode</th>
                <th>Latency</th>
                <th>HITL</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {filteredAudit.map(entry => (
                <React.Fragment key={entry.request_id}>
                  <tr onClick={() => setExpandedRow(current => (current === entry.request_id ? null : entry.request_id))}>
                    <td>{String(entry.timestamp || '').replace('T', ' ').slice(0, 19)}</td>
                    <td>{entry.user_id}</td>
                    <td>{entry.cluster_id}</td>
                    <td>{entry.mode}</td>
                    <td>{entry.timing_ms}</td>
                    <td>{entry.hitl_flagged ? 'Yes' : 'No'}</td>
                    <td>{entry.error ? 'Error' : 'OK'}</td>
                  </tr>
                  {expandedRow === entry.request_id ? (
                    <tr className="obs-table__expanded">
                      <td colSpan="7">
                        <pre>{JSON.stringify(entry, null, 2)}</pre>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="obs-panel">
        <div className="obs-panel__head">
          <h2>Risk Register</h2>
          <span>{risks.length} tracked risks</span>
        </div>
        <div className="obs-table-wrap">
          <table className="obs-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Category</th>
                <th>Likelihood</th>
                <th>Impact</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {risks.map(risk => (
                <tr key={risk.id}>
                  <td>{risk.id}</td>
                  <td>{risk.category}</td>
                  <td><span className={`badge badge--${risk.likelihood}`}>{risk.likelihood}</span></td>
                  <td><span className={`badge badge--${risk.impact}`}>{risk.impact}</span></td>
                  <td>{risk.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <style>{`
        .obs-page {
          max-width: var(--content-max-width);
          margin: 0 auto;
          min-height: calc(100vh - var(--nav-height) - var(--footer-height));
          padding: 1.5rem;
          color: var(--on-surface);
        }
        .obs-page__header h1, .obs-panel__head h2 { font-family: var(--font-mono); }
        .obs-page__eyebrow { text-transform: uppercase; letter-spacing: 0.1em; color: var(--secondary); font-size: 0.75rem; font-weight: 800; }
        .obs-loading { text-align: center; padding: 3rem; color: var(--secondary); font-family: var(--font-mono); }
        .obs-error {
          background: var(--error-container);
          border-left: 3px solid var(--error);
          padding: 1rem;
          margin-bottom: 1rem;
          color: var(--on-error-container);
          border-radius: var(--radius-md);
        }
        .obs-page__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; margin: 1.25rem 0; }
        .obs-card, .obs-panel {
          background: white;
          border: 1px solid var(--outline-variant);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-sm);
        }
        .obs-card { padding: 1rem; }
        .obs-card__head, .obs-panel__head { display: flex; justify-content: space-between; gap: 1rem; align-items: center; margin-bottom: 0.75rem; }
        .obs-card__head strong, .obs-panel__head span { color: var(--on-surface-variant); }
        .obs-card__copy { color: var(--on-surface-variant); font-size: 0.9rem; line-height: 1.5; }
        .obs-card__stats { display: flex; justify-content: space-between; color: var(--on-surface-variant); font-size: 0.85rem; }
        .dot { width: 9px; height: 9px; border-radius: 999px; display: inline-block; margin-right: 0.35rem; }
        .dot--green { background: #16a34a; }
        .dot--red { background: var(--error); }
        .obs-progress { height: 10px; background: var(--surface-container-low); border: 1px solid var(--outline-variant); border-radius: 999px; overflow: hidden; }
        .obs-progress__fill { height: 100%; background: #16a34a; }
        .obs-progress__fill--warn { background: var(--error); }
        .obs-panel { padding: 1rem; margin-bottom: 1rem; }
        .obs-filters { display: flex; gap: 0.6rem; }
        .obs-filters select, .obs-filters input {
          background: white;
          color: var(--on-surface);
          border: 1px solid var(--outline-variant);
          padding: 0.55rem 0.7rem;
          border-radius: var(--radius-md);
        }
        .obs-table-wrap { overflow: auto; }
        .obs-table { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: 0.82rem; }
        .obs-table th, .obs-table td { text-align: left; padding: 0.75rem; border-bottom: 1px solid var(--surface-container); }
        .obs-table th { color: var(--on-surface-variant); }
        .obs-table tbody tr { cursor: pointer; transition: background 0.15s ease; }
        .obs-table tbody tr:hover { background: var(--surface-container-lowest); }
        .obs-table__expanded td { background: var(--surface-container-low); cursor: default; }
        .obs-table__expanded pre { margin: 0; white-space: pre-wrap; color: var(--primary); }
        .badge { display: inline-block; padding: 0.15rem 0.45rem; border-radius: 999px; text-transform: uppercase; font-size: 0.72rem; font-weight: 700; }
        .badge--high { background: var(--error-container); color: var(--on-error-container); }
        .badge--medium { background: rgba(245, 158, 11, 0.16); color: #b45309; }
        .badge--low { background: rgba(34, 197, 94, 0.16); color: #166534; }
        @media (max-width: 1080px) {
          .obs-page__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 720px) {
          .obs-page { padding: 1rem; }
          .obs-page__grid { grid-template-columns: 1fr; }
          .obs-panel__head, .obs-filters { flex-direction: column; align-items: flex-start; }
          .obs-filters { width: 100%; }
          .obs-filters select, .obs-filters input { width: 100%; }
        }
      `}</style>
    </div>
  );
}
