// What each overlay layer draws on the sample poster: Kometa's badge image path and/or text. Pure lookup; the preview paints it.

import type { PlexItem } from "./api";

export type LayerArt = { image?: string; text?: string };

type Vars = Record<string, unknown>;

// Typical samples when PlexItem has no matching field (picked from Kometa's defaults and image folders).
const SAMPLE_RESOLUTION = "4k";
const SAMPLE_CODEC = "truehd";
const SAMPLE_STREAMING = "Netflix";
const SAMPLE_NETWORK = "HBO";
const SAMPLE_STUDIO = "Warner Bros. Pictures";
const SAMPLE_RIBBON_KEY = "golden";
const SAMPLE_RUNTIME_H = 2;
const SAMPLE_RUNTIME_M = 14;
const SAMPLE_STATUS = "RETURNING";
const SAMPLE_EPISODE = { season: 1, episode: 5 };
const SAMPLE_CRITIC_SCORE = 8.2;
const SAMPLE_USER_SCORE = 7.5;
const SAMPLE_AGE_COMMONSENSE = "13";
const SAMPLE_VIDEO_FORMAT = "WEB";
const SAMPLE_ASPECT = "1.78";

const CODEC_TO_KEY: Record<string, string> = {
  truehd: "truehd",
  eac3: "plus",
  ac3: "digital",
  dca: "dts",
  "dca-ma": "ma",
  aac: "aac",
  flac: "flac",
  opus: "opus",
  mp3: "mp3",
};

/** Plex resolution strings Kometa's resolution template keys. */
function resolutionKey(value: string): string {
  const s = value.toLowerCase();
  if (s === "4k" || s.includes("2160")) return "4k";
  if (s === "1080" || s.startsWith("1080") || s.includes("2k")) return "1080p";
  if (s === "720" || s === "hd") return "720p";
  if (s === "576") return "576p";
  if (s === "sd" || s === "480") return "480p";
  return SAMPLE_RESOLUTION; // Kometa only has art for 4K, 1080p, 720p, 576p and 480p
}

const pickStyle = (vars: Vars, key: string, fallback: string, allowed: readonly string[]) => {
  const raw = vars[key];
  const value = typeof raw === "string" && raw ? raw : fallback;
  return allowed.includes(value) ? value : fallback;
};

const oneDecimal = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

// ratings.yml: rating<n> is where the score comes from; rating<n>_image, or else that source's own logo, is the picture.
const RATING_LOGOS: Record<string, string> = {
  tmdb: "tmdb", mdb_tmdb: "tmdb", plex_tmdb: "tmdb", imdb: "imdb", mdb_imdb: "imdb", plex_imdb: "imdb", omdb_imdb: "imdb",
  omdb_tomatoes: "rt_tomato", omdb_metascore: "metacritic", omdb: "omdb", anidb: "anidb", anidb_average: "anidb", anidb_score: "anidb",
  mdb_letterboxd: "letterboxd", mdb_metacritic: "metacritic", mdb_metacriticuser: "metacritic", mdb_tomatoesaudience: "rt_popcorn",
  plex_tomatoesaudience: "rt_popcorn", mdb_tomatoes: "rt_tomato", plex_tomatoes: "rt_tomato", serializd: "serializd", mal: "mal",
  mdb_myanimelist: "mal", mdb: "mdb", mdb_average: "mdb", user: "star", floppy: "floppy", critic: "critic", audience: "audience",
};
const LOGO_FILES: Record<string, string> = {
  anidb: "AniDB", imdb: "IMDb", floppy: "Floppy", omdb: "OMDb", letterboxd: "Letterboxd", mdb: "MDBList", metacritic: "Metacritic",
  rt_popcorn: "RT-Aud-", rt_tomato: "RT-Crit-", tmdb: "TMDb", serializd: "Serializd", mal: "MAL", star: "Star", critic: "Critic", audience: "Audience",
};
const PERCENT_LOGOS = ["rt_popcorn", "rt_tomato", "tmdb"]; // Kometa writes these as a percentage
const RT_DIRECT = ["mdb_tomatoes", "mdb_tomatoesaudience", "plex_tomatoes", "plex_tomatoesaudience"];

