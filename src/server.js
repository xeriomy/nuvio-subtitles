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
const { createOpenSubtitlesDownloader } = require('./providers/opensubtitlesDownload');
const { createContentProxy } = require('./providers/contentProxy');

// /[/config]/subtitles/{type}/{id}[/{extra}].json  — config is URL-encoded JSON
const SUBTITLES_RE = /^\/(?:([^/]+)\/)?subtitles\/([^/]+)\/([^/]+?)(?:\/([^/]*))?\.json$/;

// Credential-holding download proxies, so the client never sees API keys:
//   /proxy/opensubtitles/{fileId}  -> POST download endpoint -> 302 temp link
//   /proxy/subdl/{path}            -> 302 to dl.subdl.com with the key re-attached
const OS_PROXY_RE = /^\/proxy\/opensubtitles\/([^/]+)$/;
const SUBDL_PROXY_RE = /^\/proxy\/subdl\/([A-Za-z0-9][A-Za-z0-9/._-]*)$/;

/**
 * @param {{env?: object, providers?: Array, version?: string}} [opts]
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => void}
 */
function createServer(opts = {}) {
	const { manifest, interface: iface, registry, resolveConfig } = buildAddon(opts);
	const sdkRouter = getRouter({ manifest, get: iface.get });
	const opensubtitlesDownloader = opts.opensubtitlesDownloader || createOpenSubtitlesDownloader();
	const contentProxy = opts.contentProxy || createContentProxy({ fetchImpl: httpFetch });

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

		if (serveProxy(pathname, req, res, { resolveConfig, opensubtitlesDownloader, contentProxy })) return;

		const match = SUBTITLES_RE.exec(pathname);
		if (match) {
			serveSubtitles(match, url, req, { iface, resolveConfig }, res);
			return;
		}

		// manifest.json, the /{config}/manifest.json form, and true 404s
		sdkRouter(req, res, () => sendJson(res, 404, { err: 'not found' }));
	};
}

function serveSubtitles(match, url, req, { iface, resolveConfig }, res) {
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

	// Providers that build proxy download links need this add-on's public
	// base URL: the explicit ADDON_BASE_URL wins (reverse-proxy deployments),
	// otherwise it is derived from the incoming request.
	const resolved = resolveConfig(config);
	resolved.addonBaseUrl = resolved.addonBaseUrl || requestBase(req);

	if (resolved.debug) {
		console.log(`[debug] subtitles ${type}/${rawId} extras=${JSON.stringify(extras)} config=${JSON.stringify({
			languages: resolved.languages,
			verifyShowNames: resolved.verifyShowNames,
			encodingFallback: resolved.encodingFallback === true,
		})}`);
	}

	iface.get('subtitles', type, rawId, extras, resolved)
		.then((resp) => sendSubtitlesResponse(resp, res))
		.catch((err) => {
			console.error('[subtitles] handler error:', err && err.message ? err.message : err);
			sendJson(res, 500, { err: 'handler error' });
		});
}

/** "http(s)://host[:port]" as seen by this server (X-Forwarded-* aware). */
function requestBase(req) {
	const forwardedProto = String(req.headers['x-forwarded-proto'] || '');
	const proto = (forwardedProto || (req.socket && req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
	const forwardedHost = String(req.headers['x-forwarded-host'] || '');
	const host = (forwardedHost || req.headers.host || '127.0.0.1').split(',')[0].trim();
	return `${proto}://${host}`;
}

/**
 * Handle the /proxy/... routes. Returns true when the request was handled.
 * These routes exist because provider files are only reachable with the
 * provider's API key, which must never leave this server.
 *
 * Content is fetched server-side, normalised (zips unpacked, charsets decoded
 * to UTF-8) and cached — the player re-fetches subtitle URLs constantly
 * (preview, playback, auto-sync), so redirecting it to the provider produced
 * HTTP 429 rate limits and quota exhaustion.
 */
function serveProxy(pathname, req, res, { resolveConfig, opensubtitlesDownloader, contentProxy }) {
	const os = OS_PROXY_RE.exec(pathname);
	if (os) {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			sendJson(res, 405, { err: 'method not allowed' });
			return true;
		}
		if (!/^\d+$/.test(os[1])) {
			sendJson(res, 400, { err: 'file id must be numeric' });
			return true;
		}
		const config = resolveConfig(undefined);
		if (!config.opensubtitlesApiKey) {
			sendJson(res, 503, { err: 'OpenSubtitles is not configured' });
			return true;
		}
		serveProxyContent(res, contentProxy.get('opensubtitles', os[1], async () => {
			const link = await opensubtitlesDownloader(os[1], config);
			if (!link) throw statusError('no download link available', 502);
			return link;
		}));
		return true;
	}

	const subdl = SUBDL_PROXY_RE.exec(pathname);
	if (subdl) {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			sendJson(res, 405, { err: 'method not allowed' });
			return true;
		}
		const path = subdl[1];
		if (path.includes('..') || path.includes('//')) {
			sendJson(res, 400, { err: 'bad path' });
			return true;
		}
		const config = resolveConfig(undefined);
		if (!config.subdlApiKey) {
			sendJson(res, 503, { err: 'SubDL is not configured' });
			return true;
		}
		serveProxyContent(res, contentProxy.get('subdl', path, async () =>
			`https://dl.subdl.com/${path}?api_key=${encodeURIComponent(config.subdlApiKey)}`));
		return true;
	}

	return false;
}

/** Stream the resolved content with caching headers; pass upstream 429s through. */
function serveProxyContent(res, promise) {
	promise
		.then((content) => {
			res.writeHead(200, {
				'Content-Type': content.contentType,
				'Content-Length': content.body.length,
				// player-side caching too: subtitle bytes are immutable
				'Cache-Control': 'max-age=3600, public',
				'Access-Control-Allow-Origin': '*',
			});
			res.end(content.body);
		})
		.catch((err) => {
			const status = (err && err.status) || 502;
			const headers = { 'Content-Type': 'application/json; charset=utf-8' };
			if (status === 429) headers['Retry-After'] = '60';
			res.writeHead(status, headers);
			res.end(JSON.stringify({ err: 'subtitle fetch failed' }));
		});
}

function statusError(message, status) {
	const err = new Error(message);
	err.status = status;
	return err;
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

/**
 * fetch adapter for the content proxy: returns { buffer, contentType, filename }
 * and throws `HTTP <status>` errors so status codes can be passed through.
 */
async function httpFetch(url) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error('request timed out')), 20000);
	try {
		const res = await fetch(url, {
			headers: { 'User-Agent': 'nuvio-subtitles-addon v1', Accept: '*/*' },
			signal: controller.signal,
			redirect: 'follow',
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const buffer = Buffer.from(await res.arrayBuffer());
		// SubDL puts the extension in the URL path; OpenSubtitles leaves it to the
		// content type. The content proxy only needs a name for zip/sniffing.
		let filename = '';
		try {
			const path = new URL(res.url || url).pathname;
			const last = decodeURIComponent(path.split('/').pop() || '');
			if (/\.[a-z0-9]{2,5}$/i.test(last)) filename = last;
		} catch (e) { /* filename stays empty */ }
		return { buffer, contentType: res.headers.get('content-type') || '', filename };
	} finally {
		clearTimeout(timer);
	}
}

module.exports = { createServer, SUBTITLES_RE, parsePathExtras };
