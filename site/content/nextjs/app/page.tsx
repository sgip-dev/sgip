// A tiny view of what has arrived: who is here and the messages they've had.
import { cookies } from 'next/headers';
import { Suspense } from 'react';
import { addressOf, store } from '@/lib/store.ts';
import { config } from '@/lib/sgip.ts';
import { leave } from '@/app/sgip/visit/actions.ts';

export default function Home() {
    return (
        <main style={{ fontFamily: 'system-ui', padding: 48, maxWidth: 720 }}>
            <h1>{config.name}</h1>
            <Suspense fallback={<p>Loading…</p>}>
                <WhatArrived />
            </Suspense>
        </main>
    );
}

async function WhatArrived() {
    const me = store.players.get((await cookies()).get('session')?.value ?? '');

    return (
        <>
            <p>{me ? `Welcome, ${me.name}, visiting from ${me.home}.` : `An SGIP platform at ${config.platformId}.`}</p>
            {me?.visit && (
                <form action={leave}>
                    <button type="submit">Leave</button>
                </form>
            )}
            <h2>Players</h2>
            <ul>{[...store.players.values()].map((p) => <li key={p.handle}>{p.name} ({addressOf(p)})</li>)}</ul>
            <h2>Messages</h2>
            <ul>{store.messages.map((m) => <li key={m.id}><b>{m.fromName}</b> to {m.to}: {m.text}</li>)}</ul>
        </>
    );
}
