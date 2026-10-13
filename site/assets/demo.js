// The demo: two tiny games and a hub, all in this page, speaking SGIP to each other.
// Maple Bay (dollars) is Sam's home; Lindenfeld (euros) is where Mira lives.
(() => {
    const root = document.querySelector('.pg');

    if (!root) {
        return;
    }

    const canvas = root.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const W = 960;
    const H = 400;
    const FEET = 296;

    // --- The cast -------------------------------------------------------------------------

    const HUB = 'sgip-hub';
    const HOME = {
        id: 'maplebay.example',
        name: 'Maple Bay',
        icon: '⚓',
        currency: 'USD',
        places: [
            { id: 'diner', label: "Rosie's Diner", x: 170, w: 190, color: '#e9725c', roof: '#b9473a' },
            { id: 'park', label: 'Harbour Park', x: 470, w: 170, park: true },
            { id: 'gate', label: 'Travel Gate', x: 790, w: 170, color: '#5b6fd6', roof: '#3a4aa8' },
        ],
    };
    const HOST = {
        id: 'lindenfeld.example',
        name: 'Lindenfeld',
        icon: '🥨',
        currency: 'EUR',
        places: [
            { id: 'bakery', label: 'Linden Bakery', x: 170, w: 180, color: '#f2c14e', roof: '#9c4a2f' },
            { id: 'museum', label: 'Clock Museum', x: 420, w: 190, color: '#d9cbb3', roof: '#6b5a4a' },
            { id: 'mira', label: 'Mira', x: 640, w: 60, person: true },
            { id: 'station', label: 'Station', x: 830, w: 170, color: '#8aa6a3', roof: '#3f5653' },
        ],
    };
    // The hub's rates (section 7.4). 115 US cents buy 100 euro cents; the gap both ways makes round trips lose.
    const RATES = [
        { give: { amount: 115, currency: 'USD' }, get: { amount: 100, currency: 'EUR' } },
        { give: { amount: 100, currency: 'EUR' }, get: { amount: 105, currency: 'USD' } },
    ];
    const DAILY_LIMIT = { amount: 5000, currency: 'USD' };
    const MIRA = {
        player: 'mira@lindenfeld.example',
        name: 'Mira',
        pronouns: 'she',
        look: { body: 'feminine', skin: '#c68642', hair: { style: 'long', color: '#2b1b12' }, outfit: { style: 'casual', top: '#2b5fd9', bottom: '#33363d' } },
    };

    const fresh = () => ({
        world: 'home',
        busy: false,
        done: new Set(),
        player: { x: 90, target: null, facing: 1, phase: 0 },
        sam: {
            handle: 'sam',
            name: 'Sam',
            pronouns: 'they',
            look: { body: 'feminine', skin: '#8d5524', hair: { style: 'short', color: '#1b1b1b' }, outfit: { style: 'casual', top: '#14936a', bottom: '#2f3542' } },
        },
        sub: ulid(),
        balance: 4000,
        stats: { mood: 50, hunger: 40 },
        visit: null,
        bubble: null,
        transition: null,
    });

    // --- Helpers ----------------------------------------------------------------------------

    const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    function ulid() {
        let out = '';

        for (let i = 0, t = Date.now(); i < 10; i++, t = Math.floor(t / 32)) {
            out = CROCKFORD[t % 32] + out;
        }

        for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
            out += CROCKFORD[byte % 32];
        }

        return out;
    }

    const money = ({ amount, currency }) => `${currency === 'EUR' ? '€' : '$'}${(amount / 100).toFixed(2)}`;
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const json = (value) => JSON.stringify(value, null, 2);
    const handle = () => `${state.sam.handle}@${HOME.id}`;
    const display = () => ({ name: state.sam.name, color: state.sam.look.outfit.top, pronouns: state.sam.pronouns, look: state.sam.look });

    // --- Real Ed25519, from WebCrypto where the browser has it ---------------------------------

    const enc = new TextEncoder();
    const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
    const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const unb64url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));

    async function makeKey() {
        try {
            const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
            const pub = b64(await crypto.subtle.exportKey('raw', pair.publicKey));

            return { ...pair, pub, keyId: (await sha256(pub)).slice(0, 16) };
        } catch {
            return null;
        }
    }

    const sign = async (key, bytes) => (key ? crypto.subtle.sign({ name: 'Ed25519' }, key.privateKey, bytes) : null);

    /** The SGIP-Signature header for one request (section 6). */
    async function signature(key, path, body) {
        const ts = Math.floor(Date.now() / 1000);
        const nonce = ulid();
        const base = ['POST', path, ts, nonce, await sha256(body)].join('\n');
        const sig = await sign(key, enc.encode(base));

        return `SGIP-Signature: keyId=${key?.keyId ?? 'none'},ts=${ts},nonce=${nonce},sig=${sig ? b64(sig) : '(this browser cannot sign with Ed25519)'}`;
    }

    async function passport(claims) {
        const header = b64url(enc.encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: keys.hub?.keyId ?? 'none' })));
        const body = b64url(enc.encode(JSON.stringify(claims)));
        const sig = await sign(keys.hub, enc.encode(`${header}.${body}`));

        return `${header}.${body}.${sig ? b64url(sig) : 'unsigned'}`;
    }

    /** What the host does before letting anyone in (section 7.1). */
    async function checkPassport(token) {
        const [header, body, sig] = token.split('.');
        const claims = JSON.parse(new TextDecoder().decode(unb64url(body)));
        const signed = keys.hub
            ? await crypto.subtle.verify({ name: 'Ed25519' }, keys.hub.publicKey, unb64url(sig), enc.encode(`${header}.${body}`))
            : null;

        return { claims, signed, audience: claims.aud === HOST.id, fresh: claims.exp > Date.now() / 1000 };
    }

    const keys = {};

    // --- The wire: every op is logged and animated -------------------------------------------

    const log = root.querySelector('.pg-log');
    const wire = root.querySelector('.pg-wire');
    const NODES = { [HOME.id]: 50, [HUB]: 200, [HOST.id]: 350 };
    const OPS = 'operations.html#';

    async function packet(from, to, colour) {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('r', '6');
        dot.setAttribute('cy', '38');
        dot.setAttribute('class', colour);
        wire.appendChild(dot);

        const start = performance.now();
        const ms = 520;

        await new Promise((resolve) => {
            const step = (now) => {
                const p = Math.min(1, (now - start) / ms);
                const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
                dot.setAttribute('cx', String(NODES[from] + (NODES[to] - NODES[from]) * e));
                p < 1 ? requestAnimationFrame(step) : resolve();
            };
            requestAnimationFrame(step);
        });

        dot.remove();
    }

    function entry({ op, kind = 'op', route, text, blocks = [], error = false }) {
        const item = document.createElement('li');
        item.className = `pg-entry ${kind}${error ? ' error' : ''}`;
        const title = kind === 'op' ? `<a href="${OPS}${op.replace(/[^a-z0-9]/g, '')}"><code>${escape(op)}</code></a>` : `<b>${escape(op)}</b>`;
        const shown = blocks
            .map(([label, body]) => `<figure class="code"><figcaption>${escape(label)}</figcaption><pre><code>${escape(body)}</code></pre></figure>`)
            .join('');

        item.innerHTML = `<p class="pg-entry-head">${title}${route ? `<span class="pg-route">${route.map(escape).join(' <i>→</i> ')}</span>` : ''}</p>
<p>${text}</p>${shown ? `<details><summary>Show what was sent</summary>${shown}</details>` : ''}`;
        log.prepend(item);
    }

    /** One operation, sent the way SGIP sends it: signed to the hub, and on from the hub signed again. */
    async function call({ op, from, to, payload, result, text, error = null }) {
        const envelope = { sgip: '0.1', id: ulid(), op, from, to, reply_to: null, payload };
        const body = JSON.stringify(envelope);
        const reply = error ? { ok: false, id: envelope.id, error } : { ok: true, id: envelope.id, result };
        const blocks = [[`${from.platform} → hub: POST /ops`, `${await signature(keys[from.platform], '/ops', body)}\n\n${json(envelope)}`]];
        const route = [from.platform, 'hub'];

        await packet(from.platform, HUB, 'out');

        if (to.platform !== HUB) {
            blocks.push([`hub → ${to.platform}: POST /sgip/inbox`, `${await signature(keys.hub, '/sgip/inbox', body)}\n\n(the same envelope)`]);
            route.push(to.platform);
            await packet(HUB, to.platform, 'out');
            await packet(to.platform, HUB, 'back');
        }

        await packet(HUB, from.platform, error ? 'bad' : 'back');
        blocks.push(['Reply', json(reply)]);
        entry({ op, route, text, blocks, error: Boolean(error) });

        return reply;
    }

    /** The hub asks a game something on its own behalf (wallet.read@1, wallet.debit@1). */
    async function hubAsks({ op, to, payload, result, text }) {
        const envelope = { sgip: '0.1', id: ulid(), op, from: { platform: HUB }, to: { platform: to, player: payload.player }, reply_to: null, payload };
        const body = JSON.stringify(envelope);

        await packet(HUB, to, 'out');
        await packet(to, HUB, 'back');
        entry({
            op,
            route: ['hub', to],
            text,
            blocks: [
                [`hub → ${to}: POST /sgip/inbox`, `${await signature(keys.hub, '/sgip/inbox', body)}\n\n${json(envelope)}`],
                ['Reply', json({ ok: true, id: envelope.id, result })],
            ],
        });
    }

    const local = (title, text) => entry({ op: title, kind: 'local', text });

    // --- What the player can do --------------------------------------------------------------

    function done(step) {
        state.done.add(step);
        renderSteps();
    }

    function say(who, text, ms = 3600) {
        state.bubble = { who, text, until: performance.now() + ms };
    }

    const busy = async (work) => {
        if (state.busy) {
            return;
        }

        state.busy = true;
        renderActions();

        try {
            await work();
        } finally {
            state.busy = false;
            renderActions(true);
            renderHud();
        }
    };

    function changeStats(changes) {
        for (const [stat, by] of Object.entries(changes)) {
            if (state.visit) {
                state.visit.souvenirs[stat] = (state.visit.souvenirs[stat] ?? 0) + by;
            } else {
                state.stats[stat] = clamp(state.stats[stat] + by, 0, 100);
            }
        }
    }

    const pancakes = () =>
        busy(async () => {
            if (state.balance < 850) {
                say('Rosie', "You're a bit short today, hon.");
                return;
            }

            state.balance -= 850;
            changeStats({ hunger: 25, mood: 5 });
            say('Sam', 'Best pancakes in the bay.');
            local('Local: pancakes at Rosie\'s', "Sam paid $8.50 in Maple Bay's own money. Nothing crossed to another game, so nothing went over SGIP: a game's own world is its own business.");
            done('walk');
        });

    const relax = () =>
        busy(async () => {
            changeStats({ mood: 8 });
            say('Sam', 'The sea is calm today.');
            local('Local: a rest in the park', 'Resting in the park only changes Sam in Maple Bay. SGIP carries only what crosses between games.');
            done('walk');
        });

    const message = () =>
        busy(async () => {
            await call({
                op: 'message.send@1',
                from: { platform: HOME.id, player: handle() },
                to: { platform: HOST.id, player: MIRA.player },
                payload: { text: 'Hi Mira! Is Lindenfeld nice this time of year?', from_name: state.sam.name, lang: 'en' },
                result: { delivered: true },
                text: "Maple Bay signs the envelope with its own key and posts it to the hub. The hub checks the signature, signs it again with the hub's key and delivers it to Lindenfeld's inbox. The two games never call each other.",
            });
            done('message');
            await sleep(700);
            await call({
                op: 'message.send@1',
                from: { platform: HOST.id, player: MIRA.player },
                to: { platform: HOME.id, player: handle() },
                payload: { text: 'Come and see! The bakery does the best pretzels.', from_name: MIRA.name, lang: 'en' },
                result: { delivered: true },
                text: "Mira answers from Lindenfeld. The same op runs the other way: Lindenfeld signs, the hub checks and forwards, Maple Bay shows the message in its own chat.",
            });
            say('Mira', 'Come and see! The bakery does the best pretzels.', 5000);
        });

    const lookup = () =>
        busy(async () => {
            await call({
                op: 'player.lookup@1',
                from: { platform: HOME.id, player: handle() },
                to: { platform: HOST.id },
                payload: { player: MIRA.player },
                result: { player: MIRA.player, sub: '01JA00000000000000000000MR', display_name: MIRA.name, pronouns: MIRA.pronouns, look: MIRA.look, badges: ['Local guide'] },
                text: "Mira chose to be discoverable, so Lindenfeld answers with her public profile: her name, pronouns and look, in shared words any game can draw. A player who hasn't opted in comes back as <code>not_found</code>.",
            });
            showProfile();
            done('lookup');
        });

    let directory = null;

    const plan = () =>
        busy(async () => {
            directory = {
                platforms: [
                    {
                        platform_id: HOST.id,
                        name: HOST.name,
                        icon: HOST.icon,
                        capabilities: ['hub.ping@1', 'player.lookup@1', 'message.send@1'],
                        visit_url: `https://${HOST.id}/sgip/visit`,
                        origin: `https://${HOST.id}`,
                        embed: { allowed: true },
                        currencies: ['EUR'],
                        accepts: [{ from: HOME.id, daily_inflow_limit: { amount: 50000, currency: 'EUR' } }],
                        visitors_welcome: true,
                    },
                ],
                rates: RATES,
            };
            await call({
                op: 'platform.directory@1',
                from: { platform: HOME.id },
                to: { platform: HUB },
                payload: {},
                result: directory,
                text: "Maple Bay asks the hub which games it can send players to. Lindenfeld takes visitors, uses euros and accepts money from Maple Bay. It set no rate of its own, so the hub's rate applies: $1.15 buys €1.00.",
            });
            done('directory');
            root.querySelector('.pg-trip').hidden = false;
            root.querySelector('.pg-trip').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });

    const travel = (budget) =>
        busy(async () => {
            root.querySelector('.pg-trip').hidden = true;
            const visitId = ulid();
            const iat = Math.floor(Date.now() / 1000);
            const claims = {
                iss: HUB,
                sub: state.sub,
                player: handle(),
                home: HOME.id,
                aud: HOST.id,
                visit_id: visitId,
                jti: ulid(),
                scopes: ['visit', 'chat', 'act', 'pay'],
                display: display(),
                arrival: `place://${HOST.id}/old-town/station`,
                budget: { amount: budget, currency: 'USD' },
                iat,
                exp: iat + 900,
            };
            const token = await passport(claims);

            await call({
                op: 'visit.request@1',
                from: { platform: HOME.id, player: handle() },
                to: { platform: HUB },
                payload: { player: handle(), sub: state.sub, host: HOST.id, scopes: claims.scopes, display: claims.display, budget: claims.budget },
                result: { visit_id: visitId, passport: token, launch_url: `https://${HOST.id}/sgip/visit`, host_origin: `https://${HOST.id}`, host_name: HOST.name, expires_at: claims.exp, embed: { allowed: true } },
                text: `Maple Bay asks the hub for a passport: who Sam is, how they look, what they may do in Lindenfeld (<code>visit</code>, <code>chat</code>, <code>act</code>, <code>pay</code>) and a trip budget of ${money(claims.budget)}. The hub signs it with its key. It lasts 15 minutes and Maple Bay refreshes it while Sam is away.`,
            });

            entry({
                op: 'Browser: passport handed over',
                kind: 'browser',
                text: "Maple Bay opens Lindenfeld's visit page in a frame and passes the passport with <code>postMessage</code>. It never goes in a URL query string, where servers and proxies would log it.",
                blocks: [['postMessage to https://lindenfeld.example', json({ type: 'sgip.passport', token })]],
            });

            const check = await checkPassport(token);
            const verdict = check.signed === null ? 'skipped (this browser has no Ed25519)' : check.signed ? 'valid' : 'INVALID';
            entry({
                op: 'Lindenfeld checks the passport',
                kind: 'local',
                text: `Lindenfeld checks the passport offline with the hub's public key, before it creates a guest: signature <b>${verdict}</b>, addressed to <code>${escape(check.claims.aud)}</code>, ${check.fresh ? 'not expired' : 'expired'}. Then it draws Sam from <code>display.look</code>, in Sam's own colours.`,
                blocks: [['Passport claims, decoded', json(check.claims)]],
            });

            await crossTo('host', () => {
                state.visit = { id: visitId, budget: claims.budget, spent: 0, souvenirs: {}, started: Date.now(), activities: {} };
            });
            done('travel');
            await sleep(300);
            await balance();
            say('Mira', `${state.sam.name}! You made it. Welcome to Lindenfeld.`, 4200);
        });

    /** What the visitor can spend, in the host's currency (section 7.4). */
    function spendable() {
        const left = Math.min(state.balance, state.visit.budget.amount - state.visit.spent, DAILY_LIMIT.amount - state.visit.spent);
        const rate = RATES[0];

        return { home: left, host: Math.floor((Math.max(0, left) * rate.get.amount) / rate.give.amount) };
    }

    async function balance() {
        const can = spendable();

        await call({
            op: 'wallet.balance@1',
            from: { platform: HOST.id },
            to: { platform: HUB },
            payload: { player: handle(), visit_id: state.visit.id },
            result: { spendable: [{ amount: can.host, currency: 'EUR' }] },
            text: `Lindenfeld asks what Sam can spend. The hub takes the lowest of Sam's balance, what is left of the trip budget and the daily limit, then converts it at its rate, rounding down: ${money({ amount: can.home, currency: 'USD' })} × 100 ÷ 115 = ${money({ amount: can.host, currency: 'EUR' })}. Lindenfeld never learns Sam's balance.`,
        });
        await hubAsks({
            op: 'wallet.read@1',
            to: HOME.id,
            payload: { player: handle(), currency: 'USD' },
            result: { balance: { amount: state.balance, currency: 'USD' } },
            text: "To answer, the hub asked Maple Bay for Sam's balance. Only the hub sees it.",
        });
    }

    const buy = (item) =>
        busy(async () => {
            const rate = RATES[0];
            const debit = Math.ceil((item.price * rate.give.amount) / rate.get.amount);
            const can = spendable();
            const charge = { player: handle(), visit_id: state.visit.id, amount: { amount: item.price, currency: 'EUR' }, description: item.label, verb: item.verb };

            if (debit > can.home) {
                await call({
                    op: 'wallet.charge@1',
                    from: { platform: HOST.id },
                    to: { platform: HUB },
                    payload: charge,
                    error: { code: 'limit_reached', message: 'The charge would pass the trip budget', retryable: false },
                    text: `${item.label} costs ${money(charge.amount)}, which would be ${money({ amount: debit, currency: 'USD' })} from home: more than is left of Sam's trip budget. The hub refuses with <code>limit_reached</code> and Maple Bay is never asked.`,
                });
                say('Sam', "That's over my trip budget.");
                return;
            }

            const id = ulid();
            await call({
                op: 'wallet.charge@1',
                from: { platform: HOST.id },
                to: { platform: HUB },
                payload: charge,
                result: { charge_id: id, charged: charge.amount, debited: { amount: debit, currency: 'USD' }, spendable: [{ amount: Math.floor(((can.home - debit) * rate.get.amount) / rate.give.amount), currency: 'EUR' }] },
                text: `Sam buys ${item.label.toLowerCase()} for ${money(charge.amount)}. Lindenfeld charges through the hub, which converts at its rate and rounds up, so nothing is ever free: ${money(charge.amount)} × 115 ÷ 100 = ${money({ amount: debit, currency: 'USD' })}.`,
            });
            state.balance -= debit;
            state.visit.spent += debit;
            await hubAsks({
                op: 'wallet.debit@1',
                to: HOME.id,
                payload: { charge_id: id, player: handle(), amount: { amount: debit, currency: 'USD' }, host: HOST.id, host_amount: charge.amount, description: item.label },
                result: { balance: { amount: state.balance, currency: 'USD' } },
                text: `The hub tells Maple Bay to take ${money({ amount: debit, currency: 'USD' })} from Sam. Maple Bay takes it only if Sam has it, in one step. The money stays in Maple Bay: Lindenfeld pays its own sellers in euros.`,
            });
            changeStats(item.effects);
            state.visit.activities[item.verb] = (state.visit.activities[item.verb] ?? 0) + 1;
            say('Sam', item.line);
            done('spend');
        });

    const chat = () =>
        busy(async () => {
            changeStats({ mood: 6 });
            state.visit.activities.talk = (state.visit.activities.talk ?? 0) + 1;
            say('Mira', 'Try the museum. The big clock still runs on a weight from 1802!', 4200);
            local('Local: talking with Mira', "Sam and Mira are both in Lindenfeld now, so their chat is Lindenfeld's own business. The passport's <code>chat</code> scope is what let Sam take part.");
        });

    const goHome = () =>
        busy(async () => {
            const souvenirs = Object.fromEntries(Object.entries(state.visit.souvenirs).filter(([, v]) => v));
            const capped = Object.fromEntries(Object.entries(souvenirs).map(([k, v]) => [k, clamp(v, -20, 20)]));
            const activities = Object.entries(state.visit.activities).map(([verb, count]) => ({ verb, count }));

            await call({
                op: 'visit.end@1',
                from: { platform: HOST.id },
                to: { platform: HOME.id },
                payload: { visit_id: state.visit.id, player: handle(), reason: 'left', duration_s: Math.round((Date.now() - state.visit.started) / 1000), souvenirs, last_place: `place://${HOST.id}/old-town/station`, activities },
                result: { returned: true },
                text: `Sam leaves from the station. Lindenfeld tells Maple Bay, through the hub, how Sam's stats moved on the trip (the souvenirs). Maple Bay caps each change at ±20 and decides what to accept${Object.keys(souvenirs).length ? `: ${Object.entries(capped).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ')}` : ''}.`,
            });
            await crossTo('home', () => {
                state.visit = null;

                for (const [stat, by] of Object.entries(capped)) {
                    state.stats[stat] = clamp(state.stats[stat] + by, 0, 100);
                }

                state.player.x = HOME.places[2].x;
            });
            done('home');
            say('Sam', 'Home again. Lindenfeld was lovely.');
        });

    // --- Drawing ----------------------------------------------------------------------------

    function person(x, look, { phase = 0, facing = 1, label = null, scale = 1, c = ctx } = {}) {
        const swing = Math.sin(phase) * 7 * scale;
        const y = FEET;

        c.save();
        c.translate(x, y);
        c.scale(scale * facing, scale);
        c.lineCap = 'round';

        // Legs, then arms behind the body.
        c.strokeStyle = look.outfit.bottom;
        c.lineWidth = 7;
        c.beginPath();
        c.moveTo(-4, -26);
        c.lineTo(-4 + swing, 0);
        c.moveTo(4, -26);
        c.lineTo(4 - swing, 0);
        c.stroke();
        c.strokeStyle = look.skin;
        c.lineWidth = 5;
        c.beginPath();
        c.moveTo(0, -46);
        c.lineTo(-swing * 0.8, -26);
        c.stroke();

        c.fillStyle = look.outfit.top;
        c.beginPath();
        c.roundRect(-11, -50, 22, 28, 8);
        c.fill();

        c.beginPath();
        c.moveTo(0, -46);
        c.lineTo(swing * 0.8, -26);
        c.stroke();

        // Head and hair.
        const hair = look.hair ?? {};
        c.fillStyle = hair.color ?? '#222';

        if (hair.style === 'afro') {
            c.beginPath();
            c.arc(0, -62, 15, 0, Math.PI * 2);
            c.fill();
        }

        if (hair.style === 'long') {
            c.beginPath();
            c.roundRect(-11, -70, 22, 30, 7);
            c.fill();
        }

        c.fillStyle = look.skin;
        c.beginPath();
        c.arc(0, -60, 10, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = hair.color ?? '#222';

        if (['short', 'long', 'bun', 'ponytail'].includes(hair.style)) {
            c.beginPath();
            c.arc(0, -61, 10.5, Math.PI * 1.02, Math.PI * 1.98);
            c.closePath();
            c.fill();
        }

        if (hair.style === 'ponytail') {
            c.beginPath();
            c.roundRect(-15, -66, 6, 16, 3);
            c.fill();
        }

        if (hair.style === 'bun') {
            c.beginPath();
            c.arc(-3, -73, 5.5, 0, Math.PI * 2);
            c.fill();
        }

        c.fillStyle = '#1a1a1a';
        c.beginPath();
        c.arc(4.5, -61, 1.4, 0, Math.PI * 2);
        c.fill();
        c.restore();

        if (label) {
            c.font = '600 12px ui-sans-serif, system-ui, sans-serif';
            const w = c.measureText(label).width + 12;
            c.fillStyle = 'rgba(20, 23, 28, 0.72)';
            c.beginPath();
            c.roundRect(x - w / 2, y - 96 * scale, w, 18, 9);
            c.fill();
            c.fillStyle = '#fff';
            c.textAlign = 'center';
            c.fillText(label, x, y - 83 * scale);
        }
    }

    function building(p, theme, near) {
        const left = p.x - p.w / 2;
        const top = 120;

        if (p.park) {
            ctx.fillStyle = '#6fbf73';
            ctx.fillRect(left, 236, p.w, 14);

            for (const dx of [-55, 0, 55]) {
                ctx.fillStyle = '#7a5235';
                ctx.fillRect(p.x + dx - 4, 196, 8, 44);
                ctx.fillStyle = dx ? '#4e9a52' : '#3f8a44';
                ctx.beginPath();
                ctx.arc(p.x + dx, 186, 26, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.fillStyle = '#8a5a3b';
            ctx.fillRect(p.x - 30, 228, 60, 6);
        } else if (p.person) {
            return;
        } else {
            ctx.fillStyle = p.color;
            ctx.fillRect(left, top, p.w, 130);
            ctx.fillStyle = p.roof;

            if (theme === 'host') {
                ctx.beginPath();
                ctx.moveTo(left - 8, top);
                ctx.lineTo(p.x, top - 56);
                ctx.lineTo(left + p.w + 8, top);
                ctx.fill();
            } else {
                ctx.fillRect(left - 8, top - 14, p.w + 16, 16);
            }

            ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';

            for (const dx of [-p.w / 3, p.w / 3]) {
                ctx.fillRect(p.x + dx - 18, top + 30, 36, 30);
            }

            ctx.fillStyle = 'rgba(30, 30, 40, 0.75)';
            ctx.fillRect(p.x - 17, top + 74, 34, 56);

            if (p.id === 'gate') {
                ctx.strokeStyle = '#ffd36e';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.ellipse(p.x, top + 98, 22, 30, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // Sign.
        ctx.font = '700 13px ui-sans-serif, system-ui, sans-serif';
        const w = ctx.measureText(p.label).width + 18;
        ctx.fillStyle = near ? '#ffd36e' : '#fffaf0';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(p.x - w / 2, p.park ? 140 : top + 8, w, 22, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#1d1d1f';
        ctx.textAlign = 'center';
        ctx.fillText(p.label, p.x, (p.park ? 140 : top + 8) + 15.5);
    }

    const walkers = {
        home: [
            { x: 300, dir: 1, speed: 38, phase: 0, look: { skin: '#f1c27d', hair: { style: 'bun', color: '#a0522d' }, outfit: { top: '#f4a259', bottom: '#5c6b73' } } },
            { x: 650, dir: -1, speed: 30, phase: 1, look: { skin: '#5a3825', hair: { style: 'afro', color: '#111' }, outfit: { top: '#e9e4d8', bottom: '#3d405b' } } },
        ],
        host: [
            { x: 260, dir: -1, speed: 34, phase: 0, look: { skin: '#e0ac69', hair: { style: 'short', color: '#704214' }, outfit: { top: '#9b2335', bottom: '#2f2f2f' } } },
            { x: 760, dir: 1, speed: 28, phase: 2, look: { skin: '#ffdbac', hair: { style: 'ponytail', color: '#d4a017' }, outfit: { top: '#5f9ea0', bottom: '#444' } } },
        ],
    };
    const cars = [
        { x: -100, lane: 344, speed: 120, color: '#e63946' },
        { x: 500, lane: 378, speed: -95, color: '#f1faee' },
    ];

    function scene(world, t) {
        const host = world === 'host';
        const sky = ctx.createLinearGradient(0, 0, 0, 250);
        sky.addColorStop(0, host ? '#a9c9e8' : '#7cc6f0');
        sky.addColorStop(1, host ? '#eef3f6' : '#ffe7c4');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, 250);

        if (host) {
            ctx.fillStyle = '#a7c4a0';
            ctx.beginPath();
            ctx.moveTo(0, 210);
            ctx.quadraticCurveTo(240, 120, 480, 200);
            ctx.quadraticCurveTo(720, 130, 960, 205);
            ctx.lineTo(960, 250);
            ctx.lineTo(0, 250);
            ctx.fill();
        } else {
            ctx.fillStyle = '#3d9cc7';
            ctx.fillRect(0, 196, W, 54);
            const bob = Math.sin(t / 700) * 2;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(600, 200 + bob);
            ctx.lineTo(600, 168 + bob);
            ctx.lineTo(624, 198 + bob);
            ctx.fill();
            ctx.fillStyle = '#8a4b2a';
            ctx.fillRect(584, 200 + bob, 52, 8);
        }

        // Sun.
        ctx.fillStyle = host ? 'rgba(255, 255, 255, 0.9)' : '#ffd36e';
        ctx.beginPath();
        ctx.arc(host ? 120 : 880, 60, 26, 0, Math.PI * 2);
        ctx.fill();

        const places = host ? HOST.places : HOME.places;
        const near = nearby();

        for (const p of places) {
            building(p, world, near === p);
        }

        if (host) {
            // Fountain beside Mira, and linden trees.
            ctx.fillStyle = '#b8b2a7';
            ctx.fillRect(700, 236, 60, 14);
            ctx.fillStyle = '#7fb8d6';
            ctx.fillRect(724, 214 + Math.sin(t / 300) * 2, 12, 22);

            for (const x of [30, 300, 560, 950]) {
                ctx.fillStyle = '#6d4c33';
                ctx.fillRect(x - 4, 200, 8, 50);
                ctx.fillStyle = '#5d9c59';
                ctx.beginPath();
                ctx.arc(x, 190, 22, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Pavement, kerb, road.
        ctx.fillStyle = host ? '#d3cabb' : '#ddd6c6';
        ctx.fillRect(0, 250, W, 60);

        if (host) {
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.07)';
            ctx.lineWidth = 1;

            for (let x = 0; x < W; x += 24) {
                ctx.beginPath();
                ctx.moveTo(x, 250);
                ctx.lineTo(x, 310);
                ctx.stroke();
            }
        }

        ctx.fillStyle = '#a9a294';
        ctx.fillRect(0, 308, W, 6);
        ctx.fillStyle = '#4a4e57';
        ctx.fillRect(0, 314, W, 86);
        ctx.fillStyle = '#f2f2f2';

        for (let x = 0; x < W; x += 60) {
            ctx.fillRect(x + 10, 359, 30, 4);
        }

        for (const car of cars) {
            ctx.fillStyle = car.color;
            ctx.beginPath();
            ctx.roundRect(car.x, car.lane - 18, 70, 20, 6);
            ctx.roundRect(car.x + 14, car.lane - 32, 40, 16, 6);
            ctx.fill();
            ctx.fillStyle = 'rgba(180, 220, 255, 0.9)';
            ctx.fillRect(car.x + 20, car.lane - 29, 13, 10);
            ctx.fillRect(car.x + 36, car.lane - 29, 13, 10);
            ctx.fillStyle = '#111';
            ctx.beginPath();
            ctx.arc(car.x + 16, car.lane + 2, 7, 0, Math.PI * 2);
            ctx.arc(car.x + 54, car.lane + 2, 7, 0, Math.PI * 2);
            ctx.fill();
        }

        for (const w of walkers[world]) {
            person(w.x, w.look, { phase: w.phase, facing: w.dir, scale: 0.92 });
        }

        if (host) {
            person(640, MIRA.look, { phase: 0, facing: -1, label: 'Mira' });
        }

        const pl = state.player;
        person(pl.x, state.sam.look, { phase: pl.phase, facing: pl.facing, label: state.sam.name || 'Sam' });

        if (state.bubble && performance.now() < state.bubble.until) {
            const who = state.bubble.who;
            const x = who === 'Mira' ? 640 : who === 'Sam' ? pl.x : 170;
            bubble(x, `${who}: ${state.bubble.text}`);
        }
    }

    function bubble(x, text) {
        ctx.font = '500 13.5px ui-sans-serif, system-ui, sans-serif';
        const w = Math.min(380, ctx.measureText(text).width + 24);
        const left = clamp(x - w / 2, 8, W - w - 8);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
        ctx.beginPath();
        ctx.roundRect(left, 166, w, 30, 10);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#1d1d1f';
        ctx.textAlign = 'left';
        ctx.fillText(text, left + 12, 186, w - 24);
    }

    function frame(now) {
        const dt = Math.min(0.05, (now - (frame.last ?? now)) / 1000);
        frame.last = now;
        update(dt);

        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, W, H);
        scene(state.world, now);

        const tr = state.transition;

        if (tr) {
            const p = Math.min(1, (now - tr.start) / 1800);
            const cover = p < 0.5 ? p * 2 : (1 - p) * 2;

            if (p >= 0.5 && !tr.swapped) {
                tr.swapped = true;
                tr.swap();
            }

            ctx.fillStyle = `rgba(12, 15, 19, ${Math.min(1, cover * 1.15)})`;
            ctx.fillRect(0, 0, W, H);
            ctx.strokeStyle = `rgba(62, 207, 142, ${cover})`;
            ctx.lineWidth = 4;

            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.arc(W / 2, H / 2 - 20, 30 + i * 22 + ((now / 12) % 22), 0, Math.PI * 2);
                ctx.stroke();
            }

            ctx.fillStyle = `rgba(255, 255, 255, ${cover})`;
            ctx.font = '700 20px ui-sans-serif, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(tr.label, W / 2, H / 2 + 80);

            if (p >= 1) {
                state.transition = null;
                tr.resolve();
            }
        }

        requestAnimationFrame(frame);
    }

    function crossTo(world, swap) {
        const label = world === 'host' ? `Crossing to ${HOST.id}` : `Back home to ${HOME.id}`;

        return new Promise((resolve) => {
            state.transition = {
                start: performance.now(),
                label,
                resolve,
                swap: () => {
                    state.world = world;
                    state.player.target = null;
                    state.player.x = world === 'host' ? HOST.places[3].x : state.player.x;
                    swap();
                    renderHud();
                    renderActions(true);
                },
            };
        });
    }

    // --- Movement ---------------------------------------------------------------------------

    const held = { left: false, right: false };

    function update(dt) {
        const pl = state.player;
        let dir = (held.right ? 1 : 0) - (held.left ? 1 : 0);

        if (dir) {
            pl.target = null;
        } else if (pl.target !== null) {
            const gap = pl.target - pl.x;
            dir = Math.abs(gap) < 3 ? 0 : Math.sign(gap);

            if (!dir) {
                pl.target = null;
            }
        }

        if (dir && !state.transition) {
            pl.x = clamp(pl.x + dir * 190 * dt, 24, W - 24);
            pl.facing = dir;
            pl.phase += dt * 11;
        } else {
            pl.phase = 0;
        }

        for (const w of walkers[state.world]) {
            w.x += w.dir * w.speed * dt;
            w.phase += dt * 7;

            if (w.x < 30 || w.x > W - 30) {
                w.dir *= -1;
            }
        }

        for (const car of cars) {
            car.x += car.speed * dt;

            if (car.speed > 0 && car.x > W + 80) {
                car.x = -160;
            }

            if (car.speed < 0 && car.x < -160) {
                car.x = W + 80;
            }
        }

        const near = nearby();

        if (near !== update.near) {
            update.near = near;
            renderActions(true);
        }
    }

    function nearby() {
        const places = state.world === 'host' ? HOST.places : HOME.places;

        return places.find((p) => Math.abs(p.x - state.player.x) < Math.max(50, p.w / 2 - 10)) ?? null;
    }

    canvas.addEventListener('pointerdown', (event) => {
        const rect = canvas.getBoundingClientRect();
        state.player.target = clamp(((event.clientX - rect.left) / rect.width) * W, 24, W - 24);
        canvas.focus({ preventScroll: true });
    });

    canvas.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            held[event.key === 'ArrowLeft' ? 'left' : 'right'] = true;
            event.preventDefault();
        }
    });

    canvas.addEventListener('keyup', (event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            held[event.key === 'ArrowLeft' ? 'left' : 'right'] = false;
        }
    });

    canvas.addEventListener('blur', () => {
        held.left = held.right = false;
    });

    // --- Panels -----------------------------------------------------------------------------

    const STEPS = [
        ['walk', 'Look around Maple Bay', 'Walk with ← → or tap the street. Get pancakes at Rosie\'s Diner or rest in the park. Watch the wire: nothing happens, because local things stay local.'],
        ['message', 'Message Mira', 'Mira plays a different game, Lindenfeld. Send her a message and watch it go through the hub.'],
        ['lookup', 'Look Mira up', 'Ask Lindenfeld for her public profile, including how she looks.'],
        ['directory', 'Plan a trip', 'Walk to the Travel Gate and see where Sam can go, and what their dollars are worth there.'],
        ['travel', 'Visit Lindenfeld', 'Pick a trip budget and go. The hub signs a passport, and Lindenfeld draws Sam from it.'],
        ['spend', 'Spend dollars in a euro game', 'Buy a pretzel or a museum ticket. Lindenfeld charges in euros; Maple Bay pays in dollars.'],
        ['home', 'Come home with souvenirs', 'Leave from the station. Lindenfeld reports how the trip changed Sam, and Maple Bay applies it.'],
    ];

    function renderSteps() {
        const current = STEPS.find(([id]) => !state.done.has(id))?.[0];
        root.querySelector('.pg-steps').innerHTML = STEPS.map(
            ([id, title, text], i) =>
                `<li class="${state.done.has(id) ? 'done' : id === current ? 'current' : ''}"><span class="num">${state.done.has(id) ? '✓' : i + 1}</span><div><b>${title}</b>${id === current ? `<p>${text}</p>` : ''}</div></li>`,
        ).join('');
        root.querySelector('.pg-finished').hidden = Boolean(current);
    }

    function renderHud() {
        const hud = root.querySelector('.pg-hud');
        const g = state.world === 'host' ? HOST : HOME;
        const stat = (name) => {
            const extra = state.visit?.souvenirs[name] ?? 0;
            return `<span class="pg-stat"><span>${name}</span><span class="bar"><i style="width:${state.stats[name]}%"></i></span><b>${state.stats[name]}</b>${extra ? `<em>${extra > 0 ? '+' : ''}${extra} on trip</em>` : ''}</span>`;
        };
        const purse = state.visit
            ? `<span class="pg-money">Can spend <b>${money({ amount: spendable().host, currency: 'EUR' })}</b><small>from ${money({ amount: state.balance, currency: 'USD' })} at home</small></span>`
            : `<span class="pg-money">Wallet <b>${money({ amount: state.balance, currency: 'USD' })}</b></span>`;

        hud.innerHTML = `<span class="pg-game"><span aria-hidden="true">${g.icon}</span><b>${g.name}</b><code>${g.id}</code>${state.visit ? '<em>visiting</em>' : ''}</span>${purse}${stat('mood')}${stat('hunger')}`;
    }

    let actionsKey = '';

    function renderActions(force = false) {
        const near = nearby();
        const key = `${state.world}|${near?.id}|${state.busy}|${state.done.size}`;

        if (!force && key === actionsKey) {
            return;
        }

        actionsKey = key;
        const buttons = [];
        const add = (label, run, primary = false) => buttons.push({ label, run, primary });

        if (state.world === 'home') {
            if (near?.id === 'diner') add('Order pancakes · $8.50', pancakes, true);
            if (near?.id === 'park') add('Rest by the water', relax, true);
            if (near?.id === 'gate') add('See where you can go', plan, true);
            add('📱 Message Mira', message);
            add('📱 Look up Mira', lookup);
        } else {
            if (near?.id === 'bakery') add('Buy a pretzel · €3.20', () => buy({ label: 'A pretzel', price: 320, verb: 'eat', effects: { hunger: 20, mood: 4 }, line: 'Warm and salty. Perfect.' }), true);
            if (near?.id === 'museum') add('Museum ticket · €6.00', () => buy({ label: 'A museum ticket', price: 600, verb: 'explore', effects: { mood: 12 }, line: 'So many clocks!' }), true);
            if (near?.id === 'mira') add('Talk to Mira', chat, true);
            if (near?.id === 'station') add('Go home to Maple Bay', goHome, true);
        }

        const places = (state.world === 'host' ? HOST.places : HOME.places).filter((p) => p !== near);
        const bar = root.querySelector('.pg-actions');
        bar.innerHTML = '';

        for (const { label, run, primary } of buttons) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `pg-btn${primary ? ' primary' : ''}`;
            b.textContent = label;
            b.disabled = state.busy || Boolean(state.transition);
            b.addEventListener('click', run);
            bar.appendChild(b);
        }

        const walk = document.createElement('span');
        walk.className = 'pg-walk';
        walk.textContent = 'Walk to';
        bar.appendChild(walk);

        for (const p of places) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'pg-btn ghost';
            b.textContent = p.label;
            b.addEventListener('click', () => {
                state.player.target = p.x;
            });
            bar.appendChild(b);
        }
    }

    function showProfile() {
        const card = root.querySelector('.pg-profile');
        card.hidden = false;
        const mini = card.querySelector('canvas');
        const c = mini.getContext('2d');
        mini.width = 80 * scale;
        mini.height = 90 * scale;
        c.setTransform(scale, 0, 0, scale, 0, 0);
        c.translate(0, -FEET + 84);
        person(40, MIRA.look, { c, scale: 0.95 });
    }

    // The look editor: changes go into the next passport.
    const editor = root.querySelector('.pg-look');

    editor.addEventListener('submit', (event) => event.preventDefault());

    editor.addEventListener('input', (event) => {
        const { name, value } = event.target;
        const look = state.sam.look;

        if (name === 'name') state.sam.name = value.trim().slice(0, 20) || 'Sam';
        if (name === 'skin') look.skin = value;
        if (name === 'hair') look.hair.style = value;
        if (name === 'hair_color') look.hair.color = value;
        if (name === 'top') look.outfit.top = value;
        if (name === 'pronouns') state.sam.pronouns = value;
    });

    root.querySelector('.pg-trip').addEventListener('click', (event) => {
        const amount = Number(event.target.dataset?.budget);

        if (amount) {
            travel(amount);
        }
    });

    root.querySelector('.pg-reset').addEventListener('click', () => {
        state = fresh();
        log.innerHTML = '';
        root.querySelector('.pg-profile').hidden = true;
        root.querySelector('.pg-trip').hidden = true;
        editor.reset();
        start();
    });

    // --- Start ------------------------------------------------------------------------------

    let state = fresh();
    let scale = 1;

    function resize() {
        scale = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = W * scale;
        canvas.height = H * scale;
    }

    async function start() {
        renderSteps();
        renderHud();
        renderActions(true);

        if (!keys.hub) {
            Object.assign(keys, { hub: await makeKey(), [HOME.id]: await makeKey(), [HOST.id]: await makeKey() });
        }

        const descriptor = (game, extra) => ({
            sgip: '0.1',
            platform_id: game.id,
            name: game.name,
            icon: game.icon,
            public_key: keys[game.id]?.pub ?? '(no Ed25519 in this browser)',
            inbox: `https://${game.id}/sgip/inbox`,
            visit: `https://${game.id}/sgip/visit`,
            ...extra,
        });

        entry({
            op: 'Setup: two games and a hub',
            kind: 'setup',
            text: keys.hub
                ? `Your browser just made three real Ed25519 key pairs: one for each game and one for the hub (key id <code>${keys.hub.keyId}</code>). Each game publishes its public key in <code>/.well-known/sgip.json</code> and joins with <code>hub.hello@1</code>.`
                : "This browser can't make Ed25519 keys, so signatures below are placeholders. Everything else is real SGIP.",
            blocks: [
                [
                    `https://${HOME.id}/.well-known/sgip.json`,
                    json(
                        descriptor(HOME, {
                            return: `https://${HOME.id}/welcome-back`,
                            capabilities: ['hub.ping@1', 'player.lookup@1', 'message.send@1', 'visit.end@1', 'wallet.read@1', 'wallet.debit@1', 'wallet.credit@1'],
                            currencies: ['USD'],
                            money: { spending_abroad: { daily_limits: [DAILY_LIMIT] } },
                        }),
                    ),
                ],
                [
                    `https://${HOST.id}/.well-known/sgip.json`,
                    json(
                        descriptor(HOST, {
                            capabilities: ['hub.ping@1', 'player.lookup@1', 'message.send@1'],
                            currencies: ['EUR'],
                            money: { accepts: [{ from: HOME.id, daily_inflow_limit: { amount: 50000, currency: 'EUR' } }] },
                        }),
                    ),
                ],
            ],
        });
    }

    resize();
    window.addEventListener('resize', resize);
    start();
    requestAnimationFrame(frame);
})();
