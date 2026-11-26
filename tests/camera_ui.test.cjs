const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function page(handlers = {}) {
    const calls = [];
    const nodes = new Map();
    const context = vm.createContext({
        document: {
            getElementById(id) {
                if (!nodes.has(id)) nodes.set(id, { classList: { toggle() {} }, setAttribute() {}, querySelector() { return {}; }, value: '' });
                return nodes.get(id);
            },
            querySelectorAll() { return []; },
        },
        window: { __TAURI__: { core: { invoke: async (cmd, args) => {
            calls.push([cmd, JSON.parse(JSON.stringify(args))]);
            return handlers[cmd]?.(args);
        } } } },
    });
    const script = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
    // Use the app's real controller with explicit synthetic frame/session state.
    vm.runInContext(script.replace(/\ninit\(\);\s*$/, '') +
        "\nstate.session = 'preview'; state.live = true; state.frameAt = Date.now();", context);
    const element = id => context.document.getElementById(id);
    const run = code => vm.runInContext(code, context);
    return { calls, element, run };
}

test('zoom disables capture until a matching preview frame and applies to recording', async () => {
    const { calls, element, run } = page();
    element('camera-zoom').value = '225';
    await run('selectZoom()');
    assert.deepEqual(calls, [['set_camera_zoom', { session: 'preview', percent: 225 }]]);
    assert.equal(element('capture').disabled, true);
    assert.equal(element('record').disabled, true);
    await run('startRecording()');
    assert.equal(calls.length, 1);
    run("state.frameZoom = 225; $('device').value = 'Synthetic'; renderCamera()");
    assert.equal(element('capture').disabled, false);
    await run('startRecording()');
    assert.equal(calls.at(-1)[0], 'start_recording');
    assert.equal(calls.at(-1)[1].zoomPercent, 225);
    assert.equal(element('camera-zoom').disabled, true);
    assert.equal(element('autofocus').disabled, true);
});

test('unsupported focus does not trigger any focus operation', async () => {
    const { calls, element, run } = page({ autofocus: () => false });
    await run("checkAutofocus('preview')");
    assert.equal(element('autofocus').disabled, true);
    await run('refocus()');
    assert.deepEqual(calls, [['autofocus', { session: 'preview', perform: false }]]);
});

test('supported focus sends one request while pending', async () => {
    let resolve;
    const { calls, element, run } = page({
        autofocus: ({ perform }) => perform ? new Promise(r => { resolve = r; }) : true,
    });
    await run("checkAutofocus('preview')");
    assert.equal(element('autofocus').disabled, false);
    const focus = run('refocus()');
    await run('refocus()');
    assert.equal(calls.length, 2);
    resolve(true);
    await focus;
    assert.match(element('focus-status').textContent, /요청/);
});

test('rapid zoom selections are serialized and use the latest setting', async () => {
    let resolve;
    const { calls, element, run } = page({
        set_camera_zoom: ({ percent }) => percent === 150 ? new Promise(r => { resolve = r; }) : undefined,
    });
    element('camera-zoom').value = '150'; const first = run('selectZoom()');
    element('camera-zoom').value = '200'; await run('selectZoom()');
    element('camera-zoom').value = '300'; await run('selectZoom()');
    assert.equal(element('capture').disabled, true);
    resolve(); await first;
    assert.deepEqual(calls.map(([, args]) => args.percent), [150, 300]);
    assert.equal(element('zoom-value').textContent, '3×');
});

test('zoom buttons respect bounds and cannot change recording or stale preview', async () => {
    const { calls, element, run } = page();
    run('renderCamera()');
    assert.equal(element('zoom-out').disabled, true);
    await run('stepZoom(25)');
    assert.equal(calls.at(-1)[1].percent, 125);
    await run('stepZoom(-25)');
    assert.equal(calls.at(-1)[1].percent, 100);
    for (let i = 0; i < 10; i++) await run('stepZoom(25)');
    assert.equal(run('state.zoom'), 300);
    assert.equal(element('zoom-in').disabled, true);
    const count = calls.length;
    run('state.recording = true; renderCamera()');
    await run('stepZoom(-25)');
    assert.equal(calls.length, count);
    assert.equal(element('zoom-out').disabled, true);
    run('state.recording = false; state.frameAt = 0; renderCamera()');
    await run('stepZoom(-25)');
    assert.equal(calls.length, count);
});
