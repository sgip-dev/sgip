# Examples

These examples follow one exchange from start to finish. Tunde plays a game set in Lagos (`lagos.example`); Lena plays a game set in Berlin (`berlin.example`). Tunde messages Lena, looks her up, checks what a bar near her offers, visits it and returns home.

Each game keeps its own models and its own names for things. SGIP only defines how they are described when they leave the game: words from the [vocabulary](vocabulary.html), stats on a 0–100 scale, and money in minor units. The code is TypeScript without a framework. Its structure is one way to organise a game's side of the protocol, not a requirement; only the messages on the wire are specified.

The helpers it imports from `./sgip.ts` (`envelope`, `callHub`, `checkSignature`, `parseSignature`, `hubKey`, `passportKeyId`, `verifyPassport`) are the ones built in the [Next.js walkthrough](nextjs.html).

## 1. The contract

The types mirror the [schemas](operations.html). `Game` is what each game implements: two required methods and four optional ones: three for operations and `welcome` for visitors arriving.

@include site/content/examples/contract.ts ts

## 2. The inbox

The inbox is written once against `Game`. It verifies the hub's signature, rejects reused nonces, returns the stored reply for a repeated envelope id, and passes each operation to the matching method. A game declares an optional operation by implementing its method.

@include site/content/examples/inbox.ts ts

## 3. The Berlin game

