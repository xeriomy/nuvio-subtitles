// Cue-text extraction for AI translation.
//
// Translation must never touch anything but the human-readable text lines of
// a subtitle file: index lines, `-->` timing lines, VTT headers, NOTE/STYLE
// blocks and cue settings all pass through byte-exact, so a translated file's
// timings are identical to its source's by construction.

const TIMING_RE = /\s-->\s/;

function isBlank(line) {
	return line.trim() === '';
}

/**
 * Split a subtitle file into lines and mark the translatable cue-text lines.
 * A line is cue text iff it follows a timing line, precedes the next blank
 * line, is non-empty, and is not itself a (timing-lookalike) timestamp line.
 *
 * @param {string} text
 * @returns {{ eol: '\n'|'\r\n', lines: string[], slots: number[], texts: string[] }}
 */
function extractCueTexts(text) {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = String(text).split(/\r?\n/);
	const slots = [];
	const texts = [];
	let inCue = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (TIMING_RE.test(line)) {
			inCue = true; // timing line (or an inline karaoke timestamp): never translated
			continue;
		}
		if (isBlank(line)) {
			inCue = false;
			continue;
		}
		if (inCue) {
			slots.push(i);
			texts.push(line);
		}
	}
	return { eol, lines, slots, texts };
}

/**
 * Write translations back into the extracted structure. `translations[i]`
 * replaces `texts[i]`; everything else is untouched.
 */
function rebuildWithCueTexts({ eol, lines, slots }, translations) {
	if (translations.length !== slots.length) {
		throw new Error(`translation count ${translations.length} does not match cue text count ${slots.length}`);
	}
	const out = lines.slice();
	slots.forEach((lineIndex, i) => { out[lineIndex] = translations[i]; });
	return out.join(eol);
}

module.exports = { extractCueTexts, rebuildWithCueTexts };
