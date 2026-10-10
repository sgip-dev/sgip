// A Berlin game. It stores venues by its own categories, prices in euros,
// and mood changes on a -10 to +10 scale. These mappers describe them in SGIP's terms.
import type { ActionEntry, Game, PlaceEntry, PlayerCard, Stats, VisitReport } from './contract.ts';
import type { Passport } from './sgip.ts';

type Category = 'bar' | 'snack_bar' | 'late_shop' | 'nightclub' | 'beer_garden';
type Activity = 'drink' | 'eat' | 'table_football' | 'dancing';
type Item = { key: string; name: string; activity: Activity; minutes: number; priceEuros: number; moodChange: number; energyChange: number };
type Venue = { district: string; slug: string; name: string; category: Category; lat: number; lng: number; acceptsVisitors: boolean; items: Item[] };
type Resident = { handle: string; name: string; color: string; sub: string; discoverable: boolean; inbox: string[] };

/** Categories to place kinds (vocabulary: place kinds). */
const PLACE_KIND: Record<Category, string> = {
    bar: 'pub',
    snack_bar: 'fast_food',
    late_shop: 'convenience',
    nightclub: 'club',
    beer_garden: 'x-berlin.beer_garden', // no registered term yet
};

/** Activities to verbs (vocabulary: verbs). */
const VERB: Record<Activity, string> = { drink: 'drink', eat: 'eat', table_football: 'play', dancing: 'dance' };

/** Effects on the shared 0–100 scale. */
function effects(item: Item): Stats {
    return {
        mood: item.moodChange * 5, // -10..10 to -50..50
        energy: item.energyChange,
    };
}

export function toPlace(venue: Venue, platform: string): PlaceEntry {
    return {
        id: `place://${platform}/${venue.district}/${venue.slug}`,
        name: venue.name,
        kind: PLACE_KIND[venue.category],
        lat: venue.lat,
        lng: venue.lng,
        guests_allowed: venue.acceptsVisitors,
    };
}

export function toAction(item: Item): ActionEntry {
    return {
        id: item.key,
        verb: VERB[item.activity],
        label: item.name,
        duration_minutes: item.minutes,
        price: { amount: Math.round(item.priceEuros * 100), currency: 'EUR' },
        pays: null,
        effects: effects(item),
    };
}

/** The report sent home when a visitor leaves: summed effects capped at ±20, and a count per verb. */
export function visitReport(passport: Passport, done: ActionEntry[], stayedSeconds: number): VisitReport {
    const souvenirs: Stats = {};
    const counts = new Map<string, number>();

    for (const action of done) {
        for (const [stat, change] of Object.entries(action.effects) as [keyof Stats, number][]) {
            souvenirs[stat] = Math.max(-20, Math.min(20, (souvenirs[stat] ?? 0) + change));
        }

        counts.set(action.verb, (counts.get(action.verb) ?? 0) + 1);
    }

    return {
        visit_id: passport.visit_id,
        player: passport.player,
        reason: 'left',
        duration_s: stayedSeconds,
        souvenirs,
        activities: [...counts].map(([verb, count]) => ({ verb, count })),
    };
}

export class BerlinGame implements Game {
    platform = 'berlin.example';
    guests = new Map<string, Passport>();

    private venues: Venue[];
    private residents: Resident[];

    constructor(venues: Venue[], residents: Resident[]) {
        this.venues = venues;
        this.residents = residents;
    }

    lookup(address: string): PlayerCard | null {
        const resident = this.resident(address);

        if (!resident?.discoverable) {
            return null;
        }

        return { player: address, sub: resident.sub, display_name: resident.name, avatar: { color: resident.color } };
    }

    deliver(to: string, from: string, text: string): boolean {
        const resident = this.resident(to);
        resident?.inbox.push(`${from}: ${text}`);

        return resident !== undefined;
    }

    places(): PlaceEntry[] {
        return this.venues.map((venue) => toPlace(venue, this.platform));
    }

    actions(place: string): ActionEntry[] | null {
        const venue = this.venues.find((candidate) => toPlace(candidate, this.platform).id === place);

        return venue ? venue.items.map(toAction) : null;
    }

    welcome(passport: Passport): void {
        this.guests.set(`${passport.sub}@${passport.home}`, passport);
    }

    private resident(address: string): Resident | undefined {
        return this.residents.find((resident) => `${resident.handle}@${this.platform}` === address);
    }
}
