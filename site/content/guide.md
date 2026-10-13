# Connect your game

This guide takes a game from nothing to a conforming SGIP platform. It needs no SDK: if your stack can serve HTTP, parse JSON and make an Ed25519 signature, it can join. Allow an afternoon.

Prefer to start from working code? [Build with Next.js](nextjs.html) walks through a complete platform, and the [examples](examples.html) show each part of the protocol in a few lines.

## 1. Make a key pair

Every platform has one Ed25519 key pair. The public key is 32 raw bytes written as standard base64; keep the private key (the 32-byte seed) secret, in your environment, never in code.

```js
// Node
import { generateKeyPairSync } from 'node:crypto';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url').toString('base64');
```

```python
# Python (pip install cryptography)
import base64
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization as s
key = Ed25519PrivateKey.generate()
pub = base64.b64encode(key.public_key().public_bytes(s.Encoding.Raw, s.PublicFormat.Raw)).decode()
seed = base64.b64encode(key.private_bytes(s.Encoding.Raw, s.PrivateFormat.Raw, s.NoEncryption())).decode()
```

```php
// PHP (ext-sodium)
$pair = sodium_crypto_sign_keypair();
$pub = base64_encode(sodium_crypto_sign_publickey($pair));
$seed = base64_encode(substr(sodium_crypto_sign_secretkey($pair), 0, 32));
```

```go
// Go (standard library)
pub, priv, err := ed25519.GenerateKey(rand.Reader) // crypto/ed25519, crypto/rand
if err != nil {
    log.Fatal(err)
}
pubB64 := base64.StdEncoding.EncodeToString(pub)
seedB64 := base64.StdEncoding.EncodeToString(priv.Seed())
```

```rust
// Rust (Cargo.toml: ed25519-dalek = "2", getrandom = "0.2", base64 = "0.22")
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::SigningKey;

let mut seed = [0u8; 32];
getrandom::getrandom(&mut seed).expect("no randomness");
let public = STANDARD.encode(SigningKey::from_bytes(&seed).verifying_key().to_bytes());
let secret = STANDARD.encode(seed);
```

Your **key id** is the first 16 hex characters of the SHA-256 of the base64 text of your public key.

## 2. Publish your descriptor

Serve `GET /.well-known/sgip.json` on your game's own domain. It proves you own the domain and tells the hub where to reach you.

```json
{
  "sgip": "0.1",
  "platform_id": "yourgame.example",
  "name": "Your Game",
  "description": "A sentence or two about your game.",
  "icon": "🎮",
  "icon_url": "https://yourgame.example/icon.png",
  "public_key": "<your base64 public key>",
  "inbox": "https://yourgame.example/sgip/inbox",
  "visit": "https://yourgame.example/sgip/visit",
  "return": "https://yourgame.example/welcome-back",
  "capabilities": ["hub.ping@1", "player.lookup@1", "message.send@1"],
  "currencies": ["GBP"],
  "visitors": { "except": ["noisy.example"] }
}
```

