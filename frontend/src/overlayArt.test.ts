declare const process: { cwd(): string };

// @ts-expect-error vitest runs in Node; frontend tsconfig only lists DOM libs
import { existsSync } from "node:fs";
// @ts-expect-error vitest runs in Node; frontend tsconfig only lists DOM libs
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { PlexItem } from "./api";
import { layerArt } from "./overlayArt";

// vitest cwd is frontend/; test file lives at frontend/src (spec: ../../kometa from here)
const kometaImages = join(process.cwd(), "..", "kometa", "defaults", "overlays", "images");

const item = (overrides: Partial<PlexItem> = {}): PlexItem => ({
  rating_key: "1",
  title: "Sample Title",
  type: "movie",
  year: 2020,
  thumb: null,
  ids: {},
  content_rating: "PG-13",
  audience_rating: 7.84,
  episodes: null,
  added_at: null,
  video_resolution: "4k",
  audio_codec: "truehd",
  ...overrides,
});

const OVERLAY_DEFAULTS = [
  "resolution",
  "audio_codec",
  "ratings",
  "streaming",
  "ribbon",
  "video_format",
  "runtimes",
  "status",
  "network",
  "studio",
  "languages",
  "language_count",
  "mediastinger",
  "commonsense",
  "direct_play",
  "versions",
  "aspect",
  "episode_info",
  "content_rating_us_movie",
  "content_rating_us_show",
  "content_rating_uk",
  "content_rating_de",
  "content_rating_au",
  "content_rating_nz",
] as const;

describe("layerArt", () => {
  it("maps resolution from the title, and falls back to 4K without an item", () => {
    expect(layerArt("resolution", item({ video_resolution: "1080" }), {})).toEqual({ image: "resolution/1080p.png" });
    expect(layerArt("resolution", null, {})).toEqual({ image: "resolution/4k.png" });
  });

  it("honours audio codec style folders and maps Plex codecs", () => {
    expect(layerArt("audio_codec", item({ audio_codec: "eac3" }), {})).toEqual({ image: "audio_codec/compact/plus.png" });
    expect(layerArt("audio_codec", item({ audio_codec: "wma" }), { style: "standard" })).toEqual({ image: "audio_codec/standard/truehd.png" });
    expect(layerArt("audio_codec", null, {})).toEqual({ image: "audio_codec/compact/truehd.png" });
  });

  it("draws content ratings and audience scores from the item", () => {
    expect(layerArt("content_rating_us_movie", item({ content_rating: "R" }), {})).toEqual({ image: "cr/usrc.png" });
    expect(layerArt("content_rating_us_movie", item({ content_rating: "unknown-mpaa" }), {})).toEqual({ image: "cr/uspg-13c.png" });
    expect(layerArt("ratings", item(), { rating1: "audience" }, "rating1")).toEqual({ image: "rating/AudienceFresh.png", text: "7.8" });
    expect(layerArt("ratings", item({ audience_rating: null }), { rating2: "critic" }, "rating2")).toEqual({ image: "rating/CriticFresh.png", text: "8.2" });
  });

  it("draws ratings the way ratings.yml does: the slot's source, its chosen logo and Fresh or Rotten", () => {
    expect(layerArt("ratings", item(), { rating1: "critic", rating1_image: "rt_tomato" }, "rating1")).toEqual({ image: "rating/RT-Crit-Fresh.png", text: "82%" });
    expect(layerArt("ratings", item(), { rating1: "plex_tomatoes" }, "rating1")).toEqual({ image: "rating/RT-Crit-Direct.png", text: "82%" });
    expect(layerArt("ratings", item(), { rating1: "critic", fresh_rating: 9 }, "rating1")).toEqual({ image: "rating/CriticRotten.png", text: "8.2" });
    expect(layerArt("ratings", item(), { rating3: "imdb" }, "rating3")).toEqual({ image: "rating/IMDb.png", text: "8.2" });
    expect(layerArt("ratings", item(), { rating1: "none" }, "rating1")).toEqual({});
  });

  it("covers text-only and image defaults with sensible samples", () => {
    expect(layerArt("runtimes", null, {})).toEqual({ text: "Runtime: 2h 14m" });
    expect(layerArt("status", null, {})).toEqual({ text: "RETURNING" });
    expect(layerArt("streaming", null, { style: "white" })).toEqual({ image: "streaming/white/Netflix.png" });
    expect(layerArt("ribbon", null, { style: "red" })).toEqual({ image: "ribbon/red/golden.png" });
    expect(layerArt("languages", null, { style: "square" })).toEqual({ image: "flag/square/us.png", text: "EN" });
    expect(layerArt("episode_info", null, {})).toEqual({ text: "S01E05" });
    expect(layerArt("video_format", null, { key: "bluray" })).toEqual({ text: "BLU-RAY" });
  });

  it("returns something for every Kometa overlay default name", () => {
    for (const name of OVERLAY_DEFAULTS) {
      const art = layerArt(name, item(), name === "ratings" ? { rating1: "audience" } : {}, name === "ratings" ? "rating1" : undefined);
      expect(art.image ?? art.text, name).toBeTruthy();
    }
  });
});

describe.skipIf(!existsSync(kometaImages))("Kometa overlay images", () => {
  const collectImages = (): string[] => {
    const paths = new Set<string>();
  const matrix: { item: PlexItem | null; vars: Record<string, unknown>; badge?: string }[] = [
      { item: null, vars: {} },
      { item: item(), vars: { style: "standard", color: false } },
      { item: item({ type: "show", content_rating: "TV-MA" }), vars: { style: "white", image_level: "Rotten" } },
      { item: item({ video_resolution: "720", audio_codec: "aac", content_rating: "G" }), vars: { style: "compact", use_subtitles: true, rating1: "tmdb", rating2: "user", rating3: "plex_tomatoesaudience" } },
      { item: item({ audience_rating: 3 }), vars: { rating1: "critic", rating2: "audience", rating3: "mdb_letterboxd", rating1_image: "rt_popcorn" } },
      { item: item({ type: "show", content_rating: "TV-Y7", video_resolution: "1440" }), vars: { rating1: "mdb_tomatoes", rating1_image: "imdb", rating2: "plex_tomatoesaudience" } },
      { item: item({ type: "show", content_rating: "TV-Y", video_resolution: "360" }), vars: {} },
    ];
    for (const name of OVERLAY_DEFAULTS) {
      for (const row of matrix) {
        const badges = name === "ratings" ? ["rating1", "rating2", "rating3"] : [undefined];
        for (const badge of badges) {
          const art = layerArt(name, row.item, row.vars, badge);
          if (art.image) paths.add(art.image);
        }
      }
    }
    return [...paths];
  };

  it("only returns image paths that exist under defaults/overlays/images", () => {
    const missing: string[] = [];
    for (const rel of collectImages()) {
      if (!existsSync(join(kometaImages, rel))) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });
});
