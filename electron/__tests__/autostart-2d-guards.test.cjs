'use strict';

/**
 * B5.2 F-03 Unit 2D — static guards and protected-surface verification.
 *
 * Unit 2D's handler lives inside a React component, and the repository has no
 * DOM test infrastructure and Unit 2D may not add one. The properties that
 * matter most for this unit — ordering (OS before persistence), the refusal
 * path never touching the preference, no observed → persisted write-back, and
 * an unchanged contract/surface — are structural, so they are asserted
 * structurally rather than through a mock of the component.
 *
 * These assertions deliberately target *structure* (statement order, absence of
 * an import, presence of a guard) rather than formatting. Whitespace, comments
 * and line wrapping are not asserted on.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const md5 = (rel) =>
  crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');

/** Slice a named region out of a source file. */
function region(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `start marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `end marker not found: ${endMarker}`);
  return source.slice(start, end + endMarker.length);
}

/**
 * Strip comments so banned-token scans judge code, not prose.
 *
 * Unit 2D's own comments legitimately *name* the APIs it refuses to use
 * (`ipcRenderer`, `window.electron`), so a raw substring scan would fail on the
 * documentation that describes the constraint. String literals are left intact.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const APP = 'src/App.tsx';
const VIEW = 'src/components/PengaturanView.tsx';

const appSource = read(APP);
const viewSource = read(VIEW);
const appCode = stripComments(appSource);
const viewCode = stripComments(viewSource);

// The auto-start toggle handler, and the observed-state read effect.
const handler = region(
  appSource,
  'const handleToggleAutoStart = useCallback(async () => {',
  '}, [autoStartUiInput, reportStorageFailure]);',
);
const readEffect = region(
  appSource,
  'const autoStartSurfaceActive =',
  '}, [autoStartSurfaceActive]);',
);

const at = (haystack, needle) => {
  const i = haystack.indexOf(needle);
  assert.notEqual(i, -1, `expected to find: ${needle}`);
  return i;
};

// ---------------------------------------------------------------------------
// §13 Critical ordering rule
// ---------------------------------------------------------------------------

test('13. the OS operation happens before the preference is updated', () => {
  const setCall = at(handler, 'await setAutoStartEnabled(requested)');
  const refusal = at(handler, 'if (!result.supported) return;');
  const persist = at(handler, 'setSettings(next)');

  assert.ok(setCall < refusal, 'the OS must be asked first');
  assert.ok(refusal < persist, 'the refusal path must return before any preference update');
});

test('13. the preference is updated before it is persisted', () => {
  assert.ok(at(handler, 'setSettings(next)') < at(handler, 'await commitSettings(next)'));
});

test('13. persistence is awaited and inspected, never fired and forgotten', () => {
  assert.ok(handler.includes('await commitSettings(next)'));
  assert.equal(
    handler.indexOf('void commitSettings'),
    -1,
    'the auto-start path must not use the fire-and-forget form',
  );
  assert.ok(at(handler, 'await commitSettings(next)') < at(handler, 'if (!persisted.ok)'));
  // Unit 2D originally asserted here that the incidental settings effect still
  // used the fire-and-forget form, proving Unit 2D had not rewritten it. B5
  // Volume F-05 then deliberately rewrote that effect to debounce, flush and
  // inspect the commit, so the pinned shape no longer exists -- and never was a
  // property worth keeping. The invariant that does matter is its inverse: NO
  // settings commit anywhere may discard its result.
  const positions = [...appCode.matchAll(/commitSettings\(/g)].map((m) => m.index);
  assert.ok(positions.length > 0, 'sanity: settings commits found');
  for (const index of positions) {
    const awaited = /\bawait\s+$/.test(appCode.slice(Math.max(0, index - 8), index));
    // Statement-boundary aware: `[^;]*?` cannot cross a `;`, so a `.then(`
    // belonging to a different statement is never mistaken for this call's.
    const chained = /^commitSettings\([^;]*?\)\s*\.then\(/.test(appCode.slice(index));
    assert.ok(
      awaited || chained,
      `settings commit at offset ${index} is neither awaited nor chained onto .then(`,
    );
  }
});

test('13b. the incidental settings commit surfaces a failed write', () => {
  const flush = region(
    appSource,
    'const flushPendingSettings = useCallback(() => {',
    '}, [reportStorageFailure]);',
  );
  assert.ok(flush.includes('commitSettings('), 'commits through the official entry point');
  assert.ok(flush.includes(').then('), 'the commit result is handled');
  assert.ok(/if \(!result\.ok\)/.test(flush), 'the failure branch is explicit');
  assert.ok(flush.includes('reportStorageFailure('), 'surfaced through the existing convention');
});

// ---------------------------------------------------------------------------
// 18. An OS failure must not persist the requested value
// ---------------------------------------------------------------------------

test('18. a refused OS write returns before the preference is touched', () => {
  const refusal = at(handler, 'if (!result.supported) return;');
  const persist = at(handler, 'setSettings(next)');
  const commit = at(handler, 'await commitSettings(next)');
  assert.ok(refusal < persist && refusal < commit);
});

test('18. the value written after a successful OS write is the request, not the observation', () => {
  assert.ok(
    handler.includes('autoStartWindows: requested'),
    'the desired value comes from the user request',
  );
  assert.ok(
    !/autoStartWindows\s*:\s*result\.enabled/.test(appSource),
    'never persist the observed value',
  );
  assert.ok(
    !/autoStartWindows\s*:\s*status\.enabled/.test(appSource),
    'never persist the observed value',
  );
});

// ---------------------------------------------------------------------------
// 19. Persistence failure is reported separately from an OS failure
// ---------------------------------------------------------------------------

test('19. a persistence failure is surfaced through the storage failure convention', () => {
  assert.ok(handler.includes('if (!persisted.ok)'));
  assert.ok(handler.includes('reportStorageFailure('));
  assert.ok(
    /Preferensi run otomatis belum tersimpan/.test(handler),
    'the wording names the storage failure',
  );
});

test('19. a persistence failure is not relabelled as an auto-start failure', () => {
  // No auto-start error wording may be shown for a storage-only failure.
  assert.ok(
    !/describeAutoStartStatus\(persisted/.test(handler),
    'the storage result is not run through the auto-start describer',
  );
  assert.ok(!/AUTOSTART_SET_FAILED/.test(handler));
  assert.ok(!/setAutoStartStatus\(persisted/.test(handler));
});

test('19. the observed status is replaced by the result of the request, not re-read', () => {
  assert.ok(handler.includes('setAutoStartStatus(result)'));
  assert.ok(
    !handler.includes('getAutoStartStatus'),
    'the request result is already the fresh observation; no second read',
  );
});

// ---------------------------------------------------------------------------
// 17. A successful OS change is allowed to persist
// ---------------------------------------------------------------------------

test('17. a confirmed OS change moves the desired state and persists it', () => {
  const refusal = at(handler, 'if (!result.supported) return;');
  const persist = at(handler, 'setSettings(next)');
  const commit = at(handler, 'await commitSettings(next)');
  assert.ok(refusal < persist && persist < commit, 'success path: OS, then desired, then storage');
});

// ---------------------------------------------------------------------------
// 20. Observed OS state is never written back into the preference
// ---------------------------------------------------------------------------

test('20. every autoStartWindows assignment in App.tsx is intent-only', () => {
  // Allowlist of the only right-hand sides permitted for the field.
  const allowed = new Set(['true', 'requested']);
  const assignments = [...appSource.matchAll(/autoStartWindows\s*:\s*([^,\n}]+)/g)].map((m) =>
    m[1].trim(),
  );
  assert.ok(assignments.length > 0, 'sanity: assignments found');
  for (const rhs of assignments) {
    assert.ok(allowed.has(rhs), `unexpected autoStartWindows source: ${rhs}`);
  }
});

test('20. the view reads the resolved view model, never the preference directly', () => {
  assert.ok(
    !viewSource.includes('settings.autoStartWindows'),
    'the row must render the resolved model, not re-read the preference',
  );
  assert.ok(viewSource.includes('autoStartUi.checked'));
});

test('20. no auto-start write path calls the incidental settings updater', () => {
  // The row used to persist straight through `onUpdateSettings`. It must now
  // report intent only, so that persistence can happen after OS confirmation.
  assert.ok(viewSource.includes('onClick={onToggleAutoStart}'));
  assert.ok(
    !/onUpdateSettings\(\{\s*autoStartWindows/.test(viewSource),
    'the row must not persist the preference itself',
  );
});

// ---------------------------------------------------------------------------
// §2 / §12 Concurrency and intent guards
// ---------------------------------------------------------------------------

test('12. the handler refuses a click that arrives while hydrating or in flight', () => {
  assert.ok(handler.includes('canRequestAutoStartChange('));
  assert.ok(
    at(handler, 'canRequestAutoStartChange(') < at(handler, 'setAutoStartPending(true)'),
    'guards run before any state change',
  );
  assert.ok(handler.includes('autoStartPendingRef.current'));
  assert.ok(
    at(handler, 'autoStartPendingRef.current = true') <
      at(handler, 'await setAutoStartEnabled(requested)'),
    'the synchronous guard is raised before the await',
  );
});

test('12. pending is always cleared, even when the request fails', () => {
  assert.ok(handler.includes('finally {'));
  assert.ok(handler.includes('autoStartPendingRef.current = false'));
  assert.ok(handler.includes('setAutoStartPending(false)'));
});

test('12. the request is the inverse of the live preference', () => {
  assert.ok(
    handler.includes('nextAutoStartRequest(settingsRef.current.autoStartWindows)'),
    'reads the live preference rather than a captured one',
  );
});

// ---------------------------------------------------------------------------
// §10 Pre-hydration behaviour
// ---------------------------------------------------------------------------

test('10. no auto-start write can be issued before hydration resolves', () => {
  assert.ok(readEffect.includes('storageReady'), 'the read is gated on hydration');
  assert.ok(
    appSource.includes('const autoStartSurfaceActive = storageReady &&'),
    'the gate includes storageReady',
  );
});

test('10. the read effect and the toggle are both gated on the same gate', () => {
  assert.ok(readEffect.includes('if (!autoStartSurfaceActive) return;'));
});

// ---------------------------------------------------------------------------
// §11 Controlled fetch lifecycle
// ---------------------------------------------------------------------------

test('11. the observed state is read once per activation, with no polling', () => {
  assert.ok(/}, \[autoStartSurfaceActive\]\);/.test(readEffect), 'single, deliberate dependency');
  assert.ok(!readEffect.includes('setInterval'), 'no polling');
  assert.ok(!readEffect.includes('setTimeout'), 'no retry timer');
  assert.ok(!readEffect.includes('requestAnimationFrame'), 'no frame loop');
  assert.equal(
    [...readEffect.matchAll(/getAutoStartStatus\(\)/g)].length,
    1,
    'exactly one read per activation, with no recursive refresh',
  );
});

test('11. the status read does not depend on settings, so edits do not re-trigger it', () => {
  assert.ok(
    /\[autoStartSurfaceActive\]\);/.test(readEffect),
    'the effect depends only on the activation gate',
  );
});

test('11. the read guards against a late resolution after unmount', () => {
  assert.ok(readEffect.includes('cancelled'));
});

test('11. the application-wide auto-start surface has exactly one status read site', () => {
  const sites = [...appSource.matchAll(/getAutoStartStatus\(\)/g)];
  assert.equal(sites.length, 1, `expected one read site, found ${sites.length}`);
});

// ---------------------------------------------------------------------------
// §4 / §7 / §24 No direct Electron access from the renderer
// ---------------------------------------------------------------------------

test('24. the renderer never reaches for Electron APIs directly', () => {
  for (const [name, source] of [
    [APP, appCode],
    [VIEW, viewCode],
  ]) {
    for (const banned of [
      'ipcRenderer',
      'window.electron',
      "require('electron')",
      'require("electron")',
      "from 'electron'",
      'from "electron"',
      'contextBridge',
      'BrowserWindow',
      'app.getLoginItemSettings',
      'app.setLoginItemSettings',
      'electronAPI',
    ]) {
      assert.ok(!source.includes(banned), `${name} must not contain ${banned}`);
    }
  }
});

test('24. the component does not touch the bridge object directly', () => {
  assert.ok(!viewCode.includes('schoolBellAutoStart'));
  assert.ok(!appCode.includes('schoolBellAutoStart'));
});

test('§4 the existing typed facade is the one that is used', () => {
  assert.ok(
    /from '\.\/utils\/autostart'/.test(appSource),
    'App imports the facade module',
  );
  for (const fn of ['getAutoStartStatus', 'setAutoStartEnabled', 'describeAutoStartStatus']) {
    assert.ok(appSource.includes(`${fn}(`), `${fn} is called`);
  }
});

test('§7 the error-code to wording mapping is not duplicated in the view', () => {
  assert.ok(!viewSource.includes('AUTOSTART_'), 'no error codes branch in the component');
  const decision = read('src/utils/autostart-ui-state.ts');
  for (const code of [
    'AUTOSTART_UNSUPPORTED_PLATFORM',
    'AUTOSTART_NOT_PACKAGED',
    'AUTOSTART_NOT_IMPLEMENTED',
    'AUTOSTART_SET_FAILED',
    'AUTOSTART_READ_FAILED',
    'AUTOSTART_FORBIDDEN',
    'AUTOSTART_INVALID_INPUT',
    'AUTOSTART_BRIDGE_FAILED',
  ]) {
    assert.ok(!decision.includes(code), `the decision module must not map ${code}`);
  }
});

// ---------------------------------------------------------------------------
// §9 Accessibility
// ---------------------------------------------------------------------------

test('9. the switch keeps its role and gains a stable, associated name', () => {
  assert.ok(viewSource.includes('role="switch"'));
  assert.ok(viewSource.includes('aria-checked={autoStartUi.checked}'));
  assert.ok(viewSource.includes('const AUTO_START_SWITCH_ID ='));
  assert.ok(viewSource.includes('id={AUTO_START_SWITCH_ID}'));
  assert.ok(viewSource.includes('htmlFor={AUTO_START_SWITCH_ID}'));
  assert.ok(viewSource.includes('aria-describedby={`${AUTO_START_SWITCH_ID}-description'));
});

test('9. the switch exposes disabled and busy state', () => {
  assert.ok(viewSource.includes('disabled={autoStartUi.disabled}'));
  assert.ok(viewSource.includes('aria-disabled={autoStartUi.disabled}'));
  assert.ok(viewSource.includes('aria-busy={autoStartUi.ariaBusy}'));
});

// ---------------------------------------------------------------------------
// §21 / §22 / §23 Contract and protected surfaces
// ---------------------------------------------------------------------------

test('21/22/23. the F-03 contract, facade and main process are byte-identical', () => {
  const expected = {
    'src/types/autostart-bridge.ts': '90e5454636a80cb539671561d66892dd',
    'src/utils/autostart.ts': 'e27936a128364ee6c0ee3dca28fd0750',
    'electron/preload.cjs': '9de3aa9c1df88379e743758a89605d06',
    'electron/autostart-ipc.cjs': 'ea6c40383b6bff9caef070f16f7ff627',
    'electron/autostart-sync.cjs': 'b222bd35bde940e2a342b8ed2c049ff8',
    'electron/autostart-boot.cjs': '5fed20d698847c58df44d84d70c0a5d3',
    'electron/main.cjs': '6279b6e2e7a8a9faf24b53634049d3db',
  };
  for (const [file, hash] of Object.entries(expected)) {
    assert.equal(md5(file), hash, `${file} must match the F-03 reconciled baseline`);
  }
});

// ---------------------------------------------------------------------------
// Stage B3 — standalone byte-identity checks for files previously masked by an
// earlier assertion in the list above. Each file gets its own test so a drift
// in one can never hide a drift in another.
// ---------------------------------------------------------------------------

test('B3 — electron/main.cjs byte-identity (standalone, previously masked)', () => {
  assert.equal(
    md5('electron/main.cjs'),
    '6279b6e2e7a8a9faf24b53634049d3db',
    'electron/main.cjs must match the B3-reconciled baseline',
  );
});

test('B3 — electron/settings-schema.cjs byte-identity (standalone, previously masked)', () => {
  assert.equal(
    md5('electron/settings-schema.cjs'),
    '66e1b837c3b82e39cbd2a0d28d8843ce',
    'electron/settings-schema.cjs must match the B3-reconciled baseline',
  );
});

test('23. no new IPC channel exists', () => {
  const ipc = read('electron/autostart-ipc.cjs');
  const preload = read('electron/preload.cjs');

  // The two channels are built as `school-bell:autostart:<verb>`, so the verbs
  // are what must not grow.
  const base = /const CHANNEL = '([^']+)'/.exec(ipc);
  assert.ok(base, 'channel base is declared once');
  const verbs = [...ipc.matchAll(/^\s*handle\('([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(
    verbs.sort(),
    ['get-status', 'set-enabled'],
    'exactly the two Unit 1 verbs',
  );
  assert.equal(
    [...ipc.matchAll(/ipcMain\.handle/g)].length,
    1,
    'only the shared handler template registers a channel',
  );
  assert.deepEqual(
    [...new Set([...preload.matchAll(/invokeAutoStart\('([^']+)'/g)].map((m) => m[1]))].sort(),
    verbs.slice().sort(),
    'preload invokes exactly the registered channels',
  );
});

test('23. the renderer adds no channel of its own', () => {
  for (const source of [appSource, viewSource]) {
    assert.ok(!/school-bell:autostart/.test(source), 'the renderer never names a channel');
  }
});

// ---------------------------------------------------------------------------
// §17 F-04 lifecycle untouched
// ---------------------------------------------------------------------------

test('F-04 lifecycle code and tests are untouched', () => {
  assert.equal(
    md5('electron/__tests__/f04-lifecycle.test.cjs'),
    '58514c30dedce4a641b769bced5e795e',
  );
  assert.equal(
    md5('electron/__tests__/f04-harness.cjs'),
    '47609625196546c2e3f81b1ecc001727',
  );
  const main = read('electron/main.cjs');
  assert.ok(main.includes("app.on('before-quit'"), 'the F-04 exit path still exists');
});

test('Unit 2D did not add a renderer-side reconciliation entry point', () => {
  // Comment-stripped: Unit 2E's guard explains itself by naming the main-process
  // reconciler, and prose must not be mistaken for an import.
  const renderer = stripComments(appSource) + stripComments(viewSource);
  for (const banned of ['reconcileOnBoot', 'synchronize(', 'autostart-sync', 'autostart-boot']) {
    assert.ok(!renderer.includes(banned), `renderer must not reference ${banned}`);
  }
});

// ---------------------------------------------------------------------------
// Test-harness design invariant
// ---------------------------------------------------------------------------

test('the decision module is import-free, which is what makes it testable', () => {
  const decision = read('src/utils/autostart-ui-state.ts');
  assert.ok(
    !/^\s*import\s/m.test(decision),
    'no import statement — this is what lets node --test load it',
  );
  assert.ok(!/\brequire\(/.test(decision));
  const decisionCode = stripComments(decision);
  assert.ok(!/from ['"]react['"]/.test(decisionCode), 'no React');
  assert.ok(!/ipcRenderer|electron/i.test(decisionCode), 'no Electron');
  assert.ok(!/\bdocument\b|\bwindow\./.test(decisionCode), 'no browser globals');
});

test('the new test file is reachable by the existing F-03 glob', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['test:f03'], /autostart-\*\.test\.cjs/);
  assert.ok(
    fs.existsSync(path.join(ROOT, 'electron/__tests__/autostart-ui-state.test.cjs')),
    'behavioural suite is inside the glob',
  );
  assert.ok(
    fs.existsSync(path.join(ROOT, 'electron/__tests__/autostart-2d-guards.test.cjs')),
    'guard suite is inside the glob',
  );
});

test('package.json is byte-identical to the reconciled baseline (electron-builder 26.15.3)', () => {
  assert.equal(
    md5('package.json'),
    'c2af0e6dc31e43d8deb2e6ef5a4d64c8',
    'package.json matches the Stage B3 reconciled baseline (electron-builder pinned to 26.15.3)',
  );
});

// ===========================================================================
// Unit 2E — read-back verified preference commit
//
// Stage C found that the Unit 2D gate stopped at `supported`, while Unit 2A's
// `setEnabled` is write-then-read-back (`autostart-ipc.cjs:206`) and returns the
// observed value, never the request. A supported result whose `enabled`
// disagrees with `requested` is therefore legitimate, and persisting `requested`
// anyway stored an intent Windows never accepted.
//
// These tests read the gate's condition expressions *out of the production
// source* and evaluate them, rather than reimplementing the handler. A test that
// restated the intended logic would pass even with the guard missing; these fail.
// ===========================================================================

/** The literal condition of the read-back guard, exactly as written in App.tsx. */
const READBACK_GUARD = /if \((result\.enabled\s*!==\s*requested)\)\s*return;/;

/** The literal condition of the pre-existing refusal guard. */
const REFUSAL_GUARD = /if \((!result\.supported)\)\s*return;/;

function handlerFromSource() {
  const source = read(APP);
  // NB: the local must not be named `region` — that would shadow the helper
  // above and put it in the temporal dead zone on the right-hand side.
  const body = region(
    source,
    'const handleToggleAutoStart = useCallback(async () => {',
    '}, [autoStartUiInput, reportStorageFailure]);',
  );
  const readback = READBACK_GUARD.exec(body);
  const refusal = REFUSAL_GUARD.exec(body);
  return {
    region: body,
    readbackCondition: readback ? readback[1] : null,
    refusalCondition: refusal ? refusal[1] : null,
  };
}

/** Compile a condition extracted from production source into a predicate. */
const predicateFrom = (condition) =>
  new Function('result', 'requested', `return (${condition});`);

test('1. the read-back guard exists and uses the mandated comparison', () => {
  const { readbackCondition } = handlerFromSource();
  assert.ok(readbackCondition, 'if (result.enabled !== requested) return; is missing');
  assert.equal(
    readbackCondition.replace(/\s+/g, ' ').trim(),
    'result.enabled !== requested',
    'must compare the observed value against the request',
  );
});

test('1b. the guard compares against `requested`, not against the stored preference', () => {
  const { readbackCondition } = handlerFromSource();
  assert.ok(readbackCondition);
  assert.ok(
    !readbackCondition.includes('settings'),
    'must not read settings.autoStartWindows here',
  );
  assert.ok(
    !readbackCondition.includes('settingsRef'),
    'must not read the stored preference here',
  );
  assert.ok(
    !readbackCondition.includes('==='),
    'the guard must use `!==`; an `===` test would invert the gate',
  );
});

test('1c. no coercion is applied to the observed value at the guard', () => {
  const { region } = handlerFromSource();
  const window = region.slice(
    region.indexOf('await setAutoStartEnabled(requested)'),
    at(region, 'setSettings(next)'),
  );
  for (const banned of ['Boolean(', '?? false', '?? true', '|| false', '=== true ?', '!result.enabled']) {
    assert.ok(!window.includes(banned), `read-back gate must not use ${banned}`);
  }
});

test('2. the read-back guard precedes setSettings()', () => {
  const { region, readbackCondition } = handlerFromSource();
  assert.ok(readbackCondition);
  assert.ok(
    at(region, 'if (result.enabled !== requested) return;') < at(region, 'setSettings(next)'),
    'desired state cannot move before the read-back is verified',
  );
});

test('3. the read-back guard precedes commitSettings()', () => {
  const { region, readbackCondition } = handlerFromSource();
  assert.ok(readbackCondition);
  assert.ok(
    at(region, 'if (result.enabled !== requested) return;') <
      at(region, 'await commitSettings(next)'),
    'persistence is unreachable when the read-back disagrees',
  );
});

test('3b. the only work between the read-back guard and persistence is building `next`', () => {
  const { region, readbackCondition } = handlerFromSource();
  assert.ok(readbackCondition);
  const marker = 'if (result.enabled !== requested) return;';
  const window = stripComments(
    region.slice(region.indexOf(marker) + marker.length, at(region, 'setSettings(next)')),
  ).trim();

  // `next` has to be built before it can be handed to setSettings, so the window
  // is expected to contain exactly that one declaration — nothing that persists.
  assert.ok(!window.includes('setSettings('), 'no earlier setSettings in the window');
  assert.ok(!window.includes('commitSettings('), 'no earlier commitSettings in the window');

  const statements = window.split(';').map((s) => s.trim()).filter(Boolean);
  assert.equal(statements.length, 1, `expected one statement, got ${JSON.stringify(statements)}`);
  assert.match(
    statements[0],
    /^const next: AppSettings = \{ \.\.\.settingsRef\.current, autoStartWindows: requested \}$/,
    `the persistence payload must be the intent-only value, got: ${statements[0]}`,
  );
  assert.ok(!statements[0].includes('result'), 'the observation must not enter the payload');
});

test('4. requested=true with enabled=false cannot reach persistence', () => {
  const { readbackCondition } = handlerFromSource();
  assert.ok(readbackCondition);
  const blocks = predicateFrom(readbackCondition)({ supported: true, enabled: false }, true);
  assert.equal(blocks, true, 'the guard must fire for a rejected enable');
});

test('5. requested=false with enabled=true cannot reach persistence', () => {
  const { readbackCondition } = handlerFromSource();
  assert.ok(readbackCondition);
  const blocks = predicateFrom(readbackCondition)({ supported: true, enabled: true }, false);
  assert.equal(blocks, true, 'the guard must fire for a rejected disable');
});

test('6. matching requested and observed states remain allowed to persist', () => {
  const { readbackCondition } = handlerFromSource();
  assert.ok(readbackCondition);
  const gate = predicateFrom(readbackCondition);
  assert.equal(gate({ supported: true, enabled: true }, true), false, 'Case A may persist');
  assert.equal(gate({ supported: true, enabled: false }, false), false, 'Case B may persist');
});

test('7. supported:false remains blocked, and is checked first', () => {
  const { region, refusalCondition, readbackCondition } = handlerFromSource();
  assert.ok(refusalCondition, 'the Unit 2D refusal guard must survive');
  assert.ok(readbackCondition);
  assert.ok(
    at(region, 'if (!result.supported) return;') <
      at(region, 'if (result.enabled !== requested) return;'),
    'refusal is evaluated before the read-back check',
  );
  assert.equal(
    predicateFrom(refusalCondition)({ supported: false, enabled: null, errorCode: 'X' }, true),
    true,
  );
});

test('7b. the observed result is stored before both guards, and is not overwritten', () => {
  const { region } = handlerFromSource();
  assert.ok(at(region, 'setAutoStartStatus(result)') < at(region, 'if (!result.supported) return;'));
  assert.equal(
    [...region.matchAll(/setAutoStartStatus\(/g)].length,
    1,
    'exactly one observation is stored, and it is the real result',
  );
  // The mismatch path must not fabricate an error status.
  assert.ok(!/setAutoStartStatus\(\{/.test(region), 'no synthesised AutoStartStatus');
  assert.ok(!/AUTOSTART_/.test(stripComments(region)), 'no new error code is invented');
});

test('8. observed state is still never written into autoStartWindows', () => {
  // The intent-only allowlist from Unit 2D must still hold unchanged.
  const assignments = [...read(APP).matchAll(/autoStartWindows\s*:\s*([^,\n}]+)/g)].map((m) =>
    m[1].trim(),
  );
  assert.ok(assignments.length > 0);
  for (const rhs of assignments) {
    assert.ok(
      rhs === 'true' || rhs === 'requested',
      `unexpected autoStartWindows source: ${rhs}`,
    );
  }
  const { region } = handlerFromSource();
  assert.ok(!/autoStartWindows\s*:\s*result\.enabled/.test(region));
});

test('8b. the full gate reaches persistence if and only if the OS achieved the request', () => {
  const { refusalCondition, readbackCondition } = handlerFromSource();
  assert.ok(refusalCondition && readbackCondition);
  const refused = predicateFrom(refusalCondition);
  const readback = predicateFrom(readbackCondition);

  // Compose the two production conditions exactly as the handler does, then
  // sweep every representable outcome of a write-then-read-back.
  const reachesPersistence = (result, requested) =>
    !refused(result, requested) && !readback(result, requested);

  const matrix = [
    // [requested, result, expectedToPersist, label]
    [true, { supported: true, enabled: true }, true, 'A requested ON, observed ON'],
    [false, { supported: true, enabled: false }, true, 'B requested OFF, observed OFF'],
    [true, { supported: true, enabled: false }, false, 'C requested ON, observed OFF'],
    [false, { supported: true, enabled: true }, false, 'D requested OFF, observed ON'],
    [true, { supported: false, enabled: null, errorCode: 'AUTOSTART_SET_FAILED' }, false, 'E refusal'],
    [false, { supported: false, enabled: null, errorCode: 'AUTOSTART_SET_FAILED' }, false, 'E refusal'],
  ];

  for (const [requested, result, expected, label] of matrix) {
    assert.equal(
      reachesPersistence(result, requested),
      expected,
      `${label}: persistence ${expected ? 'allowed' : 'must be blocked'}`,
    );
  }

  // Exhaustive over every boolean pair, so no combination is left unasserted.
  for (const requested of [true, false]) {
    for (const enabled of [true, false]) {
      assert.equal(
        reachesPersistence({ supported: true, enabled }, requested),
        enabled === requested,
        `persist only on agreement (requested=${requested}, enabled=${enabled})`,
      );
    }
  }
});

test('Unit 2E changed only the App.tsx gate, not the presentation layer', () => {
  // The mismatch presentation already existed in Unit 2D and must be untouched,
  // so the row keeps reporting the real observed state.
  assert.equal(
    md5('src/utils/autostart-ui-state.ts'),
    '1ebf9cba53ea371d50af1a01099e7b71',
    'decision module unchanged by Unit 2E',
  );
  assert.equal(
    md5('src/components/PengaturanView.tsx'),
    '3d6941ba6a80e19dd51f18347f335627',
    'view matches the B3-reconciled baseline',
  );
  assert.equal(
    md5('src/utils/autostart.ts'),
    'e27936a128364ee6c0ee3dca28fd0750',
    'facade unchanged by Unit 2E',
  );
});