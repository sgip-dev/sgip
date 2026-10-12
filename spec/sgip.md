# SGIP: Simulation Game Interoperability Protocol

Version 0.1. This is the normative contract. The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in all capitals.

SGIP lets independent games recognise each other's players, message across games and send a player to visit another game. It was designed for simulation games, but works for any game whose players want to meet. Everything is HTTPS + JSON with Ed25519 signatures, so a game can be written in any language: if it can serve three HTTP endpoints and sign a request, it can join.

Machine-readable parts of this contract:

- [`openapi.yaml`](openapi.yaml): every HTTP endpoint, on the hub and on a game.
- [`schemas/`](schemas): JSON Schema (2020-12) for the envelope, replies, the descriptor, passports and every operation.
- [`vectors/`](vectors): fixed keys, requests, expected signatures, passports and money conversions to test an implementation against.
- [`vocabulary/`](vocabulary): the registry of shared words (section 8), from which `schemas/common.json` is generated.

## 1. Roles

| Role | What it is | Talks to |
| --- | --- | --- |
| Hub | Registers games, checks signatures, routes operations, queues for offline games, issues passports | Every platform |
| Platform | A game that implements SGIP, named by its domain, e.g. `lagos.example` | Only the hub, plus the visit page in a player's browser |
| Player | A person playing a platform, addressed `handle@platform` | Only their home platform's UI |

Platforms never call each other's APIs. The only direct contact between two games is the visit page, opened in the player's browser.

## 2. What a platform serves

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/sgip.json` | Descriptor (`schemas/descriptor.json`): the platform's id, name, description and icon, its public key (two during a rotation, `public_keys`), inbox, visit page, return page, capabilities, currencies, `money` (section 7.4), who may visit (`visitors`, section 7.5) and whether its visit page may be embedded (`embed`, section 7.2). Proves domain ownership. |
| `POST /sgip/inbox` (any path, declared in the descriptor) | Receives operations from the hub. MUST verify the hub's signature. |
| `GET /sgip/visit` (any path, declared in the descriptor) | Where visiting players land (section 7). A game that takes no visitors leaves `visit` out. |

Every URL in the descriptor (`inbox`, `visit`, `return` and `icon_url`) MUST be HTTPS on the platform's own domain or one of its subdomains; the hub refuses anything else. `icon_url` is a square PNG or SVG of at least 128 px, shown wherever other games list this one; `icon` is a short emoji or text for when there is no image. `description` says what the game is in at most 200 characters; it is plain text, and games MUST show it as text, never as markup. `return` is the page a player comes back to after visiting another game (section 7.3).

The hub fetches the descriptor at exactly `https://<platform_id>/.well-known/sgip.json`, without following redirects, and gives up after 5 seconds.

