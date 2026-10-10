// Checks the contract from the outside, in a second language:
//  1. every schema compiles and every op's examples match it,
//  2. the vocabulary registry is valid and common.json matches it,
//  3. the signing and passport vectors verify (or fail) as the spec says,
//     using only Node's built-in Ed25519,
//  4. the money vectors convert, round and refuse as the spec says.
//
//   cd tools && npm install && npm run check

import { createHash, createPublicKey, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const spec = new URL('../spec/', import.meta.url).pathname;
const json = (path) => JSON.parse(readFileSync(join(spec, path), 'utf8'));
let failures = 0;

function check(ok, label) {
    console.log(`${ok ? '✓' : '✗'} ${label}`);

    if (!ok) {
        failures++;
    }
}

// --- Schemas -------------------------------------------------------------------

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

const schemaFiles = ['common.json', 'envelope.json', 'reply.json', 'descriptor.json', 'hub-descriptor.json', 'passport-claims.json', ...readdirSync(join(spec, 'schemas/ops')).map((f) => `ops/${f}`)];
schemaFiles.forEach((file) => ajv.addSchema(json(`schemas/${file}`)));

for (const file of schemaFiles.filter((f) => f.startsWith('ops/'))) {
    const schema = json(`schemas/${file}`);
    const validate = ajv.getSchema(schema.$id);

    for (const example of schema.examples ?? []) {
        const ok = validate(example);
        check(ok, `${schema.title} example matches its schema${ok ? '' : `: ${ajv.errorsText(validate.errors)}`}`);
    }
}

// --- Vocabulary ------------------------------------------------------------------

const validateDomain = ajv.compile(json('schemas/vocabulary.json'));

for (const file of readdirSync(join(spec, 'vocabulary')).filter((f) => f.endsWith('.json'))) {
    const ok = validateDomain(json(`vocabulary/${file}`));
    check(ok, `vocabulary/${file} matches the registry schema${ok ? '' : `: ${ajv.errorsText(validateDomain.errors)}`}`);
}

try {
    console.log(execFileSync('node', [new URL('vocab.mjs', import.meta.url).pathname, '--check'], { encoding: 'utf8' }).trim());
} catch (error) {
    check(false, `vocabulary: ${String(error.stderr ?? error.message).trim()}`);
}

// --- Signing vectors -------------------------------------------------------------

const ed25519 = (base64) =>
    createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(base64, 'base64').toString('base64url') }, format: 'jwk' });

const keyId = (base64) => createHash('sha256').update(base64).digest('hex').slice(0, 16);

function parseHeader(header) {
    const parts = Object.fromEntries(header.split(',').map((pair) => pair.trim().split(/=(.*)/s).slice(0, 2)));

    return parts.keyId && /^\d+$/.test(parts.ts ?? '') && parts.nonce && parts.sig && (parts.alg ?? 'ed25519') === 'ed25519' ? parts : null;
}

/** What a receiver should conclude: 'ok', 'bad_signature' or 'expired'. */
function receive({ method, path, body, header }, publicKey, now) {
    const parsed = parseHeader(header);

    if (!parsed) {
        return 'bad_signature';
    }

    const canonical = [method.toUpperCase(), path, parsed.ts, parsed.nonce, createHash('sha256').update(body).digest('hex')].join('\n');

    if (!verify(null, Buffer.from(canonical), ed25519(publicKey), Buffer.from(parsed.sig, 'base64'))) {
        return 'bad_signature';
    }

    return Math.abs(now - Number(parsed.ts)) > 300 ? 'expired' : 'ok';
}

const signing = json('vectors/signing.json');

for (const [name, key] of Object.entries(signing.keys)) {
    check(keyId(key.public_key) === key.key_id, `key id for ${name} is sha256(base64 key)[0..16]`);
}

for (const c of signing.valid) {
    const canonical = [c.method.toUpperCase(), c.path, String(c.ts), c.nonce, createHash('sha256').update(c.body).digest('hex')].join('\n');
    check(canonical === c.canonical, `canonical string: ${c.name}`);
    check(receive(c, signing.keys[c.signer].public_key, c.ts) === 'ok', `verifies: ${c.name}`);
}

