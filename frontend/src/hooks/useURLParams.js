import { useSearchParams } from 'react-router-dom';

export function useURLParams() {
  const [params] = useSearchParams();
  return {
    cluster_id: params.get('cluster_id') || null,
    query: params.get('query') || null,
    mode: params.get('mode') || null,
    ticket_id: params.get('ticket_id') || null,
    auto_submit: params.get('auto_submit') === 'true',
  };
}
