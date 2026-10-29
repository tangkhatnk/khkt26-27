import {
  applyStudyExerciseTextImport,
  isCurrentStudyExerciseTextImport,
  STUDY_EXERCISE_TEXT_LIMIT,
} from "./studyExercises.ts";
import type {
  StudyExerciseTextImportAction,
  StudyExerciseTextImportScope,
} from "./studyExercises.ts";
import type { MaterialExtractionOptions, MaterialFileResult } from "./materialExtraction.ts";

export type StudyExerciseTextImportState = {
  fileName: string;
  text: string;
  message: string;
  error: string;
  extracting: boolean;
  progress: number;
};

export const EMPTY_STUDY_EXERCISE_TEXT_IMPORT: StudyExerciseTextImportState = {
  fileName: "",
  text: "",
  message: "",
  error: "",
  extracting: false,
  progress: 0,
};

type ExerciseTextImportContext = Pick<StudyExerciseTextImportScope, "plannedSessionId" | "mode">;
type ExtractFile = (file: File, options: MaterialExtractionOptions) => Promise<MaterialFileResult>;

const extractLocalMaterialFile: ExtractFile = async (file, options) => {
  const { extractMaterialFile } = await import("./materialExtraction.ts");
  return extractMaterialFile(file, options);
};

export class StudyExerciseTextImportController {
  private generation = 0;
  private context: ExerciseTextImportContext = { plannedSessionId: "", mode: "provided" };
  private abortController: AbortController | null = null;
  private state = EMPTY_STUDY_EXERCISE_TEXT_IMPORT;
  private readonly onStateChange: (state: StudyExerciseTextImportState) => void;
  private readonly extractFile: ExtractFile;
  private readonly getCurrentContext: () => ExerciseTextImportContext;

  constructor(
    onStateChange: (state: StudyExerciseTextImportState) => void,
    extractFile: ExtractFile = extractLocalMaterialFile,
    getCurrentContext?: () => ExerciseTextImportContext,
  ) {
    this.onStateChange = onStateChange;
    this.extractFile = extractFile;
    this.getCurrentContext = getCurrentContext ?? (() => this.context);
  }

  private publish(state: StudyExerciseTextImportState) {
    this.state = state;
    this.onStateChange(state);
  }

  private invalidateCurrentRequest() {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
  }

  setContext(context: ExerciseTextImportContext) {
    if (this.context.plannedSessionId === context.plannedSessionId && this.context.mode === context.mode) return;
    this.invalidateCurrentRequest();
    this.context = context;
    this.publish(EMPTY_STUDY_EXERCISE_TEXT_IMPORT);
  }

  cancel(message = "") {
    this.invalidateCurrentRequest();
    this.publish({ ...EMPTY_STUDY_EXERCISE_TEXT_IMPORT, message });
  }

  async start(file: File, context: ExerciseTextImportContext) {
    this.setContext(context);
    this.abortController?.abort();
    const generation = ++this.generation;
    const scope: StudyExerciseTextImportScope = { ...context, generation };
    const controller = new AbortController();
    this.abortController = controller;
    this.publish({ ...EMPTY_STUDY_EXERCISE_TEXT_IMPORT, fileName: file.name, extracting: true });

    const isCurrent = () => !controller.signal.aborted && generation === this.generation &&
      isCurrentStudyExerciseTextImport(scope, { ...this.getCurrentContext(), generation: this.generation });

    try {
      const result: MaterialFileResult = await this.extractFile(file, {
        maxTextChars: STUDY_EXERCISE_TEXT_LIMIT,
        signal: controller.signal,
        onProgress: event => {
          if (isCurrent()) this.publish({ ...this.state, progress: Math.round(event.progress * 100) });
        },
      });
      if (!isCurrent()) return;
      if ((result.status === "extracted" || result.status === "truncated") && result.text.trim()) {
        this.publish({
          fileName: result.name,
          text: result.text,
          message: result.message,
          error: "",
          extracting: true,
          progress: this.state.progress,
        });
      } else if (result.status !== "cancelled") {
        this.publish({
          ...EMPTY_STUDY_EXERCISE_TEXT_IMPORT,
          fileName: result.name,
          message: result.message,
          error: result.message,
          extracting: true,
        });
      }
    } catch {
      if (isCurrent()) this.publish({
        ...EMPTY_STUDY_EXERCISE_TEXT_IMPORT,
        fileName: file.name,
        error: "Không đọc được nội dung tệp này. Hãy thử tệp hoặc ảnh khác.",
        extracting: true,
      });
    } finally {
      if (isCurrent()) {
        this.abortController = null;
        this.publish({ ...this.state, extracting: false, progress: 0 });
      }
    }
  }

  editText(text: string) {
    if (this.state.fileName && !this.state.extracting) this.publish({ ...this.state, text });
  }

  apply(currentText: string, action: StudyExerciseTextImportAction) {
    return applyStudyExerciseTextImport(currentText, this.state.text, action);
  }

  dispose() {
    this.invalidateCurrentRequest();
  }
}
