// Bundled fixtures provider.
//
// Serves recorded, real-shaped provider payloads from disk so the add-on
// returns Arabic subtitles with no credentials and no network. It is a first
// class provider: same contract as the live ones, and enabled/disabled/ordered
// like any other.
//
// To serve your own data, drop a file in fixtures/providers/ and add it to MAP.

const fs = require('node:fs');
const path = require('node:path');

const FIXTURE_DIR = path.join(__dirname, '..', '..', 'fixtures', 'providers');

// which recorded file backs which request, and which live provider's mapping
// should normalise it (so the mapping code under test is the real one)
const MAP = [
	{ file: 'opensubtitles-ar-movie.json', mapper: 'opensubtitles' },
	{ file: 'opensubtitles-ar-series.json', mapper: 'opensubtitles' },
	{ file: 'subdl-ar-movie.json', mapper: 'subdl' },
	{ file: 'subdl-ar-series.json', mapper: 'subdl' },
];

function createDemoFixturesProvider({ openSubtitlesMapper, subdlMapper } = {}) {
	const mappers = { opensubtitles: openSubtitlesMapper, subdl: subdlMapper };

	return {
		meta: {
			id: 'demoFixtures',
			name: 'Bundled example subtitles',
			description: 'Recorded Arabic subtitle samples shipped with the add-on; no credentials or network required.',
			order: 90,
			requiresCredentials: [],
			defaultEnabled: true,
			supportsVideoHash: false,
		},

		isConfigured() { return true; },

		// Recorded fixtures describe ONE movie and ONE episode. Serving them
		// for any id polluted real requests with wrong-show subtitles (GoT
		// subs while playing JoJo), so we abstain outside the exact demo ids.
		DEMO_IDS: {
			movie: { imdb: 'tt0111161', tmdb: '278' },
			series: { imdb: 'tt0944947', tmdb: '1399', season: 1, episode: 1 },
		},

		supports({ media } = {}) {
			if (!media || !(media.imdbId || media.tmdbId)) return false;
			const demo = this.DEMO_IDS[media.type] || (media.season !== undefined ? this.DEMO_IDS.series : this.DEMO_IDS.movie);
			const idMatches = media.imdbId === demo.imdb || media.tmdbId === demo.tmdb;
			if (!idMatches) return false;
			if (media.type === 'series' || media.season !== undefined) {
				return media.season === demo.season && media.episode === demo.episode;
			}
			return true;
		},

		/** @returns {{mapper: string, hits: Array}|null} */
		_load(file) {
			try {
				const raw = fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8');
				const body = JSON.parse(raw);
				const entry = MAP.find(m => m.file === file);
				const hits = Array.isArray(body.data) ? body.data : (Array.isArray(body.subtitles) ? body.subtitles : []);
				return { mapper: entry ? entry.mapper : null, hits };
			} catch (e) {
				return null;
			}
		},

		_pick(media) {
			// Series requests get the series fixtures, everything else the movie
			// ones. Both recorded sources are served together so the merged
			// response reflects what the live providers would jointly return.
			const series = media && media.season !== undefined && media.episode !== undefined;
			const files = series
				? ['opensubtitles-ar-series.json', 'subdl-ar-series.json']
				: ['opensubtitles-ar-movie.json', 'subdl-ar-movie.json'];
			const hits = [];
			for (const file of files) {
				const loaded = this._load(file);
				if (loaded) hits.push(...loaded.hits);
			}
			return { hits };
		},

		/**
		 * @returns {Promise<Array>} provider-native hits, exactly as a live
		 * provider would have returned them, so mapping stays uniform.
		 */
		async search({ media }) {
			const picked = this._pick(media);
			return picked ? picked.hits : [];
		},

		mapHit(hit, ctx = {}) {
			if (!hit || typeof hit !== 'object') return null;
			// Route by hit shape: OpenSubtitles REST hits carry `attributes`,
			// SubDL hits carry the fields directly.
			const mapper = hit.attributes ? mappers.opensubtitles : mappers.subdl;
			if (!mapper) return null;
			return mapper(hit, ctx);
		},

		health() {
			return { provider: 'Bundled example subtitles', mode: 'offline', files: MAP.map(m => m.file), healthy: true };
		},
	};
}

module.exports = { createDemoFixturesProvider, MAP };