## 3. What the hub serves

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/sgip-hub.json` | The hub's public key, its key id and expiry, and its ops URL (`schemas/hub-descriptor.json`). |
| `POST /ops` | Every operation from a platform, in one envelope. |

## 4. Envelope

Every operation travels in one JSON envelope (`schemas/envelope.json`), in both directions, sent as UTF-8 with `Content-Type: application/json`.

```json
{
  "sgip": "0.1",
  "id": "01JA2B3C4D5E6F7G8H9J0K1M2N",
  "op": "message.send@1",
  "from": { "platform": "lagos.example", "player": "tunde@lagos.example" },
  "to": { "platform": "berlin.example", "player": "lena@berlin.example" },
  "reply_to": null,
  "payload": { "text": "How far? Greetings from Lagos" }
}
```

| Field | Rule |
| --- | --- |
| `sgip` | Protocol version. Receivers MUST reject an unknown major version with `invalid_payload`. |
| `id` | A ULID made by the sender. It is the idempotency key: a receiver MUST treat a repeat `id` within 24 hours as already done and return the same result. |
| `op` | `namespace.action@version`. The version belongs to the operation, not the protocol. |
| `from`, `to` | `platform` is required. `player` is present when a player acts or is addressed. A platform MUST only send `from.player` for its own players; the hub rejects anything else with `forbidden`. |
| `reply_to` | The `id` this message answers, for asynchronous replies. Optional. |
| `payload` | Defined by the operation's schema. Unknown fields MUST be ignored. |

Envelopes addressed to the hub itself use `"to": { "platform": "sgip-hub" }`.

## 5. Replies and errors

A receiver answers every envelope synchronously in the HTTP response, within 10 seconds. The hub treats a slower answer as no answer: `platform_offline`.

```json
{ "ok": true, "id": "01JA2B…", "result": { } }
{ "ok": false, "id": "01JA2B…", "error": { "code": "not_found", "message": "No player ghost@berlin.example", "retryable": false } }
```

| Code | HTTP status | Retryable | Meaning |
| --- | --- | --- | --- |
| `invalid_payload` | 422 | no | The envelope or payload breaks its schema |
| `op_unsupported` | 422 | no | The receiver does not declare this op |
| `bad_signature` | 401 | no | Missing, malformed or wrong `SGIP-Signature`, or a reused nonce |
| `expired` | 401 | no | Signature timestamp more than 300 seconds from the receiver's clock |
| `forbidden` | 403 | no | Signed correctly but not allowed (another platform's player, blocked) |
| `not_found` | 404 | no | No such player, place, visit or platform |
| `rate_limited` | 429 | yes | Slow down; honour `Retry-After` when present |
| `platform_offline` | 503 | yes | The target could not be reached |
| `insufficient_funds` | 402 | no | The player's home balance does not cover a charge (section 7.4) |
| `limit_reached` | 403 | no | A charge would pass the trip budget, a daily limit or an inflow limit (section 7.4) |

A sender SHOULD retry retryable errors with backoff, reusing the same `id`. The hub holds envelopes for an offline platform for up to 24 hours for the queueable ops listed in section 9. When it holds one, it answers the sender `{ "ok": true, "id": "…", "result": { "queued": true } }` in place of the receiver's result.

## 6. Signing

Every hub ↔ platform request carries one header:

```
SGIP-Signature: keyId=<key id>,ts=<unix seconds>,nonce=<ULID>,sig=<base64>
```

An optional `alg` parameter names the signature algorithm. The only algorithm in 0.1 is `ed25519`, which is also the default when `alg` is absent, so senders MAY leave it out. It exists so that a later version can add an algorithm without changing the header.

The signature is Ed25519 over this exact string, joined with a single `\n` (0x0A), no trailing newline:

```
<HTTP method, uppercase>
<request path, starting with "/", no query string>
<ts, as decimal>
<nonce>
<lowercase hex SHA-256 of the raw request body bytes>
```

- Keys are raw 32-byte Ed25519 public keys, written as standard base64 (with padding) wherever they appear.
- `keyId` is the first 16 lowercase hex characters of SHA-256 over the base64 *text* of the public key.
- `sig` is the 64-byte detached signature, standard base64 with padding.
- The receiver MUST reject: a missing or unparsable header (`bad_signature`); an `alg` other than `ed25519` (`bad_signature`); a signature that fails (`bad_signature`); `|now − ts| > 300` (`expired`); a nonce seen in the last 600 seconds (`bad_signature`). Receivers MUST ignore other header parameters they don't know.
- Verification follows RFC 8032, section 5.1.7. In particular a signature whose `S` is not less than the group order `L` MUST fail; every common Ed25519 library already checks this.
- A public key MUST be a valid point of large order. The hub MUST refuse at `hub.hello@1` a key that is not, because some libraries accept forged signatures for small-order keys. Platforms only verify the hub's key, so they don't need to check this themselves.
- Sign the body bytes exactly as sent. Do not re-encode the JSON between signing and sending.

`vectors/signing.json` has fixed keys, bodies and the expected canonical strings and signatures, a header with `alg`, an unknown algorithm, an unreduced `S`, and the small-order keys the hub must refuse.

During a key rotation a platform MAY list two keys in its descriptor (`public_keys`); the hub accepts either until the old one is removed.

### 6.1 The hub's key

Platforms don't configure the hub's key; they look it up. The hub publishes one key at `/.well-known/sgip-hub.json`:

```json
{ "sgip": "0.1", "public_key": "<base64>", "key_id": "d47f9a1343ec4fd3", "expires_at": "2026-11-10T00:00:00Z", "ops": "https://hub.example/ops" }
```

- A platform MAY cache the key until `expires_at`. After that it MUST fetch the file again, and it MUST NOT accept a signature or a passport from a key whose `expires_at` has passed.
- When a request's `keyId` or a passport's `kid` isn't the cached key's id, the platform fetches the file again, at most once a minute, and refuses if the id still doesn't match. This is how a key the hub replaced early, for example after a leak, stops being trusted.
- The hub keeps `expires_at` in the future while a key is in use: it either moves the time on or switches to a new key when it passes. It MUST NOT issue a passport whose `exp` is after its key's `expires_at`, so no passport outlives its key and a planned change needs nothing from platforms.

## 7. Visits and passports

A visit costs one hub call. The home game asks the hub for a passport, opens the host's visit page, and the host checks the passport offline with the hub's public key.

### 7.1 Passport

A passport is a compact JWS (`header.claims.signature`, base64url without padding) signed by the hub with EdDSA. Header: `{"alg":"EdDSA","typ":"JWT","kid":"<hub key id>"}`. Claims (`schemas/passport-claims.json`):

| Claim | Meaning |
| --- | --- |
| `iss` | `sgip-hub` |
| `sub` | The player's pseudonymous stable id at home, e.g. `01JA…`. Never an internal user id. |
| `player` | `handle@home`, the player's public address |
| `home` | The home platform id |
| `aud` | The one host platform this passport is for |
| `visit_id` | The visit's ULID; the same across refreshes |
| `jti` | A ULID unique to this token |
| `scopes` | What the guest may do: any of `visit`, `chat`, `act`, `phone`, `pay`. A host MAY narrow them, never widen them. `pay` lets the host charge the player's home money (section 7.4). |
| `display` | `{ "name", "avatar_url"?, "color"?, "badges"?, "pronouns"?, "look"? }`, shown to other players. `pronouns` is a [pronoun](vocabulary/pronouns.json) (`she`, `he`, `they`); without it, games use `they`. `look` is how the player looks at home (section 8.4) |
| `arrival` | Optional `place://` address where the player arrives |
| `budget` | Present with `pay`: the most the host may charge on this visit, in a home currency (section 7.4) |
| `iat`, `exp` | Issued and expiry times; `exp − iat` MUST NOT exceed 900 seconds, and `exp` MUST NOT be after the hub key's `expires_at` (section 6.1) |

