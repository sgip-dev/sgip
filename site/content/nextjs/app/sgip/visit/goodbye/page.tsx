// Where a visitor lands after leaving: a link back to their home game [7.3].
import { Suspense } from 'react';
import { directory } from '@/lib/sgip.ts';
import { Exit } from './exit';

type Props = { searchParams: Promise<{ home?: string }> };

export default function Goodbye({ searchParams }: Props) {
    return (
        <main style={{ fontFamily: 'system-ui', padding: 48 }}>
            <h1>Thanks for visiting</h1>
            <Suspense fallback={null}>
                <WayHome searchParams={searchParams} />
            </Suspense>
        </main>
    );
}

async function WayHome({ searchParams }: Props) {
    const { home } = await searchParams;
    // Only games the hub lists, so this page can't be used to send people anywhere else.
    const game = (await directory()).find((platform) => platform.platform_id === home);

    if (!game) {
        return null;
    }

    return (
        <p>
            <Exit origin={game.origin} />
            <a href={game.return_url ?? `https://${game.platform_id}`}>Back to {game.name}</a>
        </p>
    );
}
