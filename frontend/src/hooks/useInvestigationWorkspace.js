import { useEffect, useState } from 'react';
import { apiFetch } from '../config';
import { supabase } from '../lib/supabaseClient';
import { fetchResolutionRecord, fetchTodos } from '../services/copilotService';

export function useInvestigationWorkspace(clusterId, logger) {
  const [data, setData] = useState(null);
  const [resolution, setResolution] = useState(null);
  const [todos, setTodos] = useState([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    async function loadWorkspace() {
      setIsLoading(true);
      setError('');
      try {
        const [clusterRes, resolutionPayload, todoPayload] = await Promise.all([
          logger?.trackFetch('cluster response', () => apiFetch(`/api/clusters/${clusterId}`), { cluster_id: clusterId }) ??
            apiFetch(`/api/clusters/${clusterId}`),
          logger?.trackFetch('resolution workspace', () => fetchResolutionRecord(clusterId), { cluster_id: clusterId }) ??
            fetchResolutionRecord(clusterId),
          logger?.trackFetch('todos', () => fetchTodos(clusterId), { cluster_id: clusterId }) ?? fetchTodos(clusterId),
        ]);

        if (!clusterRes.ok) {
          let details = `Failed to load cluster (${clusterRes.status})`;
          try {
            const payload = await clusterRes.json();
            details = payload?.detail || payload?.message || details;
          } catch {}
          throw new Error(details);
        }

        const clusterPayload = await clusterRes.json();
        logger?.info('Applied fetched page data', {
          cluster_id: clusterPayload?.cluster?.cluster_id || clusterId,
          ticket_count: Array.isArray(clusterPayload?.tickets) ? clusterPayload.tickets.length : 0,
          todo_count: Array.isArray(todoPayload) ? todoPayload.length : 0,
          has_resolution: Boolean(resolutionPayload),
        });
        if (!isCancelled) {
          setData(clusterPayload);
          setResolution(resolutionPayload);
          setTodos(Array.isArray(todoPayload) ? todoPayload : []);
        }
      } catch (err) {
        logger?.error('Page data load failed', {
          cluster_id: clusterId,
          message: err instanceof Error ? err.message : String(err),
        });
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load investigation');
          setData(null);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    if (clusterId) {
      void loadWorkspace();
    }
    return () => {
      isCancelled = true;
    };
  }, [clusterId, logger]);

  useEffect(() => {
    if (!clusterId) {
      return undefined;
    }

    const channel = supabase
      .channel(`cluster-live-${clusterId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'complaint_clusters', filter: `cluster_id=eq.${clusterId}` },
        payload => {
          if (!payload.new) {
            return;
          }
          logger?.info('Realtime cluster update received', { cluster_id: clusterId, event: 'UPDATE' });
          setData(previous => {
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
          logger?.info('Realtime ticket event received', { cluster_id: clusterId, event: payload.eventType });
          setData(previous => {
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
          } catch {}
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [clusterId, logger]);

  return { data, setData, resolution, setResolution, todos, setTodos, error, setError, isLoading };
}
