// HTTP front-end for the add-on.
//
// Why a custom listener instead of the SDK's serveHTTP():
// the official getRouter() parses `extra` only from a path segment
// (/{resource}/{type}/{id}/{extraArgs}.json) and silently drops query-string
// extras. Stremio/Nuvio send subtitle extras (videoHash, videoSize, filename)
// as a query string, so without this bridge hash-matching could never work.
//
// Everything else — /manifest.json, the /{config}/... prefix form, unknown
// routes, 404s — still goes through the official getRouter(), so manifest
// handling and its CORS behavior stay SDK-owned. CORS headers are set here for
// every route, matching what the SDK's cors() middleware emits.

const { getRouter } = require('stremio-addon-sdk');
const qs = require('node:querystring');
const { buildAddon } = require('./addon');
const { parseExtras } = require('./catalog');

// /[/config]/subtitles/{type}/{id}[/{extra}].json  — config is URL-encoded JSON
const SUBTITLES_RE = /^\/(?:([^/]+)\/)?subtitles\/([^/]+)\/([^/]+?)(?:\/([^/]*))?\.json$/;

/**
 * @param {{env?: object, providers?: Array, version?: string}} [opts]
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => void}
 */
function createServer(opts = {}) {
	const { manifest, interface: iface, registry, resolveConfig } = buildAddon(opts);
	const sdkRouter = getRouter({ manifest, get: iface.get });

	return function addonRequestListener(req, res) {
		// The addon protocol requires CORS on every route, including manifest.
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');

		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		let url;
		try {
			url = new URL(req.url, 'http://localhost');
		} catch (e) {
			url = null;
		}
		const pathname = url ? url.pathname : req.url;

		if (pathname === '/' ) {
			res.writeHead(302, { Location: '/manifest.json' });
			res.end();
			return;
		}

		if (pathname === '/healthz') {
			sendJson(res, 200, { ok: true, providers: healthView(registry, resolveConfig) });
			return;
		}

		const match = SUBTITLES_RE.exec(pathname);
		if (match) {
			serveSubtitles(match, url, { iface, resolveConfig }, res);
			return;
		}

		// manifest.json, the /{config}/manifest.json form, and true 404s
		sdkRouter(req, res, () => sendJson(res, 404, { err: 'not found' }));
	};
}

function serveSubtitles(match, url, { iface, resolveConfig }, res) {
	const [, rawConfig, rawType, rawId, rawExtra] = match;

	// Merge both documented extra forms; query-string wins on conflict because
	// it is what current clients send. parseExtras() types and filters them.
	const extras = parseExtras(Object.assign(
		{},
		parsePathExtras(rawExtra),
		url ? Object.fromEntries(url.searchParams.entries()) : {},
	));
	const config = parseConfig(rawConfig);
	const type = safeDecode(rawType);

	iface.get('subtitles', type, rawId, extras, config)
		.then((resp) => sendSubtitlesResponse(resp, res))
		.catch((err) => {
			console.error('[subtitles] handler error:', err && err.message ? err.message : err);
			sendJson(res, 500, { err: 'handler error' });
		});
}

function sendSubtitlesResponse(resp, res) {
	const body = resp && typeof resp === 'object' ? resp : { subtitles: [] };

	// Same cache semantics the SDK router derives from these response fields.
	const cacheParts = [];
	if (Number.isInteger(body.cacheMaxAge)) cacheParts.push(`max-age=${body.cacheMaxAge}`);
	if (Number.isInteger(body.staleRevalidate)) cacheParts.push(`stale-while-revalidate=${body.staleRevalidate}`);
	if (Number.isInteger(body.staleError)) cacheParts.push(`stale-if-error=${body.staleError}`);
	if (cacheParts.length) res.setHeader('Cache-Control', `${cacheParts.join(', ')}, public`);

	sendJson(res, 200, body);
}

function healthView(registry, resolveConfig) {
	return registry.health(resolveConfig(undefined)).map(p => ({
		id: p.id,
		name: p.name,
		enabled: p.enabled,
		configured: p.configured,
		supportsVideoHash: p.meta ? p.meta.supportsVideoHash === true : false,
	}));
}

function sendJson(res, status, payload) {
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
	res.end(JSON.stringify(payload));
}

/**
 * Parse the /{config} path segment — any JSON object the client sends back
 * after its configuration UI, URL-encoded in the path.
 * Example: /%7B%22languages%22%3A%5B%22ar%22%5D%7D/ -> {"languages":["ar"]}
 * Malformed input resolves to {} (never an error).
 */
function parseConfig(raw) {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(decodeURIComponent(raw));
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch (e) {
		return {};
	}
}

/**
 * Parse the /{extraArgs} path segment. The protocol documents extraArgs as a
 * raw query-string ("videoHash=abc&videoSize=123"), where only the *values*
 * are percent-encoded — so splitting must happen before decoding (qs.parse).
 * Some clients URL-encode the whole segment instead (videoHash%3Dabc%26...);
 * that form is detected and decoded first.
 */
function parsePathExtras(raw) {
	if (!raw) return {};
	const segment = raw.includes('%3D') && !raw.includes('=') ? safeDecode(raw) : raw;
	return qs.parse(segment);
}

function safeDecode(value) {
	try {
		return decodeURIComponent(value);
	} catch (e) {
		return value;
	}
}

module.exports = { createServer, SUBTITLES_RE, parsePathExtras };
