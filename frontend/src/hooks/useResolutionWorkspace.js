import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchClusterDetail, fetchResolutionRecord, fetchTodos } from '../services/copilotService';

export function useResolutionWorkspace(clusterId, logger) {
  const [clusterData, setClusterData] = useState(null);
  const [resolution, setResolution] = useState(null);
  const [todos, setTodos] = useState([]);
  const [draft, setDraft] = useState('');
  const [draftDirty, setDraftDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspace() {
      setLoading(true);
      setError('');
      try {
        const [clusterPayload, resolutionPayload, todoPayload] = await Promise.all([
          logger?.trackFetch('cluster detail', () => fetchClusterDetail(clusterId), { cluster_id: clusterId }) ??
            fetchClusterDetail(clusterId),
          logger?.trackFetch('resolution workspace', () => fetchResolutionRecord(clusterId), { cluster_id: clusterId }) ??
            fetchResolutionRecord(clusterId),
          logger?.trackFetch('todos', () => fetchTodos(clusterId), { cluster_id: clusterId }) ?? fetchTodos(clusterId),
        ]);

        if (cancelled) {
          return;
        }
        logger?.info('Applied fetched page data', {
          cluster_id: clusterPayload?.cluster?.cluster_id || clusterId,
          ticket_count: Array.isArray(clusterPayload?.tickets) ? clusterPayload.tickets.length : 0,
          todo_count: Array.isArray(todoPayload) ? todoPayload.length : 0,
          has_resolution: Boolean(resolutionPayload),
        });
        setClusterData(clusterPayload);
        setResolution(resolutionPayload);
        setTodos(Array.isArray(todoPayload) ? todoPayload : []);
        setDraft(resolutionPayload?.draft_text || '');
        setDraftDirty(false);
      } catch (err) {
        logger?.error('Failed to load resolution workspace', {
          cluster_id: clusterId,
          message: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load resolution workspace');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    if (clusterId) {
      void loadWorkspace();
    }
    return () => {
      cancelled = true;
    };
  }, [clusterId, logger]);

  useEffect(() => {
    if (!clusterId) {
      return undefined;
    }

    const channel = supabase
      .channel(`resolution-live-${clusterId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'complaint_clusters', filter: `cluster_id=eq.${clusterId}` },
        payload => {
          if (!payload.new) {
            return;
          }
          logger?.info('Realtime resolution cluster update received', { cluster_id: clusterId, event: 'UPDATE' });
          setClusterData(previous => {
            if (!previous?.cluster) {
              return previous;
            }
            return { ...previous, cluster: { ...previous.cluster, ...payload.new } };
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'investigation_tickets', filter: `cluster_id=eq.${clusterId}` },
        payload => {
          logger?.info('Realtime resolution ticket event received', { cluster_id: clusterId, event: payload.eventType });
          setClusterData(previous => {
            if (!previous?.tickets) {
              return previous;
            }
            const nextTickets = [...previous.tickets];
            if (payload.eventType === 'INSERT' && payload.new?.ticket_id && !nextTickets.some(ticket => ticket.ticket_id === payload.new.ticket_id)) {
              nextTickets.unshift(payload.new);
            }
            if (payload.eventType === 'UPDATE' && payload.new?.ticket_id) {
              const index = nextTickets.findIndex(ticket => ticket.ticket_id === payload.new.ticket_id);
              if (index >= 0) nextTickets[index] = { ...nextTickets[index], ...payload.new };
            }
            if (payload.eventType === 'DELETE' && payload.old?.ticket_id) {
              const index = nextTickets.findIndex(ticket => ticket.ticket_id === payload.old.ticket_id);
              if (index >= 0) nextTickets.splice(index, 1);
            }
            return { ...previous, tickets: nextTickets };
          });
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_items', filter: `cluster_id=eq.${clusterId}` }, async () => {
        try {
          const refreshedTodos = await fetchTodos(clusterId);
          setTodos(Array.isArray(refreshedTodos) ? refreshedTodos : []);
        } catch {}
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'resolution_records', filter: `cluster_id=eq.${clusterId}` },
        async () => {
          try {
            const refreshedResolution = await fetchResolutionRecord(clusterId);
            setResolution(refreshedResolution);
            setDraft(currentDraft => currentDraft || refreshedResolution?.draft_text || '');
          } catch {}
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [clusterId, logger]);

  return {
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
  };
}
