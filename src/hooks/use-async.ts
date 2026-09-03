import { useCallback, useEffect, useState } from "react";

export type AsyncState<T> = {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

type Settled<T> = { key: string; data?: T; error: string | null };

/**
 * Runs `load` whenever `key` changes, aborting the previous run.
 * Previous data is kept while the next load is in flight.
 */
export function useAsync<T>(key: string, load: (signal: AbortSignal) => Promise<T>): AsyncState<T> {
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState<Settled<T>>({ key: "", error: null });
  const requestKey = `${version}:${key}`;

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => setSettled({ key: requestKey, data, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = err instanceof Error ? err.message : String(err);
        setSettled((prev) => ({ key: requestKey, data: prev.data, error }));
      });
    return () => controller.abort();
    // `load` is intentionally excluded: `requestKey` identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const loading = settled.key !== requestKey;

  return { data: settled.data, error: loading ? null : settled.error, loading, reload };
}
