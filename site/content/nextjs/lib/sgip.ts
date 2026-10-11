// Everything SGIP needs, using only Node's built-in crypto: keys, request
// signatures, passports, ULIDs and calls to the hub. Spec sections in brackets.
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';

export const config = {
    platformId: process.env.SGIP_PLATFORM_ID ?? 'yourgame.example',
    name: process.env.SGIP_PLATFORM_NAME ?? 'Your Game',
    icon: process.env.SGIP_PLATFORM_ICON ?? '🎮',
    appUrl: (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    publicKey: process.env.SGIP_PUBLIC_KEY ?? '',
    secretKey: process.env.SGIP_SECRET_KEY ?? '',
    hubUrl: (process.env.SGIP_HUB_URL ?? '').replace(/\/$/, ''),
};

/** The ops this game answers at its inbox. The first three are required [9]. */
export const CAPABILITIES = ['hub.ping@1', 'player.lookup@1', 'message.send@1', 'visit.end@1'];

export type Endpoint = { platform: string; player?: string };
export type Envelope = { sgip: string; id: string; op: string; from: Endpoint; to: Endpoint; reply_to?: string | null; payload: Record<string, unknown> };
export type Reply = { ok: true; id: string; result: Record<string, unknown> } | { ok: false; id: string; error: { code: string; message: string; retryable: boolean } };

// --- Keys [6] -------------------------------------------------------------------------

const b64url = (base64: string) => Buffer.from(base64, 'base64').toString('base64url');

/** The first 16 hex characters of the SHA-256 of the public key's base64 text. */
export const keyId = (publicKey: string) => createHash('sha256').update(publicKey).digest('hex').slice(0, 16);

const privateKey = (seed: string, pub: string) => createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: b64url(seed), x: b64url(pub) }, format: 'jwk' });
const publicKey = (pub: string) => createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64url(pub) }, format: 'jwk' });

// --- Request signatures [6] --------------------------------------------------------------

/** Five lines: method, path, timestamp, nonce, SHA-256 of the exact body. */
export function canonical(method: string, path: string, ts: number, nonce: string, body: string): string {
    return [method.toUpperCase(), path, ts, nonce, createHash('sha256').update(body).digest('hex')].join('\n');
}

export function signRequest(method: string, path: string, body: string, ts = Math.floor(Date.now() / 1000), nonce = ulid()): string {
    const sig = sign(null, Buffer.from(canonical(method, path, ts, nonce, body)), privateKey(config.secretKey, config.publicKey)).toString('base64');

    return `keyId=${keyId(config.publicKey)},ts=${ts},nonce=${nonce},sig=${sig}`;
}

export type Signature = { keyId: string; ts: number; nonce: string; sig: string };

export function parseSignature(header: string | null): Signature | null {
    const parts = Object.fromEntries((header ?? '').split(',').map((pair) => pair.trim().split(/=(.*)/).slice(0, 2)));

    // ed25519 is the only algorithm, and the default when alg is absent [6].
    const known = (parts.alg ?? 'ed25519') === 'ed25519';

    return known && parts.keyId && /^\d+$/.test(parts.ts ?? '') && parts.nonce && parts.sig ? { keyId: parts.keyId, ts: Number(parts.ts), nonce: parts.nonce, sig: parts.sig } : null;
}

/** 'ok', or the error code a receiver must answer with. Nonce replay is checked by the caller. */
export function checkSignature(header: string | null, method: string, path: string, body: string, signerKey: string, now = Math.floor(Date.now() / 1000)): 'ok' | 'bad_signature' | 'expired' {
    const signature = parseSignature(header);

    if (!signature || signature.keyId !== keyId(signerKey)) {
        return 'bad_signature';
    }

    const valid = verify(null, Buffer.from(canonical(method, path, signature.ts, signature.nonce, body)), publicKey(signerKey), Buffer.from(signature.sig, 'base64'));

    if (!valid) {
        return 'bad_signature';
    }

    return Math.abs(now - signature.ts) > 300 ? 'expired' : 'ok';
}

// --- The hub's key [6.1] -------------------------------------------------------------------

let published: { publicKey: string; keyId: string; expiresAt: number } | undefined;
let lookedUpAt = 0;

