// Minimal ZIP reader (read-only) for subtitle archives.
//
// SubDL delivers subtitle files as .zip archives, which Nuvio cannot parse.
// The proxy unpacks them server-side and serves the inner subtitle file.
// Supports STORE (0) and DEFLATE (8) entries — all that subtitle archives use.

const zlib = require('node:zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/**
 * Extract all entries from a ZIP buffer.
 * @param {Buffer} buf
 * @returns {Array<{name: string, data: Buffer}>} in central-directory order
 */
function unzip(buf) {
	if (!buf || buf.length < 22) return [];
	const eocd = findEOCD(buf);
	if (eocd === -1) return [];

	const count = buf.readUInt16LE(eocd + 10);
	let offset = buf.readUInt32LE(eocd + 16);

	const entries = [];
	for (let i = 0; i < count && offset + 46 <= buf.length; i++) {
		if (buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE) break;
		const method = buf.readUInt16LE(offset + 10);
		const compressedSize = buf.readUInt32LE(offset + 20);
		const nameLen = buf.readUInt16LE(offset + 28);
		const extraLen = buf.readUInt16LE(offset + 30);
		const commentLen = buf.readUInt16LE(offset + 32);
		const localOffset = buf.readUInt32LE(offset + 42);
		const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);

		const data = readEntryData(buf, localOffset, method, compressedSize);
		if (data) entries.push({ name, data });

		offset += 46 + nameLen + extraLen + commentLen;
	}
	return entries;
}

function readEntryData(buf, localOffset, method, compressedSize) {
	// Local header: signature(4) + fields(26) + nameLen(2) + extraLen(2)
	if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) return null;
	const nameLen = buf.readUInt16LE(localOffset + 26);
	const extraLen = buf.readUInt16LE(localOffset + 28);
	const start = localOffset + 30 + nameLen + extraLen;
	const end = start + compressedSize;
	if (end > buf.length) return null;
	const raw = buf.subarray(start, end);

	try {
		if (method === 0) return Buffer.from(raw);
		if (method === 8) return zlib.inflateRawSync(raw);
		return null;
	} catch (e) {
		return null;
	}
}

/** End Of Central Directory: scan back over the possible comment. */
function findEOCD(buf) {
	const min = Math.max(0, buf.length - 22 - 65535);
	for (let i = buf.length - 22; i >= min; i--) {
		if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
	}
	return -1;
}

/**
 * Pick the subtitle file to serve from an archive's entries:
 * the largest .srt/.vtt/.ass/.ssa, falling back to the largest entry.
 * @param {Array<{name: string, data: Buffer}>} entries
 * @returns {{name: string, data: Buffer}|null}
 */
function pickSubtitleEntry(entries) {
	if (!entries || !entries.length) return null;
	const isSubtitle = e => /\.(srt|vtt|ass|ssa|sub|txt)$/i.test(e.name);
	const subtitles = entries.filter(isSubtitle);
	const pool = subtitles.length ? subtitles : entries;
	return pool.sort((a, b) => b.data.length - a.data.length)[0];
}

module.exports = { unzip, pickSubtitleEntry };