A host MUST reject a passport whose signature fails, whose `aud` is not itself, or whose `exp` has passed, before creating any guest record. `vectors/passports.json` has valid, forged, expired and misaddressed examples.

The home game refreshes the passport every 10 minutes with `visit.request@1`, passing the same `visit_id`.

### 7.2 Handing the passport over

The passport MUST NOT appear in a URL query string, where it would be logged by servers and proxies.

- **Embedded (preferred):** the home game opens `launch_url` in an iframe, then sends `postMessage({ type: "sgip.passport", token }, host_origin)`. The visit page MUST only accept it from an origin listed in the hub directory.
- **New tab** (when the host's directory entry says `embed.allowed: false`): the home game opens `launch_url#passport=<token>`. The fragment never reaches a server; the visit page's script reads it, removes it from the address bar and posts it to its own server.

The host's server verifies the passport and starts a guest session keyed on `sub@home`, so repeat visitors keep the same guest identity.

### 7.3 Ending a visit

The host sends `visit.end@1` when the guest leaves, idles for 15 minutes or is removed, and posts `{ type: "sgip.exit" }` to its parent frame. Hosts SHOULD include how long the guest stayed and how their stats moved (`souvenirs`). The home game decides what to accept and MUST cap each stat change at ±20 per visit.

When a visit ran in a tab of its own, the host SHOULD end it with a link back to the player's home game: that game's `return_url` in `platform.directory@1`, or its domain when it has none.

### 7.4 Spending home money

A visitor can spend the money they have at home. The money stays in the home game: the host shows it converted into its own currency, and each purchase is a charge that the home game approves through the hub. The hub applies the exchange rate and every limit.

**Opting in.** Both games publish a `money` object in their descriptors (`schemas/descriptor.json`).

- A home game that lets its players spend abroad declares `wallet.read@1`, `wallet.debit@1` and `wallet.credit@1`, and sets a daily limit per player for each currency that may be spent:

  ```json
  "money": { "spending_abroad": { "daily_limits": [{ "amount": 20000000, "currency": "NGN" }] } }
  ```

- A host lists the money it accepts. Each entry names a home game and a daily limit on how much may enter the host's economy from that game. It MAY also set its own rate as two whole amounts in minor units (`give` in the home currency buys `get` in the host's); without one, the hub's rate applies:

  ```json
  "money": { "accepts": [{
    "from": "lagos.example",
    "give": { "amount": 500000, "currency": "NGN" },
    "get": { "amount": 1000, "currency": "EUR" },
    "daily_inflow_limit": { "amount": 200000, "currency": "EUR" }
  }] }
  ```

