# Build with Next.js

This walkthrough turns a fresh Next.js app into a game platform that joins SGIP. It uses Next.js route handlers and Node's built-in crypto, and nothing else. Follow it through and the hub's conformance check passes every check.

You'll build four things: a descriptor that says who you are, an inbox the hub delivers to, a visit page for players from other games and a way for them to leave, and a script that registers you with the hub. You need Node.js 24 or newer, which runs the TypeScript scripts directly.

## 1. Create the app

```sh
npx create-next-app@latest my-game --ts --app --empty --use-npm --yes
cd my-game
```

The code below imports files with their `.ts` extension, so the scripts can run straight in Node. Allow that in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "allowImportingTsExtensions": true
  }
}
```

In `package.json`, mark the project as ES modules and add four scripts:

```json
{
  "type": "module",
  "scripts": {
    "keys": "node scripts/keys.ts",
    "hello": "node --env-file=.env.local scripts/hello.ts",
    "check": "node --env-file=.env.local scripts/check.ts",
    "vectors": "node scripts/check-vectors.ts"
  }
}
```

## 2. Settings

Create `.env.example`, copy it to `.env.local`, and fill it in. Your platform id is your game's domain: players are addressed `handle@yourgame.example`. You don't set the hub's key: the library looks it up at `<hub>/.well-known/sgip-hub.json` and keeps it until the expiry the hub publishes.

@include site/content/nextjs/.env.example sh

To make your key pair, add this script and run `npm run keys`, then paste the two lines into `.env.local`. Never commit the secret.

@include site/content/nextjs/scripts/keys.ts ts

## 3. The SGIP library

One file does the protocol's crypto and talks to the hub: key ids, the five-line canonical string, signing and checking requests, looking up the hub's key, ULIDs, passports, `callHub` and the hub's directory of games. Each part names the spec section it follows.

@include site/content/nextjs/lib/sgip.ts ts

## 4. Check it against the test vectors

Ed25519 signatures are deterministic, so a correct implementation reproduces every expected signature in the spec's test vectors exactly. This script downloads them and checks your library:

@include site/content/nextjs/scripts/check-vectors.ts ts

```sh
npm run vectors
# ✓ key id ff73a0647bbc29aa … ✓ passport invalid: not a JWS
# All vectors pass
```

Don't go further until every line passes.

## 5. A place to keep things

The inbox has to remember nonces for 10 minutes and envelope ids for 24 hours, and visitors need guest records. This keeps them in memory to stay short. In a real game, use your database, so they survive restarts and are shared by every server.

@include site/content/nextjs/lib/store.ts ts

## 6. Publish your descriptor

The hub fetches `/.well-known/sgip.json` from your domain to confirm the domain vouches for your key. `capabilities` lists the ops your inbox answers, `icon` is a short emoji other games show for yours until you add an image (`icon_url`), and `return` is where your players land when they come back from a visit.

@include site/content/nextjs/app/.well-known/sgip.json/route.ts ts

## 7. Answer your inbox

The hub POSTs every operation here, signed with its key. The route checks the signature, the timestamp, the nonce and the envelope in the order the spec gives, returns the stored reply for an id it has seen, and refuses ops it never declared. Then each op gets its answer.

@include site/content/nextjs/app/sgip/inbox/route.ts ts

## 8. Welcome visitors

A visitor arrives with a passport in the URL fragment (a new tab) or by `postMessage` (an iframe), never in the query string. The page reads it, takes it out of the address bar and posts it to your server. A passport sent by `postMessage` is only taken from a game in the hub's directory.

@include site/content/nextjs/app/sgip/visit/page.tsx tsx

@include site/content/nextjs/app/sgip/visit/arrival.tsx tsx

Your server checks the passport offline with the hub's key: its signature, that it's meant for you, and that it hasn't expired. Only then does it create a guest, keyed on `sub@home` so a returning visitor keeps the same identity.

@include site/content/nextjs/app/sgip/visit/arrive/route.ts ts

To see who has arrived and the messages they've had, replace `app/page.tsx`. A visitor also gets a **Leave** button:

@include site/content/nextjs/app/page.tsx tsx

## 9. Let visitors leave

When a visitor leaves, tell their home game with `visit.end@1`, sent through the hub, so it can take them back. Then show a goodbye page with a link back to their game. If the visit ran in an iframe, the page tells the home game it can close it.

@include site/content/nextjs/app/sgip/visit/actions.ts ts

The goodbye page only links to games the hub lists, so nobody can use it to send people to another site:

@include site/content/nextjs/app/sgip/visit/goodbye/page.tsx tsx

@include site/content/nextjs/app/sgip/visit/goodbye/exit.tsx tsx

## 10. Say hello

The hub fetches your descriptor from `https://<SGIP_PLATFORM_ID>/.well-known/sgip.json`, so the app must be reachable there over HTTPS: deploy it, or while you develop, point the domain at your machine with a tunnel. Set `APP_URL` to that address. Then register with one signed `hub.hello@1`. The hub fetches your descriptor, checks the key matches, and answers with its own public key.

@include site/content/nextjs/scripts/hello.ts ts

```sh
npm run dev        # in one terminal
npm run hello      # in another
```

## 11. Check your game

Ask the hub to check your game. The request is signed with your key, so only you can ask for your game's check. The hub fetches your descriptor, sends signed, unsigned, stale, replayed and malformed requests, and grades every reply against the schemas (spec section 9.1).

@include site/content/nextjs/scripts/check.ts ts

```sh
npm run check
# ✓ Descriptor is served … ✓ Visit page does not take the passport in the query string
# Conforms
```

When it says **Conforms**, you're on the network.

## Before you go live

- Move the store to your database.
- Serve over HTTPS on the domain you use as `SGIP_PLATFORM_ID`.
- Keep `SGIP_SECRET_KEY` out of your code and your repository.
- End visits for visitors who have been idle for 15 minutes too: `visit.end@1` with `reason: "idle"`.
- Add `icon_url` to your descriptor, a square image of at least 128 px. When your game has money, add `currencies`; to choose which games' players may visit, add `visitors` (see the [guide](guide.html#2-publish-your-descriptor)).
- Add more operations as you build them: list each in `CAPABILITIES` and answer it in the inbox. The [examples](examples.html) show what the others look like.
