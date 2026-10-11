// Builds the SGIP website into site/dist from the spec itself, so the site can
// never say something the spec doesn't. Usage: npm run build (or npm run serve).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = join(root, 'spec');
const dist = join(root, 'site/dist');

/** Where the source lives, for "edit this page" and contribution links. */
const REPO = process.env.SGIP_REPO_URL ?? 'https://github.com/sgip-dev/sgip';

const read = (path) => readFileSync(join(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Heading ids the way GitHub makes them, so anchors work on both. */
const slug = (text) =>
    String(text)
        .replace(/<[^>]+>/g, '')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, '')
        .trim()
        .replace(/\s+/g, '-');

// --- Content --------------------------------------------------------------------------

const vocabulary = readdirSync(join(spec, 'vocabulary'))
    .filter((file) => file.endsWith('.json'))
    .map((file) => json(`spec/vocabulary/${file}`));
const DOMAIN_ORDER = ['verbs', 'place-kinds', 'stats', 'transport-modes', 'skills', 'relationships', 'interactions', 'poses', 'career-fields', 'event-kinds', 'game-kinds', 'item-categories', 'pronouns', 'body-types', 'hair-styles', 'headwear', 'outfit-styles', 'patterns'];
vocabulary.sort((a, b) => DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain));
const termCount = vocabulary.reduce((sum, domain) => sum + domain.terms.length, 0);

const ops = readdirSync(join(spec, 'schemas/ops'))
    .filter((file) => file.endsWith('.json'))
    .map((file) => json(`spec/schemas/ops/${file}`));
const common = json('spec/schemas/common.json');
const specText = read('spec/sgip.md');
const version = specText.match(/Version (\d+\.\d+)/)?.[1] ?? '0.x';

/** The operations table in spec section 9: direction, required, queued. */
const opRows = Object.fromEntries(
    [...specText.matchAll(/^\| `([a-z.]+@\d+)` \| ([^|]+) \| (yes|no) \| (yes|no) \|/gm)].map(([, name, direction, required, queued]) => [
        name,
        { direction: direction.trim(), required: required === 'yes', queued: queued === 'yes' },
    ]),
);

const OP_GROUPS = [
    ['Joining', ['hub.hello@1', 'hub.ping@1', 'hub.check@1', 'platform.directory@1']],
    ['Players', ['player.lookup@1', 'player.profile@1', 'presence.update@1', 'presence.subscribe@1']],
    ['Messages and invites', ['message.send@1', 'message.receipt@1', 'invite.send@1', 'invite.respond@1']],
    ['Visits', ['visit.request@1', 'visit.end@1', 'travel.quote@1']],
    ['The world', ['world.places@1', 'place.status@1', 'world.events@1', 'action.list@1']],
    ['Money', ['wallet.balance@1', 'wallet.charge@1', 'wallet.refund@1', 'wallet.read@1', 'wallet.debit@1', 'wallet.credit@1']],
];

// --- Markdown ---------------------------------------------------------------------------

