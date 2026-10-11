// Checks the vocabulary registry (spec/vocabulary) and writes the wire
// definitions it implies into spec/schemas/common.json.
// Usage: node vocab.mjs            check and write
//        node vocab.mjs --check    check only; exit 1 if common.json is stale
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const spec = join(dirname(fileURLToPath(import.meta.url)), '../spec');
const checkOnly = process.argv.includes('--check');
const problems = [];

/** Domain file → the $defs name in common.json, and whether x- extensions are allowed. */
const WIRE = {
    stats: { def: 'stat', extensible: false },
    verbs: { def: 'verb', extensible: true },
    'place-kinds': { def: 'placeKind', extensible: true },
    'transport-modes': { def: 'transportMode', extensible: true },
    skills: { def: 'skill', extensible: true },
    relationships: { def: 'relationship', extensible: true },
    interactions: { def: 'interaction', extensible: true },
    poses: { def: 'pose', extensible: true },
    'career-fields': { def: 'careerField', extensible: true },
    'event-kinds': { def: 'eventKind', extensible: true },
    'game-kinds': { def: 'gameKind', extensible: true },
    'item-categories': { def: 'itemCategory', extensible: true },
    'body-types': { def: 'bodyType', extensible: true },
    'hair-styles': { def: 'hairStyle', extensible: true },
    headwear: { def: 'headwear', extensible: true },
    'outfit-styles': { def: 'outfitStyle', extensible: true },
    patterns: { def: 'pattern', extensible: true },
};

export const EXTENSION = '^x-[a-z0-9-]+\\.[a-z0-9_-]+$';

export function loadVocabulary() {
    return readdirSync(join(spec, 'vocabulary'))
        .filter((file) => file.endsWith('.json'))
        .sort()
        .map((file) => JSON.parse(readFileSync(join(spec, 'vocabulary', file), 'utf8')));
}

const domains = loadVocabulary();

for (const domain of domains) {
    const ids = new Map(domain.terms.map((term) => [term.id, term]));
    const words = new Map();

    if (domain.terms.length !== ids.size) {
        problems.push(`${domain.domain}: duplicate ids`);
    }

    for (const term of domain.terms) {
        if (!/^[a-z][a-z0-9_]*$/.test(term.id)) {
            problems.push(`${domain.domain}.${term.id}: ids are lower snake_case`);
        }

        if (term.broader && !ids.has(term.broader)) {
            problems.push(`${domain.domain}.${term.id}: broader "${term.broader}" is not a term`);
        }

        // The broader chain must end, or a fallback could loop forever.
        const seen = new Set([term.id]);

        for (let next = term.broader; next; next = ids.get(next)?.broader) {
            if (seen.has(next)) {
                problems.push(`${domain.domain}.${term.id}: broader chain loops`);
                break;
            }

            seen.add(next);
        }

        // An alias must not shadow another term or another term's alias.
        for (const alias of term.aliases ?? []) {
            if (ids.has(alias) && alias !== term.id) {
                problems.push(`${domain.domain}.${term.id}: alias "${alias}" is already a term`);
            }

            if (words.has(alias)) {
                problems.push(`${domain.domain}.${term.id}: alias "${alias}" is also used by ${words.get(alias)}`);
            }

            words.set(alias, term.id);
        }
    }

    if (!WIRE[domain.domain]) {
        problems.push(`${domain.domain}: not mapped to a common.json definition in tools/vocab.mjs`);
    }
}

// Generate the wire definitions.
const commonPath = join(spec, 'schemas/common.json');
const common = JSON.parse(readFileSync(commonPath, 'utf8'));

for (const domain of domains) {
    const wire = WIRE[domain.domain];

    if (!wire) {
        continue;
    }

    // Deprecated terms stay valid on the wire; only new senders should avoid them.
    const ids = domain.terms.map((term) => term.id);
    const description = `Generated from vocabulary/${domain.domain}.json. ${domain.fallback}`;

    common.$defs[wire.def] = wire.extensible
        ? { description, anyOf: [{ enum: ids }, { type: 'string', pattern: EXTENSION }] }
        : { description, enum: ids };
}

const next = JSON.stringify(common, null, 2) + '\n';

if (problems.length) {
    console.error(problems.map((problem) => `✗ ${problem}`).join('\n'));
    process.exit(1);
}

if (checkOnly) {
    if (readFileSync(commonPath, 'utf8') !== next) {
        console.error('✗ common.json is out of date with the vocabulary. Run: node tools/vocab.mjs');
        process.exit(1);
    }

    console.log(`✓ vocabulary: ${domains.length} domains, ${domains.reduce((n, d) => n + d.terms.length, 0)} terms, common.json up to date`);
} else {
    writeFileSync(commonPath, next);
    console.log(`✓ vocabulary: ${domains.length} domains, ${domains.reduce((n, d) => n + d.terms.length, 0)} terms; wrote common.json`);
}
