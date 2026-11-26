// Turning a SceneItem's SVG into markup the page can show.

import { api } from "../../../../api";
import { POSTER_HREF } from "../../../../overlayEngineApi";

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The scene's SVG with the title's poster (from Plex, through Studio) where the server left POSTER_HREF. */
export function sceneMarkup(svg: string, thumb: string): string {
  return svg.split(POSTER_HREF).join(escapeAttr(api.plexLibraries.imageUrl(thumb, 1000, 1500)));
}
