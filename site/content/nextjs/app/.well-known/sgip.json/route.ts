// GET /.well-known/sgip.json: who this game is, its key, and where to reach it [2].
import { connection } from 'next/server';
import { CAPABILITIES, config } from '@/lib/sgip.ts';

export async function GET() {
    await connection(); // answer from the settings at request time, not a copy made at build

    return Response.json({
        sgip: '0.1',
        platform_id: config.platformId,
        name: config.name,
        icon: config.icon,
        public_key: config.publicKey,
        inbox: `${config.appUrl}/sgip/inbox`,
        visit: `${config.appUrl}/sgip/visit`,
        return: `${config.appUrl}/`,
        capabilities: CAPABILITIES,
        embed: { allowed: true },
    });
}
