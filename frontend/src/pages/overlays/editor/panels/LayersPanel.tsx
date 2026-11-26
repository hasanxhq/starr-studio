import { useEditor } from "../EditorContext";
import { outline, removeElement, reorderElement, type OutlineNode } from "../model/styleDoc";
import { Button, Field, inputClass } from "../../../../components/ui";
import { ADD_KINDS, addKind, canRemove, siblingCount, siblingIndex } from "./styleHelpers";

export function LayersPanel() {
  const { text, selection, select, edit, scene, readOnly } = useEditor();
  let nodes: OutlineNode[] | null = null;
  try {
    nodes = outline(text);
  } catch {
    nodes = null;
  }

  const sceneReady = scene !== undefined && "boxes" in scene;
  const boxes = sceneReady ? scene.boxes : {};

  const onSelect = (path: string, shift: boolean) => {
    if (shift) {
      if (selection.includes(path)) select(selection.filter((p) => p !== path));
      else select([...selection, path]);
    } else select([path]);
  };

  const yamlOk = nodes !== null;

  const add = (kind: (typeof ADD_KINDS)[number]["key"]) => {
    edit((t) => {
      const { text: next, path: newPath } = addKind(t, selection, kind);
      select([newPath]);
      return next;
    });
  };

  return (
    <section aria-label="Layers" className="flex max-h-[min(70vh,40rem)] flex-col gap-2 rounded-card border border-border bg-surface p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Layers</h3>
        {!readOnly && yamlOk && (
          <Field label="Add">
            <select
              aria-label="Add element"
              className={`${inputClass} text-xs`}
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value as (typeof ADD_KINDS)[number]["key"];
                if (v) add(v);
                e.target.value = "";
              }}
            >
              <option value="">Add…</option>
              {ADD_KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {nodes === null ? (
        <p className="text-muted">The file has a problem: fix it in the YAML view</p>
      ) : nodes.length === 0 ? (
        <p className="text-muted">No elements yet.</p>
      ) : (
        <ul role="tree" className="min-h-0 flex-1 overflow-y-auto">
          {nodes.map((node) => (
            <LayerRow key={node.path} node={node} depth={0} selection={selection} boxes={boxes} sceneReady={sceneReady} readOnly={readOnly} yamlOk={yamlOk} onSelect={onSelect} text={text} edit={edit} select={select} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LayerRow({
  node,
  depth,
  selection,
  boxes,
  sceneReady,
  readOnly,
  yamlOk,
  onSelect,
  text,
  edit,
  select,
}: {
  node: OutlineNode;
  depth: number;
  selection: string[];
  boxes: Record<string, number[]>;
  sceneReady: boolean;
  readOnly: boolean;
  yamlOk: boolean;
  onSelect: (path: string, shift: boolean) => void;
  text: string;
  edit: (fn: (t: string) => string) => void;
  select: (paths: string[]) => void;
}) {
  const selected = selection.includes(node.path);
  const sole = selection.length === 1 && selection[0] === node.path;
  const hidden = sceneReady && !boxes[node.path];
  const idx = siblingIndex(node.path);
  const count = siblingCount(text, node.path);
  const removable = canRemove(text, node.path);

  const reorder = (to: number) => {
    edit((t) => {
      const { text: next, path: newPath } = reorderElement(t, node.path, to);
      select([newPath]);
      return next;
    });
  };

  const del = () => {
    edit((t) => removeElement(t, node.path));
    select([]);
  };

  return (
    <li role="treeitem" aria-expanded={node.children.length > 0 ? true : undefined} aria-selected={selected}>
      <div className="flex items-start gap-1" style={{ paddingLeft: depth * 12 }}>
        <button
          type="button"
          className={`min-w-0 flex-1 rounded px-1 py-0.5 text-left ${selected ? "bg-accent/15 ring-1 ring-accent/40" : "hover:bg-surface-raised"}`}
          onClick={(e) => onSelect(node.path, e.shiftKey)}
        >
          <span className="block truncate font-medium">{node.label}</span>
          <span className="text-xs text-muted">{node.type}</span>
          {hidden && <span className="block text-xs text-muted">hidden on this title</span>}
        </button>
        {sole && !readOnly && yamlOk && (
          <div className="flex shrink-0 flex-col gap-0.5">
            <Button
              disabled={idx >= count - 1}
              title="Bring forward"
              aria-label="Move up"
              className="!min-h-0 !px-1 !py-0 text-xs"
              onClick={() => reorder(idx + 1)}
            >
              ↑
            </Button>
            <Button
              disabled={idx <= 0}
              title="Send backward"
              aria-label="Move down"
              className="!min-h-0 !px-1 !py-0 text-xs"
              onClick={() => reorder(idx - 1)}
            >
              ↓
            </Button>
            <Button variant="danger" disabled={!removable} title="Delete" aria-label="Delete" className="!min-h-0 !px-1 !py-0 text-xs" onClick={del}>
              ×
            </Button>
          </div>
        )}
      </div>
      {node.children.length > 0 && (
        <ul role="group">
          {node.children.map((child) => (
            <LayerRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selection={selection}
              boxes={boxes}
              sceneReady={sceneReady}
              yamlOk={yamlOk}
              readOnly={readOnly}
              onSelect={onSelect}
              text={text}
              edit={edit}
              select={select}
            />
          ))}
        </ul>
      )}
    </li>
  );
}