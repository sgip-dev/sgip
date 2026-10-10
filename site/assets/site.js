// Small enhancements; every page works without them.
(() => {
    const root = document.documentElement;
    const header = document.querySelector('.top');

    document.querySelector('.menu')?.addEventListener('click', (event) => {
        const open = header.classList.toggle('open');
        event.currentTarget.setAttribute('aria-expanded', String(open));
    });

    document.querySelector('.theme')?.addEventListener('click', () => {
        const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
        root.dataset.theme = dark ? 'light' : 'dark';

        try {
            localStorage.setItem('sgip-theme', root.dataset.theme);
        } catch {
            // Storage blocked: the choice lasts for this page only.
        }
    });

    for (const button of document.querySelectorAll('.copy')) {
        button.addEventListener('click', async () => {
            const code = button.closest('.code')?.querySelector('code')?.innerText ?? '';

            try {
                await navigator.clipboard.writeText(code);
                button.textContent = 'Copied';
            } catch {
                button.textContent = 'Select and copy';
            }

            setTimeout(() => (button.textContent = 'Copy'), 1600);
        });
    }

    // Highlight the section in view in the table of contents.
    const links = new Map([...document.querySelectorAll('.toc a')].map((link) => [link.hash.slice(1), link]));

    if (links.size) {
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        links.forEach((link) => link.classList.remove('active'));
                        links.get(entry.target.id)?.classList.add('active');
                    }
                }
            },
            { rootMargin: '-90px 0px -70% 0px' },
        );

        links.forEach((_, id) => {
            const target = document.getElementById(id);

            if (target) {
                observer.observe(target);
            }
        });
    }

    // Vocabulary search: matches ids, labels, aliases and descriptions.
    const search = document.getElementById('vocab-search');

    if (search) {
        const terms = [...document.querySelectorAll('.term')];
        const domains = [...document.querySelectorAll('.domain')];
        const count = document.getElementById('vocab-count');
        const run = () => {
            const words = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
            let shown = 0;

            for (const term of terms) {
                const match = words.every((word) => term.dataset.search.includes(word));
                term.hidden = !match;
                shown += match ? 1 : 0;
            }

            for (const domain of domains) {
                domain.hidden = !domain.querySelector('.term:not([hidden])');
            }

            count.textContent = words.length ? `${shown} of ${terms.length}` : `${terms.length} words`;
        };

        search.addEventListener('input', run);
        run();
    }
})();
