import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import CsvBatchImporter from '../../components/intake/CsvBatchImporter';
import { useURLParams } from '../../hooks/useURLParams';
import { useClusterCatalog } from '../../hooks/useClusterCatalog';
import { createPageLogger } from '../../utils/pageLogger';
import {
  createCluster,
  createTicket,
  deleteTicket,
  fetchClusterDetail,
  patchCluster,
  updateTicket,
} from '../../services/copilotService';

const pageLogger = createPageLogger('DataIntakePage');

const emptyClusterForm = {
  cluster_id: '',
  title: '',
  sku: '',
  defect_family: '',
  count: 0,
  first_seen: '',
  last_seen: '',
  confidence: '',
  severity: 'Medium',
  ai_summary: '',
};

const emptyTicketForm = {
  ticket_id: '',
  cluster_id: '',
  timestamp: '',
  content: '',
  severity: 'Medium',
  associated_sku: '',
};

function toClusterForm(cluster) {
  return {
    cluster_id: cluster?.cluster_id || '',
    title: cluster?.title || '',
    sku: cluster?.sku || '',
    defect_family: cluster?.defect_family || '',
    count: Number(cluster?.count || 0),
    first_seen: cluster?.first_seen || '',
    last_seen: cluster?.last_seen || '',
    confidence: cluster?.confidence ?? '',
    severity: cluster?.severity || 'Medium',
    ai_summary: cluster?.ai_summary || '',
  };
}

