import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutText } from '../src/markedImage.ts';
const measure = text => Array.from(text).length * 10;
test('image wrapping preserves text and source offsets including punctuation and Unicode', () => {
 const text="I have a notebook.\r\n\r\nI have written—three ideas. Don't stop! 😀";
 const layout=layoutText(text,100,measure);
 assert.equal(layout.runs.map(r=>r.text).join(''),text.replace(/\s/gu,''));
 for(const r of layout.runs){assert.equal(text.slice(r.offset,r.offset+r.text.length),r.text);assert.ok(r.x+measure(r.text)<=100);assert.ok(r.line<layout.lines);}
});
test('oversized words wrap without clipping and final line is included',()=>{
 const text='a'.repeat(12000);const layout=layoutText(text,100,measure);
 assert.equal(layout.runs.map(r=>r.text).join(''),text);assert.equal(layout.lines,1200);assert.equal(layout.runs.at(-1).line,1199);
});
test('blank line runs are bounded while paragraph separation remains',()=>{
 assert.equal(layoutText('First\n\nLast',100,measure).runs.at(-1).line,2);
 assert.equal(layoutText('First'+'\n'.repeat(1000)+'Last',100,measure).runs.at(-1).line,2);
});