for (const c of signing.invalid) {
    const result = receive(c, signing.keys[c.verify_with].public_key, c.now ?? 1791480060);
    check(result === c.expect, `rejects (${c.expect}): ${c.name}`);
}

// Small-order keys: the hub must refuse them, because some libraries accept a
// forged signature for the identity key. Whether this Node does depends on the
// crypto library it was built with, so it is reported, not checked.
for (const weak of signing.weak_keys.keys) {
    check(Buffer.from(weak.public_key, 'base64').length === 32, `weak key is 32 bytes: ${weak.name}`);

    if (weak.forged_signature) {
        const accepted = verify(null, Buffer.from(weak.forged_message), ed25519(weak.public_key), Buffer.from(weak.forged_signature, 'base64'));
        console.log(`  this Node ${accepted ? 'accepts' : 'refuses'} the forged signature for ${weak.name}`);
    }
}

// --- Passport vectors ---------------------------------------------------------------

const claimsSchema = ajv.getSchema('https://sgip.dev/schemas/v0.1/passport-claims.json');

function checkPassport(token, hubKey, audience, now) {
    const parts = token.split('.');

    if (parts.length !== 3) {
        return 'invalid';
    }

    const [header, payload, signature] = parts;

    if (!verify(null, Buffer.from(`${header}.${payload}`), ed25519(hubKey), Buffer.from(signature, 'base64url'))) {
        return 'invalid';
    }

    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    if (!claimsSchema(claims) || claims.aud !== audience || claims.exp < now || claims.exp - claims.iat > 900) {
        return 'invalid';
    }

    return 'valid';
}

const passports = json('vectors/passports.json');

for (const c of passports.cases) {
    check(checkPassport(c.token, passports.keys.hub.public_key, c.audience, c.now) === c.expect, `passport ${c.expect}: ${c.name}`);
}

// --- Money vectors ---------------------------------------------------------------------

const money = json('vectors/money.json');
const big = (n) => BigInt(n);
const debitFor = (amount, give, get) => (big(amount) * big(give) + big(get) - 1n) / big(get); // round up
const shownFor = (amount, give, get) => (big(amount) * big(get)) / big(give);                 // round down

for (const c of money.debits) {
    check(debitFor(c.host_amount, c.give.amount, c.get.amount) === big(c.debit), `money debit: ${c.name}`);
}

for (const c of money.shown) {
    check(shownFor(c.home_amount, c.give.amount, c.get.amount) === big(c.shown), `money shown: ${c.name}`);
}

for (const c of money.refunds) {
    let refunded = 0n;
    let credited = 0n;
    const ok = c.refunds.every((r) => {
        refunded += big(r.amount);
        const credit = refunded === big(c.charged) ? big(c.debited) - credited : (big(c.debited) * big(r.amount)) / big(c.charged);
        credited += credit;

        return credit === big(r.credited);
    });
    check(ok, `money refunds: ${c.name}`);
}

/** True when some cycle of conversions multiplies to more than 1, compared exactly. */
function gainsInACircle(accepts) {
    const edges = accepts.map((a) => ({ from: `${a.from}|${a.give.currency}`, to: `${a.host}|${a.get.currency}`, num: big(a.get.amount), den: big(a.give.amount) }));
    const walk = (start, node, num, den, used) => edges.some((e, i) => {
        if (used.has(i) || e.from !== node) {
            return false;
        }

        const [n, d] = [num * e.num, den * e.den];

        return e.to === start ? n > d : walk(start, e.to, n, d, new Set([...used, i]));
    });

    return edges.some((e) => walk(e.from, e.from, 1n, 1n, new Set()));
}

for (const c of money.rate_sets) {
    check((gainsInACircle(c.accepts) ? 'refused' : 'allowed') === c.expect, `money rates ${c.expect}: ${c.name}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