Berlin stores venues by its own categories, prices in euros, and mood changes from -10 to +10. Its mappers translate each of these once: categories to place kinds, activities to verbs, euros to cents, and mood changes to the shared scale. A category without a registered term is sent as an extension (`x-berlin.beer_garden`) until one is [proposed](contribute.html#adding-vocabulary-terms).

@include site/content/examples/berlin.ts ts

## 4. The Lagos game

Lagos stores hunger with 100 meaning starving, and happiness out of 10. It only needs to read stats back when a player returns, so it implements `bringHome` and leaves the other optional methods out.

@include site/content/examples/lagos.ts ts

## 5. Sending a message

Lagos sends `message.send@1` for Tunde. The hub checks the signature and payload, then delivers it to Berlin's inbox, where `answer` calls `berlin.deliver`.

```ts
const reply = await callHub(envelope(
    'message.send@1',
    { platform: 'berlin.example', player: 'lena@berlin.example' },
    { text: 'Hello from Lagos', from_name: 'Tunde' },
    'tunde@lagos.example',
));
```

The envelope on the wire:

```json
{
  "sgip": "0.1",
  "id": "01JA2B3C4D5E6F7G8H9J0K1M2N",
  "op": "message.send@1",
  "from": { "platform": "lagos.example", "player": "tunde@lagos.example" },
  "to": { "platform": "berlin.example", "player": "lena@berlin.example" },
  "reply_to": null,
  "payload": { "text": "Hello from Lagos", "from_name": "Tunde" }
}
```

The result is `{ "delivered": true }`. If Berlin is offline, the hub holds the message for up to 24 hours and the result is `{ "queued": true }` (spec section 5).

## 6. Looking up a player

```ts
const lena = await callHub(envelope('player.lookup@1', { platform: 'berlin.example' }, { player: 'lena@berlin.example' }));
```

`berlin.lookup` returns a card only for residents who chose to be discoverable. Everyone else is answered `not_found`.

```json
{ "player": "lena@berlin.example", "sub": "b7c1e0a4", "display_name": "Lena", "avatar": { "color": "#e76f51" } }
```

## 7. Listing what a place offers

```ts
const offer = await callHub(envelope('action.list@1', { platform: 'berlin.example' }, { place: 'place://berlin.example/kreuzberg/kneipe-am-kanal' }));
```

`berlin.actions` maps the venue's items through `toAction`:

```json
{
  "place": "place://berlin.example/kreuzberg/kneipe-am-kanal",
  "actions": [
    { "id": "beer", "verb": "drink", "label": "Glass of Berliner Pils", "duration_minutes": 40, "price": { "amount": 450, "currency": "EUR" }, "pays": null, "effects": { "mood": 10, "energy": -5 } },
    { "id": "kicker", "verb": "play", "label": "Table football", "duration_minutes": 20, "price": { "amount": 100, "currency": "EUR" }, "pays": null, "effects": { "mood": 5, "energy": -5 } },
    { "id": "dance-night", "verb": "dance", "label": "Dance night", "duration_minutes": 90, "price": { "amount": 800, "currency": "EUR" }, "pays": null, "effects": { "mood": 15, "energy": -15 } }
  ]
}
```

Lagos models fewer verbs than the vocabulary holds. To display a verb it doesn't model, it follows the term's `broader` chain until it reaches one it does:

@include site/content/examples/understand.ts ts

```ts
const verbs = await (await fetch('https://sgip.dev/vocabulary/verbs.json')).json();
const known = new Set(['eat', 'drink', 'party', 'talk', 'trade']);

understand('drink', known, verbs); // 'drink'
understand('dance', known, verbs); // 'party'
understand('play', known, verbs);  // null: show the sender's label as it is
```

## 8. Visiting

Lagos asks the hub for a passport. It opens Berlin's visit page in an iframe and hands the passport over by `postMessage`, or, when Berlin can't be embedded, in a new tab with the passport in the URL fragment. Either way the passport never reaches a server log.

```ts
const visit = await callHub(envelope('visit.request@1', { platform: 'sgip-hub' }, {
    player: 'tunde@lagos.example',
    sub: tunde.sub,
    host: 'berlin.example',
    scopes: ['visit', 'chat', 'act'],
    display: { name: 'Tunde', color: '#2e4a6b' },
}, 'tunde@lagos.example'));

if (visit.ok) {
    const { launch_url, passport, host_origin, embed } = visit.result as { launch_url: string; passport: string; host_origin: string; embed?: { allowed: boolean } };

    if (embed?.allowed === false) {
        open(`${launch_url}#passport=${passport}`);
    } else {
        const frame = document.createElement('iframe');
        frame.src = launch_url;
        frame.onload = () => frame.contentWindow?.postMessage({ type: 'sgip.passport', token: passport }, host_origin);
        document.body.append(frame);
    }
}
```

Berlin's visit page posts the passport to its server, which checks it offline with the hub's public key before admitting the visitor:

```ts
const key = await hubKey(passportKeyId(token)); // the hub's key, looked up and cached [6.1]
const passport = verifyPassport(token, key ?? ''); // throws if the key, signature, audience or expiry is wrong
berlin.welcome(passport);
```

## 9. Returning home

Tunde has a beer and stays for the dance night, then leaves after 130 minutes. Berlin builds the report with `visitReport` and sends it to Lagos.

```ts
const report = visitReport(passport, [beer, danceNight].map(toAction), 130 * 60);
await callHub(envelope('visit.end@1', { platform: passport.home, player: passport.player }, report));
```

```json
{
  "visit_id": "01JA00000000000000000000V1",
  "player": "tunde@lagos.example",
  "reason": "left",
  "duration_s": 7800,
  "souvenirs": { "mood": 20, "energy": -20 },
  "activities": [{ "verb": "drink", "count": 1 }, { "verb": "dance", "count": 1 }]
}
```

Mood summed to 25 and was capped at 20. In Lagos, `answer` calls `lagos.bringHome`, and `applySouvenirs` converts back: energy falls by 20 and happiness rises by 2 on its 0–10 scale.

## 10. Refusals

Every refusal carries a code. `retryable` tells the sender whether to try again later with the same envelope id.

```json
{
  "ok": false,
  "id": "01JA2B3C4D5E6F7G8H9J0K1M2N",
  "error": { "code": "not_found", "message": "No player lena@berlin.example", "retryable": false }
}
```

| Code | Retryable | Meaning |
| --- | --- | --- |
| `invalid_payload` | No | The envelope or payload doesn't match its schema |
| `op_unsupported` | No | The receiver doesn't declare this operation |
| `bad_signature` | No | Missing or wrong signature, or a reused nonce |
| `expired` | No | The signature timestamp is more than 300 seconds off |
| `forbidden` | No | Signed correctly but not allowed, such as sending for another game's player |
| `not_found` | No | No such player, place, visit or platform |
| `rate_limited` | Yes | Too many requests |
| `platform_offline` | Yes | The receiver couldn't be reached |
| `insufficient_funds` | No | The player's home balance doesn't cover a charge |
| `limit_reached` | No | A charge would pass the trip budget, a daily limit or an inflow limit |

The hub validates every request payload against the schemas before routing it. Replies are returned as the receiver wrote them, so check your results against the [operations reference](operations.html), which also covers the operations not used here.
