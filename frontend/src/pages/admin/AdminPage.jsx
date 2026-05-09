import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminNavBar from '../../components/layout/AdminNavBar';
import { apiFetch } from '../../config';

function parseBypassUsers() {
  const raw = String(import.meta.env.VITE_AUTH_BYPASS_ENTRIES || '').trim();
  return raw
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [email = '', password = '', role = 'registrar'] = entry.split(':').map((value) => value.trim());
      if (!email) return null;
      return {
        email,
        passwordMask: password ? '•'.repeat(Math.min(password.length, 8)) : 'Not set',
        role,
      };
    })
    .filter(Boolean);
}

function HeroSection({ activePanel, healthStatus, auditCount, clusterCount, userCount }) {
  const panelLabels = {
    users: 'Users',
    health: 'System Health',
    audit: 'Audit Log',
    clusters: 'Cluster Governance',
  };

  return (
    <section style={{ position: 'relative', background: 'linear-gradient(135deg, #f8fafc, white)', borderRadius: 'var(--radius-xl)', border: '1px solid #e2e8f0', padding: '2rem', overflow: 'hidden' }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 760 }}>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
            AuraQC Admin
          </h1>
          <p style={{ fontSize: '1.125rem', color: '#64748b' }}>
            Unified administration for access, service health, audit visibility, and cluster governance inside the same AuraQC workspace.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0.75rem', background: healthStatus === 'ok' ? '#dcfce7' : 'var(--error-container)', color: healthStatus === 'ok' ? '#166534' : 'var(--on-error-container)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: healthStatus === 'ok' ? '#22c55e' : 'var(--error)' }} />
            {healthStatus === 'ok' ? 'Admin Systems Live' : 'Admin Attention Needed'}
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Panel: {panelLabels[activePanel]}
          </span>
          <Link
            to="/traceability"
            style={{
              marginTop: '0.4rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.6rem 0.9rem',
              borderRadius: 'var(--radius-md)',
              background: '#0f172a',
              color: 'white',
              fontSize: 12,
              fontWeight: 700,
              textDecoration: 'none',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>hub</span>
            <span>Open Traceability</span>
          </Link>
        </div>
      </div>

      <div style={{ marginTop: '1.5rem', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
        <div style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid #dbe4ee', background: 'white' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Workspace Focus</div>
          <div style={{ fontSize: 14, color: '#1e293b', fontWeight: 600 }}>
            Admin oversight stays inside the same product language as dashboard, intake, and investigation pages.
          </div>
        </div>
        <div style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid #dbe4ee', background: 'white' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Users</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>{userCount}</div>
        </div>
        <div style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid #dbe4ee', background: 'white' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Audit Events</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>{auditCount}</div>
        </div>
        <div style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid #dbe4ee', background: 'white' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Clusters</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>{clusterCount}</div>
        </div>
      </div>
    </section>
  );
}

function KpiRow({ items }) {
  return (
    <div className="kpi-grid">
      {items.map((item) => (
        <div key={item.label} className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">{item.label}</span>
          </div>
          <div className="kpi-value">
            <span className="number" style={item.color ? { color: item.color } : undefined}>{item.value}</span>
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{item.meta}</div>
        </div>
      ))}
    </div>
  );
}

function SectionCard({ icon, iconClass, title, subtitle, action = null, children }) {
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className={`card-icon ${iconClass}`}>
            <span className="material-symbols-outlined">{icon}</span>
          </div>
          <div>
            <h2 style={{ fontWeight: 600, color: '#0f172a' }}>{title}</h2>
            <p style={{ marginTop: '0.2rem', fontSize: 12, color: '#64748b' }}>{subtitle}</p>
          </div>
        </div>
        {action}
      </div>
      <div style={{ padding: '1rem 1.25rem 1.25rem' }}>{children}</div>
    </section>
  );
}

function UserManagementPanel({ users }) {
  return (
    <SectionCard
      icon="group"
      iconClass="indigo"
      title="Users"
      subtitle="Configured admin-mode identities available through AUTH_BYPASS_ENTRIES."
      action={<span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>{users.length} configured</span>}
    >
      <div style={{ display: 'grid', gap: '0.85rem' }}>
        {users.map((user) => (
          <div key={user.email} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) 140px 120px', gap: '1rem', alignItems: 'center', padding: '0.95rem 1rem', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-xl)', background: 'white' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{user.email}</div>
              <div style={{ marginTop: '0.18rem', fontSize: 12, color: '#64748b' }}>
                Password mask: {user.passwordMask}
              </div>
            </div>
            <span style={{ justifySelf: 'start', fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1e40af', background: '#dbeafe', padding: '0.28rem 0.5rem', borderRadius: '999px' }}>
              {user.role}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>Active</span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function SystemHealthPanel({ health, metrics, loading, error, reload }) {
  const dependencies = health?.dependencies || {};
  const kpis = [
    { label: 'API Status', value: health?.status || 'Unknown', meta: 'Backend heartbeat', color: health?.status === 'ok' ? '#166534' : '#b91c1c' },
    { label: 'Database', value: dependencies.database || 'Unknown', meta: 'Primary data layer', color: dependencies.database === 'ok' ? '#166534' : '#b91c1c' },
    { label: 'LLM', value: dependencies.llm || 'Unknown', meta: 'Model connectivity', color: dependencies.llm === 'configured' ? '#1d4ed8' : '#b45309' },
    { label: 'Pinecone', value: dependencies.pinecone || 'Unknown', meta: 'Vector retrieval', color: dependencies.pinecone === 'configured' ? '#1d4ed8' : '#b45309' },
  ];

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <KpiRow items={kpis} />
      <SectionCard
        icon="monitor_heart"
        iconClass="emerald"
        title="System Health"
        subtitle="Live operational signals for backend, data plane, and AI support services."
        action={
          <button className="btn-outline" type="button" style={{ fontSize: 12, padding: '0.5rem 0.9rem' }} onClick={() => { void reload(); }}>
            Refresh
          </button>
        }
      >
        {error ? <p style={{ color: 'var(--error)', marginBottom: '0.85rem', fontSize: 13 }}>{error}</p> : null}
        <div style={{ padding: '1rem', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-xl)', background: '#f8fafc', color: '#334155', fontSize: 13 }}>
          {loading ? 'Refreshing service probes and metric snapshots…' : `Metrics snapshot loaded${metrics ? ' and ready for admin review.' : '.'}`}
        </div>
      </SectionCard>
    </div>
  );
}

function AuditLogPanel({ entries, loading, error, reload }) {
  return (
    <SectionCard
      icon="receipt_long"
      iconClass="cyan"
      title="Audit Log"
      subtitle="Recent execution records and trace events visible to admin only."
      action={
        <button className="btn-outline" type="button" style={{ fontSize: 12, padding: '0.5rem 0.9rem' }} onClick={() => { void reload(); }}>
          Refresh
        </button>
      }
    >
      {error ? <p style={{ color: 'var(--error)', marginBottom: '0.85rem', fontSize: 13 }}>{error}</p> : null}
      {loading ? (
        <p style={{ color: '#475569', fontSize: 13 }}>Loading audit activity…</p>
      ) : (
        <div style={{ display: 'grid', gap: '0.85rem' }}>
          {entries.length ? entries.map((entry, index) => (
            <article key={`${entry.request_id || entry.id || 'audit'}-${index}`} style={{ border: '1px solid #e2e8f0', borderRadius: 'var(--radius-xl)', padding: '0.95rem 1rem', background: 'white' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                <strong style={{ color: '#0f172a', fontSize: 14 }}>{entry.endpoint || entry.path || 'Unknown endpoint'}</strong>
                <span className="font-mono" style={{ fontSize: 11, color: '#64748b' }}>{entry.status || 'logged'}</span>
              </div>
              <div style={{ fontSize: 13, color: '#475569', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <span>User: {entry.user_id || entry.email || 'unknown'}</span>
                <span>Cluster: {entry.cluster_id || 'n/a'}</span>
                <span>Request: {entry.request_id || entry.id || 'n/a'}</span>
              </div>
            </article>
          )) : (
            <div style={{ padding: '1rem', borderRadius: 'var(--radius-xl)', background: '#f8fafc', border: '1px dashed #cbd5e1', color: '#64748b' }}>
              No audit entries available.
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function ClusterGovernancePanel({ clusters, loading, error, reload }) {
  const counts = useMemo(() => {
    const totals = { open: 0, under_investigation: 0, resolved: 0 };
    clusters.forEach((cluster) => {
      const key = String(cluster.status || 'open').toLowerCase();
      if (key in totals) totals[key] += 1;
    });
    return totals;
  }, [clusters]);

  const kpis = [
    { label: 'Open', value: counts.open, meta: 'Awaiting action', color: '#b45309' },
    { label: 'Investigating', value: counts.under_investigation, meta: 'Active handling', color: '#1d4ed8' },
    { label: 'Resolved', value: counts.resolved, meta: 'Closed clusters', color: '#166534' },
    { label: 'Visible', value: clusters.length, meta: 'Governed records', color: '#0f172a' },
  ];

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <KpiRow items={kpis} />
      <SectionCard
        icon="hub"
        iconClass="purple"
        title="Cluster Governance"
        subtitle="Status distribution and ownership visibility for cluster oversight."
        action={
          <button className="btn-outline" type="button" style={{ fontSize: 12, padding: '0.5rem 0.9rem' }} onClick={() => { void reload(); }}>
            Refresh
          </button>
        }
      >
        {error ? <p style={{ color: 'var(--error)', marginBottom: '0.85rem', fontSize: 13 }}>{error}</p> : null}
        {loading ? (
          <p style={{ color: '#475569', fontSize: 13 }}>Loading cluster governance view…</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {clusters.slice(0, 12).map((cluster) => (
              <div key={cluster.cluster_id} style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1.8fr) 170px 150px', gap: '1rem', alignItems: 'center', padding: '0.95rem 1rem', borderRadius: 'var(--radius-xl)', border: '1px solid #e2e8f0', background: 'white' }}>
                <strong style={{ color: '#0f172a' }}>{cluster.cluster_id}</strong>
                <div>
                  <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 14 }}>{cluster.title}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: '0.18rem' }}>{cluster.defect_family || 'Unclassified'}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{cluster.status || 'open'}</span>
                <span style={{ fontSize: 12, color: '#64748b' }}>{cluster.updated_by || 'Unassigned'}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

export default function AdminPage() {
  const [activePanel, setActivePanel] = useState('users');
  const [health, setHealth] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState('');
  const [auditEntries, setAuditEntries] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [clusters, setClusters] = useState([]);
  const [clustersLoading, setClustersLoading] = useState(false);
  const [clustersError, setClustersError] = useState('');
  const bypassUsers = useMemo(() => parseBypassUsers(), []);

  const loadHealth = async () => {
    setHealthLoading(true);
    setHealthError('');
    try {
      const [healthRes, metricsRes] = await Promise.all([
        apiFetch('/api/health'),
        apiFetch('/api/metrics'),
      ]);
      if (!healthRes.ok || !metricsRes.ok) {
        throw new Error('Unable to load system health.');
      }
      const [healthPayload, metricsPayload] = await Promise.all([
        healthRes.json(),
        metricsRes.json(),
      ]);
      setHealth(healthPayload);
      setMetrics(metricsPayload);
    } catch (error) {
      setHealthError(error instanceof Error ? error.message : 'Unable to load system health.');
    } finally {
      setHealthLoading(false);
    }
  };

  const loadAudit = async () => {
    setAuditLoading(true);
    setAuditError('');
    try {
      const response = await apiFetch('/api/audit?limit=25');
      if (!response.ok) {
        throw new Error('Unable to load audit log.');
      }
      const payload = await response.json();
      setAuditEntries(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : 'Unable to load audit log.');
    } finally {
      setAuditLoading(false);
    }
  };

  const loadClusters = async () => {
    setClustersLoading(true);
    setClustersError('');
    try {
      const response = await apiFetch('/api/clusters');
      if (!response.ok) {
        throw new Error('Unable to load clusters.');
      }
      const payload = await response.json();
      setClusters(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setClustersError(error instanceof Error ? error.message : 'Unable to load clusters.');
    } finally {
      setClustersLoading(false);
    }
  };

  useEffect(() => {
    void loadHealth();
    void loadAudit();
    void loadClusters();
  }, []);

  return (
    <main style={{ minHeight: '100vh', background: 'var(--surface)' }}>
      <AdminNavBar activePanel={activePanel} setActivePanel={setActivePanel} />
      <div style={{ maxWidth: 'var(--content-max-width)', margin: '0 auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <HeroSection
          activePanel={activePanel}
          healthStatus={health?.status || 'syncing'}
          auditCount={auditEntries.length}
          clusterCount={clusters.length}
          userCount={bypassUsers.length}
        />

        {activePanel === 'users' && <UserManagementPanel users={bypassUsers} />}
        {activePanel === 'health' && (
          <SystemHealthPanel
            health={health}
            metrics={metrics}
            loading={healthLoading}
            error={healthError}
            reload={loadHealth}
          />
        )}
        {activePanel === 'audit' && (
          <AuditLogPanel
            entries={auditEntries}
            loading={auditLoading}
            error={auditError}
            reload={loadAudit}
          />
        )}
        {activePanel === 'clusters' && (
          <ClusterGovernancePanel
            clusters={clusters}
            loading={clustersLoading}
            error={clustersError}
            reload={loadClusters}
          />
        )}
      </div>
    </main>
  );
}
