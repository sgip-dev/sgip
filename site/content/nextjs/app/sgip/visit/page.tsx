// GET /sgip/visit: where visitors from other games land [7.2].
import { connection } from 'next/server';
import { Suspense } from 'react';
import { directory } from '@/lib/sgip.ts';
import { Arrival } from './arrival';

export default function VisitPage() {
    return (
        <Suspense fallback={null}>
            <VisitWithOrigins />
        </Suspense>
    );
}

async function VisitWithOrigins() {
    await connection(); // read settings per request, not at build time

    // Only games in the hub's directory may hand over a passport by postMessage.
    const origins = (await directory()).flatMap((platform) => (platform.origin ? [platform.origin] : []));

    return <Arrival origins={origins} />;
}
