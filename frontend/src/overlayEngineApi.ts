// Studio's own overlay engine (docs/plans/overlay-engine.md, Phases 3–4): style files, each library's chosen style,
// the poster gallery, apply / restore, and the editor's scene and samples. Routes in starr_studio/overlay_engine_routes.py.

import { errorFrom, request, SIGNED_OUT_EVENT } from "./api";
import { urlBase } from "./base";

async function failed(response: Response): Promise<never> {
  if (response.status === 401) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  throw await errorFrom(response);
}

const BASE = "/overlay-engine";
const enc = encodeURIComponent;

export type StyleOption = {
  type: "colour" | "percent" | "number" | "choice" | "toggle" | "text";
  label: string;
  default: unknown;
  min?: number;
  max?: number;
  choices?: string[];
  choice_labels?: Record<string, string>; // what to show for a choice; the choice itself where missing
  multiple?: boolean;
};

export type StyleSummary = {
  id: string; // file name without .yml
  shipped: boolean; // read-only; duplicate to edit
  name: string;
  description: string;
  options: Record<string, StyleOption>;
  error: string | null; // a hand-edited file that doesn't load
};

export type StyleDetail = StyleSummary & { yaml: string };

export type LibraryStyle = { style: string; values: Record<string, unknown>; saved: boolean };

export type GalleryPoster = {
  rating_key: string;
  title: string;
  year: number | null;
  thumb: string | null; // for api.plex.imageUrl
  studio_poster: boolean; // Plex shows Studio's poster now
  style: string | null;
  applied_at: number | null;
  restored_at: number | null;
};

export type OutcomeKind = "draw" | "redraw" | "replaced" | "skip" | "excluded" | "restore" | "unchanged" | "error";
export type Outcome = { rating_key: string; title: string; kind: OutcomeKind; message: string; done: boolean };
export type OutcomeList = { dry_run: boolean; outcomes: Outcome[] };

/** Leave style and yaml out to use the library's chosen style and saved values. */
export type ApplyBody = {
  library: string;
  rating_keys: string[]; // 1–50
  style?: string;
  yaml?: string;
  values?: Record<string, unknown>;
  dry_run?: boolean; // true unless false is passed
  force?: boolean; // Repair: redraw even when up to date
};

export type PreviewBody = { rating_key: string; library?: string; style?: string; yaml?: string; values?: Record<string, unknown> };

/** In a SceneItem's svg, where the poster's URL goes: editor/model/scene.ts sceneMarkup() fills it in. */
export const POSTER_HREF = "studio-poster:";

/** x, y, width, height in poster units (the poster is 1000 × 1500). */
export type SceneBox = [number, number, number, number];

/** One title in the editor: its SVG (each element in <g data-path="elements.1.children.0">) and each drawn element's
 *  box by path. An element the style hides on this title has no box. error: Plex couldn't be read for this title. */
export type SceneItem =
  | { rating_key: string; title: string; year: number | null; thumb: string; svg: string; boxes: Record<string, SceneBox>; error?: undefined }
  | { rating_key: string; error: string };

export type SceneBody = { library: string; rating_keys: string[]; style?: string; yaml?: string; values?: Record<string, unknown> };

export type Sample = { rating_key: string; title: string; year: number | null; thumb: string; traits: string[] };

export const overlayEngine = {
  schema: () => request<Record<string, unknown>>("GET", `${BASE}/style-schema`),
  styles: {
    list: () => request<StyleSummary[]>("GET", `${BASE}/styles`),
    get: (id: string) => request<StyleDetail>("GET", `${BASE}/styles/${enc(id)}`),
    save: (id: string, yaml: string) => request<StyleDetail>("PUT", `${BASE}/styles/${enc(id)}`, { yaml }),
    duplicate: (id: string, newId?: string) => request<StyleDetail>("POST", `${BASE}/styles/${enc(id)}/duplicate`, newId ? { id: newId } : {}),
    remove: (id: string) => request<void>("DELETE", `${BASE}/styles/${enc(id)}`),
    /** A zip of the style file and any custom logos and fonts it uses. */
    exportUrl: (id: string) => `${urlBase}/api/v1${BASE}/styles/${enc(id)}/export`,
    /** A .zip from exportUrl, or a bare .yml, sent as the raw body (Studio has no multipart). The id defaults to the
     *  file's name; 409 if it's taken. */
    import: async (file: File, id?: string): Promise<StyleDetail> => {
      const query = `filename=${enc(file.name)}${id ? `&id=${enc(id)}` : ""}`;
      const response = await fetch(`${urlBase}/api/v1${BASE}/styles/import?${query}`, {
        method: "POST",
        headers: { "Content-Type": file.name.toLowerCase().endsWith(".zip") ? "application/zip" : "application/yaml" },
        body: file,
      });
      if (!response.ok) await failed(response);
      return (await response.json()) as StyleDetail;
    },
  },
  library: {
    style: (library: string) => request<LibraryStyle>("GET", `${BASE}/libraries/${enc(library)}/style`),
    setStyle: (library: string, style: string, values: Record<string, unknown>) =>
      request<LibraryStyle>("PUT", `${BASE}/libraries/${enc(library)}/style`, { style, values }),
    posters: (library: string, { q = "", start = 0, size = 48 }: { q?: string; start?: number; size?: number } = {}) =>
      request<{ items: GalleryPoster[]; start: number; total: number }>(
        "GET",
        `${BASE}/libraries/${enc(library)}/posters?start=${start}&size=${size}${q ? `&q=${enc(q)}` : ""}`,
      ),
  },
  /** The editor's scene for 1–12 titles (see SceneItem). */
  scene: (body: SceneBody) => request<{ items: SceneItem[] }>("POST", `${BASE}/scene`, body),
  /** Up to count (≤ 12) varied titles to try a style on; traits say what kind each is, e.g. "resolution:4K", "rt:no". */
  samples: (library: string, count = 12) => request<{ items: Sample[] }>("GET", `${BASE}/libraries/${enc(library)}/samples?count=${count}`),
  apply: (body: ApplyBody) => request<OutcomeList>("POST", `${BASE}/apply`, body),
  restore: (library: string, ratingKeys: string[], dryRun = true) =>
    request<OutcomeList>("POST", `${BASE}/restore`, { library, rating_keys: ratingKeys, dry_run: dryRun }),
  /** The JPEG the engine would upload, as a blob (revoke the object URL you make from it). */
  preview: async (body: PreviewBody): Promise<Blob> => {
    const response = await fetch(`${urlBase}/api/v1${BASE}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) await failed(response);
    return response.blob();
  },
};
