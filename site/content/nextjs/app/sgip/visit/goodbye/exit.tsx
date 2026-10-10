'use client';

// In an iframe, tells the home game the visit is over so it can close the frame [7.3].
import { useEffect } from 'react';

export function Exit({ origin }: { origin: string | null }) {
    useEffect(() => {
        if (origin && window.parent !== window) {
            window.parent.postMessage({ type: 'sgip.exit' }, origin);
        }
    }, [origin]);

    return null;
}
