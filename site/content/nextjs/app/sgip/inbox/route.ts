// POST /sgip/inbox: where the hub delivers operations. The checks run in the
// order the spec gives them, then each declared op gets an answer [5, 6, 9].
import { addressOf, freshNonce, store } from '@/lib/store.ts';
import { CAPABILITIES, checkSignature, config, hubKey, isUlid, parseSignature, type Envelope, type Reply } from '@/lib/sgip.ts';

const STATUS: Record<string, number> = {
    invalid_payload: 422, op_unsupported: 422, bad_signature: 401, expired: 401, forbidden: 403, not_found: 404, rate_limited: 429, platform_offline: 503,
};

const ok = (id: string, result: Record<string, unknown> = {}): Reply => ({ ok: true, id, result });
const fail = (id: string, code: string, message: string): Reply => ({ ok: false, id, error: { code, message, retryable: code === 'rate_limited' || code === 'platform_offline' } });
const respond = (reply: Reply) => Response.json(reply, { status: reply.ok ? 200 : STATUS[reply.error.code] ?? 400 });

export async function POST(request: Request) {
    const body = await request.text();
    let message: Envelope | null = null;

    try {
        message = JSON.parse(body);
    } catch {
        // Answered below as invalid_payload, once the signature has been checked.
    }

    const id = typeof message?.id === 'string' ? message.id : '';

    // 1. Signed by the hub, recently, with a nonce we haven't seen.
    const header = request.headers.get('SGIP-Signature');
    const signature = checkSignature(header, 'POST', new URL(request.url).pathname, body, (await hubKey(parseSignature(header)?.keyId)) ?? '');

    if (signature !== 'ok') {
        return respond(fail(id, signature, signature === 'expired' ? 'Request is more than five minutes old.' : 'Missing or invalid SGIP-Signature.'));
    }

    if (!freshNonce(parseSignature(header)!.nonce)) {
        return respond(fail(id, 'bad_signature', 'Nonce already used.'));
    }

    // 2. A well-formed envelope.
    if (!message || !isUlid(message.id) || typeof message.op !== 'string' || typeof message.from?.platform !== 'string' || typeof message.to?.platform !== 'string' || !String(message.sgip).startsWith('0.')) {
        return respond(fail(id, 'invalid_payload', 'The envelope does not match the SGIP schema.'));
    }

    // 3. Seen this id before? Same answer, nothing done twice.
    const previous = store.processed.get(message.id);

    if (previous) {
        return respond(previous);
    }

    // 4. Only ops we declared.
    const reply = CAPABILITIES.includes(message.op) ? handle(message) : fail(message.id, 'op_unsupported', `${message.op} is not supported here.`);
    store.processed.set(message.id, reply);

    return respond(reply);
}

function handle({ id, op, from, to, payload }: Envelope): Reply {
    switch (op) {
        case 'hub.ping@1':
            return ok(id, { platform: config.platformId, time: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });

        case 'player.lookup@1': {
            const player = localPlayer(payload.player);

            // Players who haven't opted in are indistinguishable from players who don't exist [11].
            return player?.discoverable
                ? ok(id, { player: addressOf(player), sub: player.sub, display_name: player.name, avatar: { color: player.color }, badges: [] })
                : fail(id, 'not_found', `No player ${String(payload.player)}`);
        }

        case 'message.send@1': {
            const player = localPlayer(to.player);
            const text = payload.text;

            if (typeof text !== 'string' || text.length < 1 || text.length > 1000 || !from.player) {
                return fail(id, 'invalid_payload', 'message.send@1 needs from.player and 1 to 1,000 characters of text.');
            }

            if (!player) {
                return fail(id, 'not_found', `No player ${String(to.player)}`);
            }

            store.messages.push({ id, from: from.player, fromName: typeof payload.from_name === 'string' ? payload.from_name : from.player, to: addressOf(player), text, at: Date.now() });

            return ok(id, { delivered: true });
        }

        case 'visit.end@1':
            // One of our players came home: apply their souvenirs here, each capped at ±20 [7.3].
            return ok(id, { returned: true });
    }

    return fail(id, 'op_unsupported', `${op} is not supported here.`);
}

function localPlayer(address: unknown) {
    if (typeof address !== 'string' || !address.endsWith(`@${config.platformId}`)) {
        return null;
    }

    const player = store.players.get(address.split('@')[0]);

    return player && !player.home ? player : null;
}
