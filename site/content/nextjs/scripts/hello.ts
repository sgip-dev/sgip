// Registers this game with the hub (hub.hello@1). Run it with the app up, so
// the hub can fetch the descriptor [9]. Usage: npm run hello
import { CAPABILITIES, callHub, config, envelope } from '../lib/sgip.ts';

const reply = await callHub(envelope('hub.hello@1', { platform: 'sgip-hub' }, {
    name: config.name,
    icon: config.icon,
    inbox: `${config.appUrl}/sgip/inbox`,
    visit: `${config.appUrl}/sgip/visit`,
    public_key: config.publicKey,
    capabilities: CAPABILITIES,
}));

console.log(JSON.stringify(reply, null, 2));
process.exit(reply.ok ? 0 : 1);