`give.currency` MUST be one of the home game's `currencies` with a daily limit, and `get.currency` one of the host's. A host MAY list several entries, for several games or currencies. The hub reads both descriptors at `hub.hello@1`; a game changes its rates or limits by saying hello again.

**Hub rates.** The hub keeps its own exchange rates and publishes them as `rates` in `platform.directory@1`, in the same `give`/`get` form. An entry without `give` and `get` accepts every currency the home game lets its players spend, into the currency of `daily_inflow_limit`, at the hub's rate. If the hub has no rate between two currencies, that money isn't accepted until the host sets one. A host's own rate always wins over the hub's.

**The trip budget.** Before leaving, the player chooses the most they may spend on the visit. The home game sends it as `budget` in `visit.request@1` together with the `pay` scope. The hub answers `invalid_payload` if one is sent without the other, and `forbidden` if the host doesn't accept `budget.currency` from the home game. Otherwise it adds `budget` to the passport. The budget is fixed by the first request for a `visit_id`; refreshes keep it. A home game finds which hosts accept its money in `platform.directory@1`, which lists each game's `currencies` and `accepts`.

**Operations.** The host asks the hub, and the hub asks the home game:

| Host → Hub | Hub → Home | Purpose |
| --- | --- | --- |
| `wallet.balance@1` | `wallet.read@1` | What the visitor can spend, in the host's currencies |
| `wallet.charge@1` | `wallet.debit@1` | Pay for something the visitor chose |
| `wallet.refund@1` | `wallet.credit@1` | Return all or part of a charge |

- `wallet.balance@1` answers with `spendable`: for each host currency with a rate for the budget's currency, the lowest of the home balance, the remaining trip budget, the player's remaining daily limit and the host's remaining inflow, converted. The host never learns the home balance itself.
- `wallet.charge@1` names the visit, an amount in one of the host's currencies and a description. Its envelope `id` is the charge id. The hub converts the amount, checks every limit, and sends `wallet.debit@1` to the home game with both amounts. The home game MUST take the amount only if the player has it, in one step, and answer with the new balance or `insufficient_funds`. It MUST treat a repeated `charge_id` as the same debit. There is no separate check before a charge: the debit is the check.
- `wallet.refund@1` returns all or part of a charge within 24 hours. Its envelope `id` is the refund id. The hub sends the matching share of the debit with `wallet.credit@1`, carrying the refund id as `refund_id`, and restores the trip budget and daily limits by the same amount. The home game MUST treat a repeated `refund_id` as the same credit.

**Home game answers.** `wallet.read@1`, `wallet.debit@1` and `wallet.credit@1` carry the player in `payload.player`, which MUST match `to.player`; a home game refuses a mismatch with `invalid_payload`. A balance below zero (for example from arrears) is reported as zero. A home game MAY apply its own limits as well as the hub's.

