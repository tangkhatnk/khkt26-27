import type { MaterialSource } from "./materialSources.ts";

export type RevisionMaterialSourceRecord = {
  id: string;
  sessionId?: string;
  planId?: string | null;
  stepId?: string | null;
  kind?: "note" | "source";
  source: MaterialSource;
  material?: { sourceId?: string; name: string; type: string; status: string; size?: number; message?: string };
};

export type RevisionMaterialWorkspaceRecord = {
  sessionId: string;
  planId: string | null;
  stepId: string | null;
  notes?: string;
  sources?: readonly MaterialSource[];
  materials?: readonly { name: string; type: string; status: string; size?: number; message?: string; sourceId?: string }[];
};

export type RevisionMaterialCollection = {
  current: RevisionMaterialWorkspaceRecord;
  drafts: readonly RevisionMaterialWorkspaceRecord[];
  history: readonly RevisionMaterialWorkspaceRecord[];
};

export type RevisionMaterialEntry = {
  id: string;
  name: string;
  sourceLabel: string;
  reviewState: "reviewed" | "needs-review" | "unreadable";
};

function extensionLabel(name: string): string | undefined {
  const extension = name.match(/\.([a-z0-9]+)$/iu)?.[1]?.toLowerCase();
  if (extension === "pdf") return "Tệp PDF";
  if (extension === "docx" || extension === "odt") return "Tệp DOCX";
  if (extension === "pptx" || extension === "odp") return "Tệp trình chiếu";
  if (["xlsx", "xls", "ods"].includes(extension ?? "")) return "Bảng tính";
  if (["png", "jpg", "jpeg", "webp", "bmp"].includes(extension ?? "")) return "Ảnh";
  return undefined;
}

function sourceLabel(record: RevisionMaterialSourceRecord): string {
  if (record.kind === "note" || record.source.source === "personal-notes") return "Ghi chú học tập";
  if (record.source.source === "ai-generated") return "Bản ôn tập AI";
  const fileLabel = extensionLabel(record.material?.name ?? record.source.name);
  if (fileLabel) return fileLabel;
  if (record.source.source === "embedded-text") return "Ghi chú đã nhập";
  if (record.source.source === "recovered") return "Nội dung khôi phục";
  return "Tài liệu ôn tập";
}

function sameOptionalArray<T>(
  left: readonly T[] | undefined,
  right: readonly T[] | undefined,
  sameItem: (leftItem: T, rightItem: T) => boolean = (leftItem, rightItem) => leftItem === rightItem,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((item, index) => sameItem(item, right[index]));
}

function sameSourceMaterial(
  left: RevisionMaterialSourceRecord["material"],
  right: RevisionMaterialSourceRecord["material"],
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.sourceId === right.sourceId && left.name === right.name && left.type === right.type &&
    left.status === right.status && left.size === right.size && left.message === right.message;
}

function sameExactSourceVersion(
  left: MaterialSource,
  right: MaterialSource,
  leftMaterial: RevisionMaterialSourceRecord["material"],
  rightMaterial: RevisionMaterialSourceRecord["material"],
): boolean {
  return left.id === right.id && left.name === right.name && left.text === right.text &&
    left.source === right.source && left.requiresReview === right.requiresReview && left.reviewed === right.reviewed &&
    sameOptionalArray(left.covers, right.covers) &&
    sameOptionalArray(left.illustrations, right.illustrations,
      (leftIllustration, rightIllustration) => JSON.stringify(leftIllustration) === JSON.stringify(rightIllustration)) &&
    sameSourceMaterial(leftMaterial, rightMaterial);
}

/** Collects private library rows in precedence order: current draft, saved drafts, then history. */
export function collectRevisionMaterialRecords(
  collection: RevisionMaterialCollection,
  removedSessionIds: readonly string[] = [],
): RevisionMaterialSourceRecord[] {
  const removed = new Set(removedSessionIds);
  const seen = new Set<string>();
  const seenSourceVersions = new Map<string, Array<{
    source: MaterialSource;
    material: RevisionMaterialSourceRecord["material"];
  }>>();
  const records: RevisionMaterialSourceRecord[] = [];
  const addWorkspace = (workspace: RevisionMaterialWorkspaceRecord) => {
    if (!workspace.sessionId || removed.has(workspace.sessionId)) return;
    for (const source of workspace.sources ?? []) {
      const id = JSON.stringify([workspace.sessionId, source.id]);
      if (seen.has(id)) continue;
      const material = workspace.materials?.find((item) => item.sourceId === source.id ||
        (!item.sourceId && item.name === source.name));
      const versions = seenSourceVersions.get(source.id);
      if (versions?.some((version) => sameExactSourceVersion(source, version.source, material, version.material))) continue;
      seen.add(id);
      if (versions) versions.push({ source, material });
      else seenSourceVersions.set(source.id, [{ source, material }]);
      records.push({
        id,
        sessionId: workspace.sessionId,
        planId: workspace.planId,
        stepId: workspace.stepId,
        kind: "source",
        source,
        material,
      });
    }
    const notes = workspace.notes?.trim();
    const noteId = JSON.stringify([workspace.sessionId, "notes"]);
    if (!notes || seen.has(noteId)) return;
    seen.add(noteId);
    records.push({
      id: noteId,
      sessionId: workspace.sessionId,
      planId: workspace.planId,
      stepId: workspace.stepId,
      kind: "note",
      source: {
        id: noteId,
        name: "Ghi chú buổi học",
        text: workspace.notes ?? "",
        source: "personal-notes",
        requiresReview: false,
        reviewed: notes.length >= 10,
      },
      material: {
        name: "Ghi chú buổi học",
        type: "text/plain",
        size: new TextEncoder().encode(workspace.notes ?? "").length,
        status: "extracted",
        message: "Ghi chú riêng của người học.",
      },
    });
  };

  addWorkspace(collection.current);
  for (const draft of collection.drafts) addWorkspace(draft);
  for (const session of collection.history) addWorkspace(session);
  return records;
}

export function buildRevisionMaterialEntries(
  records: readonly RevisionMaterialSourceRecord[],
): RevisionMaterialEntry[] {
  return records.map((record) => {
    const unreadable = record.source.text.trim().length < 10 ||
      (!record.source.reviewed && (record.material?.status === "empty" || record.material?.status === "unsupported"));
    return {
      id: record.id,
      name: record.source.name,
      sourceLabel: sourceLabel(record),
      reviewState: unreadable ? "unreadable" : record.kind === "note" || record.source.reviewed ? "reviewed" : "needs-review",
    };
  });
}
