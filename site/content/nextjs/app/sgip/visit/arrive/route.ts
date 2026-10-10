// POST /sgip/visit/arrive: check the passport offline, then start a guest session [7.1, 7.2].
import { cookies } from 'next/headers';
import { admitGuest } from '@/lib/store.ts';
import { hubKey, passportKeyId, verifyPassport } from '@/lib/sgip.ts';

export async function POST(request: Request) {
    const { passport } = (await request.json()) as { passport?: string };

    const token = String(passport ?? '');

    try {
        const key = await hubKey(passportKeyId(token));

        if (!key) {
            throw new Error('Not signed by the hub.');
        }

        // Signature, audience and expiry, all checked before any guest record exists.
        const guest = admitGuest(verifyPassport(token, key));
        (await cookies()).set('session', guest.handle, { httpOnly: true, sameSite: 'lax', path: '/' });

        return Response.json({ welcome: guest.name });
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'Not a passport.';

        return Response.json({ message: `Passport refused: ${reason}` }, { status: 403 });
    }
}