`capabilities` lists only the ops you **answer** at your inbox. Start with the three required ones and add more as you build them. `currencies` lists every currency your game uses; a game can have more than one. `icon_url` (a square image of at least 128 px) and `description` (plain text, at most 200 characters) are how other games show yours, and `return` is where your players land when they come back from a visit. Every URL must be HTTPS on your own domain. `visitors` is optional and says whose players may visit you: `"except"` turns away the games listed, and `"from"` lets in only the games listed (an empty list closes your game to visitors). Leave it out to take visitors from every game; see [section 7.5](spec.html#75-who-may-visit).

## 3. Sign every request

Every request between your game and the hub carries one header:

```
SGIP-Signature: keyId=<key id>,ts=<unix seconds>,nonce=<ULID>,sig=<base64>
```

The signature is Ed25519 over five lines joined by `\n`, with no trailing newline: the HTTP method in capitals, the path, the timestamp, the nonce and the lowercase hex SHA-256 of the exact body bytes. Pass the current Unix time as `ts` and a fresh ULID as `nonce`. A header may also carry `alg=ed25519`, which is the default; when you receive one, accept it with or without `alg` and refuse any other value.

```js
// Node
import { createHash, createPrivateKey, sign } from 'node:crypto';

function signRequest(method, path, body, seed, pub, keyId, ts, nonce) {
    const canonical = [method.toUpperCase(), path, ts, nonce, createHash('sha256').update(body).digest('hex')].join('\n');
    const key = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: Buffer.from(seed, 'base64').toString('base64url'), x: Buffer.from(pub, 'base64').toString('base64url') }, format: 'jwk' });
    const sig = sign(null, Buffer.from(canonical), key).toString('base64');
    return `keyId=${keyId},ts=${ts},nonce=${nonce},sig=${sig}`;
}
```

```python
# Python (pip install cryptography)
import base64, hashlib
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

def sign_request(method, path, body: bytes, seed, key_id, ts, nonce):
    canonical = "\n".join([method.upper(), path, str(ts), nonce, hashlib.sha256(body).hexdigest()])
    key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(seed))
    sig = base64.b64encode(key.sign(canonical.encode())).decode()
    return f"keyId={key_id},ts={ts},nonce={nonce},sig={sig}"
```

```php
// PHP (ext-sodium)
function signRequest(string $method, string $path, string $body, string $seed, string $keyId, int $ts, string $nonce): string
{
    $canonical = implode("\n", [strtoupper($method), $path, $ts, $nonce, hash('sha256', $body)]);
    $secret = sodium_crypto_sign_secretkey(sodium_crypto_sign_seed_keypair(base64_decode($seed)));
    $sig = base64_encode(sodium_crypto_sign_detached($canonical, $secret));
    return "keyId={$keyId},ts={$ts},nonce={$nonce},sig={$sig}";
}
```

```go
// Go (standard library)
import (
    "crypto/ed25519"
    "crypto/sha256"
    "encoding/base64"
    "encoding/hex"
    "fmt"
    "strings"
)

func SignRequest(method, path string, body []byte, seed, keyID string, ts int64, nonce string) (string, error) {
    raw, err := base64.StdEncoding.DecodeString(seed)
    if err != nil {
        return "", err
    }
    sum := sha256.Sum256(body)
    canonical := strings.Join([]string{strings.ToUpper(method), path, fmt.Sprint(ts), nonce, hex.EncodeToString(sum[:])}, "\n")
    sig := ed25519.Sign(ed25519.NewKeyFromSeed(raw), []byte(canonical))
    return fmt.Sprintf("keyId=%s,ts=%d,nonce=%s,sig=%s", keyID, ts, nonce, base64.StdEncoding.EncodeToString(sig)), nil
}
```

```rust
// Rust (Cargo.toml: ed25519-dalek = "2", sha2 = "0.10", base64 = "0.22", hex = "0.4")
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};

fn sign_request(method: &str, path: &str, body: &[u8], seed: &[u8; 32], key_id: &str, ts: u64, nonce: &str) -> String {
    let canonical = format!("{}\n{}\n{}\n{}\n{}", method.to_uppercase(), path, ts, nonce, hex::encode(Sha256::digest(body)));
    let sig = SigningKey::from_bytes(seed).sign(canonical.as_bytes());
    format!("keyId={key_id},ts={ts},nonce={nonce},sig={}", STANDARD.encode(sig.to_bytes()))
}
```

Sign the body bytes exactly as you send them: don't re-encode the JSON between signing and sending. Check your code against the [signing vectors](files/vectors/signing.json) before you go further.

## 4. Answer your inbox

The hub POSTs envelopes to your inbox. For each request, in this order:

1. Verify the signature against the **hub's** public key. Reply `401 bad_signature` if the header is missing or unparsable, names an `alg` other than `ed25519`, or the signature fails.
2. Reply `401 expired` if the timestamp is more than 300 seconds from your clock.
3. Reply `401 bad_signature` if you have seen the nonce in the last 600 seconds.
4. Check the envelope. Reply `422 invalid_payload` if it breaks its schema or its `sgip` version isn't `0.x`. If you have already handled this envelope `id`, return the same reply again.
5. Reply `422 op_unsupported` for any op you didn't declare; otherwise handle it.

```json
{ "ok": true, "id": "01JA2B3C4D5E6F7G8H9J0K1M2N", "result": { "platform": "yourgame.example", "time": "2026-10-09T12:00:00Z" } }
```

Look the hub's key up at `/.well-known/sgip-hub.json` and keep it until its `expires_at`; never accept a signature or passport with it after that. When a request or passport names a key id you don't have, fetch the file again (at most once a minute), and refuse if it still doesn't match (spec section 6.1).

## 5. Say hello to the hub

Register with one signed `hub.hello@1` to the hub's `POST /ops`. The hub fetches your descriptor to check the key matches, then answers with its own public key.

```json
{
  "sgip": "0.1",
  "id": "01JA2B3C4D5E6F7G8H9J0K1M2N",
  "op": "hub.hello@1",
  "from": { "platform": "yourgame.example" },
  "to": { "platform": "sgip-hub" },
  "payload": {
    "name": "Your Game",
  "description": "A sentence or two about your game.",
    "inbox": "https://yourgame.example/sgip/inbox",
    "visit": "https://yourgame.example/sgip/visit",
    "public_key": "<your base64 public key>",
    "capabilities": ["hub.ping@1", "player.lookup@1", "message.send@1"]
  }
}
```

## 6. Ask for a conformance check

Send the hub one signed `hub.check@1`. Only your game can ask for its own check: the hub fetches your descriptor from your domain and answers only a request signed with a key it lists. It doesn't matter what your game is built with, because the hub only talks to it over HTTPS, exactly as it does in normal use.

```json
{
  "sgip": "0.1",
  "id": "01JA2B3C4D5E6F7G8H9J0K1M2N",
  "op": "hub.check@1",
  "from": { "platform": "yourgame.example" },
  "to": { "platform": "sgip-hub" },
  "payload": {}
}
```

The hub then sends your inbox signed, unsigned, stale, replayed and malformed requests, looks up and messages a player who doesn't exist, loads your visit page, and grades every reply against the schemas. The reply lists each check with whether it passed and why, so you know what to fix (spec section 9.1). Your inbox must trust the hub's key, which it looks up at `/.well-known/sgip-hub.json`.

When `conforms` is `true`, you're ready to join the network.

## 7. Welcome visitors

To take visitors, serve your visit page and list it as `visit` in your descriptor. A visitor arrives with a passport, a short-lived token signed by the hub, in the URL fragment or by `postMessage`, never in the query string. Only take a passport sent by `postMessage` from an origin listed in the hub's directory (`platform.directory@1`). Check it offline with the hub's public key: the signature, that `aud` is you, and that it hasn't expired. Then start a guest session keyed on `sub@home`.

When they leave, send `visit.end@1` to their home game through the hub, with how long they stayed and how their stats moved. If the visit ran in an iframe, post `{ type: "sgip.exit" }` to the parent frame; if it ran in a tab of its own, end with a link back to their game's `return_url` from the directory (spec section 7.3).

To get reports when your own players come home from other games, add `visit.end@1` to your capabilities and answer it.

## 8. Speak the shared vocabulary

Describe your world in your own words, and send a shared word alongside: a verb for each activity, a kind for each place, a mode for each journey. A danfo or a keke in Lagos and a U-Bahn ride in Berlin all mean something to every game. Browse the [vocabulary](vocabulary.html); if a word you need is missing, [propose it](contribute.html).