/** The hub's public key, looked up at its well-known file and cached until it expires. A key id we don't know is looked up again, at most once a minute. */
export async function hubKey(id?: string): Promise<string | null> {
    const stale = !published || published.expiresAt <= Date.now();

    if (stale || (id && id !== published?.keyId && Date.now() - lookedUpAt > 60_000)) {
        lookedUpAt = Date.now();
        const data = await fetch(`${config.hubUrl}/.well-known/sgip-hub.json`).then((response) => response.json()).catch(() => null);
        const expiresAt = Date.parse(data?.expires_at);

        // Never trust a key past its expiry, nor one whose id doesn't match it.
        if (typeof data?.public_key === 'string' && keyId(data.public_key) === data.key_id && expiresAt > Date.now()) {
            published = { publicKey: data.public_key, keyId: data.key_id, expiresAt };
        }
    }

    return published && published.expiresAt > Date.now() && (!id || id === published.keyId) ? published.publicKey : null;
}

// --- ULIDs [4] ---------------------------------------------------------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 48 bits of milliseconds, then 80 random bits, in Crockford base32. */
export function ulid(time = Date.now()): string {
    let out = '';

    for (let i = 9, t = time; i >= 0; i--, t = Math.floor(t / 32)) {
        out = CROCKFORD[t % 32] + out;
    }

    for (const byte of randomBytes(16)) {
        out += CROCKFORD[byte % 32];
    }

    return out;
}

export const isUlid = (value: unknown): value is string => typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);

// --- Passports [7.1] ---------------------------------------------------------------------

export type Look = {
    body?: string; skin?: string; hair?: { style?: string; color?: string }; headwear?: { kind: string; color?: string };
    outfit?: { style?: string; pattern?: string; top?: string; bottom?: string };
};

export type Passport = {
    iss: string; sub: string; player: string; home: string; aud: string; visit_id: string; jti: string;
    scopes: string[]; display: { name: string; color?: string; avatar_url?: string; badges?: string[]; pronouns?: string; look?: Look }; arrival?: string; iat: number; exp: number;
};

/** The id of the hub key that signed a passport (its `kid`), to look the key up first. */
export function passportKeyId(token: string): string | undefined {
    try {
        return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')).kid;
    } catch {
        return undefined;
    }
}

/** Checks a passport offline with the hub's key. Throws with the reason if it must be refused. */
export function verifyPassport(token: string, hubPublicKey: string, audience = config.platformId, now = Math.floor(Date.now() / 1000)): Passport {
    const [header, claims, signature] = token.split('.');

    if (!header || !claims || !signature) {
        throw new Error('Not a passport.');
    }

    if (!verify(null, Buffer.from(`${header}.${claims}`), publicKey(hubPublicKey), Buffer.from(signature, 'base64url'))) {
        throw new Error('Not signed by the hub.');
    }

    const passport = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as Passport;

    if (passport.iss !== 'sgip-hub' || passport.aud !== audience) {
        throw new Error('Meant for another game.');
    }

    if (passport.exp < now || passport.exp - passport.iat > 900) {
        throw new Error('Expired.');
    }

    return passport;
}

// --- Talking to the hub [3, 4] -------------------------------------------------------------

export function envelope(op: string, to: Endpoint, payload: Record<string, unknown>, fromPlayer?: string): Envelope {
    return { sgip: '0.1', id: ulid(), op, from: { platform: config.platformId, ...(fromPlayer ? { player: fromPlayer } : {}) }, to, reply_to: null, payload };
}

/** POST one envelope to the hub, signed, and read the reply. */
export async function callHub(message: Envelope): Promise<Reply> {
    const body = JSON.stringify(message);
    const url = new URL('/ops', config.hubUrl);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'SGIP-Signature': signRequest('POST', url.pathname, body) },
            body,
        });

        return (await response.json()) as Reply;
    } catch (error) {
        return { ok: false, id: message.id, error: { code: 'platform_offline', message: String(error), retryable: true } };
    }
}

// --- The hub's directory [7.2, 9] ------------------------------------------------------------

export type Platform = { platform_id: string; name: string; origin: string | null; return_url?: string | null };

let listed: { platforms: Platform[]; at: number } | undefined;

/** The games on the network, from platform.directory@1, kept for five minutes. */
export async function directory(): Promise<Platform[]> {
    if (!listed || Date.now() - listed.at > 300_000) {
        const reply = await callHub(envelope('platform.directory@1', { platform: 'sgip-hub' }, {}));

        if (!reply.ok) {
            return listed?.platforms ?? [];
        }

        listed = { platforms: reply.result.platforms as Platform[], at: Date.now() };
    }

    return listed.platforms;
}
