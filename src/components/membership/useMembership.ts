import { useCallback, useEffect, useRef, useState } from 'react';
import { useAction } from 'convex/react';
import { ConvexError } from 'convex/values';
import type { FunctionReturnType } from 'convex/server';
import { api } from '../../../convex/_generated/api';

export function memberError(error: unknown, fallback = '暂时无法完成操作，请稍后重试。') {
  if (error instanceof ConvexError && typeof error.data === 'object' && error.data !== null &&
    'message' in error.data && typeof error.data.message === 'string') return error.data.message;
  return fallback;
}

export function useMembership() {
  const read = useAction(api.membership.getMyMembership);
  const [membership, setMembership] = useState<FunctionReturnType<typeof api.membership.getMyMembership> | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setPending(true);
    setError('');
    try {
      const next = await read({});
      if (request === generation.current) setMembership(next);
    } catch (error) {
      if (request === generation.current) {
        setMembership(null);
        setError(memberError(error, '会员状态暂时无法读取，请稍后重试。'));
      }
    } finally {
      if (request === generation.current) setPending(false);
    }
  }, [read]);
  useEffect(() => {
    void refresh();
    return () => { generation.current++; };
  }, [refresh]);
  return { membership, pending, error, refresh };
}
