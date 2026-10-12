// ASS/SSA -> SRT conversion.
//
// Nuvio's player and its auto-sync feature are SRT-oriented: raw ASS dialogue
// (with {\...} override tags on every line) either renders poorly or crashes
// their sync regex. We convert at serve time: keep text and timing, drop
// styling. The trade-off (positioning/fonts lost) is worth working subtitles.

/**
 * Convert ASS/SSA subtitle text to SRT.
 *
 * @param {string} text full ASS document
 * @returns {string|null} SRT text, or null when there are no dialogue events
 */
function convertAssToSrt(text) {
	if (!text || typeof text !== 'string') return null;

	const lines = text.split(/\r?\n/);

	// Field order for Dialogue lines, from the [Events] Format: declaration.
	let format = ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'];
	let textIndex = format.indexOf('Text');
	let startIndex = format.indexOf('Start');
	let endIndex = format.indexOf('End');

	const blocks = [];
	let index = 1;

	for (const raw of lines) {
		const line = raw.trim();
		if (/^Format:/i.test(line)) {
			const declared = line.slice('Format:'.length).split(',').map(s => s.trim());
			if (declared.includes('Text') && declared.includes('Start') && declared.includes('End')) {
				format = declared;
				textIndex = declared.indexOf('Text');
				startIndex = declared.indexOf('Start');
				endIndex = declared.indexOf('End');
			}
			continue;
		}
		if (!/^Dialogue:/i.test(line)) continue;

		const fields = line.slice('Dialogue:'.length).split(',');
		if (fields.length < format.length) continue; // malformed row
		const start = fields[startIndex].trim();
		const end = fields[endIndex].trim();
		// Text is everything after the last fixed field: it may contain commas.
		const textValue = fields.slice(textIndex).join(',').trim();
		if (!textValue) continue;

		const cleanText = cleanAssText(textValue);
		if (!cleanText) continue;

		blocks.push(`${index}\n${assTimeToSrt(start)} --> ${assTimeToSrt(end)}\n${cleanText}`);
		index += 1;
	}

	return blocks.length ? blocks.join('\n\n') + '\n' : null;
}

/** Strip {\...} overrides, convert \N/\n to real newlines, drop HTML tags. */
function cleanAssText(text) {
	return text
		.replace(/\{[^{}]*\}/g, '')
		.replace(/\\[Nn]/g, '\n')
		.replace(/<\/?[a-z][a-z0-9]*[^>]*>/gi, '')
		.replace(/&nbsp;/gi, ' ')
		.trim();
}

/** ASS "H:MM:SS.cc" -> SRT "HH:MM:SS,ccc". */
function assTimeToSrt(value) {
	const m = /^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(value.trim());
	if (!m) return value.trim();
	const [, h, min, s, cs] = m;
	const millis = cs.padEnd(3, '0').slice(0, 3);
	return `${h.padStart(2, '0')}:${min.padStart(2, '0')}:${s.padStart(2, '0')},${millis}`;
}

module.exports = { convertAssToSrt, cleanAssText, assTimeToSrt };
