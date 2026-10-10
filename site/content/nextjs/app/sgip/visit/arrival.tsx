'use client';

// The passport arrives in the URL fragment (new tab) or by postMessage (iframe),
// never in the query string, so it never reaches a server log [7.2].
import { useEffect, useRef, useState } from 'react';

export function Arrival({ origins }: { origins: string[] }) {
    const [status, setStatus] = useState('Checking your passport…');
    const sent = useRef(false);

    useEffect(() => {
        async function arrive(passport: string) {
            if (sent.current) {
                return;
            }

            sent.current = true;
            const response = await fetch('/sgip/visit/arrive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passport }) });

            if (response.ok) {
                window.location.replace('/');
            } else {
                setStatus(((await response.json()) as { message: string }).message);
            }
        }

        const fromFragment = new URLSearchParams(window.location.hash.slice(1)).get('passport');

        if (fromFragment) {
            history.replaceState(null, '', window.location.pathname); // take it out of the address bar
            void arrive(fromFragment);

            return;
        }

        const onMessage = (event: MessageEvent) => {
            if (origins.includes(event.origin) && event.data?.type === 'sgip.passport') {
                void arrive(String(event.data.token));
            }
        };

        window.addEventListener('message', onMessage);

        return () => window.removeEventListener('message', onMessage);
    }, [origins]);

    return <main style={{ fontFamily: 'system-ui', padding: 48 }}>{status}</main>;
}
