// The inbox, written once against the Game interface.
import { checkSignature, hubKey, parseSignature, type Reply } from './sgip.ts';
import type { Envelope, Game, VisitReport } from './contract.ts';

/** The required ops, plus one for each optional method the game implements. */
export function capabilities(game: Game): string[] {
    return [
        'hub.ping@1', 'player.lookup@1', 'message.send@1',
        ...(game.places ? ['world.places@1'] : []),
        ...(game.actions ? ['action.list@1'] : []),
        ...(game.bringHome ? ['visit.end@1'] : []),
    ];
}

/** Answers one operation from the game. */
export function answer(game: Game, { id, op, from, to, payload }: Envelope): Reply {
    const ok = (result: Record<string, unknown>): Reply => ({ ok: true, id, result });
    const no = (code: string, message: string): Reply => ({ ok: false, id, error: { code, message, retryable: false } });

    if (!capabilities(game).includes(op)) {
        return no('op_unsupported', `${op} is not supported here.`);
    }

    switch (op) {
        case 'hub.ping@1':
            return ok({ platform: game.platform, time: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });

        case 'player.lookup@1': {
            const card = game.lookup(String(payload.player));
            return card ? ok(card) : no('not_found', `No player ${payload.player}`);
        }

        case 'message.send@1':
            return game.deliver(String(to.player), String(from.player), String(payload.text))
                ? ok({ delivered: true })
                : no('not_found', `No player ${to.player}`);

        case 'world.places@1':
            return ok({ places: game.places!() });

        case 'action.list@1': {
            const actions = game.actions!(String(payload.place));
            return actions ? ok({ place: payload.place, actions }) : no('not_found', `No place ${payload.place}`);
        }

        case 'visit.end@1':
            game.bringHome!(payload as VisitReport);
            return ok({ returned: true });
    }

    return no('op_unsupported', `${op} is not supported here.`);
}

const STATUS: Record<string, number> = { bad_signature: 401, expired: 401, not_found: 404, op_unsupported: 422, invalid_payload: 422 };
const nonces = new Set<string>(); // in production: a database table, kept 10 minutes
const replies = new Map<string, Reply>(); // in production: a database table, kept 24 hours

/** POST /sgip/inbox. Verifies the request, then answers it. */
export async function inbox(game: Game, request: Request): Promise<Response> {
    const body = await request.text();
    const header = request.headers.get('SGIP-Signature');
    const check = checkSignature(header, 'POST', new URL(request.url).pathname, body, (await hubKey(parseSignature(header)?.keyId)) ?? '');
    const nonce = parseSignature(header)?.nonce ?? '';

    if (check !== 'ok' || nonces.has(nonce)) {
        return Response.json({ ok: false, id: '', error: { code: check === 'ok' ? 'bad_signature' : check, message: 'Not signed by the hub.', retryable: false } }, { status: 401 });
    }

    nonces.add(nonce);
    const message: Envelope = JSON.parse(body);
    const reply = replies.get(message.id) ?? answer(game, message); // a repeated id gets the stored reply
    replies.set(message.id, reply);

    return Response.json(reply, { status: reply.ok ? 200 : STATUS[reply.error.code] ?? 400 });
}
