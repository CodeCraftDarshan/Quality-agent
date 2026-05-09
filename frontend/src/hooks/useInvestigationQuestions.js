import { useEffect, useState } from 'react';
import { fetchInvestigationQuestions } from '../services/copilotService';

export function useInvestigationQuestions({
  selectedClusterId,
  availableClusterIds = [],
  fallbackQuestions = [],
  logger,
  count = 4,
} = {}) {
  const [questions, setQuestions] = useState(fallbackQuestions);
  const [isRefreshingQuestions, setIsRefreshingQuestions] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadQuestions() {
      if (!selectedClusterId) {
        logger?.warn('Skipping investigation question fetch because no cluster is selected yet');
        return;
      }
      if (availableClusterIds.length > 0 && !availableClusterIds.includes(selectedClusterId)) {
        logger?.warn('Skipping investigation question fetch for stale cluster selection', {
          cluster_id: selectedClusterId,
          available_cluster_ids: availableClusterIds,
        });
        return;
      }

      setIsRefreshingQuestions(true);
      try {
        const payload = logger
          ? await logger.trackFetch(
              'investigation questions',
              () => fetchInvestigationQuestions(selectedClusterId, count),
              { cluster_id: selectedClusterId }
            )
          : await fetchInvestigationQuestions(selectedClusterId, count);
        if (!cancelled && Array.isArray(payload) && payload.length > 0) {
          setQuestions(payload);
        } else if (!cancelled) {
          setQuestions(fallbackQuestions);
        }
      } catch (error) {
        logger?.error('Failed to load investigation questions', {
          cluster_id: selectedClusterId,
          message: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled) {
          setQuestions(fallbackQuestions);
        }
      } finally {
        if (!cancelled) {
          setIsRefreshingQuestions(false);
        }
      }
    }

    void loadQuestions();
    return () => {
      cancelled = true;
    };
  }, [availableClusterIds, count, fallbackQuestions, logger, selectedClusterId]);

  return {
    investigationQuestions: questions,
    setInvestigationQuestions: setQuestions,
    isRefreshingQuestions,
  };
}
