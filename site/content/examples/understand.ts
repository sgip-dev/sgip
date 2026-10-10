// Reading a shared word this game doesn't model: follow `broader` until one it does.
type Vocabulary = { terms: { id: string; broader?: string }[] };

export function understand(word: string, known: Set<string>, vocabulary: Vocabulary): string | null {
    const broader = new Map(vocabulary.terms.map((term) => [term.id, term.broader]));

    for (let current: string | undefined = word; current; current = broader.get(current)) {
        if (known.has(current)) {
            return current;
        }
    }

    return null;
}
