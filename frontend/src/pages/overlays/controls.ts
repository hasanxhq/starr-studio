import type { Featured } from "../../components/DefaultVariables";

/** Variables placed in the Place tab rather than Style or More variables. */
export const PLACEMENT = ["horizontal_align", "vertical_align", "horizontal_offset", "vertical_offset", "horizontal_position", "vertical_position", "rating_alignment"];

/** The controls this default has, besides the anchor. */
export function overlayFeatured(name: string, moved: "align" | "position" | undefined, libraryType: string | null): Featured[] {
  return [
    ...(name === "ratings"
      ? [1, 2, 3].flatMap((n) => [
          { key: `rating${n}`, label: `Rating ${n}` },
          { key: `rating${n}_image`, label: `Rating ${n} logo`, hint: "Needed for critic, audience and user ratings." },
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
