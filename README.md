# SGIP: Simulation Game Interoperability Protocol

SGIP is an open protocol that lets independent simulation games recognise each other's players, message across games and send a player to visit another game. It is plain HTTPS + JSON with Ed25519 signatures, so **the language your game is written in does not matter**: anything that can serve HTTP and sign a request can join.

SGIP is at version 0.1. This repository holds the protocol: the specification, the shared vocabulary, the proposals and the website. Games connect to each other through a hub that implements this specification.

## Join in four steps

1. **Make a key pair.** Ed25519. Keep the secret on your server.
2. **Serve three endpoints** (see [`spec/openapi.yaml`](spec/openapi.yaml)):
   - `GET /.well-known/sgip.json`: your descriptor, listing your public key ([schema](spec/schemas/descriptor.json)).
   - `POST /sgip/inbox`: where the hub delivers operations. Verify the hub's signature; answer the ops you declare.
   - `GET /sgip/visit`: where visiting players land with a hub-signed passport.
3. **Sign every request** to the hub with the `SGIP-Signature` header ([spec §6](spec/sgip.md#6-signing)). Check your code against [`spec/vectors/signing.json`](spec/vectors/signing.json) before going live.
4. **Say hello.** Send `hub.hello@1` listing the ops your inbox answers. Three are required: `hub.ping@1`, `player.lookup@1` and `message.send@1`. Add the rest when you're ready.

## What's in this repository

| Path | What it is |
| --- | --- |
| [`spec/sgip.md`](spec/sgip.md) | The normative protocol: envelope, signing, errors, passports, visits, vocabulary, operations, versioning |
| [`spec/openapi.yaml`](spec/openapi.yaml) | Every HTTP endpoint, on the hub and on a game (OpenAPI 3.1) |
| [`spec/schemas/`](spec/schemas) | JSON Schema 2020-12 for the envelope, replies, descriptor, passport claims and each op's payload and result, with examples |
| [`spec/vectors/`](spec/vectors) | Fixed keys, requests, signatures, passports and money conversions, valid and broken, to test any implementation |
| [`spec/vocabulary/`](spec/vocabulary) | The registry of shared words: verbs, place kinds, stats, transport modes and eight more domains. `schemas/common.json` is generated from it |
| [`spec/decisions.md`](spec/decisions.md) | Why the protocol works the way it does |
| [`tools/`](tools) | In Node: `vocab.mjs` (checks the vocabulary and regenerates `common.json`), `generate-vectors.mjs` (writes the signing and passport vectors) and `check.mjs` (checks schemas, examples, vocabulary and vectors) |
| [`site/`](site) | The protocol website, generated from the spec: `cd site && npm install && npm run serve` (needs Python 3 for the local server) |
| [`proposals/`](proposals) | SGIP Enhancement Proposals |
| [`brand/`](brand) | The SGIP logo: the app icon and the plain mark, as SVG and PNG |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to add words, propose changes and help |

## Check your game

Send the hub a signed `hub.check@1` ([spec §9.1](spec/sgip.md#91-conformance-checks)). Only your game can ask for its own check. The hub tests your game over HTTPS, the same way it talks to it in normal use, and reports every check. Your inbox needs to trust the hub's key, which it looks up at `/.well-known/sgip-hub.json`.

## Check the contract itself

```sh
cd tools && npm install && npm run check
```

## Roadmap

- New operations and vocabulary through [proposals](proposals), shaped by the games that join.

## Contributing

SGIP is built by the people who make simulation games. Add a word to the vocabulary, propose a new operation, or connect your game and tell us what was unclear: see [CONTRIBUTING.md](CONTRIBUTING.md). For anything else, email [hello@sgip.dev](mailto:hello@sgip.dev).

## Licence

The specification text and the website's written content are [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the schemas, vectors, vocabulary, tools and code are MIT. The SGIP name and logo are not covered by these licences; you may use them to refer to SGIP. See [LICENSE](LICENSE).
