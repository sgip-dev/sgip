// The shapes defined in spec/schemas, and the interface a game implements.
import type { Envelope, Passport } from './sgip.ts';

/** Integers 0–100, 100 best. Omit stats the game does not model. */
export type Stats = Partial<Record<'energy' | 'hunger' | 'mood' | 'social' | 'hygiene' | 'fitness' | 'fun' | 'bladder', number>>;

/** Amount in minor units. */
export type Money = { amount: number; currency: string };

export type PlayerCard = { player: string; sub: string; display_name: string; avatar?: { color: string } };
export type PlaceEntry = { id: string; name: string; kind: string; lat?: number; lng?: number; guests_allowed?: boolean };
export type ActionEntry = { id: string; verb: string; label: string; duration_minutes: number; price: Money; pays: Money | null; effects: Stats };
export type VisitReport = { visit_id: string; player: string; reason: 'left' | 'idle' | 'removed' | 'expired'; duration_s?: number; souvenirs?: Stats; activities?: { verb: string; count: number }[] };

/** Required: lookup and deliver. The inbox declares an optional op only when its method exists. */
export interface Game {
    platform: string;
    lookup(address: string): PlayerCard | null;                // player.lookup@1
    deliver(to: string, from: string, text: string): boolean; // message.send@1
    places?(): PlaceEntry[];                                   // world.places@1
    actions?(place: string): ActionEntry[] | null;             // action.list@1
    welcome?(passport: Passport): void;                        // visitor arrival
    bringHome?(report: VisitReport): void;                     // visit.end@1
}

export type { Envelope, Passport };
