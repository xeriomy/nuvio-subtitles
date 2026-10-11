// Entry point: wires configuration, providers and the HTTP server.
//
// Configuration precedence (highest wins): request config from Nuvio (the
// /{config}/... URL form) > CONFIG_JSON env > individual env vars > defaults.
// Credentials are read from the environment only and are never logged.

const http = require('node:http');
const { createServer } = require('./server');

function loadDotEnv(env = process.env) {
	// Minimal .env loader (no dependency): only fills keys that are not already set.
	const fs = require('node:fs');
	const path = require('node:path');
	const file = path.join(process.cwd(), '.env');
	if (!fs.existsSync(file)) return;
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (env[key] === undefined || env[key] === '') env[key] = value;
	}
}

function main() {
	loadDotEnv();
	const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3000;
	const listener = createServer({ env: process.env });

	const server = http.createServer(listener);
	server.listen(port, () => {
		const address = server.address();
		const actual = typeof address === 'object' && address ? address.port : port;
		console.log(`Nuvio Subtitles add-on listening on http://127.0.0.1:${actual}/manifest.json`);
		logProviderStatus();
	});
	return server;
}

function logProviderStatus() {
	try {
		const { resolveConfig } = require('./config');
		const cfg = resolveConfig(process.env, {});
		const { registerDefaultProviders } = require('./addon');
		// status only — never prints credential values
		const lines = [];
		for (const key of ['opensubtitlesApiKey', 'subdlApiKey']) {
			const envName = key === 'opensubtitlesApiKey' ? 'OPENSUBTITLES_API_KEY' : 'SUBDL_API_KEY';
			lines.push(`${key === 'opensubtitlesApiKey' ? 'opensubtitles' : 'subdl'}: ${process.env[envName] ? 'credentials present' : 'no credentials (provider will be skipped)'}`);
		}
		lines.push(`languages: ${cfg.languages.join(', ')} (first is strongest)`);
		lines.forEach(l => console.log(`  ${l}`));
	} catch (e) { /* status logging must never break startup */ }
}

if (require.main === module) {
	main();
}

module.exports = { main, loadDotEnv };
