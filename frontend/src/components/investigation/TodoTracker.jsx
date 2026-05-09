import React, { useMemo, useState } from 'react';

function groupTodos(todos) {
  return todos.reduce((groups, todo) => {
    const key = String(todo.cluster_id || 'unassigned');
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(todo);
    return groups;
  }, {});
}

export default function TodoTracker({
  todos,
  selectedClusterIds,
  onToggleTodo,
  onAddTodo,
  emptyStateMessage = 'No actions added yet.',
}) {
  const [text, setText] = useState('');
  const [targetClusterId, setTargetClusterId] = useState('all');

  const grouped = useMemo(() => groupTodos(todos), [todos]);

  const submit = async () => {
    const value = String(text || '').trim();
    if (!value) return;
    const targetIds = targetClusterId === 'all' ? selectedClusterIds : [targetClusterId];
    await onAddTodo(value, targetIds);
    setText('');
  };

  return (
    <section className="card" style={{ padding: '1rem 1.1rem', display: 'grid', gap: '0.9rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <strong>Action Tracker</strong>
        <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>{todos.length} actions</span>
      </div>

      <div style={{ display: 'flex', gap: '8px', width: '100%', overflow: 'hidden', flexWrap: 'nowrap', alignItems: 'center' }}>
        <input
          value={text}
          onChange={event => setText(event.target.value)}
          placeholder="Add manual action"
          style={{ flex: 1, minWidth: 0, padding: '0.75rem 0.9rem', borderRadius: '999px', border: '1px solid var(--outline-variant)' }}
        />
        <select value={targetClusterId} onChange={event => setTargetClusterId(event.target.value)} style={{ flexShrink: 0, padding: '0.75rem 0.9rem', borderRadius: '999px', border: '1px solid var(--outline-variant)', background: 'white' }}>
          <option value="all">All selected clusters</option>
          {selectedClusterIds.map(clusterId => (
            <option key={clusterId} value={clusterId}>{clusterId}</option>
          ))}
        </select>
        <button className="machined-btn" onClick={() => void submit()} style={{ flexShrink: 0 }}>Add manual action</button>
      </div>

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {Object.keys(grouped).sort().map(clusterId => (
          <div key={clusterId} style={{ border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius-xl)', padding: '0.9rem', background: 'white' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
              <strong>{clusterId}</strong>
              <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>{grouped[clusterId].length} items</span>
            </div>
            <div style={{ display: 'grid', gap: '0.55rem' }}>
              {grouped[clusterId].map(todo => (
                <label key={todo.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', fontSize: 14 }}>
                  <input type="checkbox" checked={todo.status === 'completed'} onChange={() => onToggleTodo(todo)} style={{ marginTop: '0.2rem' }} />
                  <span style={{ lineHeight: 1.55, textDecoration: todo.status === 'completed' ? 'line-through' : 'none', color: todo.status === 'completed' ? 'var(--on-surface-variant)' : 'var(--on-surface)' }}>{todo.text}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
        {!todos.length ? <div style={{ color: 'var(--on-surface-variant)' }}>{emptyStateMessage}</div> : null}
      </div>
    </section>
  );
}
