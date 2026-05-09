import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchClusters } from '../services/copilotService';

export function useClusterCatalog({ initialClusterId = '', logger, channelKey = 'cluster-catalog' } = {}) {
  const [clusters, setClusters] = useState([]);
  const [selectedClusterId, setSelectedClusterId] = useState(initialClusterId);
  const [isLoadingClusters, setIsLoadingClusters] = useState(false);

  const loadClusters = useCallback(async () => {
    setIsLoadingClusters(true);
    try {
      const payload = logger
        ? await logger.trackFetch('cluster catalog', () => fetchClusters())
        : await fetchClusters();
      const nextClusters = Array.isArray(payload) ? payload : [];
      setClusters(nextClusters);
      setSelectedClusterId(current => {
        const normalizedCurrent = String(current || '').trim();
        if (normalizedCurrent && nextClusters.some(cluster => cluster.cluster_id === normalizedCurrent)) {
          return normalizedCurrent;
        }
        return nextClusters[0]?.cluster_id || '';
      });
    } catch (error) {
      logger?.error('Failed to load cluster catalog', {
        message: error instanceof Error ? error.message : String(error),
      });
      setClusters([]);
      setSelectedClusterId('');
    } finally {
      setIsLoadingClusters(false);
    }
  }, [logger]);

  useEffect(() => {
    if (initialClusterId) {
      setSelectedClusterId(initialClusterId);
    }
  }, [initialClusterId]);

  useEffect(() => {
    let cancelled = false;
    const safeLoadClusters = async () => {
      if (cancelled) {
        return;
      }
      await loadClusters();
    };

    void safeLoadClusters();
    const channel = supabase
      .channel(`${channelKey}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaint_clusters' }, () => {
        logger?.info('Realtime cluster catalog refresh triggered');
        void safeLoadClusters();
      })
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [channelKey, loadClusters, logger]);

  return {
    clusters,
    selectedClusterId,
    setSelectedClusterId,
    isLoadingClusters,
    refreshClusters: loadClusters,
  };
}
