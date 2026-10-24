/** Private, owner-scoped document content, independent from editable personal notes. */
export type MaterialSource = {
  id: string;
  name: string;
  text: string;
  source: string;
  requiresReview: boolean;
  reviewed: boolean;
  /** Explicitly reviewed combined text recovered from older saved imports. */
  covers?: string[];
};
export function createMaterialSource(id: string, result: {
  name: string; text: string; source?: string; quality?: string; status?: string;
}): MaterialSource {
  const requiresReview = result.quality === 'needs-review' || result.status === 'truncated' || !result.text.trim();
  return { id, name: result.name, text: result.text, source: result.source ?? 'embedded-text',
    requiresReview, reviewed: !requiresReview };
}
export function reviewMaterialSource(source: MaterialSource, text: string): MaterialSource {
  if (text.trim().length < 10) throw new Error('Cần ít nhất 10 ký tự nội dung đã kiểm tra từ tài liệu.');
  if (text.length > 50000) throw new Error('Nguồn tài liệu vượt 50.000 ký tự. Hãy chọn phần cần học.');
  return {...source, text, reviewed: true};
}
export function quizSourceText(notes: string, sources: MaterialSource[] = [], materials: {name:string;sourceId?:string}[] = []): string | undefined {
  if (!materials.every(material => sources.some(source => (material.sourceId ? source.id === material.sourceId : source.name === material.name || source.covers?.includes(material.name))))) {
    throw new Error('Tài liệu chưa có nội dung nguồn. Hãy nhập lại và kiểm tra trước khi tạo câu hỏi.');
  }
  if (sources.some(source => !source.reviewed)) {
    throw new Error('Hãy kiểm tra và xác nhận nội dung từng tài liệu trước khi tạo câu hỏi bằng AI.');
  }
  if (sources.some(source => source.text.trim().length < 10)) {
    throw new Error('Không đọc được nội dung tài liệu. Hãy đọc lại hoặc nhập bản chép đúng của tài liệu.');
  }
  // Attached documents define the syllabus; personal goals/notes cannot replace them.
  const text = sources.length
    ? sources.map(source => `--- ${source.name} ---\n${source.text.trim()}`).join('\n\n')
    : notes.trim();
  if (text.length > 50000) throw new Error('Nguồn vượt 50.000 ký tự. Hãy chọn phần tài liệu cần học.');
  if (text && text.length < 10) throw new Error('Nội dung cần ít nhất 10 ký tự để tạo câu hỏi.');
  return text || undefined;
}
export function validMaterialSources(value: unknown): value is MaterialSource[] {
  return Array.isArray(value) && value.length <= 10 && value.every(source =>
    source && typeof source === 'object' &&
    ['id','name','text','source'].every(key => typeof source[key] === 'string') &&
    source.text.length <= 50000 && (source.covers === undefined || (Array.isArray(source.covers) && source.covers.length <= 10 && source.covers.every((name: unknown) => typeof name === 'string'))) && typeof source.requiresReview === 'boolean' &&
    typeof source.reviewed === 'boolean');
}

export function recoveredMaterialSource(notes: string, materials: {name:string}[]): MaterialSource {
  return {...createMaterialSource(crypto.randomUUID(),{name:"Tài liệu cũ đã nhập (bản gộp)",text:notes,source:"recovered",quality:"needs-review"}),covers:materials.map(file=>file.name)};
}