/** One rating badge: `slot` is rating1, rating2 or rating3. Fresh or Rotten art follows the score against fresh_rating. */
function ratingArt(item: PlexItem | null, vars: Vars, slot: string | undefined): LayerArt {
  const source = slot ? vars[slot] : undefined;
  if (typeof source !== "string" || source === "none") return {};
  const chosen = vars[`${slot}_image`];
  const logo = typeof chosen === "string" ? chosen : RATING_LOGOS[source];
  const score = source === "audience" && item?.audience_rating != null ? item.audience_rating : source === "user" ? SAMPLE_USER_SCORE : SAMPLE_CRITIC_SCORE;
  const level = score >= (Number(vars.fresh_rating) || 6) ? "Fresh" : "Rotten";
  // image_extra in ratings.yml (its "Top" art needs a top-list flag Studio doesn't have).
  const rt = logo === "rt_popcorn" || logo === "rt_tomato"; // only Rotten Tomatoes has Direct art
  const extra = rt && RT_DIRECT.includes(source) && level === "Fresh" ? "Direct" : rt || logo === "critic" || logo === "audience" ? level : "";
  const file = LOGO_FILES[logo];
  const text = PERCENT_LOGOS.includes(logo) ? `${Math.round(score * 10)}%` : oneDecimal(score);
  return file ? { image: `rating/${file}${extra}.png`, text } : { text };
}

/** First matching overlay key from Plex content_rating, else a sensible regional default. */
function contentRatingKey(region: "us" | "uk" | "de" | "au" | "nz", rating: string | null | undefined, show: boolean): string {
  const n = (rating ?? "").trim().toLowerCase();
  const has = (...tags: string[]) => tags.some((t) => n === t.toLowerCase() || n.includes(t.toLowerCase()));
  if (has("nr", "not rated", "unrated", "none")) return "nr";
  if (region === "us") {
    if (show) {
      if (has("tv-ma", "ma-17")) return "tv-ma";
      if (has("tv-14", "tv-13")) return "tv-14";
      if (has("tv-pg")) return "tv-pg";
      if (has("tv-y")) return "tv-y"; // TV-Y7 too: content_rating_us_show.yml draws it with the TV-Y art
      if (has("tv-g")) return "tv-g";
      return "tv-14";
    }
    if (has("nc-17", "nc17")) return "nc-17";
    if (has("pg-13")) return "pg-13";
    if (has("r") && !has("pg")) return "r";
    if (has("pg") && !has("13")) return "pg";
    if (has("g")) return "g";
    return "pg-13";
  }
  if (region === "uk") {
    if (has("r18", "gb/r18")) return "r18";
    if (has("18", "gb/18", "tv-ma", "ma-17")) return "18";
    if (has("15", "gb/15")) return "15";
    if (has("12a", "gb/12a")) return "12a";
    if (has("12", "pg-13", "gb/12")) return "12";
    if (has("pg", "gb/pg")) return "pg";
    if (has("u", "gb/u", "g", "tv-g")) return "u";
    return "12a";
  }
  if (region === "de") {
    if (has("bpjm")) return "bpjm";
    if (has("18", "de/18", "nc-17")) return "18";
    if (has("16", "de/16")) return "16";
    if (has("12", "de/12", "pg-13")) return "12";
    if (has("6", "de/6", "pg")) return "6";
    return "12";
  }
  if (region === "au") {
    if (has("x", "x18", "au/x")) return "x";
    if (has("r18", "au/r", "r 18")) return "r";
    if (has("ma15", "ma 15", "au/ma", "tv-ma")) return "ma";
    if (has("m", "au/m", "12")) return "m";
    if (has("pg", "au/pg")) return "pg";
    if (has("g", "au/g", "tv-g")) return "g";
    return "m";
  }
  // nz
  if (has("r18", "18")) return "r18";
  if (has("r16", "16")) return "r16";
  if (has("r15", "15", "ma15")) return "r15";
  if (has("rp13", "14")) return "rp13";
  if (has("r13", "pg-13", "13")) return "r13";
  if (has("m", "12")) return "m";
  if (has("pg")) return "pg";
  return "m";
}

