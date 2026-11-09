import type { Featured } from "../../components/DefaultVariables";

/** Variables placed in the Place tab rather than Style or More variables. */
export const PLACEMENT = ["horizontal_align", "vertical_align", "horizontal_offset", "vertical_offset", "horizontal_position", "vertical_position", "rating_alignment"];

/** "Add a layer" offers these first: the overlay defaults Kometa setups use most (Studio's own reading of shared configs). */
export const POPULAR_LAYERS = ["resolution", "audio_codec", "ratings", "streaming", "ribbon", "video_format", "runtimes", "status", "network", "studio", "languages", "mediastinger", "versions"];

/** What a newly added layer starts with. Ratings: Kometa's own picks are all none, which draws nothing. plex_tomatoes is
 *  the Rotten Tomatoes score Plex already has, so it needs no API key; Kometa picks each logo from the rating. */
export const STARTING_VARIABLES: Record<string, Record<string, unknown>> = { ratings: { rating1: "imdb", rating2: "plex_tomatoes" } };

/** The controls this default has, besides the anchor. */
export function overlayFeatured(name: string, moved: "align" | "position" | undefined, libraryType: string | null): Featured[] {
  return [
    ...(name === "ratings"
      ? [1, 2, 3].flatMap((n) => [
          // Kometa's ratings default sets rating1–3 to none, so an empty slot draws no badge.
          { key: `rating${n}`, label: `Rating ${n}`, unset: "None (no badge)", ...(n === 1 ? { hint: "Pick at least one rating, or this layer draws nothing." } : {}) },
          { key: `rating${n}_image`, label: `Rating ${n} logo`, unset: "Matches the rating", hint: "Needed for critic, audience and user ratings." },
        ])
      : []),
    ...(name === "ratings" ? [{ key: "rating_alignment", label: "Ratings run" }] : []),
    ...(name === "resolution"
      ? [
          { key: "use_resolution", label: "Resolution badges", switchOn: true },
          { key: "use_edition", label: "Edition badges", switchOn: true },
        ]
      : []),
    ...(name === "streaming" ? [{ key: "originals_only", label: "Originals only", switchOn: false }] : []),
    ...(libraryType === "show" ? [{ key: "builder_level", label: "Draw on", options: { show: "Shows", season: "Seasons", episode: "Episodes" } }] : []),
    { key: "back_color", label: "Back colour", hint: "A hex colour, such as #00000099. The last two digits are opacity." },
    ...(moved === "align" ? [{ key: "back_radius", label: "Radius" }] : []),
  ];
}
