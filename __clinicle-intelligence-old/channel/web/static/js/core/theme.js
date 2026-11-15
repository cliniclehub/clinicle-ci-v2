/* Light/dark theme toggle.
   Split out of console.js. These are classic scripts sharing one global
   scope; see channel/web/README.md before changing the load order. */

// =====================================================================
// Theme
// =====================================================================
let currentTheme = localStorage.getItem('cow_theme') || 'light';

function applyTheme() {
    const root = document.documentElement;
    // .theme-icon, not just #theme-icon -- the header toggle isn't the only
    // one anymore (see the Teams rail's icon-only toggle), and every copy
    // needs to flip together.
    const iconClass = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    document.querySelectorAll('.theme-icon').forEach(el => { el.className = iconClass; });
    if (currentTheme === 'dark') {
        root.classList.add('dark');
        document.getElementById('hljs-light').disabled = true;
        document.getElementById('hljs-dark').disabled = false;
    } else {
        root.classList.remove('dark');
        document.getElementById('hljs-light').disabled = false;
        document.getElementById('hljs-dark').disabled = true;
    }
}

function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('cow_theme', currentTheme);
    applyTheme();
}

// Each Teams panel is this same page loaded again in its own iframe (see
// views/teams.js), so it has its own document and never sees a toggle made
// in the parent (or a sibling pane) -- only picks up the new value on its
// next load/refresh. 'storage' fires in every other same-origin document
// sharing this localStorage the moment one of them writes to it, so every
// open pane re-applies immediately without any iframe-specific plumbing.
window.addEventListener('storage', (e) => {
    if (e.key === 'cow_theme' && e.newValue && e.newValue !== currentTheme) {
        currentTheme = e.newValue;
        applyTheme();
    }
});

