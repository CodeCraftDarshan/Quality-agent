import { ACTIVE_COPILOT_VERSION, apiFetch } from '../config';
import { supabase } from '../lib/supabaseClient';

async function buildApiError(response, fallbackMessage) {
  let detail = '';
  try {
    const errorPayload = await response.json();
    detail = errorPayload?.detail || errorPayload?.message || '';
  } catch {
    detail = '';
  }

  const message = detail ? `${fallbackMessage} (${response.status}): ${detail}` : `${fallbackMessage} (${response.status})`;
  const error = new Error(message);
  error.status = response.status;
  error.detail = detail;
  return error;
}

export async function fetchClusters() {
  try {
    const res = await apiFetch('/api/clusters');
    if (!res.ok) {
      return [];
    }
    const clusters = await res.json();
    return Array.isArray(clusters) ? clusters : [];
  } catch {
    return [];
  }
}

export async function sendChatMessage(message, clusterId, taskType = 'rca', retries = 2, baseDelayMs = 250) {
  let lastError = null;
  const endpoint = ACTIVE_COPILOT_VERSION === 'v2' ? '/api/v2/chat' : '/api/chat';

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ message, cluster_id: clusterId, task_type: taskType }),
      });

      if (!res.ok) {
        let detail = '';
        try {
          const errorPayload = await res.json();
          if (typeof errorPayload?.message === 'string') {
            detail = errorPayload.message;
          }
          if (typeof errorPayload?.detail === 'string') {
            detail = errorPayload.detail;
          } else if (Array.isArray(errorPayload?.detail)) {
            detail = errorPayload.detail
              .map(item => (typeof item?.msg === 'string' ? item.msg : ''))
              .filter(Boolean)
              .join('; ');
          }
        } catch {
          detail = '';
        }

        throw new Error(
          detail
            ? `Copilot request failed (${res.status}): ${detail}`
            : `Copilot request failed (${res.status})`
        );
      }

      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delayMs = baseDelayMs * (attempt + 1);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error('Chat request failed');
}

export async function sendOllamaChatMessage(message, clusterId, taskType = 'rca', retries = 2, baseDelayMs = 250) {
  let lastError = null;
  const ollamaUrl = import.meta.env.VITE_OLLAMA_URL || 'http://localhost:11434';
  const endpoint = '/api/chat'; // Ollama endpoint

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      // Get Supabase auth token
      let token = '';
      try {
        token = localStorage.getItem('auraqc_auth_token') || '';
      } catch {
        // Ignore storage read failures
      }

      const headers = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const startTime = Date.now();
      const res = await fetch(`${ollamaUrl}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'llama3.2', // Default model, can be configured
          messages: [{ role: 'user', content: message }],
          stream: false
        })
      });

      const latencyMs = Date.now() - startTime;

      if (!res.ok) {
        let detail = '';
        try {
          const errorPayload = await res.json();
          detail = errorPayload?.message || errorPayload?.error || '';
        } catch {
          detail = '';
        }

        throw new Error(
          detail
            ? `Ollama request failed (${res.status}): ${detail}`
            : `Ollama request failed (${res.status})`
        );
      }

      const ollamaResponse = await res.json();
      const responseText = ollamaResponse?.message?.content || '';

      // Log to Supabase
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('llm_logs').insert({
            user_id: user.id,
            prompt: { message, cluster_id: clusterId, task_type: taskType },
            response: responseText,
            model: 'llama3.2',
            latency_ms: latencyMs,
            cluster_id: clusterId
          });
        }
      } catch (logError) {
        console.warn('Failed to log to Supabase:', logError);
        // Don't fail the request if logging fails
      }

      return {
        reply: responseText,
        citations: [], // Ollama doesn't return citations in this format
        clusters: [clusterId] // Return cluster info for compatibility
      };
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delayMs = baseDelayMs * (attempt + 1);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error('Ollama chat request failed');
}

export async function sendMultiClusterChatMessage(message, clusterIds, taskType = 'rca') {
  const res = await apiFetch('/api/chat/multi', {
    method: 'POST',
    body: JSON.stringify({ message, cluster_ids: clusterIds, task_type: taskType }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const errorPayload = await res.json();
      if (typeof errorPayload?.message === 'string') {
        detail = errorPayload.message;
      }
      if (typeof errorPayload?.detail === 'string') {
        detail = errorPayload.detail;
      } else if (Array.isArray(errorPayload?.detail)) {
        detail = errorPayload.detail
          .map(item => (typeof item?.msg === 'string' ? item.msg : ''))
          .filter(Boolean)
          .join('; ');
      }
    } catch {
      detail = '';
    }

    throw new Error(
      detail
        ? `Multi-cluster copilot request failed (${res.status}): ${detail}`
        : `Multi-cluster copilot request failed (${res.status})`
    );
  }

  return res.json();
}

export async function sendOllamaMultiClusterChatMessage(message, clusterIds, taskType = 'rca') {
  const ollamaUrl = import.meta.env.VITE_OLLAMA_URL || 'http://localhost:11434';
  const endpoint = '/api/chat'; // Ollama endpoint

  try {
    // Get Supabase auth token
    let token = '';
    try {
      token = localStorage.getItem('auraqc_auth_token') || '';
    } catch {
      // Ignore storage read failures
    }

    const headers = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const startTime = Date.now();
    const res = await fetch(`${ollamaUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'llama3.2',
        messages: [{ role: 'user', content: message }],
        stream: false
      })
    });

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      let detail = '';
      try {
        const errorPayload = await res.json();
        detail = errorPayload?.message || errorPayload?.error || '';
      } catch {
        detail = '';
      }

      throw new Error(
        detail
          ? `Ollama multi-cluster request failed (${res.status}): ${detail}`
          : `Ollama multi-cluster request failed (${res.status})`
      );
    }

    const ollamaResponse = await res.json();
    const responseText = ollamaResponse?.message?.content || '';

    // Log to Supabase
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('llm_logs').insert({
          user_id: user.id,
          prompt: { message, cluster_ids: clusterIds, task_type: taskType },
          response: responseText,
          model: 'llama3.2',
          latency_ms: latencyMs,
          cluster_id: clusterIds[0] // Use first cluster for single cluster_id field
        });
      }
    } catch (logError) {
      console.warn('Failed to log to Supabase:', logError);
      // Don't fail the request if logging fails
    }

    return {
      reply: responseText,
      citations: [], // Ollama doesn't return citations in this format
      clusters: clusterIds // Return cluster info for compatibility
    };
  } catch (err) {
    throw err;
  }
}

