import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHorizontalSwipe } from '../../web/js/swipe-nav.js';

test('isHorizontalSwipe: clear horizontal drag passes', () => {
  assert.equal(isHorizontalSwipe(120, 10, 80, 1.3), true);
  assert.equal(isHorizontalSwipe(-100, 0, 80, 1.3), true);
});

test('isHorizontalSwipe: too short does not pass', () => {
  assert.equal(isHorizontalSwipe(40, 0, 80, 1.3), false);
});

test('isHorizontalSwipe: vertical-dominant drag does not pass', () => {
  assert.equal(isHorizontalSwipe(90, 90, 80, 1.3), false); // dx not > 1.3*dy
  assert.equal(isHorizontalSwipe(30, 200, 80, 1.3), false);
});