**Conversion.** A debit is the host amount × `give` ÷ `get`, rounded **up** to the home currency's minor unit, so no charge costs nothing. An amount shown to the host is the home amount × `get` ÷ `give`, rounded **down**, so a visitor is never shown more than they can spend. A partial refund credits the debit × refunded ÷ charged, rounded down; the refund that completes a charge credits whatever remains of its debit. Daily limits run on UTC days. `vectors/money.json` has worked cases.

**Limits.** A charge MUST fit within all four, or the hub answers `limit_reached` (or `insufficient_funds` from the home game):

| Limit | Set by | Protects |
| --- | --- | --- |
| Trip budget | The player | The player, from a host that charges without being asked |
| Daily limit per player | The home game | The home game's economy, from being drained |
| Daily inflow from each game | The host | The host's economy, from being flooded |
| Balance | The home game | Nobody spends what they don't have |

**Round trips.** Rates connect currencies across games. The hub MUST refuse, at `hub.hello@1`, any rate that would complete a cycle of conversions (through any number of games and currencies) whose rates multiply to more than 1, so that no one can end up with more than they started with by converting in a circle. The hub's own rates count, and it MUST NOT publish rates that complete such a cycle with its own or any game's rates.

**Paying sellers.** Who receives the money is the host's business. When the seller is a player or a business, the host credits them in its own currency after the hub confirms the charge, never before. When a charge is refunded, the host covers the refund itself.

**When the home game can't be reached.** Charges are never queued. If the hub gets no definite answer to `wallet.debit@1`, it answers the host `platform_offline` and voids the charge by sending `wallet.credit@1` for the whole amount, under a new `refund_id` that it repeats on every retry, until the home game answers. A voided charge stays voided; the host may try again with a new charge, under a new envelope id. A home game that receives a credit for a `charge_id` it never debited MUST record it, answer with the balance as usual, and refuse any later debit with that id with `forbidden`, so a late debit can't land after the void. A host MAY also give visitors a guest wallet of its own for when home money is unavailable.

### 7.5 Who may visit

A game takes visitors from every game on the network unless its descriptor limits them with `visitors`, which holds one of:

- `from`: only players from these games may visit. An empty list takes no visitors, for example while the game is closed for maintenance.
- `except`: players from every game but these may visit.

```json
"visitors": { "except": ["noisy.example"] }
```

The hub reads `visitors` at `hub.hello@1`, like the rest of the descriptor, and answers `forbidden` to a `visit.request@1` for a game that doesn't take visitors from the player's home game. Refreshes are refused too, so visits already under way end when their passport expires. In `platform.directory@1`, `visitors_welcome` tells the game asking whether its players may visit each listed game, so it can hide the option rather than offer a trip that will be refused.

`visitors` is public, like the rest of the descriptor. It lets the hub refuse before the player leaves home; a host still checks every passport and MAY turn away any visitor itself.

## 8. Shared vocabulary

Games describe their worlds in their own words. To understand each other they also send a **shared word** from the SGIP vocabulary: a stat, a verb, a place kind, a transport mode and so on. A Lagos game can call an activity "Chop at the buka" and a Berlin game "Currywurst at the Imbiss"; both send `eat`, and each knows what the other means.

### 8.1 The registry

The vocabulary lives in [`vocabulary/`](vocabulary), one JSON file per domain. Each term has an `id`, a `label`, a `description`, optional `aliases` and an optional `broader` term. The wire definitions in `schemas/common.json` are generated from these files (`node tools/vocab.mjs`), so the registry is the single source of truth.

