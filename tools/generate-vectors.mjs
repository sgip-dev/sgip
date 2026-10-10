// Regenerates spec/vectors/signing.json and passports.json from fixed seeds.
// Ed25519 is deterministic, so the output is the same every run and in every language.
//
//   node tools/generate-vectors.mjs
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const PLATFORM_SEED = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const HUB_SEED = 'f0e0d0c0b0a090807060504030201000ffeeddccbbaa99887766554433221100';
const STRANGER_SEED = '5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a';

/** The group order L of Ed25519. */
const L = 2n ** 252n + 27742317777372353535851937790883648493n;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

function keys(seedHex) {
    // An Ed25519 private key is its 32-byte seed, wrapped in PKCS #8.
    const secret = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
    const publicKey = Buffer.from(createPublicKey(secret).export({ format: 'jwk' }).x, 'base64url').toString('base64');

    return { seed_hex: seedHex, public_key: publicKey, key_id: sha256(publicKey).slice(0, 16), secret };
}

const publicPart = ({ secret, ...rest }) => rest;
const signWith = (signer, message) => sign(null, Buffer.from(message), signer.secret);

function canonical(method, path, ts, nonce, body) {
    return [method.toUpperCase(), path, String(ts), nonce, sha256(body)].join('\n');
}

function jws(claims, signer) {
    const header = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: signer.key_id }));
    const payload = b64url(JSON.stringify(claims));

    return `${header}.${payload}.${b64url(signWith(signer, `${header}.${payload}`))}`;
}

function write(name, data) {
    writeFileSync(new URL(`../spec/vectors/${name}`, import.meta.url), `${JSON.stringify(data, null, 4)}\n`);
    console.log(`wrote spec/vectors/${name}`);
}

const platform = keys(PLATFORM_SEED);
const hub = keys(HUB_SEED);
const stranger = keys(STRANGER_SEED);

// --- Request signing -------------------------------------------------------

const cases = [
    { name: 'platform calls the hub', signer: 'platform', method: 'POST', path: '/ops', ts: 1791480000, nonce: '01JA0000000000000000000001',
        body: '{"sgip":"0.1","id":"01JA0000000000000000000010","op":"hub.ping@1","from":{"platform":"berlin.example"},"to":{"platform":"sgip-hub"},"payload":{}}' },
    { name: 'hub delivers to an inbox', signer: 'hub', method: 'POST', path: '/sgip/inbox', ts: 1791480060, nonce: '01JA0000000000000000000002',
        body: '{"sgip":"0.1","id":"01JA0000000000000000000011","op":"message.send@1","from":{"platform":"lagos.example","player":"tunde@lagos.example"},"to":{"platform":"berlin.example","player":"lena@berlin.example"},"payload":{"text":"Greetings from Lagos — how far?"}}' },
    { name: 'empty body', signer: 'platform', method: 'post', path: '/ops', ts: 1791480120, nonce: '01JA0000000000000000000003', body: '' },
];

const signers = { platform, hub };

const valid = cases.map((c) => {
    const signer = signers[c.signer];
    const string = canonical(c.method, c.path, c.ts, c.nonce, c.body);
    const sig = signWith(signer, string).toString('base64');

    return { ...c, body_sha256: sha256(c.body), canonical: string, signature: sig, header: `keyId=${signer.key_id},ts=${c.ts},nonce=${c.nonce},sig=${sig}` };
});

const good = valid[1];
valid.push({ ...good, name: 'header names the algorithm', header: `alg=ed25519,${good.header}` });

// The same signature with S + L: it satisfies the equation, but S is not reduced.
const sigBytes = Buffer.from(good.signature, 'base64');
const s = BigInt(`0x${Buffer.from(sigBytes.subarray(32)).reverse().toString('hex')}`) + L;
const unreduced = Buffer.concat([sigBytes.subarray(0, 32), Buffer.from(s.toString(16).padStart(64, '0'), 'hex').reverse()]);

