// Prints a fresh Ed25519 key pair as .env lines. Keep SGIP_SECRET_KEY secret.
// Usage: npm run keys
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const raw = (b64url: string) => Buffer.from(b64url, 'base64url').toString('base64');

console.log(`SGIP_PUBLIC_KEY=${raw(publicKey.export({ format: 'jwk' }).x!)}`);
console.log(`SGIP_SECRET_KEY=${raw(privateKey.export({ format: 'jwk' }).d!)}`);
