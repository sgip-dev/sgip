# Design decisions

Why SGIP 0.1 works the way it does. Each decision can be revisited before 1.0, within the versioning rules (spec section 10).

## The core

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Where do `ts` and `nonce` live? | In the `SGIP-Signature` header, not the envelope | They protect the HTTP request, not the message; the envelope stays the same over WebSocket later. |
| 2 | Passport claim names | `player`, `display`, `visit_id` and `jti` | `player` matches addresses everywhere else; `display` is what other players see; `visit_id` stays across refreshes, `jti` is per token. |
| 3 | Who signs the passport? | The hub only | The hub has already verified the home game's signed `visit.request@1`, so a second signature adds nothing in a hub-and-spoke network. Home countersigning can be added with federation. |
| 4 | How does the passport reach the host? | `postMessage` into the iframe, or the URL fragment for a new tab; never the query string | Query strings end up in server logs and proxies. |
| 5 | Which way does `hunger` run? | Every stat is 0–100 with 100 best; `hunger` = how well fed, eating raises it | One rule for every stat, so no game has to remember which way one runs. |
| 6 | Currency codes | ISO 4217 (`GBP`, `NGN`) or `<platform>:<code>` for game-only money, listed in the descriptor's `currencies` | Allows both real-styled and invented currencies, and games with more than one. |
| 7 | `visit.end@1` payload | `visit_id`, `player`, `reason`, plus optional `duration_s`, `minutes`, `souvenirs`, `last_place`, `summary`, `activities` | What the home game needs to apply capped souvenirs and tell the player how the visit went. |
| 8 | `invite.send@1` payload | `invite_id`, `host`, optional `place`, `note`, `from_name`, `expires_at` | A `place://` address, so the host can place the guest exactly, rather than free-form text. |
| 9 | Transport modes | Generic modes such as `bus`, with local ones like `danfo` beneath them | Every city has buses; a danfo is a kind of minibus, so a game that has never heard of one still understands it. |

## The vocabulary

The vocabulary is a registry rather than a fixed list, built from what real life simulation games do. A single life simulation game can tag hundreds of activities with dozens of kinds of thing (eat, date, gig, hustle, civic, online, photo, …), which a short list of verbs could not describe.

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 10 | Generic words or local ones? | Generic ids, with local words as narrower terms (`danfo` → `minibus`) or aliases (`gist` → `chat`) | Every game can understand a generic word; local terms keep each game's flavour without forcing it on others. |
| 11 | What happens when a game meets a word it doesn't know? | Follow `broader` to a word it knows, then the domain's fallback | Lets the vocabulary grow without breaking older games, which is what lets releases be additive. |
| 12 | Where do place kinds come from? | OpenStreetMap tag values where one exists | Many simulation games are built on real maps; OSM is the shared, open classification of the real world. |
| 13 | Should `fun` and `bladder` be stats? | Yes, as optional stats | Most life simulation games model both. Games that don't model them ignore them (section 8.3). |
| 14 | Is `mood` a need like the others? | It is a stat, meaning overall emotional state | Games already model it; `fun` carries the narrower "entertained" meaning. |
| 15 | What about crime, jail and courts? | Only `civic` and `courthouse`/`police` in core; crimes are platform extensions | Crimes are rules of a particular game, not something another game needs to understand to host a visitor. |
| 16 | Profiles and privacy | `player.profile@1` follows the same discoverability rule as `player.lookup@1`, shows a district only, never a home address | Profiles make games feel connected, but must not expose more than a player chose to share. |
| 17 | Who decides new terms? | Anyone proposes by pull request; terms start `proposed` and become `stable` once two platforms use them | Keeps the registry open while making sure terms describe real games. |

## Spending home money

Section 7.4 lets visitors spend what they earned at home, without letting one game flood or drain another.

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 18 | Does money move between games? | No. It stays in its home game; the host shows it converted and charges it through the hub | One balance, held by the game that owns it. Nothing is stranded in a host and nothing converts back. |
| 19 | Who sets the rate? | The host, per home game and currency, as two whole amounts | The host decides what its economy accepts. Whole amounts avoid rounding arguments about decimals. |
| 20 | Check the balance, then charge? | No. The debit is the check, and is idempotent on the charge id | Checking first lets two charges pass the same check. |
| 21 | Which way does rounding go? | Debits round up; amounts shown and partial refunds round down | No charge can cost nothing, and no visitor is shown more than they can spend. |
| 22 | What protects each side? | A trip budget set by the player, a daily limit per player set by the home game, a daily inflow limit set by the host | Each party caps the risk it carries: a dishonest host, a drained home economy, a flooded host economy. |
| 23 | Can rates be gamed by going round in circles? | The hub refuses rates that complete a cycle multiplying to more than 1 | Sellers are paid in the host's currency, so money can flow both ways; a cycle that gains would print money. |
| 24 | What about one person owning accounts in both games? | Not treated as abuse | Buying from yourself is a conversion at rates both games published, within limits both games set. |
| 25 | Who receives the money? | The host decides; a player or business seller is credited after the hub confirms, and the host covers refunds | Who owns a shop is game logic, not protocol. |

## Signatures

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 26 | Which signature algorithm? | Ed25519 | No per-signature random number to get wrong, deterministic signatures that test vectors can pin exactly, small keys, and built into PHP, Node, Go, Java and Python. |
| 27 | How could the algorithm ever change? | An optional `alg` in `SGIP-Signature`, `ed25519` by default; any other value is refused | A later version can add an algorithm, such as a post-quantum one, without a new header. Passports already name theirs (`EdDSA`). |
| 28 | Which Ed25519 verification rules? | RFC 8032 section 5.1.7, with `S` < `L`; the hub refuses small-order keys at registration | Libraries disagree on edge cases: some accept a forged signature for the identity key and others, such as libsodium, don't; refusing such keys once, at the hub, removes the difference. |
| 29 | How do platforms get the hub's key? | They look it up at `/.well-known/sgip-hub.json` and cache it until its `expires_at`; an unknown key id triggers one fresh look-up | Nothing to configure, and the hub can change its key without every game editing its settings. Capping passports at the key's expiry makes a planned change seamless; refetching on an unknown id handles a key replaced early. |

## Visitors

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 30 | Can a game choose who visits? | Yes: `visitors` in the descriptor, an allow list (`from`) or a block list (`except`); the hub enforces it at `visit.request@1` | A host can always turn a visitor away at the door, but by then the player has already left home. The descriptor is where every other setting lives, so it works with any hub and needs no dashboard. |

## Looks

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 31 | Does a player's appearance travel? | Yes: an optional `look` in `display`, built from shared words (`body`, hair, headwear, outfit) and colours | A visitor who arrives as a coloured dot loses what makes a visit feel like their own. Games that share the words keep the look exactly; others fall back through `broader`, as with every other domain. |
| 32 | Do clothes travel as items? | No: the look describes appearance only | Like money, items stay in the home game. Otherwise a cheap outfit at home becomes a free luxury item elsewhere. |
| 33 | Gender? | No gender field. `body` says how to draw the figure; `pronouns` (`she`, `he`, `they`, from the pronouns vocabulary) says how to refer to the player, and defaults to `they` | Hosts need to draw and address a visitor, not know their identity. Every host a player visits receives the passport, so it carries only what a host uses. |