| Domain | Used in | Examples |
| --- | --- | --- |
| [Stats](vocabulary/stats.json) | `stats`, `statChanges`, souvenirs, effects | `energy`, `hunger` (fed), `mood`, `social`, `hygiene`, `fitness`, `fun`, `bladder` |
| [Verbs](vocabulary/verbs.json) | `action.list@1`, presence activity, events, `visit.end@1` activities, `wallet.charge@1` | `eat`, `cook`, `sleep`, `groom`, `work`, `gig`, `study`, `date`, `gamble`, `photograph`, `vote` |
| [Place kinds](vocabulary/place-kinds.json) | `world.places@1`, `place.status@1` | `pub`, `street_food`, `spa`, `courthouse`, `polling_station`, `music_venue` |
| [Transport modes](vocabulary/transport-modes.json) | `travel.quote@1` | `walk`, `minibus`, `danfo`, `motorbike_taxi`, `okada`, `ride_hail`, `ferry`, `flight` |
| [Skills](vocabulary/skills.json) | `player.profile@1`, `action.list@1` | `charisma`, `cooking`, `coding`, `music`, `business` |
| [Relationships](vocabulary/relationships.json) | informative | `friend`, `close_friend`, `partner`, `spouse`, `rival`, `colleague` |
| [Interactions](vocabulary/interactions.json) | `action.list@1` | `greet`, `chat`, `joke`, `compliment`, `hug`, `ask_out`, `teach` |
| [Poses](vocabulary/poses.json) | `action.list@1`, presence activity | `stand`, `sit`, `lie`, `dance`, `use`, `swim` |
| [Career fields](vocabulary/career-fields.json) | `player.profile@1` | `hospitality`, `health`, `technology`, `public_service`, `arts` |
| [Event kinds](vocabulary/event-kinds.json) | `world.events@1` | `concert`, `match`, `wedding`, `market_day`, `election`, `quest` |
| [Game kinds](vocabulary/game-kinds.json) | `action.list@1`, `world.events@1` | `chess`, `ludo`, `mancala`, `shedding`, `brag`, `pool`, `quiz` |
| [Item categories](vocabulary/item-categories.json) | informative | `seating`, `bed`, `power`, `entertainment`, `pet`, `luxury` |
| [Pronouns](vocabulary/pronouns.json) | `display.pronouns`, `player.lookup@1` | `she`, `he`, `they` |
| [Body types](vocabulary/body-types.json) | `display.look`, `player.lookup@1` | `feminine`, `masculine` |
| [Hair styles](vocabulary/hair-styles.json) | `display.look`, `player.lookup@1` | `short`, `afro`, `braids`, `locs`, `long`, `bun` |
| [Headwear](vocabulary/headwear.json) | `display.look`, `player.lookup@1` | `headwrap`, `hijab`, `hat`, `cap` |
| [Outfit styles](vocabulary/outfit-styles.json) | `display.look`, `player.lookup@1` | `casual`, `sport`, `smart`, `party`, `traditional` |
| [Patterns](vocabulary/patterns.json) | `display.look`, `player.lookup@1` | `plain`, `print`, `woven` |

### 8.2 Naming rules

- **Generic first.** Core ids are plain international English that a player anywhere would understand: `street_food`, not `buka`; `minibus`, not `danfo`.
- **Local flavour is welcome as a narrower term.** A regional word may be registered when it names something real and distinct, with `broader` pointing at its generic term (`danfo` → `minibus` → `bus`). Everyday synonyms go in `aliases` instead (`gist` is an alias of `chat`).
- **Shape.** Ids are lower `snake_case`, at most 32 characters, ASCII only. Verbs are base-form verbs (`eat`, `photograph`, `play_sport`); every other domain uses nouns (`courthouse`, `close_friend`).
- **Grounded where possible.** Place kinds follow OpenStreetMap tag values (the `osm` field), so games built on real maps can classify places directly.
- **One meaning per id.** An id never changes meaning. A term that was a mistake is marked `deprecated` with `replaced_by`, and stays valid on the wire.
- **Extensions.** A platform may send `x-<platform>.<id>` (for example `x-lagos.owambe`) in any domain except stats, which travel in souvenirs and so need an SEP. A receiver MAY treat an extension it does not know as unclassified.

### 8.3 Understanding a term you don't know

