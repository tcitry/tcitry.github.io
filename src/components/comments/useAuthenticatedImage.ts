import {useEffect, useRef, useState} from 'react';
import {useAuth} from '@clerk/react';
import {commentImageEndpoint, commentImageLimit, commentImageTypes} from './comment-image-upload';

export default function useAuthenticatedImage(url: string) {
  const {getToken, userId, sessionId} = useAuth();
  const tokenGetter = useRef(getToken);
  tokenGetter.current = getToken;
  const key = `${userId ?? ''}:${sessionId ?? ''}:${url}`;
  const [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState<{key: string; source?: string; failed?: boolean}>({key});
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setImage({key});
    void (async () => {
      try {
        const expected = commentImageEndpoint('/comment-images/file');
        const endpoint = new URL(url);
        // Never forward a session token to an arbitrary URL returned as metadata.
        if (endpoint.origin !== expected.origin || endpoint.pathname !== expected.pathname || endpoint.username || endpoint.password || endpoint.hash) throw new Error('Invalid image endpoint');
        const token = await tokenGetter.current();
        if (!token || controller.signal.aborted) throw new Error('Image authentication unavailable');
        const response = await fetch(endpoint, {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]), cache: 'no-store', redirect: 'error', credentials: 'omit'});
        if (!response.ok) throw new Error('Image unavailable');
        const blob = await response.blob();
        if (!commentImageTypes.includes(blob.type) || blob.size > commentImageLimit || blob.size === 0) throw new Error('Invalid image');
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({key, source: objectUrl});
      } catch {if (!controller.signal.aborted) setImage({key, failed: true});}
    })();
    return () => {controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl);};
  }, [url, key, attempt]);
  return {...(image.key === key ? image : {}), retry: () => setAttempt(value => value + 1)};
}
