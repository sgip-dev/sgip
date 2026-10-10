// A Lagos game. It stores hunger with 100 meaning starving and happiness out of 10.
// When a player comes home, it converts the shared scale back to its own.
import type { Game, PlayerCard, Stats, VisitReport } from './contract.ts';

type Citizen = { handle: string; name: string; color: string; sub: string; discoverable: boolean; energy: number; hungerLevel: number; happiness: number; inbox: string[] };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Souvenirs onto this game's scales, each change capped at ±20 (spec §7.3). Unmodelled stats are ignored. */
export function applySouvenirs(citizen: Citizen, souvenirs: Stats): void {
    const change = (stat: keyof Stats) => clamp(souvenirs[stat] ?? 0, -20, 20);

    citizen.energy = clamp(citizen.energy + change('energy'), 0, 100);
    citizen.hungerLevel = clamp(citizen.hungerLevel - change('hunger'), 0, 100);
    citizen.happiness = clamp(citizen.happiness + Math.round(change('mood') / 10), 0, 10);
}

export class LagosGame implements Game {
    platform = 'lagos.example';

    private citizens: Citizen[];

    constructor(citizens: Citizen[]) {
        this.citizens = citizens;
    }

    lookup(address: string): PlayerCard | null {
        const citizen = this.citizen(address);

        if (!citizen?.discoverable) {
            return null;
        }

        return { player: address, sub: citizen.sub, display_name: citizen.name, avatar: { color: citizen.color } };
    }

    deliver(to: string, from: string, text: string): boolean {
        const citizen = this.citizen(to);
        citizen?.inbox.push(`${from}: ${text}`);

        return citizen !== undefined;
    }

    bringHome({ player, souvenirs = {} }: VisitReport): void {
        const citizen = this.citizen(player);

        if (citizen) {
            applySouvenirs(citizen, souvenirs);
        }
    }

    private citizen(address: string): Citizen | undefined {
        return this.citizens.find((citizen) => `${citizen.handle}@${this.platform}` === address);
    }
}
