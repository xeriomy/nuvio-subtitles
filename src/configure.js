// Self-hosted configuration page (/configure).
//
// Driven entirely by the single config schema (src/config/schema.js): every
// key appears — including hidden and secret ones — with its env name, so an
// operator can generate a working install URL without touching the server.
//
// Accepted trade-off (warned about on the page itself): API keys typed here
// are embedded in the generated install URL, because that URL is how the
// client carries per-request config (the /{config}/... path form). The repo
// and the manifest defaults never carry secrets; only this user-generated URL
// can.

const { CONFIG_SCHEMA } = require('./config/schema');
const { resolveConfig } = require('./config');

// Note: entity names are built by concatenation — see test/configure.test.js
// for why this file avoids spelling them out literally.
const LT = '&' + 'lt;';
const GT = '&' + 'gt;';
const QUOT = '&' + 'quot;';
const AMP = '&' + 'amp;';

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, AMP)
		.replace(/</g, LT)
		.replace(/>/g, GT)
		.replace(/"/g, QUOT);
}

function renderConfigurePage({ env = {} } = {}) {
	const values = resolveConfig(env, {});

	const rows = CONFIG_SCHEMA.map((entry) => {
		const value = entry.secret ? '' : values[entry.key]; // env secret values never enter the page
		const def = escapeHtml(String(entry.default));
		const common = `data-key="${escapeHtml(entry.key)}" data-default="${def}"`;
		let control;
		if (entry.type === 'checkbox') {
			control = `<input type="checkbox" ${common} ${value === true ? 'checked' : ''}>`;
		} else if (entry.type === 'number') {
			control = `<input type="number" ${common} value="${escapeHtml(value)}">`;
		} else if (entry.type === 'select' && Array.isArray(entry.options)) {
			const opts = entry.options.map(o =>
				`<option value="${escapeHtml(o)}" ${String(value) === String(o) ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
			control = `<select ${common}>${opts}</select>`;
		} else if (entry.secret) {
			control = `<input type="password" ${common} data-secret="1" value="" placeholder="empty = server env value" autocomplete="off">`;
		} else {
			control = `<input type="text" ${common} value="${escapeHtml(value)}" autocomplete="off">`;
		}
		return `<div class="row">
	<label><code>${escapeHtml(entry.key)}</code> <span class="env">${escapeHtml(entry.env)}</span>${entry.secret ? ' <span class="badge">secret</span>' : ''}${entry.hidden ? ' <span class="badge">internal</span>' : ''}</label>
	${control}
	<p class="desc">${escapeHtml(entry.description)}</p>
</div>`;
	}).join('\n');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nuvio Subtitles — configure</title>
<style>
	body { font-family: system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; color: #1c1c1c; }
	h1 { font-size: 1.4rem; }
	.row { margin: 1.1rem 0; }
	label { font-weight: 600; display: block; }
	.env { font-family: monospace; font-size: 0.8rem; color: #666; }
	.badge { font-size: 0.7rem; border: 1px solid #bbb; border-radius: 3px; padding: 0 4px; }
	input[type=text], input[type=password], input[type=number], select { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; padding: 6px 8px; font-size: 0.95rem; }
	.desc { font-size: 0.8rem; color: #555; margin: 4px 0 0; }
	#warn { background: #fff3cd; border: 1px solid #e0c568; border-radius: 6px; padding: 10px 12px; }
	#url { font-family: monospace; word-break: break-all; background: #f4f4f4; padding: 8px; border-radius: 6px; display: block; margin: 8px 0; }
	button { padding: 6px 14px; font-size: 0.95rem; }
	#empty { color: #555; font-size: 0.85rem; }
</style>
</head>
<body>
<h1>Nuvio Subtitles — configuration</h1>
<p>Only values that differ from the default are embedded. An empty API key means the server's own environment value (or "not configured") is used.</p>
<div id="warn">⚠️ <strong>The generated URL embeds any API keys you entered</strong> — anyone who obtains that URL can use those keys against your accounts. Only share it with your own devices.</div>
<h2>Settings</h2>
${rows}
<h2>Install URL</h2>
<code id="url"></code>
<a id="link" rel="noopener"></a>
<button id="copy" type="button">Copy install URL</button>
<p id="empty"></p>
<script>
function buildConfig() {
	const cfg = {};
	document.querySelectorAll('[data-key]').forEach(function (f) {
		const def = f.dataset.default;
		let value;
		if (f.type === 'checkbox') value = f.checked;
		else if (f.type === 'number') { if (f.value === '') return; value = Number(f.value); if (!Number.isFinite(value)) return; }
		else { if (f.value === '') return; value = f.value; }
		if (String(value) === def) return;
		cfg[f.dataset.key] = value;
	});
	return cfg;
}
function update() {
	const cfg = buildConfig();
	const url = location.origin + '/' + encodeURIComponent(JSON.stringify(cfg)) + '/manifest.json';
	document.getElementById('url').textContent = url;
	document.getElementById('link').href = url;
	document.getElementById('link').textContent = 'Open manifest';
	const keys = Object.keys(cfg);
	const hasSecrets = keys.some(function (k) {
		const f = document.querySelector('[data-key="' + k + '"]');
		return f && f.dataset.secret === '1';
	});
	document.getElementById('warn').style.display = hasSecrets ? 'block' : 'none';
	document.getElementById('empty').textContent = keys.length
		? '' : 'All values left at defaults — the URL installs the add-on with the server defaults.';
}
document.body.addEventListener('input', update);
document.getElementById('copy').addEventListener('click', function () {
	navigator.clipboard.writeText(document.getElementById('url').textContent);
});
update();
</script>
</body>
</html>`;
}

module.exports = { renderConfigurePage };