export default function DataIntakePage() {
  const { role } = useAuth();
  const { cluster_id, query, mode } = useURLParams();
  const [, setSearchParams] = useSearchParams();
  const {
    clusters,
    selectedClusterId,
    setSelectedClusterId,
    refreshClusters,
  } = useClusterCatalog({
    initialClusterId: cluster_id || '',
    logger: pageLogger,
    channelKey: 'intake-catalog',
  });
  const [clusterForm, setClusterForm] = useState(() => ({
    ...emptyClusterForm,
    cluster_id: cluster_id || '',
    ai_summary: mode === 'cluster' && query ? query : '',
  }));
  const [ticketForm, setTicketForm] = useState(() => ({
    ...emptyTicketForm,
    cluster_id: cluster_id || '',
    content: mode === 'ticket' && query ? query : '',
  }));
  const [clusterPreview, setClusterPreview] = useState(null);
  const [activeSection, setActiveSection] = useState(mode === 'ticket' ? 'ticket' : 'cluster');
  const [clusterSaving, setClusterSaving] = useState(false);
  const [ticketSaving, setTicketSaving] = useState(false);
  const [clusterMessage, setClusterMessage] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [clusterError, setClusterError] = useState('');
  const [ticketError, setTicketError] = useState('');
  const [recentActivity, setRecentActivity] = useState([]);
  const [editingTicketId, setEditingTicketId] = useState('');
  const canDelete = role === 'admin';

  useEffect(() => {
    setActiveSection(mode === 'ticket' ? 'ticket' : 'cluster');
  }, [mode]);

  useEffect(() => {
    let cancelled = false;

    async function loadClusterPreview(clusterIdValue) {
      try {
        const payload = await pageLogger.trackFetch(
          'cluster preview',
          () => fetchClusterDetail(clusterIdValue),
          { cluster_id: clusterIdValue }
        );
        if (!cancelled) {
          setClusterPreview(payload);
        }
      } catch (err) {
        pageLogger.error('Failed to load cluster preview', {
          cluster_id: clusterIdValue,
          message: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) {
          setClusterPreview(null);
        }
      }
    }

    if (cluster_id) {
      setSelectedClusterId(cluster_id);
      setTicketForm(current => ({ ...current, cluster_id }));
      void loadClusterPreview(cluster_id);
    }

    return () => {
      cancelled = true;
    };
  }, [cluster_id, setSelectedClusterId]);

  useEffect(() => {
    if (!selectedClusterId) {
      setClusterPreview(null);
      return;
    }

    let cancelled = false;
    async function loadPreview() {
      try {
        const payload = await pageLogger.trackFetch(
          'selected cluster preview',
          () => fetchClusterDetail(selectedClusterId),
          { cluster_id: selectedClusterId }
        );
        if (!cancelled) {
          setClusterPreview(payload);
          setClusterForm(current => {
            if (current.cluster_id && current.cluster_id !== selectedClusterId) {
              return current;
            }
            return toClusterForm(payload.cluster);
          });
        }
      } catch (err) {
        pageLogger.error('Failed to load selected cluster preview', {
          cluster_id: selectedClusterId,
          message: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) {
          setClusterPreview(null);
        }
      }
    }

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [selectedClusterId]);

  const clusterOptions = useMemo(
    () => clusters.map(cluster => ({ value: cluster.cluster_id, label: `${cluster.cluster_id} · ${cluster.title}` })),
    [clusters]
  );

  const previewTickets = clusterPreview?.tickets || [];

  const resetTicketForm = () => {
    setEditingTicketId('');
    setTicketForm(current => ({
      ...emptyTicketForm,
      cluster_id: selectedClusterId || current.cluster_id || '',
    }));
  };

  const syncClusterParam = (nextClusterId) => {
    setSelectedClusterId(nextClusterId);
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      if (nextClusterId) {
        next.set('cluster_id', nextClusterId);
      } else {
        next.delete('cluster_id');
      }
      return next;
    });
  };

  const addRecentActivity = (item) => {
    setRecentActivity(current => [item, ...current].slice(0, 6));
  };

  const summarizeImportActivity = (entityLabel, summary) => `${entityLabel}: ${summary.imported} imported, ${summary.skipped} skipped, ${summary.failed} failed`;

  const handleClusterCsvImport = async rows => {
    const summary = {
      imported: 0,
      skipped: 0,
      failed: 0,
      notes: [],
    };
    let lastCreatedClusterId = '';

    for (const row of rows) {
      const payload = {
        cluster_id: String(row.cluster_id || '').trim(),
        title: String(row.title || '').trim(),
        severity: String(row.severity || '').trim(),
        sku: String(row.sku || '').trim(),
        defect_family: String(row.defect_family || '').trim(),
        count: row.count === '' ? 0 : Math.max(0, Number.parseInt(row.count, 10) || 0),
        first_seen: String(row.first_seen || '').trim(),
        last_seen: String(row.last_seen || '').trim(),
        confidence: row.confidence === '' ? null : Number(row.confidence),
        ai_summary: String(row.ai_summary || '').trim(),
      };

      try {
        const saved = await createCluster(payload);
        summary.imported += 1;
        lastCreatedClusterId = saved.cluster_id;
      } catch (error) {
        if (error?.status === 409) {
          summary.skipped += 1;
          summary.notes.push(`${payload.cluster_id}: duplicate skipped`);
        } else {
          summary.failed += 1;
          summary.notes.push(`${payload.cluster_id || 'Unknown cluster'}: ${error instanceof Error ? error.message : 'Failed'}`);
        }
      }
    }

    await refreshClusters();

    if (lastCreatedClusterId) {
      syncClusterParam(lastCreatedClusterId);
      setTicketForm(current => ({ ...current, cluster_id: lastCreatedClusterId }));
      try {
        const preview = await fetchClusterDetail(lastCreatedClusterId);
        setClusterPreview(preview);
      } catch {
        setClusterPreview(null);
      }
    }

    addRecentActivity({
      type: 'cluster-import',
      label: summarizeImportActivity('Cluster CSV', summary),
    });

    return summary;
  };

  const handleTicketCsvImport = async rows => {
    const summary = {
      imported: 0,
      skipped: 0,
      failed: 0,
      notes: [],
    };
    let lastClusterId = '';

    for (const row of rows) {
      const payload = {
        ticket_id: String(row.ticket_id || '').trim(),
        cluster_id: String(row.cluster_id || '').trim(),
        timestamp: String(row.timestamp || '').trim(),
        content: String(row.content || '').trim(),
        severity: String(row.severity || '').trim(),
        associated_sku: String(row.associated_sku || '').trim(),
      };

      try {
        const saved = await createTicket(payload);
        summary.imported += 1;
        lastClusterId = saved.cluster_id;
      } catch (error) {
        if (error?.status === 409) {
          summary.skipped += 1;
          summary.notes.push(`${payload.ticket_id}: duplicate skipped`);
        } else {
          summary.failed += 1;
          summary.notes.push(`${payload.ticket_id || 'Unknown ticket'}: ${error instanceof Error ? error.message : 'Failed'}`);
        }
      }
    }

    if (lastClusterId) {
      syncClusterParam(lastClusterId);
      setTicketForm(current => ({ ...current, cluster_id: lastClusterId }));
      try {
        const preview = await fetchClusterDetail(lastClusterId);
        setClusterPreview(preview);
      } catch {
        setClusterPreview(null);
      }
    }

    addRecentActivity({
      type: 'ticket-import',
      label: summarizeImportActivity('Ticket CSV', summary),
    });

    return summary;
  };

  const handleClusterSubmit = async (event) => {
    event.preventDefault();
    setClusterSaving(true);
    setClusterMessage('');
    setClusterError('');
    try {
      const payload = {
        ...clusterForm,
        count: Number(clusterForm.count || 0),
        confidence: clusterForm.confidence === '' ? null : Number(clusterForm.confidence),
      };
      const exists = clusters.some(cluster => cluster.cluster_id === clusterForm.cluster_id);
      const saved = exists
        ? await patchCluster(clusterForm.cluster_id, payload)
        : await createCluster(payload);

      syncClusterParam(saved.cluster_id);
      setTicketForm(current => ({
        ...current,
        cluster_id: saved.cluster_id,
        associated_sku: current.associated_sku || saved.sku || '',
      }));
      setClusterForm(toClusterForm(saved));
      setClusterMessage(exists ? `Cluster ${saved.cluster_id} updated.` : `Cluster ${saved.cluster_id} created.`);
      addRecentActivity({
        type: exists ? 'cluster-updated' : 'cluster-created',
        label: `${saved.cluster_id} · ${saved.title}`,
      });
      const preview = await fetchClusterDetail(saved.cluster_id);
      setClusterPreview(preview);
    } catch (err) {
      setClusterError(err instanceof Error ? err.message : 'Failed to save cluster');
    } finally {
      setClusterSaving(false);
    }
  };

  const handleTicketSubmit = async (event) => {
    event.preventDefault();
    setTicketSaving(true);
    setTicketMessage('');
    setTicketError('');
    try {
      const payload = {
        ...ticketForm,
        cluster_id: ticketForm.cluster_id || selectedClusterId,
      };
      const saved = editingTicketId
        ? await updateTicket(editingTicketId, {
          cluster_id: payload.cluster_id,
          timestamp: payload.timestamp,
          content: payload.content,
          severity: payload.severity,
          associated_sku: payload.associated_sku,
        })
        : await createTicket(payload);
      syncClusterParam(saved.cluster_id);
      resetTicketForm();
      setTicketForm(current => ({
        ...current,
        cluster_id: saved.cluster_id,
      }));
      setTicketMessage(editingTicketId ? `Ticket ${saved.ticket_id} updated.` : `Ticket ${saved.ticket_id} created for ${saved.cluster_id}.`);
      addRecentActivity({
        type: editingTicketId ? 'ticket-updated' : 'ticket-created',
        label: `${saved.ticket_id} · ${saved.cluster_id}`,
      });
      const preview = await fetchClusterDetail(saved.cluster_id);
      setClusterPreview(preview);
    } catch (err) {
      setTicketError(err instanceof Error ? err.message : 'Failed to create ticket');
    } finally {
      setTicketSaving(false);
    }
  };

  const startEditingTicket = (ticket) => {
    setEditingTicketId(ticket.ticket_id);
    setActiveSection('ticket');
    setTicketMessage('');
    setTicketError('');
    setTicketForm({
      ticket_id: ticket.ticket_id || '',
      cluster_id: ticket.cluster_id || selectedClusterId || '',
      timestamp: ticket.timestamp || '',
      content: ticket.content || '',
      severity: ticket.severity || 'Medium',
      associated_sku: ticket.associated_sku || '',
    });
  };

  const handleDeleteTicket = async (ticketId) => {
    setTicketMessage('');
    setTicketError('');
    try {
      await deleteTicket(ticketId);
      addRecentActivity({
        type: 'ticket-deleted',
        label: `${ticketId} · ${selectedClusterId || clusterPreview?.cluster?.cluster_id || ''}`,
      });
      setTicketMessage(`Ticket ${ticketId} deleted.`);
      if (editingTicketId === ticketId) {
        resetTicketForm();
      }
      if (selectedClusterId) {
        const preview = await fetchClusterDetail(selectedClusterId);
        setClusterPreview(preview);
      }
    } catch (err) {
      setTicketError(err instanceof Error ? err.message : 'Failed to delete ticket');
    }
  };

  return (
    <main style={{ maxWidth: 'var(--content-max-width)', margin: '0 auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <section className="card" style={{ padding: '1.5rem', display: 'flex', justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--secondary)', marginBottom: '0.5rem' }}>
            Production Intake
          </p>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '0.4rem' }}>Live Cluster and Ticket Intake</h1>
          <p style={{ color: 'var(--on-surface-variant)', maxWidth: 760 }}>
            Create or update a cluster issue, then attach live tickets to it from the same workspace. This page writes directly into the production tables used by dashboard, triage, investigation, and copilot.
          </p>
        </div>
        <div style={{ minWidth: 240, display: 'grid', gap: '0.5rem' }}>
          <div style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>Current focus</div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn-outline" onClick={() => setActiveSection('cluster')} style={{ opacity: activeSection === 'cluster' ? 1 : 0.65 }}>Cluster Panel</button>
            <button className="btn-outline" onClick={() => setActiveSection('ticket')} style={{ opacity: activeSection === 'ticket' ? 1 : 0.65 }}>Ticket Panel</button>
          </div>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
        <form className="card" onSubmit={handleClusterSubmit} style={{ padding: '1.5rem', display: 'grid', gap: '0.9rem', borderTop: activeSection === 'cluster' ? '4px solid var(--primary)' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Cluster Issue Panel</h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 12 }}>
              <span style={{ color: 'var(--on-surface-variant)' }}>Load existing</span>
              <select
                value={selectedClusterId}
                onChange={event => {
                  syncClusterParam(event.target.value);
                  setTicketForm(current => ({ ...current, cluster_id: event.target.value }));
                }}
                style={{ padding: '0.45rem 0.55rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)', background: 'white', minWidth: 220 }}
              >
                <option value="">New cluster</option>
                {clusterOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span>Cluster ID</span>
              <input value={clusterForm.cluster_id} onChange={event => setClusterForm(current => ({ ...current, cluster_id: event.target.value }))} placeholder="CL-1001" style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }} />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span>Severity</span>
              <select value={clusterForm.severity} onChange={event => setClusterForm(current => ({ ...current, severity: event.target.value }))} style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }}>
                <option value="Critical">Critical</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: '0.35rem', gridColumn: '1 / -1' }}>
              <span>Title</span>
              <input value={clusterForm.title} onChange={event => setClusterForm(current => ({ ...current, title: event.target.value }))} placeholder="Foreign object complaints - canned beans" style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }} />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span>SKU</span>
              <input value={clusterForm.sku} onChange={event => setClusterForm(current => ({ ...current, sku: event.target.value }))} placeholder="CB-15-ORG" style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }} />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span>Defect Family</span>
              <input value={clusterForm.defect_family} onChange={event => setClusterForm(current => ({ ...current, defect_family: event.target.value }))} placeholder="Foreign Object" style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }} />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span>Complaint Count</span>
              <input type="number" min="0" value={clusterForm.count} onChange={event => setClusterForm(current => ({ ...current, count: event.target.value }))} style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }} />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span>Confidence (0-1)</span>
              <input type="number" min="0" max="1" step="0.01" value={clusterForm.confidence} onChange={event => setClusterForm(current => ({ ...current, confidence: event.target.value }))} style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }} />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span>First Seen</span>
              <input value={clusterForm.first_seen} onChange={event => setClusterForm(current => ({ ...current, first_seen: event.target.value }))} placeholder="2026-04-26 09:15" style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }} />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span>Last Seen</span>
              <input value={clusterForm.last_seen} onChange={event => setClusterForm(current => ({ ...current, last_seen: event.target.value }))} placeholder="2026-04-26 10:25" style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }} />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem', gridColumn: '1 / -1' }}>
              <span>Summary</span>
              <textarea value={clusterForm.ai_summary} onChange={event => setClusterForm(current => ({ ...current, ai_summary: event.target.value }))} rows={4} placeholder="Summarize the issue, affected scope, and why this cluster matters." style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)', resize: 'vertical' }} />
            </label>
          </div>

          {clusterError ? <p style={{ color: 'var(--error)', fontSize: 13 }}>{clusterError}</p> : null}
          {clusterMessage ? <p style={{ color: '#166534', fontSize: 13 }}>{clusterMessage}</p> : null}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button type="submit" className="machined-btn" disabled={clusterSaving} style={{ padding: '0.75rem 1rem' }}>
              {clusterSaving ? 'Saving...' : (clusters.some(cluster => cluster.cluster_id === clusterForm.cluster_id) ? 'Update Cluster' : 'Create Cluster')}
            </button>
            <button type="button" className="btn-outline" onClick={() => { syncClusterParam(''); setClusterForm({ ...emptyClusterForm, ai_summary: query || '' }); }} style={{ padding: '0.75rem 1rem' }}>
              New Blank Cluster
            </button>
          </div>

          <CsvBatchImporter
            title="Cluster CSV Upload"
            description="Import new clusters in bulk instead of entering each record manually."
            requiredHeaders={['cluster_id', 'title', 'severity']}
            optionalHeaders={['sku', 'defect_family', 'count', 'first_seen', 'last_seen', 'confidence', 'ai_summary']}
            sampleCsv="cluster_id,title,severity,sku,defect_family,count,first_seen,last_seen,confidence,ai_summary"
            onImport={handleClusterCsvImport}
          />
        </form>

        <div style={{ display: 'grid', gap: '1.5rem' }}>
          <form className="card" onSubmit={handleTicketSubmit} style={{ padding: '1.5rem', display: 'grid', gap: '0.9rem', borderTop: activeSection === 'ticket' ? '4px solid var(--primary)' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Ticket Intake Panel</h2>
              <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>
                Attach to an existing or newly created cluster
              </span>
            </div>

            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span>Cluster</span>
              <select value={ticketForm.cluster_id || selectedClusterId} onChange={event => { setTicketForm(current => ({ ...current, cluster_id: event.target.value })); syncClusterParam(event.target.value); }} style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }}>
                <option value="">Select cluster</option>
                {clusterOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Ticket ID</span>
                <input value={ticketForm.ticket_id} onChange={event => setTicketForm(current => ({ ...current, ticket_id: event.target.value }))} placeholder="TKT-10025" disabled={Boolean(editingTicketId)} style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Severity</span>
                <select value={ticketForm.severity} onChange={event => setTicketForm(current => ({ ...current, severity: event.target.value }))} style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }}>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Timestamp</span>
                <input value={ticketForm.timestamp} onChange={event => setTicketForm(current => ({ ...current, timestamp: event.target.value }))} placeholder="2026-04-26 10:42" style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Associated SKU</span>
                <input value={ticketForm.associated_sku} onChange={event => setTicketForm(current => ({ ...current, associated_sku: event.target.value }))} placeholder="CB-15-ORG" style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem', gridColumn: '1 / -1' }}>
                <span>Ticket Content / Issue Text</span>
                <textarea value={ticketForm.content} onChange={event => setTicketForm(current => ({ ...current, content: event.target.value }))} rows={5} placeholder="Paste the live complaint, issue detail, or ticket text here." style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)', resize: 'vertical' }} />
              </label>
            </div>

            {ticketError ? <p style={{ color: 'var(--error)', fontSize: 13 }}>{ticketError}</p> : null}
            {ticketMessage ? <p style={{ color: '#166534', fontSize: 13 }}>{ticketMessage}</p> : null}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button type="submit" className="machined-btn" disabled={ticketSaving} style={{ padding: '0.75rem 1rem' }}>
                {ticketSaving ? 'Saving...' : editingTicketId ? 'Update Ticket' : 'Create Ticket'}
              </button>
              <button type="button" className="btn-outline" onClick={resetTicketForm} style={{ padding: '0.75rem 1rem' }}>
                {editingTicketId ? 'Cancel Edit' : 'Clear Ticket Form'}
              </button>
            </div>

            <CsvBatchImporter
              title="Ticket CSV Upload"
              description="Import ticket rows in bulk. Each row must include the destination cluster_id."
              requiredHeaders={['ticket_id', 'cluster_id', 'content', 'severity']}
              optionalHeaders={['timestamp', 'associated_sku']}
              sampleCsv="ticket_id,cluster_id,content,severity,timestamp,associated_sku"
              onImport={handleTicketCsvImport}
            />
          </form>

          <section className="card" style={{ padding: '1.5rem', display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Live Preview</h2>
              <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>
                {selectedClusterId || 'No cluster selected'}
              </span>
            </div>

            {clusterPreview?.cluster ? (
              <>
                <div style={{ padding: '1rem', borderRadius: 'var(--radius-md)', background: 'var(--surface-container-lowest)', border: '1px solid var(--outline-variant)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                    <strong>{clusterPreview.cluster.title}</strong>
                    <span className="mono-id">{clusterPreview.cluster.cluster_id}</span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', lineHeight: 1.5 }}>
                    {clusterPreview.cluster.ai_summary || 'No summary yet.'}
                  </p>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.75rem', fontSize: 12, color: 'var(--on-surface-variant)' }}>
                    <span>Severity: {clusterPreview.cluster.severity}</span>
                    <span>SKU: {clusterPreview.cluster.sku || 'Unassigned'}</span>
                    <span>Defect: {clusterPreview.cluster.defect_family || 'Unspecified'}</span>
                    <span>Count: {clusterPreview.cluster.count ?? 0}</span>
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.6rem' }}>
                    <h3 style={{ fontSize: 13, fontWeight: 700 }}>Recent Tickets in Cluster</h3>
                    <span style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>{previewTickets.length} tickets</span>
                  </div>
                  <div style={{ display: 'grid', gap: '0.6rem' }}>
                    {previewTickets.length > 0 ? previewTickets.slice(0, 4).map(ticket => (
                      <div key={ticket.ticket_id} style={{ padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)', background: 'white' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.3rem' }}>
                          <strong style={{ fontFamily: 'var(--font-mono)' }}>{ticket.ticket_id}</strong>
                          <span style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>{ticket.timestamp}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                          <span className={`severity-badge ${ticket.severity === 'High' ? 'red' : ticket.severity === 'Medium' ? 'amber' : 'green'}`}>{ticket.severity}</span>
                          <span style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>{ticket.associated_sku || 'No SKU'}</span>
                        </div>
                        <p style={{ fontSize: 13, lineHeight: 1.45 }}>{ticket.content}</p>
                        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                          <button type="button" className="btn-outline" onClick={() => startEditingTicket(ticket)} style={{ padding: '0.45rem 0.65rem', fontSize: 11 }}>
                            Edit Ticket
                          </button>
                          {canDelete ? (
                            <button type="button" className="btn-outline" onClick={() => handleDeleteTicket(ticket.ticket_id)} style={{ padding: '0.45rem 0.65rem', fontSize: 11 }}>
                              Delete Ticket
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )) : (
                      <p style={{ fontSize: 13, color: 'var(--on-surface-variant)' }}>No tickets have been attached to this cluster yet.</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p style={{ color: 'var(--on-surface-variant)' }}>Save or load a cluster to preview its current live state.</p>
            )}
          </section>

          <section className="card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '0.75rem' }}>Recent Intake Activity</h2>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              {recentActivity.length > 0 ? recentActivity.map((item, index) => (
                <div key={`${item.type}-${item.label}-${index}`} style={{ padding: '0.8rem', borderRadius: 'var(--radius-md)', background: 'var(--surface-container-lowest)', border: '1px solid var(--outline-variant)' }}>
                  <div style={{ fontSize: 11, color: 'var(--secondary)', textTransform: 'uppercase', fontWeight: 700 }}>{item.type.replace('-', ' ')}</div>
                  <div style={{ fontSize: 13, marginTop: '0.25rem' }}>{item.label}</div>
                </div>
              )) : (
                <p style={{ color: 'var(--on-surface-variant)', fontSize: 13 }}>Created and updated records will appear here during this session.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
