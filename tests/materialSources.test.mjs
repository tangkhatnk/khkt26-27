import test from 'node:test';
import assert from 'node:assert/strict';
import { quizSourceText, createMaterialSource, reviewMaterialSource } from '../src/adventure/materialSources.ts';
const result = (overrides={}) => ({name:'Vocabulary.pdf',text:'cater: phục vụ\nprinciple: nguyên lý',source:'local-ocr',quality:'needs-review',...overrides});
test('clearing personal notes keeps the verified attached source as the quiz basis',()=>{
 const source=reviewMaterialSource(createMaterialSource('source-1',result()),'cater: phục vụ\nprinciple: nguyên lý');
 assert.match(quizSourceText('',[source],[{name:'Vocabulary.pdf'}]),/principle: nguyên lý/);
});
test('unreviewed OCR is rejected instead of becoming a generic topic quiz',()=>{
 const source=createMaterialSource('source-1',result());
 assert.throws(()=>quizSourceText('',[source],[{name:'Vocabulary.pdf'}]),/kiểm tra/);
});
test('old attached files with lost text cannot silently fall back to the topic',()=>{
 assert.throws(()=>quizSourceText('',[],[{name:'Vocabulary.pdf'}]),/nội dung/);
});
test('reviewing blank OCR never marks an unreadable document ready',()=>{
 assert.throws(()=>reviewMaterialSource(createMaterialSource('s',result()),' '),/nội dung/);
});
test('source budget rejects overflowing documents without silently dropping later files',()=>{
 const sources=[createMaterialSource('a',result({name:'a',text:'A'.repeat(30000),source:'embedded-text',quality:undefined})),createMaterialSource('b',result({name:'b',text:'B'.repeat(30000),source:'embedded-text',quality:undefined}))];
 assert.throws(()=>quizSourceText('',sources,[{name:'a'},{name:'b'}]),/50.000/);
});
test('a user-reviewed combined legacy source repairs multiple old file metadata records',()=>{
 const legacy={...reviewMaterialSource(createMaterialSource('legacy',result({name:'Nguồn cũ'})),result().text),covers:['a.pdf','b.docx']};
 assert.match(quizSourceText('',[legacy],[{name:'a.pdf'},{name:'b.docx'}]),/principle/);
});
test('partial selectable text is not silently approved as a complete source',()=>{
 const partial=createMaterialSource('part',result({source:'embedded-text',quality:undefined,status:'truncated'}));
 assert.equal(partial.reviewed,false);assert.throws(()=>quizSourceText('',[partial],[{name:'Vocabulary.pdf'}]),/kiểm tra/);
});