export async function updateClusterStatus(clusterId, payload) {
  const res = await apiFetch(`/api/clusters/${encodeURIComponent(clusterId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Failed to update cluster status (${res.status})`);
  }
  return res.json();
}

export async function bulkResolveClusters(clusterIds, resolutionNotes) {
  const res = await apiFetch('/api/clusters/bulk-resolve', {
    method: 'PATCH',
    body: JSON.stringify({
      cluster_ids: clusterIds,
      resolution_notes: resolutionNotes,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to resolve clusters (${res.status})`);
  }
  return res.json();
}

export async function fetchInvestigationQuestionsForClusters(clusterIds, defectFamilies = []) {
  const res = await apiFetch('/api/investigate/questions', {
    method: 'POST',
    body: JSON.stringify({
      cluster_ids: clusterIds,
      defect_families: defectFamilies,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to load investigation questions (${res.status})`);
  }
  const payload = await res.json();
  return Array.isArray(payload?.questions) ? payload.questions : [];
}

export async function fetchInvestigationQuestions(clusterId, count = 4) {
  const res = await apiFetch(
    `/api/investigation-questions?cluster_id=${encodeURIComponent(clusterId)}&count=${encodeURIComponent(count)}`
  );
  if (!res.ok) {
    throw new Error(`Failed to load investigation questions (${res.status})`);
  }
  const payload = await res.json();
  return Array.isArray(payload?.questions) ? payload.questions : [];
}

export async function fetchClusterDetail(clusterId) {
  const res = await apiFetch(`/api/clusters/${encodeURIComponent(clusterId)}`);
  if (!res.ok) {
    throw new Error(`Failed to load cluster (${res.status})`);
  }
  return res.json();
}

export async function createCluster(payload) {
  const res = await apiFetch('/api/clusters', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await buildApiError(res, 'Failed to create cluster');
  }
  return res.json();
}

export async function patchCluster(clusterId, payload) {
  const res = await apiFetch(`/api/clusters/${encodeURIComponent(clusterId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await buildApiError(res, 'Failed to update cluster');
  }
  return res.json();
}

export async function createTicket(payload) {
  const res = await apiFetch('/api/tickets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await buildApiError(res, 'Failed to create ticket');
  }
  return res.json();
}

export async function updateTicket(ticketId, payload) {
  const res = await apiFetch(`/api/tickets/${encodeURIComponent(ticketId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await buildApiError(res, 'Failed to update ticket');
  }
  return res.json();
}

export async function deleteTicket(ticketId) {
  const res = await apiFetch(`/api/tickets/${encodeURIComponent(ticketId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw await buildApiError(res, 'Failed to delete ticket');
  }
  return res.json();
}

export async function fetchResolutionRecord(clusterId) {
  const res = await apiFetch(`/api/resolution/${encodeURIComponent(clusterId)}`);
  if (!res.ok) {
    throw new Error(`Failed to load resolution workspace (${res.status})`);
  }
  return res.json();
}

export async function updateResolutionRecord(clusterId, patch) {
  const res = await apiFetch(`/api/resolution/${encodeURIComponent(clusterId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`Failed to update resolution workspace (${res.status})`);
  }
  return res.json();
}

export async function healthCheck() {
  try {
    const res = await apiFetch('/api/v2/health');
    if (!res.ok) {
      return false;
    }
    const data = await res.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

export async function fetchTodos(clusterId) {
  const res = await apiFetch(`/api/todos?cluster_id=${encodeURIComponent(clusterId)}`);
  if (!res.ok) {
    throw new Error(`Failed to load TODOs (${res.status})`);
  }
  const payload = await res.json();
  return Array.isArray(payload) ? payload : [];
}

export async function createTodo(clusterId, text) {
  const res = await apiFetch('/api/todos', {
    method: 'POST',
    body: JSON.stringify({ cluster_id: clusterId, text }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create TODO (${res.status})`);
  }
  return res.json();
}

export async function updateTodo(todoId, patch) {
  const res = await apiFetch(`/api/todos/${todoId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`Failed to update TODO (${res.status})`);
  }
  return res.json();
}

export async function deleteTodo(todoId) {
  const res = await apiFetch(`/api/todos/${todoId}`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Failed to delete TODO (${res.status})`);
  }
  return res.json();
}

export const fetchClustersV2 = fetchClusters;
export const fetchInvestigationQuestionsV2 = fetchInvestigationQuestions;
export const fetchClusterDetailV2 = fetchClusterDetail;
export const fetchResolutionRecordV2 = fetchResolutionRecord;
export const sendChatMessageV2 = sendChatMessage;
export const sendChatMessageOllama = sendOllamaChatMessage;
export const sendMultiClusterChatMessageV2 = sendMultiClusterChatMessage;
export const sendMultiClusterChatMessageOllama = sendOllamaMultiClusterChatMessage;
export const healthCheckV2 = healthCheck;
