/* Custom CSS + extensions: operator-supplied styling (Settings >
 * Appearance) plus any installed extension's theme CSS and translation
 * strings (channel/web/api/extensions.py), applied on top of the built-in
 * theme on every page. Fetched once per page load -- unlike the light/dark
 * toggle (localStorage, instant, pre-paint), these are config.json-backed
 * workspace settings, so they can only be applied after the initial round
 * trip; a brief flash of the built-in theme before they land is an
 * accepted tradeoff for a cosmetic feature, not worth a server-side render
 * just to avoid.
 */

function applyCustomCss(css) {
    let styleEl = document.getElementById('cow-custom-css');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'cow-custom-css';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = css || '';
}

function applyExtensionCss(css) {
    let styleEl = document.getElementById('cow-extension-css');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'cow-extension-css';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = css || '';
}

// Merges an extension's translation strings into the runtime I18N table
// (core/i18n.js) so t() resolves them like any built-in key -- last
// extension loaded wins on a key collision, and a page's own built-in
// strings are never overwritten (extensions add vocabulary, they don't
// override the app's own UI text).
function applyExtensionStrings(strings) {
    if (typeof I18N === 'undefined' || !strings) return;
    for (const lang of Object.keys(strings)) {
        if (!I18N[lang]) continue;
        for (const key of Object.keys(strings[lang])) {
            if (!(key in I18N[lang])) I18N[lang][key] = strings[lang][key];
        }
    }
}

function loadActiveExtensions() {
    fetch('/api/extensions/active').then(r => r.json()).then(data => {
        if (data.status !== 'success') return;
        applyExtensionCss(data.theme_css);
        applyExtensionStrings(data.strings);
    }).catch(() => {});
}

function loadCustomCss() {
    fetch('/api/custom-css').then(r => r.json()).then(data => {
        if (data && data.custom_css) applyCustomCss(data.custom_css);
    }).catch(() => {});
}

loadCustomCss();
loadActiveExtensions();

// Same cross-document staleness problem theme.js's 'storage' listener fixes
// for cow_theme: this file only fetches custom CSS / active extensions once
// at script load, so a save in another tab or Teams-grid iframe pane never
// reaches this document. config.js's saveAppearanceConfig() and
// _ceRefreshActiveExtensionsIfLoaded() bump 'custom-css-rev' on change; react
// by re-fetching and re-applying both here too.
window.addEventListener('storage', (e) => {
    if (e.key === 'custom-css-rev' && e.newValue) {
        loadCustomCss();
        loadActiveExtensions();
    }
});