function crPath(region: "us" | "uk" | "de" | "au" | "nz", key: string, vars: Vars): string {
  const color = vars.color === false ? "" : "c";
  const stem = region === "au" || region === "nz" ? `${region}_${key}` : `${region}${key}`;
  return `cr/${stem}${color}.png`;
}

function commonsenseAge(rating: string | null | undefined): string {
  const key = contentRatingKey("us", rating, false);
  if (key === "nr") return "NR";
  const map: Record<string, string> = { g: "6", pg: "10", "pg-13": "13", r: "17", "nc-17": "18" };
  return map[key] ?? SAMPLE_AGE_COMMONSENSE;
}

function runtimeText(vars: Vars): string {
  const prefix = typeof vars.text === "string" ? vars.text : "Runtime: ";
  const format = typeof vars.format === "string" ? vars.format : `${SAMPLE_RUNTIME_H}h ${SAMPLE_RUNTIME_M}m`;
  const body = format
    .replace("<<runtimeH>>", String(SAMPLE_RUNTIME_H))
    .replace("<<runtimeM>>", String(SAMPLE_RUNTIME_M).padStart(2, "0"));
  return `${prefix}${body}`;
}

function languageFlagStyle(vars: Vars): string {
  const style = pickStyle(vars, "style", "round", ["round", "square", "half"]);
  return style === "square" || style === "half" ? "square" : "round";
}

