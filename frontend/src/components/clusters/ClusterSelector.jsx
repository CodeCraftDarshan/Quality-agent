import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { fetchClusters } from '../../services/copilotService';

export default function ClusterSelector({
  value,
  defaultValue,
  onChange,
  onClustersLoaded,
  setSearchParams,
}) {
  const [clusters, setClusters] = useState([]);
  const [filter, setFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const data = await fetchClusters();
        if (!cancelled) {
          setClusters(data);
          onClustersLoaded?.(data);
          const desired = value || defaultValue;
          if (!value && desired && data.some(cluster => cluster.cluster_id === desired)) {
            onChange(desired);
          } else if (!value && data[0]?.cluster_id) {
            onChange(data[0].cluster_id);
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    const channel = supabase
      .channel(`cluster-selector-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaint_clusters' }, () => {
        void load();
      })
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [defaultValue, onChange, onClustersLoaded, value]);

  const filteredClusters = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) {
      return clusters;
    }
    return clusters.filter(cluster =>
      [cluster.cluster_id, cluster.title, cluster.defect_family, cluster.sku]
        .filter(Boolean)
        .some(field => String(field).toLowerCase().includes(query))
    );
  }, [clusters, filter]);

  const handleSelect = clusterId => {
    onChange(clusterId);
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      if (clusterId) {
        next.set('cluster_id', clusterId);
      } else {
        next.delete('cluster_id');
      }
      return next;
    });
  };

  return (
    <section className="cluster-selector">
      <div className="cluster-selector__head">
        <div>
          <p className="cluster-selector__eyebrow">Cluster Selector</p>
          <h3>Active cluster</h3>
        </div>
        <span>{isLoading ? 'Refreshing' : `${clusters.length} loaded`}</span>
      </div>

      <input
        type="text"
        value={filter}
        onChange={event => setFilter(event.target.value)}
        placeholder="Search clusters"
        className="cluster-selector__search"
      />

      <div className="cluster-selector__list">
        {filteredClusters.length === 0 ? (
          <p className="cluster-selector__empty">No clusters match the current filter.</p>
        ) : (
          filteredClusters.map(cluster => (
            <button
              key={cluster.cluster_id}
              type="button"
              className={`cluster-selector__item ${value === cluster.cluster_id ? 'cluster-selector__item--active' : ''}`}
              onClick={() => handleSelect(cluster.cluster_id)}
            >
              <div className="cluster-selector__topline">
                <span className="cluster-selector__id">{cluster.cluster_id}</span>
                <span className="cluster-selector__count">{cluster.count}</span>
              </div>
              <strong>{cluster.title}</strong>
              <span>{cluster.defect_family || 'Unknown family'}</span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
