import test from 'node:test';
import assert from 'node:assert/strict';
import { studyGuideSource, studyGuideDownload } from '../src/adventure/studyGuide.ts';
import { quizSourceText, reviewMaterialSource } from '../src/adventure/materialSources.ts';

const draft = { title: 'Cấu trúc tế bào', text: 'Tế bào là đơn vị cấu trúc và chức năng cơ bản của cơ thể sống.\nNhân chứa vật chất di truyền; màng tế bào điều hòa trao đổi chất.' };
test('an AI guide requires explicit review before it can become a quiz source', () => {
  const source = studyGuideSource('guide-1', draft);
  assert.equal(source.reviewed, false);
  assert.equal(source.requiresReview, true);
  assert.throws(() => quizSourceText('', [source]), /kiểm tra/);
  const accepted = reviewMaterialSource(source, source.text);
  assert.match(quizSourceText('', [accepted]), /Nhân chứa vật chất di truyền/);
});
test('the downloaded guide preserves the user-edited content and its AI origin', () => {
  const edited = { ...draft, text: `${draft.text}\nGhi chú đã sửa: ti thể tạo ATP.` };
  const exported = studyGuideDownload(edited);
  assert.match(exported, /Cấu trúc tế bào/);
  assert.match(exported, /Ghi chú đã sửa: ti thể tạo ATP/);
  assert.match(exported, /AI/);
  assert.match(studyGuideSource('guide-2', edited).text, /ti thể tạo ATP/);
});
test('blank and oversized edited guides cannot be accepted or downloaded', () => {
  for (const value of [{title:'',text:draft.text}, {title:draft.title,text:' '}, {title:draft.title,text:'a'.repeat(20001)}]) {
    assert.throws(() => studyGuideSource('guide-3', value));
    assert.throws(() => studyGuideDownload(value));
  }
});
