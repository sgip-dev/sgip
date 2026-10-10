// Asks the hub to check this game against the contract (hub.check@1). Only
// this game can ask for its own check: the request is signed with its key [9.1].
// Run it with the app up. Usage: npm run check
import { callHub, envelope } from '../lib/sgip.ts';

type Check = { name: string; passed: boolean; required: boolean; detail?: string };

const reply = await callHub(envelope('hub.check@1', { platform: 'sgip-hub' }, {}));

if (!reply.ok) {
    console.error(`${reply.error.code}: ${reply.error.message}`);
    process.exit(1);
}

for (const check of reply.result.checks as Check[]) {
    console.log(`${check.passed ? '✓' : check.required ? '✗' : '!'} ${check.name}${check.detail ? `  ${check.detail}` : ''}`);
}

console.log(reply.result.conforms ? '\nConforms' : '\nDoes not conform yet');
process.exit(reply.result.conforms ? 0 : 1);