/** Spec links point at files in the repo; on the site they point at pages. */
function siteLink(href) {
    if (/^(https?:|#|mailto:|files\/)/.test(href) || /^[a-z-]+\.html(#|$)/.test(href)) {
        return href;
    }

    const clean = href.replace(/^\.\.\//, '').replace(/^spec\//, '');
    const vocab = clean.match(/^vocabulary\/([a-z-]+)\.json$/);
    const op = clean.match(/(?:^|\/)ops\/([a-z.]+@\d+)\.json$/);

    if (vocab) return `vocabulary.html#${vocab[1]}`;
    if (op) return `operations.html#${slug(op[1])}`;
    if (/^vocabulary\/?$/.test(clean)) return 'vocabulary.html';
    if (/^schemas\/?$/.test(clean)) return 'operations.html';
    if (/^vectors\/?$/.test(clean)) return 'files/vectors/signing.json';
    if (clean === 'openapi.yaml') return 'files/openapi.yaml';
    if (clean === 'CONTRIBUTING.md') return 'contribute.html';
    if (clean === 'decisions.md') return 'decisions.html';
    if (clean === 'sgip.md') return 'spec.html';
    const guide = clean.match(/^site\/content\/guide\.md(#.*)?$/);
    if (guide) return `guide.html${guide[1] ?? ''}`;
    if (/^(proposals\/)?\d{4}-[a-z0-9-]+\.md$/.test(clean)) return `proposal-${clean.replace(/^proposals\//, '').replace(/\.md$/, '')}.html`;
    if (/^proposals\/?$/.test(clean) || clean === 'proposals/README.md') return 'contribute.html#sgip-enhancement-proposals-seps';
    if (clean.endsWith('.md')) return `${REPO}/blob/main/${clean}`;

    return `files/${clean}`;
}

function highlight(code, lang) {
    const text = escape(code);

    if (lang === 'json') {
        return text
            .replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)/g, '<span class="t-key">$1</span>$2')
            .replace(/:(\s*)(&quot;(?:[^&]|&(?!quot;))*?&quot;)/g, ':$1<span class="t-str">$2</span>')
            .replace(/\b(true|false|null)\b/g, '<span class="t-lit">$1</span>')
            .replace(/(:\s*|\[\s*|,\s*)(-?\d+(?:\.\d+)?)/g, '$1<span class="t-num">$2</span>');
    }

    if (['js', 'ts', 'tsx', 'python', 'php', 'sh', 'go', 'rust'].includes(lang)) {
        // One pass, so a keyword inside a comment's markup is never touched. Only Python and shell use # comments.
        const comment = ['python', 'sh'].includes(lang) ? '#(?![!\\[])[^\\n]*' : '(?<!:)\\/\\/[^\\n]*';
        const words = {
            js: 'import|from|const|let|function|return|class|new|await|async|if|else|for|of|in|export|type|switch|case|default|try|catch|throw',
            python: 'import|from|def|return|class|if|else|elif|for|in|try|except|with',
            php: 'function|return|class|new|if|else|foreach|for|echo|use|match|private|public|static|fn|const|enum|case|final',
            go: 'func|package|import|return|var|if|else|for|range|nil|type|struct',
            rust: 'fn|let|mut|pub|use|struct|impl|match|return|if|else|for',
        }[lang === 'ts' || lang === 'tsx' ? 'js' : lang];
        const pattern = new RegExp(words ? `(${comment})|\\b(${words})\\b` : `(${comment})`, 'g');

        return text.replace(pattern, (match, note) => (note ? `<span class="t-com">${note}</span>` : `<span class="t-kw">${match}</span>`));
    }

    return text;
}

function markdown() {
    const headings = [];
    const marked = new Marked({
        renderer: {
            heading({ tokens, depth }) {
                const html = this.parser.parseInline(tokens);
                const id = slug(html);
                headings.push({ depth, id, text: html.replace(/<[^>]+>/g, '') });

                return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${html}</h${depth}>`;
            },
            link({ href, title, tokens }) {
                return `<a href="${escape(siteLink(href))}"${title ? ` title="${escape(title)}"` : ''}>${this.parser.parseInline(tokens)}</a>`;
            },
            code({ text, lang }) {
                const label = { js: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', python: 'Python', php: 'PHP', go: 'Go', rust: 'Rust', json: 'JSON', sh: 'Shell' }[lang] ?? '';

                return `<figure class="code" data-lang="${escape(lang ?? '')}">${label ? `<figcaption>${label}<button type="button" class="copy" aria-label="Copy code">Copy</button></figcaption>` : ''}<pre><code>${highlight(text, lang)}</code></pre></figure>`;
            },
            table(token) {
                const head = token.header.map((cell) => `<th>${this.parser.parseInline(cell.tokens)}</th>`).join('');
                const rows = token.rows.map((row) => `<tr>${row.map((cell) => `<td>${this.parser.parseInline(cell.tokens)}</td>`).join('')}</tr>`).join('');

                return `<div class="table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
            },
        },
    });

    return { render: (text) => marked.parse(text), headings };
}

// --- Layout -----------------------------------------------------------------------------

const NAV = [
    ['index.html', 'Overview'],
    ['guide.html', 'Guide'],
    ['examples.html', 'Examples'],
    ['spec.html', 'Spec'],
    ['operations.html', 'Operations'],
    ['vocabulary.html', 'Vocabulary'],
    ['contribute.html', 'Contribute'],
];

/** The mark: a home ring woven with a smaller one you visit. Ids are per use, as it appears twice on a page. */
const logo = (id) => `<svg viewBox="6.25 7 50 50" aria-hidden="true" class="logo"><defs><clipPath id="${id}-low"><rect y="32" width="64" height="32"/></clipPath><clipPath id="${id}-high"><rect width="64" height="32"/></clipPath><mask id="${id}-a" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><circle cx="42" cy="32" r="10" fill="none" stroke="#000" stroke-width="9.0" clip-path="url(#${id}-low)"/></mask><mask id="${id}-b" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><circle cx="25" cy="32" r="14.5" fill="none" stroke="#000" stroke-width="9.0" clip-path="url(#${id}-high)"/></mask></defs><circle cx="25" cy="32" r="14.5" fill="none" stroke="currentColor" stroke-width="4.6" mask="url(#${id}-a)"/><circle cx="42" cy="32" r="10" fill="none" stroke="var(--accent)" stroke-width="4.6" mask="url(#${id}-b)"/></svg>`;

function page({ file, title, description, body, wide = false, toc = null }) {
    const nav = NAV.map(([href, label]) => `<a href="${href}"${href === file ? ' aria-current="page"' : ''}>${label}</a>`).join('');
    const aside = toc
        ? `<aside class="toc" aria-label="On this page"><p>On this page</p><nav>${toc
              .filter((h) => h.depth === 2 || h.depth === 3)
              .map((h) => `<a href="#${h.id}" class="d${h.depth}">${escape(h.text)}</a>`)
              .join('')}</nav></aside>`
        : '';

    writeFileSync(
        join(dist, file),
        `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="icon" href="assets/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="assets/site.css">
<script>try{const t=localStorage.getItem('sgip-theme');if(t)document.documentElement.dataset.theme=t}catch{}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="bar">
    <a class="brand" href="index.html">${logo('sgip-top')}<span>SGIP</span><small>v${version}</small></a>
    <button class="menu" type="button" aria-label="Menu" aria-expanded="false"><span></span></button>
    <nav class="nav" aria-label="Main">${nav}<a href="${REPO}" class="gh">GitHub ↗</a><button type="button" class="theme" aria-label="Switch light or dark">◐</button></nav>
  </div>
</header>
<main id="main" class="${wide ? 'wide' : toc ? 'doc' : 'plain'}">
${aside}<div class="content">${body}</div>
</main>
<footer class="foot">
  <div>
    <a class="brand" href="index.html">${logo('sgip-foot')}<span>SGIP</span></a>
    <p>The Simulation Game Interoperability Protocol. An open specification: the text under CC BY 4.0, the code and schemas under MIT. Built in the open by the people who make the games.</p>
  </div>
  <nav aria-label="Footer">
    <p>Protocol</p><a href="spec.html">Specification</a><a href="operations.html">Operations</a><a href="vocabulary.html">Vocabulary</a><a href="decisions.html">Design decisions</a><a href="files/openapi.yaml">OpenAPI</a>
  </nav>
  <nav aria-label="Community">
    <p>Community</p><a href="guide.html">Connect your game</a><a href="nextjs.html">Build with Next.js</a><a href="examples.html">Examples</a><a href="contribute.html">Contribute</a><a href="contribute.html#sgip-enhancement-proposals-seps">Proposals</a><a href="${REPO}/issues">Issues</a><a href="mailto:hello@sgip.dev">hello@sgip.dev</a>
  </nav>
</footer>
<script src="assets/site.js"></script>
</body>
</html>
`,
    );
}

/** `@include <path> <lang>` on its own line = that file as a code block, labelled with its path inside the reader's app. */
const includes = (source) =>
    source.replace(/^@include (\S+)(?: (\w+))?$/gm, (_, path, lang = '') => `\`\`\`${lang}\n${lang === 'sh' ? '#' : '//'} ${path.replace(/^site\/content\/[^/]+\//, '')}\n${read(path).trimEnd()}\n\`\`\``);

function docPage(file, title, description, source, intro = '') {
    const md = markdown();
    const html = md.render(includes(source));
    page({ file, title, description, body: `${intro}<article class="prose">${html}</article><p class="edit"><a href="${REPO}/edit/main/${editPath(file)}">Edit this page on GitHub</a></p>`, toc: md.headings });
}

const editPath = (file) => ({ 'spec.html': 'spec/sgip.md', 'guide.html': 'site/content/guide.md', 'examples.html': 'site/content/examples.md', 'nextjs.html': 'site/content/nextjs.md', 'contribute.html': 'CONTRIBUTING.md', 'decisions.html': 'spec/decisions.md' })[file] ?? (file.startsWith('proposal-') ? `proposals/${file.slice(9).replace(/\.html$/, '.md')}` : '');

// --- Pages ------------------------------------------------------------------------------

function home() {
    const envelope = `{
  "sgip": "${version}",
  "id": "01JA2B3C4D5E6F7G8H9J0K1M2N",
  "op": "message.send@1",
  "from": {
    "platform": "lagos.example",
    "player": "tunde@lagos.example"
  },
  "to": {
    "platform": "berlin.example",
    "player": "lena@berlin.example"
  },
  "payload": { "text": "How far? Greetings from Lagos" }
}`;
    const domains = vocabulary
        .map((domain) => `<a class="chip" href="vocabulary.html#${domain.domain}"><b>${escape(domain.title)}</b><span>${domain.terms.length}</span></a>`)
        .join('');

    const ICONS = {
        code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
        key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14.5 8.5l2 2"/>',
        envelope: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7.5 8.5 6 8.5-6"/>',
        words: '<path d="M4 5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-6l-4 3.5V15H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M7 9h6M7 11.5h4"/>',
        shield: '<path d="M12 3 4.5 6v5.5c0 4.4 3.2 8 7.5 9.5 4.3-1.5 7.5-5.1 7.5-9.5V6L12 3z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
        layers: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8 12 3.5z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/>',
    };
    const icon = (name) => `<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg></span>`;

    const body = `
<section class="hero">
  <div class="hero-text">
    <h1>Simulation Game <span class="mark">Interoperability</span> Protocol</h1>
    <p class="tagline">Let simulation games share their players.</p>
    <p class="lede">SGIP lets a player from one simulation game visit another, message friends across games and arrive as themselves. It's HTTPS, JSON and Ed25519, so a game in any language can join.</p>
    <div class="cta"><a class="button primary" href="guide.html">Connect your game</a><a class="button" href="spec.html">Read the spec</a></div>
    <ul class="facts"><li><b>${ops.length}</b> operations</li><li><b>${termCount}</b> shared words</li><li><b>3</b> endpoints to serve</li></ul>
  </div>
  <figure class="code hero-code"><figcaption><span class="lights" aria-hidden="true"><i></i><i></i><i></i></span>One envelope, signed, to one endpoint<button type="button" class="copy" aria-label="Copy code">Copy</button></figcaption><pre><code>${highlight(envelope, 'json')}</code></pre></figure>
</section>

<section class="band">
  <h2 class="section-title">How a visit works</h2>
  <p class="section-lede">Two games that have never met, and a hub that introduces them. Neither game calls the other's API.</p>
  <ol class="steps">
    <li><span class="num">1</span><h3>Ask for a passport</h3><p>Tunde is at a motor park in a Lagos game and wants to see Berlin. The Lagos game asks the hub for a passport with one signed <code>visit.request@1</code>.</p></li>
    <li><span class="num">2</span><h3>Open the door</h3><p>The Lagos game opens the Berlin game's visit page and hands over the passport by <code>postMessage</code>, or in the URL fragment for a new tab, never in a query string where servers would log it.</p></li>
    <li><span class="num">3</span><h3>Arrive as yourself</h3><p>The Berlin game checks the passport offline with the hub's public key. Tunde steps off at Hauptbahnhof with the same name, colour and badges as at home.</p></li>
    <li><span class="num">4</span><h3>Bring back souvenirs</h3><p>On the way home, Berlin sends <code>visit.end@1</code>. Lagos applies how Tunde's stats moved, capped at ±20, and only what Lagos accepts.</p></li>
  </ol>
  <svg class="diagram" viewBox="0 0 760 200" role="img" aria-label="The Lagos game and the Berlin game talk only to the hub; the player's browser carries the passport between them. A player travels to Berlin, has a drink and dances, then goes home with souvenirs.">
    <g class="node"><rect x="10" y="40" width="190" height="90" rx="16"/><text x="105" y="80">Home game</text><text x="105" y="104" class="sub">lagos.example</text></g>
    <g class="node hub"><rect x="285" y="40" width="190" height="90" rx="16"/><text x="380" y="80">Hub</text><text x="380" y="104" class="sub">verifies · routes</text></g>
    <g class="node"><rect x="560" y="40" width="190" height="90" rx="16"/><text x="655" y="80">Host game</text><text x="655" y="104" class="sub">berlin.example</text></g>
    <path d="M200 70 H285" class="wire"/><path d="M475 70 H560" class="wire"/>
    <text x="242" y="60" class="label">signed</text><text x="517" y="60" class="label">signed</text>
    <path id="trip" d="M105 130 C105 168, 655 168, 655 130" class="wire dashed"/>
    <text x="380" y="190" class="label">passport travels in the player's browser</text>
    <g class="chip"><rect x="572" y="8" width="72" height="24" rx="12"/><text x="608" y="24">drink</text><animate attributeName="opacity" dur="9s" repeatCount="indefinite" values="0;0;1;1;0;0" keyTimes="0;0.3;0.34;0.66;0.7;1"/></g>
    <g class="chip"><rect x="652" y="8" width="72" height="24" rx="12"/><text x="688" y="24">dance</text><animate attributeName="opacity" dur="9s" repeatCount="indefinite" values="0;0;1;1;0;0" keyTimes="0;0.44;0.48;0.66;0.7;1"/></g>
    <g class="chip home"><rect x="17" y="8" width="176" height="24" rx="12"/><text x="105" y="24">souvenirs: mood +20</text><animate attributeName="opacity" dur="9s" repeatCount="indefinite" values="0;0;1;1;0" keyTimes="0;0.9;0.93;0.99;1"/></g>
    <g class="player"><circle r="12"/><text y="4">T</text><animateMotion dur="9s" repeatCount="indefinite" calcMode="linear" keyPoints="0;0;1;1;0;0" keyTimes="0;0.05;0.28;0.68;0.9;1"><mpath href="#trip"/></animateMotion></g>
  </svg>
</section>

<section>
  <h2 class="section-title">Boring to implement, on purpose</h2>
  <div class="grid features">
    <article>${icon('code')}<h3>Any language</h3><p>No SDK required. Serve three HTTP endpoints, parse JSON, make an Ed25519 signature. A game written in PHP can host players from one written in TypeScript, Java, Python or Go, without ever seeing its code.</p></article>
    <article>${icon('key')}<h3>Signed, not shared</h3><p>Every request carries an Ed25519 signature over the method, path, time, a nonce and the body. No passwords or shared secrets to leak.</p></article>
    <article>${icon('envelope')}<h3>One envelope</h3><p>Every operation travels in the same JSON envelope to one endpoint per side. Idempotent by design: resend with the same id and nothing happens twice.</p></article>
    <article>${icon('words')}<h3>A shared language</h3><p>${termCount} words in ${vocabulary.length} domains so games understand each other's worlds, with fallbacks for words they've never seen.</p></article>
    <article>${icon('shield')}<h3>Players first</h3><p>Invite-only unless a player opts in. Passports last at most 15 minutes. Money stays in its home game; visitors spend it within a budget they set.</p></article>
    <article>${icon('layers')}<h3>Additive releases</h3><p>Every 0.x release only adds operations, optional fields and words. A game built today keeps working tomorrow.</p></article>
  </div>
</section>

<section class="band vocab-teaser">
  <div>
    <h2 class="section-title">A shared language for life</h2>
    <p class="section-lede">A Lagos game calls it a danfo; a Berlin game calls it the bus. Both send a word every game understands, and a game that has never heard of a danfo still knows what to do.</p>
    <p class="chain"><code>danfo</code><span>→</span><code>minibus</code><span>→</span><code>bus</code></p>
    <p><a class="button" href="vocabulary.html">Browse the vocabulary</a></p>
  </div>
  <div class="chips">${domains}</div>
</section>

<section class="contribute-cta">
  <h2 class="section-title">Shape the protocol</h2>
  <p class="section-lede">SGIP is written by the people who make the games. Every change starts as a conversation and ships with working code.</p>
  <div class="grid three">
    <a class="card-link" href="contribute.html#adding-vocabulary-terms"><h3>Add a word <span class="arrow" aria-hidden="true">→</span></h3><p>Missing a place kind or an activity? Propose it in a pull request.</p></a>
    <a class="card-link" href="contribute.html#sgip-enhancement-proposals-seps"><h3>Write a proposal <span class="arrow" aria-hidden="true">→</span></h3><p>New operations go through an SGIP Enhancement Proposal.</p></a>
    <a class="card-link" href="guide.html#6-ask-for-a-conformance-check"><h3>Test your game <span class="arrow" aria-hidden="true">→</span></h3><p>Ask the hub to check your game and tell us what was unclear.</p></a>
  </div>
</section>`;

    page({ file: 'index.html', title: 'SGIP: the Simulation Game Interoperability Protocol', description: 'An open protocol that lets simulation games share players: visits, messages and a shared vocabulary over HTTPS, JSON and Ed25519.', body, wide: true });
}

/** A JSON Schema fragment as a short type description. */
function typeOf(schema) {
    if (!schema) return 'any';

    if (schema.$ref) {
        const name = schema.$ref.split('/').pop();
        const domain = vocabulary.find((d) => {
            const def = common.$defs[name];
            return def?.description?.includes(`vocabulary/${d.domain}.json`);
        });

        return domain ? `<a href="vocabulary.html#${domain.domain}">${escape(name)}</a>` : `<span title="${escape(common.$defs[name]?.description ?? '')}">${escape(name)}</span>`;
    }

    if (schema.oneOf) return schema.oneOf.map(typeOf).join(' | ');
    if (schema.enum) return schema.enum.map((value) => `<code>${escape(JSON.stringify(value))}</code>`).join(' | ');
    if (schema.type === 'array') return `${typeOf(schema.items)}[]`;
    if (Array.isArray(schema.type)) return schema.type.join(' | ');

    return escape(schema.type ?? 'object');
}

function fieldRows(schema, prefix = '') {
    if (!schema?.properties) {
        return '';
    }

    const required = new Set(schema.required ?? []);

    return Object.entries(schema.properties)
        .map(([name, field]) => {
            const notes = [field.description, field.maxLength && `max ${field.maxLength} characters`, field.minimum !== undefined && field.maximum !== undefined && `${field.minimum}–${field.maximum}`]
                .filter(Boolean)
                .join('. ');
            const nested = field.type === 'object' ? fieldRows(field, `${prefix}${name}.`) : field.items?.type === 'object' ? fieldRows(field.items, `${prefix}${name}[].`) : '';

            return `<tr><td><code>${escape(prefix + name)}</code>${required.has(name) ? '<span class="req">required</span>' : ''}</td><td>${typeOf(field)}</td><td>${escape(notes)}</td></tr>${nested}`;
        })
        .join('');
}

function fields(title, schema) {
    const rows = fieldRows(schema);

    return `<h4>${title}</h4>${rows ? `<div class="table"><table class="fields"><thead><tr><th>Field</th><th>Type</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">An empty object.</p>'}`;
}

function operations() {
    const byName = Object.fromEntries(ops.map((op) => [op.title, op]));
    const grouped = OP_GROUPS.map(([group, names]) => [group, names.filter((name) => byName[name])]);
    const toc = grouped.flatMap(([group, names]) => [{ depth: 2, id: slug(group), text: group }, ...names.map((name) => ({ depth: 3, id: slug(name), text: name }))]);

    const sections = grouped
        .map(([group, names]) => `<h2 id="${slug(group)}">${escape(group)}</h2>${names
            .map((name) => {
                const op = byName[name];
                const row = opRows[name] ?? {};
                const example = op.examples?.[0];
                const tags = [row.direction && `<span class="tag">${escape(row.direction)}</span>`, row.required && '<span class="tag strong">Required</span>', row.queued && '<span class="tag">Queued if offline</span>'].filter(Boolean).join('');

                return `<section class="op" id="${slug(name)}">
  <h3><a class="anchor" href="#${slug(name)}" aria-hidden="true">#</a><code>${escape(name)}</code></h3>
  <div class="tags">${tags}</div>
  <p>${escape(op.description ?? '')}</p>
  ${fields('Payload', op.properties.payload)}
  ${fields('Result', op.properties.result)}
  ${example ? `<details class="example"><summary>Example</summary><div class="pair"><figure class="code"><figcaption>payload</figcaption><pre><code>${highlight(JSON.stringify(example.payload, null, 2), 'json')}</code></pre></figure><figure class="code"><figcaption>result</figcaption><pre><code>${highlight(JSON.stringify(example.result, null, 2), 'json')}</code></pre></figure></div></details>` : ''}
  <p class="schema-link"><a href="schemas/v${version}/ops/${escape(name)}.json">JSON Schema</a></p>
</section>`;
            })
            .join('')}`)
        .join('');

    const intro = `<header class="page-head"><p class="eyebrow">Reference</p><h1>Operations</h1><p class="lede">Every operation travels in the same envelope. A platform declares the ops it answers in its <code>capabilities</code>; the hub routes only to platforms that declared them. This page is generated from the schemas in <code>spec/schemas/ops</code>.</p></header>`;
    page({ file: 'operations.html', title: 'Operations · SGIP', description: 'Every SGIP operation: payloads, results and examples.', body: intro + `<article class="prose ops">${sections}</article>`, toc });
}

function vocabularyPage() {
    const toc = vocabulary.map((domain) => ({ depth: 2, id: domain.domain, text: domain.title }));
    const domains = vocabulary
        .map((domain) => {
            const ids = new Map(domain.terms.map((term) => [term.id, term]));
            const chain = (term) => {
                const steps = [];

                for (let next = term.broader; next && steps.length < 8; next = ids.get(next)?.broader) {
                    steps.push(next);
                }

                return steps;
            };
            const terms = domain.terms
                .map((term) => {
                    const up = chain(term);
                    const search = [term.id, term.label, ...(term.aliases ?? []), term.description].join(' ').toLowerCase();

                    return `<li class="term" id="${domain.domain}-${term.id}" data-search="${escape(search)}">
  <div class="term-head"><code class="id">${escape(term.id)}</code><span class="label">${escape(term.label)}</span>${term.status && term.status !== 'stable' ? `<span class="tag ${term.status}">${term.status}</span>` : ''}${term.since !== version ? `<span class="since">since ${escape(term.since)}</span>` : ''}</div>
  <p>${escape(term.description)}</p>
  ${up.length ? `<p class="broader">Falls back to ${up.map((id) => `<a href="#${domain.domain}-${id}"><code>${escape(id)}</code></a>`).join(' → ')}</p>` : ''}
  ${term.aliases?.length ? `<p class="aliases">Also called ${term.aliases.map((alias) => `<span>${escape(alias)}</span>`).join('')}</p>` : ''}
  ${term.osm ? `<p class="osm">OpenStreetMap <code>${escape(term.osm)}</code></p>` : ''}
</li>`;
                })
                .join('');

            return `<section class="domain" id="${domain.domain}">
  <h2><a class="anchor" href="#${domain.domain}" aria-hidden="true">#</a>${escape(domain.title)} <span class="count">${domain.terms.length}</span></h2>
  <p>${escape(domain.description)}</p>
  <dl class="meta"><div><dt>Used in</dt><dd>${(domain.used_in ?? []).map((use) => `<code>${escape(use)}</code>`).join(' ')}</dd></div><div><dt>Unknown words</dt><dd>${escape(domain.fallback)}</dd></div><div><dt>Extensions</dt><dd>${escape(domain.extension ?? '')}</dd></div></dl>
  <ul class="terms">${terms}</ul>
  <p class="schema-link"><a href="vocabulary/${domain.domain}.json">${domain.domain}.json</a> · <a href="${REPO}/edit/main/spec/vocabulary/${domain.domain}.json">Propose a change</a></p>
</section>`;
        })
        .join('');

    const intro = `<header class="page-head"><p class="eyebrow">Registry</p><h1>Vocabulary</h1><p class="lede">${termCount} shared words in ${vocabulary.length} domains. Games keep their own names for things and send one of these alongside, so every game understands every other. Unknown words fall back to broader ones (spec <a href="spec.html#83-understanding-a-term-you-dont-know">section 8.3</a>).</p>
<div class="search"><label for="vocab-search" class="sr-only">Search the vocabulary</label><input id="vocab-search" type="search" placeholder="Search: danfo, salon, owambe, gym…" autocomplete="off"><span id="vocab-count" aria-live="polite"></span></div></header>`;

    page({ file: 'vocabulary.html', title: 'Vocabulary · SGIP', description: 'The SGIP vocabulary registry: verbs, place kinds, stats, transport modes and more.', body: intro + `<div class="vocab">${domains}</div>`, toc });
}

function contribute() {
    const proposals = readdirSync(join(root, 'proposals'))
        .filter((file) => /^\d{4}-/.test(file) && !file.startsWith('0000'))
        .map((file) => {
            const text = read(`proposals/${file}`);

            return { file, title: text.match(/^# (.+)$/m)?.[1] ?? file, status: text.match(/\*\*Status:\*\* (.+)$/m)?.[1] ?? '' };
        });
    const intro = `<header class="page-head"><p class="eyebrow">Community</p><h1>Contribute</h1><p class="lede">SGIP is built by the people who make simulation games. Here's how to get involved, whether you have five minutes or a whole new operation in mind.</p>
<div class="grid three proposals">${proposals.map((p) => `<a class="card-link" href="proposal-${p.file.replace(/\.md$/, '')}.html"><p class="badge">${escape(p.status)}</p><h3>${escape(p.title)}</h3></a>`).join('')}<a class="card-link" href="proposal-0000-template.html"><p class="badge">Template</p><h3>Start a proposal</h3></a></div></header>`;

    docPage('contribute.html', 'Contribute · SGIP', 'How to contribute to SGIP: vocabulary terms, proposals, tools and the website.', read('CONTRIBUTING.md').replace(/^# .+\n/, ''), intro);
}

// --- Build ------------------------------------------------------------------------------

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'assets'), { recursive: true });
cpSync(join(root, 'site/assets'), join(dist, 'assets'), { recursive: true });

// Raw contract files: schemas at their $id paths, so https://sgip.dev/schemas/v0.1/… resolves.
cpSync(join(spec, 'schemas'), join(dist, `schemas/v${version}`), { recursive: true });
cpSync(join(spec, 'vocabulary'), join(dist, 'vocabulary'), { recursive: true });
mkdirSync(join(dist, 'files'), { recursive: true });
cpSync(join(spec, 'vectors'), join(dist, 'files/vectors'), { recursive: true });
cpSync(join(spec, 'openapi.yaml'), join(dist, 'files/openapi.yaml'));

home();
docPage('guide.html', 'Connect your game · SGIP', 'A step-by-step guide to joining SGIP in any language.', read('site/content/guide.md'), '');
docPage('examples.html', 'Examples · SGIP', 'Short code samples for every part of SGIP: messages, inboxes, shared words, visits, presence and events.', read('site/content/examples.md'));
docPage('nextjs.html', 'Build with Next.js · SGIP', 'A step-by-step walkthrough of a complete SGIP platform in Next.js.', read('site/content/nextjs.md'));
docPage('spec.html', `Specification v${version} · SGIP`, 'The normative SGIP specification.', specText);
docPage('decisions.html', 'Design decisions · SGIP', 'Why SGIP works the way it does.', read('spec/decisions.md'));
operations();
vocabularyPage();
contribute();

// Each proposal, including the template, as its own page.
for (const file of readdirSync(join(root, 'proposals')).filter((f) => /^\d{4}-.*\.md$/.test(f))) {
    const text = read(`proposals/${file}`);
    docPage(`proposal-${file.replace(/\.md$/, '')}.html`, `${text.match(/^# (.+)$/m)?.[1] ?? file} · SGIP`, 'An SGIP Enhancement Proposal.', text);
}

if (!existsSync(join(dist, 'index.html'))) {
    throw new Error('Build failed: no index.html');
}

console.log(`Built ${readdirSync(dist).filter((f) => f.endsWith('.html')).length} pages, ${ops.length} operations and ${termCount} vocabulary terms into site/dist (v${version}).`);
