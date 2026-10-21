import test from 'node:test';
import assert from 'node:assert/strict';
import { canDrawPointer, isStylusTouch } from '../src/canvasInput.ts';

test('finger pressure never identifies a touch as Apple Pencil', () => {
  assert.equal(isStylusTouch({ touchType: 'direct', force: 1 }), false);
  assert.equal(isStylusTouch({ force: 0.5 }), false);
  assert.equal(isStylusTouch({ touchType: 'stylus', force: 0 }), true);
  assert.equal(isStylusTouch({ touchType: 'pencil', force: 0.5 }), true);
});
test('pen/mouse mode rejects fingers and unknown pointer types', () => {
  assert.equal(canDrawPointer('stylus', 'touch'), false);
  assert.equal(canDrawPointer('stylus', ''), false);
  assert.equal(canDrawPointer('stylus', 'mouse'), true);
  assert.equal(canDrawPointer('stylus', 'pen'), true);
  assert.equal(canDrawPointer('all', 'touch'), true);
});
