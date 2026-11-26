// Keep in sync with starr_studio/overlay_engine/facts.py PLACEHOLDERS and FACT_NAMES,
// starr_studio/overlay_engine/style.py LOGOS, and starr_studio/overlay_engine/fonts.py FONTS.

export const PLACEHOLDER_KEYS = [
  "title",
  "year",
  "resolution",
  "hdr",
  "audio_codec",
  "channels",
  "audio",
  "edition",
  "imdb",
  "rt_critic",
  "rt_audience",
  "tmdb",
  "content_rating",
  "runtime",
] as const;

export const FACT_NAMES = [
  "type",
  "title",
  "year",
  "resolution",
  "hdr",
  "audio_codec",
  "atmos",
  "dts_x",
  "channels",
  "edition",
  "imdb",
  "rt_critic",
  "rt_audience",
  "tmdb",
  "content_rating",
  "runtime_minutes",
] as const;

export const LOGOS = ["imdb", "rt_fresh", "rt_rotten", "rt_audience_upright", "rt_audience_spilled", "tmdb"] as const;

export const FONTS = ["Inter Regular", "Inter Medium", "Inter SemiBold", "Inter Bold", "Inter ExtraBold", "Inter Black"] as const;

export const BOX_KEYS = ["left", "right", "centre_x", "top", "bottom", "centre_y", "width", "height"] as const;

export const ALIGNMENTS = ["start", "centre", "end"] as const;