// Charset handling for subtitle files.
//
// Arabic subtitles are very frequently published in windows-1256 (or with a
// BOM); Nuvio's parser expects UTF-8 and shows "No subtitle lines found" for
// mis-encoded files. Everything we serve is therefore normalised to UTF-8,
// using Node's built-in WHATWG decoders (full-icu builds ship windows-1256).

function hasUtf8Bom(buf) {
	return buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
}

function isProbablyValidUtf8(buf) {
	try {
		const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buf);
		return !decoded.includes('\uFFFD');
	} catch (e) {
		return false;
	}
}

/**
 * Decode a subtitle file buffer to a UTF-8 string.
 * Order: UTF-16 BOMs -> UTF-8 BOM -> strict UTF-8 -> windows-1256.
 * @param {Buffer} buf
 * @returns {string}
 */
function decodeSubtitleBuffer(buf) {
	if (!buf || buf.length === 0) return '';
	if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf);
	if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf);
	const body = hasUtf8Bom(buf) ? buf.subarray(3) : buf;
	if (isProbablyValidUtf8(body)) return body.toString('utf8');
	return new TextDecoder('windows-1256').decode(body);
}

module.exports = { decodeSubtitleBuffer, hasUtf8Bom, isProbablyValidUtf8 };
