'use server';

// Ends a visit: tells the player's home game through the hub, then says goodbye [7.3].
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { callHub, envelope } from '@/lib/sgip.ts';
import { store } from '@/lib/store.ts';

export async function leave() {
    const session = await cookies();
    const guest = store.players.get(session.get('session')?.value ?? '');

    if (!guest?.home || !guest.visit) {
        redirect('/');
    }

    const { visit } = guest;

    await callHub(envelope('visit.end@1', { platform: visit.home, player: guest.home }, {
        visit_id: visit.id,
        player: guest.home,
        reason: 'left',
        duration_s: Math.floor((Date.now() - visit.arrivedAt) / 1000),
    }));

    delete guest.visit;
    session.delete('session');
    redirect(`/sgip/visit/goodbye?home=${encodeURIComponent(visit.home)}`);
}
