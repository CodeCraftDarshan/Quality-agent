function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function summarizePayload(payload) {
  if (Array.isArray(payload)) {
    return { type: 'array', count: payload.length };
  }
  if (payload && typeof payload === 'object') {
    const summary = { type: 'object', keys: Object.keys(payload).length };
    if (Array.isArray(payload.questions)) {
      summary.questions = payload.questions.length;
    }
    if (Array.isArray(payload.tickets)) {
      summary.tickets = payload.tickets.length;
    }
    if (Array.isArray(payload.citations)) {
      summary.citations = payload.citations.length;
    }
    if (Array.isArray(payload.hypotheses)) {
      summary.hypotheses = payload.hypotheses.length;
    }
    if (Array.isArray(payload.log_items)) {
      summary.log_items = payload.log_items.length;
    }
    if (Array.isArray(payload.cluster)) {
      summary.cluster = payload.cluster.length;
    } else if (payload.cluster && typeof payload.cluster === 'object') {
      summary.cluster_id = payload.cluster.cluster_id || null;
    }
    return summary;
  }
  return { type: typeof payload, value: payload ?? null };
}

export function createPageLogger(pageName) {
  const prefix = `[Page:${pageName}]`;

  return {
    info(message, details) {
      if (details !== undefined) {
        console.info(prefix, message, details);
        return;
      }
      console.info(prefix, message);
    },

    warn(message, details) {
      if (details !== undefined) {
        console.warn(prefix, message, details);
        return;
      }
      console.warn(prefix, message);
    },

    error(message, details) {
      if (details !== undefined) {
        console.error(prefix, message, details);
        return;
      }
      console.error(prefix, message);
    },

    async trackFetch(resourceName, operation, meta = {}) {
      const startedAt = nowMs();
      console.info(prefix, `Fetching ${resourceName}...`, meta);
      try {
        const result = await operation();
        console.info(prefix, `Fetched ${resourceName} successfully`, {
          duration_ms: Math.round(nowMs() - startedAt),
          summary: summarizePayload(result),
          ...meta,
        });
        return result;
      } catch (error) {
        console.error(prefix, `Failed to fetch ${resourceName}`, {
          duration_ms: Math.round(nowMs() - startedAt),
          message: error instanceof Error ? error.message : String(error),
          ...meta,
        });
        throw error;
      }
    },
  };
}
