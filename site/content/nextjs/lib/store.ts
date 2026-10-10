// An in-memory store, so the example stays short. A real game keeps these in
// its database: they must survive restarts, and nonces and processed
// envelopes must be shared by every server that answers the inbox.
import { createHash } from 'node:crypto';
import { config, ulid, type Passport, type Reply } from './sgip.ts';

export type Player = { handle: string; name: string; color: string; sub: string; discoverable: boolean; home?: string; visit?: Visit };
export type Visit = { id: string; home: string; arrivedAt: number };
export type Message = { id: string; from: string; fromName: string; to: string; text: string; at: number };

type Store = {
    players: Map<string, Player>;
    messages: Message[];
    nonces: Map<string, number>;
    processed: Map<string, Reply>;
};

const g = globalThis as unknown as { sgipStore?: Store };

export const store: Store = (g.sgipStore ??= {
    // One local player to message and look up.
    players: new Map([['ada', { handle: 'ada', name: 'Ada', color: '#3d7ea6', sub: ulid(), discoverable: true }]]),
    messages: [],
    nonces: new Map(),
    processed: new Map(),
});

export const addressOf = (player: Player) => player.home ?? `${player.handle}@${config.platformId}`;

/** True the first time a nonce is seen in the last 600 seconds [6]. */
export function freshNonce(nonce: string, now = Math.floor(Date.now() / 1000)): boolean {
    for (const [seen, at] of store.nonces) {
        if (now - at > 600) {
            store.nonces.delete(seen);
        }
    }

    if (store.nonces.has(nonce)) {
        return false;
    }

    store.nonces.set(nonce, now);

    return true;
}

/** A visitor from another game, keyed on sub@home so they keep the same guest identity [7.2]. */
export function admitGuest(passport: Passport): Player {
    const handle = 'g_' + createHash('sha256').update(`${passport.sub}@${passport.home}`).digest('hex').slice(0, 16);
    const current = store.players.get(handle)?.visit;
    const visit = current?.id === passport.visit_id ? current : { id: passport.visit_id, home: passport.home, arrivedAt: Date.now() };
    const guest: Player = { handle, name: passport.display.name, color: passport.display.color ?? '#888888', sub: passport.sub, discoverable: false, home: passport.player, visit };
    store.players.set(handle, guest);

    return guest;
}