Senders MUST send registered ids or extensions. Receivers MUST accept every registered id, even ones they do not model, and resolve them like this:

1. If the receiver models the term, use it.
2. Otherwise follow `broader` until it reaches a term the receiver models (`okada` → `motorbike_taxi` → `taxi`).
3. Otherwise apply the domain's `fallback` rule, which each vocabulary file states (for transport: use `taxi`; for verbs: show the sender's label unclassified).

Receivers MUST ignore stats they do not model, and MUST NOT invent a value for a stat the sender did not send.

### 8.4 Other shared shapes

- **Stats** are integers 0–100 where **100 is best**. `hunger` means how well fed a player is: eating raises it. `bladder` means comfort: using a toilet raises it.
- **Money** is `{ "amount": <integer minor units>, "currency": "<code>" }`. Currency is an ISO 4217 code for a real-world-styled currency (`GBP`, `NGN`) or `<platform>:<code>` for a game-only one. A game lists every currency it uses in its descriptor's `currencies`. Money stays in its home game: a host can show it converted and charge it (section 7.4), but it never moves between games.
- **Looks** (`display.look`, `schemas/common.json`) describe a player's figure so a host can draw them as they look at home: `body`, `skin`, `hair` (`style`, `color`), `headwear` (`kind`, `color`) and `outfit` (`style`, `pattern`, `top`, `bottom`). Colours are `#rrggbb`. Every field is optional, and a host draws the look as closely as it can, resolving terms it doesn't model as in section 8.3. A look describes appearance only: a host MUST NOT give a visitor items because of their look, so clothes, like money, stay in the home game.
- **Places** are addressed `place://<platform>/<district>/<slug>`.
- **Times** are RFC 3339 timestamps in UTC, except passport claims and the passport's `expires_at` in `visit.request@1`, which are Unix seconds as in JWT.

### 8.5 Adding a term

Anyone can propose a term with a pull request that edits the vocabulary file and runs `node tools/vocab.mjs`. Terms land as `proposed`, become `stable` once two platforms use them, and are never removed. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## 9. Operations

A platform joins by sending `hub.hello@1`, and MUST declare and answer the three required inbox ops: `hub.ping@1`, `player.lookup@1` and `message.send@1`. It declares any others it supports in the same `capabilities` list, which names only the ops it *answers* at its inbox. The hub only routes an op to a platform that declared it; otherwise the sender gets `op_unsupported` at once.

| Operation | Direction | Required | Queued if offline | Schema |
| --- | --- | --- | --- | --- |
| `hub.hello@1` | Platform → Hub | yes | no | `ops/hub.hello@1.json` |
| `hub.ping@1` | Both | yes | no | `ops/hub.ping@1.json` |
| `hub.check@1` | Platform → Hub | no | no | `ops/hub.check@1.json` |
| `platform.directory@1` | Platform → Hub | no | no | `ops/platform.directory@1.json` |
| `player.lookup@1` | Platform → Hub → Platform | yes | no | `ops/player.lookup@1.json` |
| `message.send@1` | Platform → Hub → Platform | yes | yes | `ops/message.send@1.json` |
| `message.receipt@1` | Platform → Hub → Platform | no | yes | `ops/message.receipt@1.json` |
| `presence.update@1` | Platform → Hub → subscribers | no | yes | `ops/presence.update@1.json` |
| `presence.subscribe@1` | Platform → Hub | no | no | `ops/presence.subscribe@1.json` |
| `presence.unsubscribe@1` | Platform → Hub | no | no | `ops/presence.unsubscribe@1.json` |
| `invite.send@1` | Platform → Hub → Platform | no | yes | `ops/invite.send@1.json` |
| `invite.respond@1` | Platform → Hub → Platform | no | yes | `ops/invite.respond@1.json` |
| `visit.request@1` | Home → Hub | no | no | `ops/visit.request@1.json` |
| `visit.end@1` | Host → Hub → Home | no | yes | `ops/visit.end@1.json` |
| `world.places@1` | Platform → Hub → Platform | no | no | `ops/world.places@1.json` |
| `action.list@1` | Platform → Hub → Platform | no | no | `ops/action.list@1.json` |
| `travel.quote@1` | Platform → Hub → Platform | no | no | `ops/travel.quote@1.json` |
| `player.profile@1` | Platform → Hub → Platform | no | no | `ops/player.profile@1.json` |
| `world.events@1` | Platform → Hub → Platform | no | no | `ops/world.events@1.json` |
| `place.status@1` | Platform → Hub → Platform | no | no | `ops/place.status@1.json` |
| `wallet.balance@1` | Host → Hub | no | no | `ops/wallet.balance@1.json` |
| `wallet.charge@1` | Host → Hub | no | no | `ops/wallet.charge@1.json` |
| `wallet.refund@1` | Host → Hub | no | no | `ops/wallet.refund@1.json` |
| `wallet.read@1` | Hub → Home | no | no | `ops/wallet.read@1.json` |
| `wallet.debit@1` | Hub → Home | no | no | `ops/wallet.debit@1.json` |
| `wallet.credit@1` | Hub → Home | no | no | `ops/wallet.credit@1.json` |

