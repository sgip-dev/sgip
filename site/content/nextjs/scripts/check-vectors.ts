// Checks lib/sgip.ts against the spec's own test vectors [6, 7.1].
// Usage: npm run vectors. Set SGIP_VECTORS to a folder or URL to use another copy.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, checkSignature, keyId, parseSignature, verifyPassport } from '../lib/sgip.ts';

const source = process.env.SGIP_VECTORS ?? 'https://sgip.dev/files/vectors/';
const load = async (name: string) =>
    source.startsWith('http') ? (await fetch(new URL(name, source))).json() : JSON.parse(readFileSync(join(source, name), 'utf8'));
const signing = await load('signing.json');
const passports = await load('passports.json');
let failures = 0;
const check = (pass: boolean, label: string) => {
    console.log(`${pass ? '✓' : '✗'} ${label}`);
    failures += pass ? 0 : 1;
};

for (const key of Object.values<{ public_key: string; key_id: string }>(signing.keys)) {
    check(keyId(key.public_key) === key.key_id, `key id ${key.key_id}`);
}

for (const c of signing.valid) {
    const signature = parseSignature(c.header)!;
    check(canonical(c.method, c.path, signature.ts, signature.nonce, c.body) === c.canonical, `canonical: ${c.name}`);
    check(checkSignature(c.header, c.method, c.path, c.body, signing.keys[c.signer].public_key, c.ts) === 'ok', `verifies: ${c.name}`);
}

for (const c of signing.invalid) {
    check(checkSignature(c.header, c.method, c.path, c.body, signing.keys[c.verify_with].public_key, c.now ?? 1791480060) === c.expect, `rejects (${c.expect}): ${c.name}`);
}

for (const c of passports.cases) {
    let outcome = 'valid';

    try {
        verifyPassport(c.token, passports.keys.hub.public_key, c.audience, c.now);
    } catch {
        outcome = 'invalid';
    }

    check(outcome === c.expect, `passport ${c.expect}: ${c.name}`);
}

console.log(failures ? `\n${failures} failed` : '\nAll vectors pass');
process.exit(failures ? 1 : 0);