const invalid = [
    { name: 'body changed after signing', expect: 'bad_signature', method: 'POST', path: good.path, header: good.header, body: good.body.replace('how far?', 'send money'), verify_with: 'hub' },
    { name: 'signed for another path', expect: 'bad_signature', method: 'POST', path: '/sgip/inbox/other', header: good.header, body: good.body, verify_with: 'hub' },
    { name: 'signed by a key the receiver does not trust', expect: 'bad_signature', method: 'POST', path: good.path, body: good.body, verify_with: 'hub',
        header: `keyId=${stranger.key_id},ts=1791480060,nonce=01JA0000000000000000000002,sig=${signWith(stranger, canonical('POST', good.path, 1791480060, '01JA0000000000000000000002', good.body)).toString('base64')}` },
    { name: 'too old (receiver clock 301 s later)', expect: 'expired', method: 'POST', path: good.path, header: good.header, body: good.body, verify_with: 'hub', now: 1791480060 + 301 },
    { name: 'unknown algorithm', expect: 'bad_signature', method: 'POST', path: good.path, header: `alg=rsa-sha256,${good.header}`, body: good.body, verify_with: 'hub' },
    { name: 'S not reduced (S + L)', expect: 'bad_signature', method: 'POST', path: good.path, body: good.body, verify_with: 'hub',
        header: `keyId=${hub.key_id},ts=1791480060,nonce=01JA0000000000000000000002,sig=${unreduced.toString('base64')}` },
    { name: 'header missing sig', expect: 'bad_signature', method: 'POST', path: good.path, header: `keyId=${hub.key_id},ts=1791480060,nonce=01JA0000000000000000000002`, body: good.body, verify_with: 'hub' },
];

const bytes = (first, length, fill = 0) => Buffer.concat([Buffer.from([first]), Buffer.alloc(length - 1, fill)]);

write('signing.json', {
    description: "SGIP-Signature test vectors (spec section 6). Valid cases must verify with the signer's public key at now = ts; invalid ones must fail with `expect`.",
    keys: { platform: publicPart(platform), hub: publicPart(hub), stranger: publicPart(stranger) },
    valid,
    invalid,
    weak_keys: {
        description: 'Small-order public keys. The hub MUST refuse them at hub.hello@1: some Ed25519 libraries accept forged signatures for them. The forged signature below verifies against the identity key in libraries that do not check.',
        keys: [
            { name: 'identity (order 1)', public_key: bytes(0x01, 32).toString('base64'), forged_message: 'any message', forged_signature: bytes(0x01, 64).toString('base64') },
            { name: 'y = 0 (order 4)', public_key: Buffer.alloc(32).toString('base64') },
            { name: 'y = -1 (order 2)', public_key: Buffer.concat([Buffer.from([0xec]), Buffer.alloc(30, 0xff), Buffer.from([0x7f])]).toString('base64') },
        ],
    },
});

// --- Passports ---------------------------------------------------------------

const claims = {
    iss: 'sgip-hub',
    sub: '01JA00000000000000000000SB',
    player: 'tunde@lagos.example',
    home: 'lagos.example',
    aud: 'berlin.example',
    visit_id: '01JA00000000000000000000V1',
    jti: '01JA00000000000000000000T1',
    scopes: ['visit', 'chat', 'act'],
    display: { name: 'Tunde', color: '#2e4a6b', badges: ['heir'] },
    arrival: 'place://berlin.example/mitte/hauptbahnhof',
    iat: 1791480000,
    exp: 1791480900,
};

const validToken = jws(claims, hub);
const [h, , sig] = validToken.split('.');
const widened = b64url(JSON.stringify({ ...claims, scopes: ['visit', 'chat', 'act', 'pay'] }));

write('passports.json', {
    description: 'Passport test vectors (spec section 7.1). Verify with keys.hub.public_key as host `audience` at time `now`.',
    keys: { hub: publicPart(hub), stranger: publicPart(stranger) },
    cases: [
        { name: 'valid', token: validToken, audience: 'berlin.example', now: 1791480300, expect: 'valid', claims },
        { name: 'forged: signed by another key', token: jws(claims, stranger), audience: 'berlin.example', now: 1791480300, expect: 'invalid' },
        { name: 'scopes widened after signing', token: `${h}.${widened}.${sig}`, audience: 'berlin.example', now: 1791480300, expect: 'invalid' },
        { name: 'meant for another game', token: validToken, audience: 'abuja.example', now: 1791480300, expect: 'invalid' },
        { name: 'expired', token: validToken, audience: 'berlin.example', now: 1791480901, expect: 'invalid' },
        { name: 'not a JWS', token: 'hello.world', audience: 'berlin.example', now: 1791480300, expect: 'invalid' },
    ],
});
