# Contributing to SGIP

SGIP is meant to be built by the people who make simulation games. If you run a game, are building one, or just care about games talking to each other, you are welcome here.

## Ways to help

| You want to… | Do this |
| --- | --- |
| Connect your game | Follow the [guide](site/content/guide.md), ask the hub for a conformance check with `hub.check@1`, and open an issue to say hello. Every new platform finds something the spec should say more clearly. |
| Add a word to the vocabulary | Edit the file in [`spec/vocabulary/`](spec/vocabulary), run `node tools/vocab.mjs`, and open a pull request. A new stat needs an SEP (spec section 8.2). |
| Fix or clarify the spec | Open a pull request against [`spec/sgip.md`](spec/sgip.md). Small wording fixes need no discussion. |
| Propose a new operation or a change in behaviour | Write an SGIP Enhancement Proposal ([below](#sgip-enhancement-proposals-seps)). |
| Report a problem | Open an issue with what you sent, what came back and what you expected. Never include private keys or passports. |
| Report a security vulnerability | Privately, never as an issue: see [SECURITY.md](SECURITY.md). |
| Improve the tools or the website | Pull requests are welcome; run the checks first. |

## Adding vocabulary terms

1. Pick the domain file in `spec/vocabulary/` (verbs, place kinds, transport modes, …).
2. Add the term with `"status": "proposed"` and `"since"` set to the next release:
   ```json
   { "id": "busk", "label": "Busk", "description": "Perform in the street for tips.", "broader": "perform", "status": "proposed", "since": "0.2" }
   ```
3. Follow the naming rules in spec section 8.2: generic English ids, lower `snake_case`, verbs as base-form verbs; a local word becomes a narrower term with `broader` set, and a plain synonym becomes an alias of an existing term.
4. Run `node tools/vocab.mjs` to regenerate `spec/schemas/common.json`, then `cd tools && npm install && npm run check`.
5. In the pull request, say which game uses the term and how.

A term becomes `stable` once two platforms use it. Terms are never deleted; a mistake is `deprecated` with `replaced_by`.

## SGIP Enhancement Proposals (SEPs)

Anything that changes what a platform or the hub must do, or adds an operation, goes through an SEP.

1. Open an issue describing the problem (not the solution) and wait a few days for discussion.
2. Copy [`proposals/0000-template.md`](proposals/0000-template.md) to `proposals/0000-short-title.md` and open it as a draft pull request. Maintainers assign the number.
3. A proposal needs a working implementation in at least one game before it is accepted.
4. Accepted proposals ship in the next 0.x release. 0.x releases only add; nothing a 0.x platform relies on is taken away before 1.0.

## Principles for changes

- **Technology must not matter.** Everything is HTTPS + JSON with Ed25519. A change that only works in one language or framework will not be accepted.
- **Additive by default.** New ops and optional fields, never changed meanings.
- **Players first.** Nothing that moves real money or exposes more than a player chose to share. Money, items and stats never cross games; a visitor spends home money in place, within a budget they set.
- **Show, don't argue.** Examples in the schemas, vectors for anything cryptographic, and a running implementation.

## Before you open a pull request

These check the spec repo itself. To test your game, see [Ask for a conformance check](site/content/guide.md#6-ask-for-a-conformance-check).

```sh
cd tools && npm install && npm run check    # schemas, examples, vocabulary, signing and passport vectors
cd ../site && npm install && npm run build  # the website, generated from the spec
```

## Conduct

Be kind, assume good faith, and keep discussion about the work. Harassment of any kind is not tolerated; maintainers may remove comments and block accounts that make the project unwelcoming. To raise a conduct concern privately, email [hello@sgip.dev](mailto:hello@sgip.dev).