const HANDLERS: Record<string, (item: PlexItem | null, vars: Vars, badge?: string) => LayerArt> = {
  resolution: (item, vars) => {
    const key = item?.video_resolution ? resolutionKey(item.video_resolution) : SAMPLE_RESOLUTION;
    const alt = typeof vars.alt === "string" ? vars.alt : "";
    const file = alt ? `resolution/${key}${alt}.png` : `resolution/${key}.png`;
    return { image: file };
  },
  audio_codec: (item, vars) => {
    const style = pickStyle(vars, "style", "compact", ["compact", "standard"]);
    const plex = item?.audio_codec?.toLowerCase();
    const resolved = (plex && CODEC_TO_KEY[plex]) || SAMPLE_CODEC;
    return { image: `audio_codec/${style}/${resolved}.png` };
  },
  ratings: ratingArt,
  streaming: (_item, vars) => {
    const style = pickStyle(vars, "style", "color", ["color", "white"]);
    const STREAMING_NAMES: Record<string, string> = { netflix: "Netflix", amazon: "Prime Video", disney: "Disney", hbomax: "HBO-Max", hulu: "Hulu" };
    const key = typeof vars.key === "string" ? vars.key.toLowerCase() : "";
    const overlay = STREAMING_NAMES[key] ?? SAMPLE_STREAMING;
    return { image: `streaming/${style}/${overlay}.png` };
  },
  network: (_item, vars) => {
    const style = pickStyle(vars, "style", "color", ["color", "white"]);
    return { image: `network/${style}/${SAMPLE_NETWORK}.png` };
  },
  studio: (_item, vars) => {
    const style = pickStyle(vars, "style", "standard", ["standard", "bigger"]);
    return { image: `studio/${style}/${SAMPLE_STUDIO}.png` };
  },
  ribbon: (_item, vars) => {
    const style = pickStyle(vars, "style", "yellow", ["yellow", "gray", "black", "red"]);
    return { image: `ribbon/${style}/${SAMPLE_RIBBON_KEY}.png` };
  },
  video_format: (_item, vars) => {
    const labels: Record<string, string> = { remux: "REMUX", bluray: "BLU-RAY", web: "WEB", hdtv: "HDTV", dvd: "DVD", sdtv: "SDTV", cam: "CAM", telesync: "TELESYNC" };
    const rawKey = typeof vars.key === "string" ? vars.key : "web";
    const fromVar = typeof vars[`text_${rawKey}`] === "string" ? String(vars[`text_${rawKey}`]) : undefined;
    return { text: fromVar ?? labels[rawKey] ?? SAMPLE_VIDEO_FORMAT };
  },
  runtimes: (_item, vars) => ({ text: runtimeText(vars) }),
  status: (_item, vars) => {
    const key = typeof vars.key === "string" ? vars.key : "returning";
    const textKey = `text_${key}`;
    const text = typeof vars[textKey] === "string" ? String(vars[textKey]) : typeof vars.text === "string" ? vars.text : SAMPLE_STATUS;
    return { text };
  },
  languages: (_item, vars) => {
    const style = languageFlagStyle(vars);
    const country = typeof vars.country === "string" ? vars.country : "us";
    const hide = vars.hide_text === true;
    const lower = vars.use_lowercase === true;
    const label = hide ? " " : lower ? "en" : "EN";
    return { image: `flag/${style}/${country}.png`, text: label };
  },
  language_count: (_item, vars) => {
    const subs = vars.use_subtitles === true;
    const dual = `dual_${subs ? "subs" : "audio"}.png`;
    return { image: dual };
  },
  mediastinger: () => ({ image: "Mediastinger.png" }),
  commonsense: (item, vars) => {
    const age = commonsenseAge(item?.content_rating);
    const pre = age === "NR" ? String(vars.pre_nr_text ?? "") : String(vars.pre_text ?? "");
    const post = age === "NR" ? String(vars.post_nr_text ?? "") : String(vars.post_text ?? "+");
    return { image: "Commonsense.png", text: `${pre}${age}${post}` };
  },
  direct_play: () => ({ image: "Direct-Play.png" }),
  versions: () => ({ image: "versions.png" }),
  aspect: (_item, vars) => {
    const key = typeof vars.key === "string" ? vars.key : SAMPLE_ASPECT;
    const text = typeof vars[`text_${key}`] === "string" ? String(vars[`text_${key}`]) : key;
    return { text };
  },
  episode_info: () => ({
    text: `S${String(SAMPLE_EPISODE.season).padStart(2, "0")}E${String(SAMPLE_EPISODE.episode).padStart(2, "0")}`,
  }),
  content_rating_us_movie: (item, vars) => {
    const key = contentRatingKey("us", item?.content_rating, false);
    return { image: crPath("us", key, vars) };
  },
  content_rating_us_show: (item, vars) => {
    const key = contentRatingKey("us", item?.content_rating, true);
    return { image: crPath("us", key, vars) };
  },
  content_rating_uk: (item, vars) => ({ image: crPath("uk", contentRatingKey("uk", item?.content_rating, item?.type === "show"), vars) }),
  content_rating_de: (item, vars) => ({ image: crPath("de", contentRatingKey("de", item?.content_rating, false), vars) }),
  content_rating_au: (item, vars) => ({ image: crPath("au", contentRatingKey("au", item?.content_rating, false), vars) }),
  content_rating_nz: (item, vars) => ({ image: crPath("nz", contentRatingKey("nz", item?.content_rating, false), vars) }),
};

/** What one badge of overlay default `name` shows on `item`. `vars` are the layer's template variables after
 *  resolveLayout (the default's own values plus the user's). `badge` is the rating slot for `ratings`
 *  ("rating1" | "rating2" | "rating3"), undefined otherwise. Returns {} when Studio can't tell, and the caller keeps the plain box. */
export function layerArt(name: string, item: PlexItem | null, vars: Record<string, unknown>, badge?: string): LayerArt {
  const handler = HANDLERS[name];
  if (!handler) return {}; // unknown default file name
  return handler(item, vars, badge);
}
