import type { DefaultEntry, FileReference } from "../../api";
import type { Values } from "../../components/DefaultVariables";

export type Layer = { name: string; title: string; entry: DefaultEntry | undefined; reference: FileReference; variables: Values };