Each op schema defines `payload` and `result`.

`player.profile@1` MUST follow the same discoverability rule as `player.lookup@1`, and MUST NOT include a home address, only a district. `place.status@1` reports how many players are at a place, never who.

### 9.1 Conformance checks

A platform asks the hub to test it with `hub.check@1`, signed with its own key. Only the platform can ask for its own check: there is no way to check someone else's game. Like `hub.hello@1`, it works before the platform is registered.

The hub fetches the platform's descriptor from `https://<platform_id>/.well-known/sgip.json` and MUST refuse the request unless it is signed with a key that descriptor lists. It MUST refuse a descriptor whose `inbox` or `visit` is not HTTPS on the platform's domain, so a check never sends traffic anywhere else. It SHOULD limit how often one platform can ask, and answers `rate_limited` when it does.

The hub then tests the platform over HTTP the way it does in normal operation, with requests signed by its own key, and reports each check. A check covers at least:

1. The descriptor is served, matches `schemas/descriptor.json` and declares the three required ops.
2. A correctly signed `hub.ping@1` gets a valid reply.
3. A request that is unsigned, signed by another key, more than 300 seconds old, or repeats a nonce is refused with `bad_signature` or `expired`.
4. A malformed envelope is refused with `invalid_payload`, and an op the platform never declared with `op_unsupported`.
5. `player.lookup@1` and `message.send@1` for a player who doesn't exist answer `not_found`.
6. The visit page loads and doesn't take a passport from the query string.

The reply lists every check with `name`, `passed`, `required` and `detail`. `conforms` is true when every required check passed.

## 10. Versioning

- New behaviour arrives as a new op or a new `@version`, never by changing an existing one.
- Adding an optional field is allowed within a version; removing, renaming or changing a field's meaning needs a new version.
- From 1.0, the hub supports at least two versions of an op at once and announces deprecations 90 days ahead. Before 1.0 nothing is removed.
- Experimental ops use `x-<platform>.<action>@n` and are routed between platforms that both declare them.
- The protocol version in `sgip` is `0.<minor>` until 1.0. Every 0.x release is a superset of the one before: new ops, new optional fields and new vocabulary terms only. Receivers accept any `0.x` envelope.
- New vocabulary terms are not a breaking change: receivers resolve unknown terms with section 8.3.

## 11. Abuse controls

- The hub rate-limits every platform per op, more strictly for `message.send` and `invite.send`.
- Message text is plain UTF-8, at most 1,000 characters, no HTML.
- Players are invite-only across games unless they opt in to being discoverable; `player.lookup@1` MUST NOT reveal players who haven't.
- The hub can suspend a platform that forges messages or spams; platforms can block players on their side, and choose which games' players may visit them (section 7.5).
- No money, items or stats move between games. Spending home money on a visit (section 7.4) is bounded by the player's trip budget, the home game's daily limit per player and the host's daily inflow limit from each game.
