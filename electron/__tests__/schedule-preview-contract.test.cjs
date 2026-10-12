'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const readSource = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('schedule row preview forwards the selected schedule to app-level playback', () => {
  const view = readSource('src/components/JadwalView.tsx');
  const app = readSource('src/App.tsx');

  assert.match(view, /onPreviewSchedule: \(schedule: ScheduleItem\) => Promise<void>;/);

  const handler = view.match(
    /const handlePlaySound = \(item: ScheduleItem\) => \{([\s\S]*?)\n  \};/,
  );
  assert.ok(handler, 'schedule row play handler should exist');
  assert.match(handler[1], /onPreviewSchedule\(item\)/);
  assert.match(handler[1], /\.catch\(\(error: unknown\) =>/);

  assert.match(
    app,
    /onPreviewSchedule=\{\(schedule\) =>\s*playScheduleSound\(schedule, settings\.bellVolume\)\s*\}/,
  );
  assert.match(app, /audioFilesRef\.current\.find\(\(f\) => f\.id === schedule\.soundId\)/);
  assert.match(app, /playSoundByName\(schedule\.soundName, volume, resolved\.url\)/);
});

test('schedule sound test sequence remains on its existing direct-name path', () => {
  const view = readSource('src/components/JadwalView.tsx');
  const sequence = view.match(
    /const handleTestSequence = async \(\) => \{([\s\S]*?)\n  \};/,
  );

  assert.ok(sequence, 'test sequence handler should exist');
  assert.match(sequence[1], /playSoundByName\(item\.soundName, settings\.bellVolume\)/);
  assert.doesNotMatch(sequence[1], /onPreviewSchedule/);
});