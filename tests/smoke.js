'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const handlers = new Map();
const netHandlers = new Map();
const nuiCallbacks = new Set();
const commands = new Set();
const keyMappings = [];

global.GetCurrentResourceName = () => 'yx_shellcreator';
global.LoadResourceFile = (_, file) => fs.readFileSync(path.join(root, file), 'utf8');
global.RegisterNuiCallbackType = (name) => nuiCallbacks.add(name);
global.on = (name, handler) => handlers.set(name, handler);
global.onNet = (name, handler) => netHandlers.set(name, handler);
global.RegisterCommand = (name) => commands.add(name);
global.RegisterKeyMapping = (...args) => keyMappings.push(args);
global.setTick = () => 1;
global.GetPlayerServerId = () => 1;
global.PlayerId = () => 1;
global.GetGameTimer = () => 1;
global.emitNet = () => {};
global.SendNUIMessage = () => {};
global.SetNuiFocus = () => {};
global.YXCatalog = require('../client/catalog');

const client = fs.readFileSync(path.join(root, 'client', 'client.js'), 'utf8');
vm.runInThisContext(client, { filename: 'client/client.js' });

const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'config.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'config', 'catalog.json'), 'utf8'));
const ids = new Set();
const models = new Set();

for (const item of catalog.items) {
    if (!item.id || ids.has(item.id)) throw new Error(`Duplicate or missing catalog id: ${item.id}`);
    if (!item.model || models.has(item.model)) throw new Error(`Duplicate or missing catalog model: ${item.model}`);
    ids.add(item.id);
    models.add(item.model);
    if (item.image && !fs.existsSync(path.join(root, 'web', item.image))) throw new Error(`Missing image: ${item.image}`);
}

const requiredNui = [
    'close', 'createHouse', 'updateHouse', 'deleteHouse', 'enterHouse', 'leaveHouse',
    'createObject', 'selectObject', 'deleteObject', 'restoreObject', 'undo', 'redo', 'setRotation',
    'setEnvironment', 'exportHouse', 'importHouse', 'previewDoor', 'toggleDoorHold', 'accessPoint'
];
for (const name of requiredNui) if (!nuiCallbacks.has(name)) throw new Error(`Missing NUI callback: ${name}`);

for (const name of [config.commands.manager, config.commands.builder, config.commands.leave]) {
    if (!commands.has(name)) throw new Error(`Missing command: ${name}`);
}
for (const name of ['fixshell', 'fixloc']) {
    if (!commands.has(name)) throw new Error(`Missing recovery command: ${name}`);
}

const server = fs.readFileSync(path.join(root, 'server', 'Main.cs'), 'utf8');
if (!server.includes('HandleFixLocationAsync') || !server.includes('ContextDepth') || !server.includes('Previous = previous')) {
    throw new Error('Nested-house recovery implementation is missing');
}
if (!server.includes('HandleSetDoorStateAsync') || !server.includes('door_open')) {
    throw new Error('Persistent synchronized door-state implementation is missing');
}

if (config.interiors.length < 10) throw new Error('Interior presets are missing');
const currentLocationPreset = config.interiors.find((preset) => preset.id === 'current_location');
if (!currentLocationPreset || currentLocationPreset.type !== 'world') {
    throw new Error('Current-location world property preset is missing');
}
if (!server.includes('IsCurrentLocationPreset') || !server.includes('currentLocationPreset ? request.Entrance : preset.Spawn')
    || !server.includes('request.CurrentPosition')) {
    throw new Error('Current-location property coordinates are not captured by the server');
}
if (catalog.items.length < 300) throw new Error('Furniture catalog unexpectedly small');
if (netHandlers.size < 5) throw new Error('Client network handlers were not registered');
if (keyMappings.length < 9) throw new Error('Expected camera, gizmo, delete and construction key mappings were not registered');
if (!client.includes('CreateCam') || !client.includes('DrawGizmo') || !client.includes('EnterCursorMode')) throw new Error('Freecam or native 3D gizmo implementation is missing');
if (!client.includes('RequestCollisionForModel') || !client.includes('RequestCollisionAtCoord')) {
    throw new Error('Native model collision streaming requests are missing');
}
if (!config.freecam || config.freecam.speed <= 0 || config.freecam.lookSensitivity <= 0) throw new Error('Freecam configuration is invalid');
if (!config.entryLoading || config.entryLoading.minimumDurationMs < 500
    || config.entryLoading.objectSettleMs < 0 || config.entryLoading.collisionTimeoutMs <= 0
    || config.entryLoading.preloadModelLimit <= 0 || config.entryLoading.spawnBatchSize <= 0) {
    throw new Error('Interior entry loading configuration is invalid');
}
if (!config.doors || !(config.doors.contactDistance > 0) || !(config.doors.closeSpeed > 0) || config.doors.animationSpeed <= 0) {
    throw new Error('Interactive door configuration is invalid');
}
if (!config.emptyBuild || config.emptyBuild.gridSize <= 0 || !config.emptyBuild.camera) throw new Error('Empty-space build configuration is invalid');
for (const buildType of ['floor', 'wall', 'door', 'stairs']) {
    if (!catalog.items.some((item) => item.buildType === buildType)) throw new Error(`Missing ${buildType} construction pieces`);
}
const expectedBuildKit = [
    ['yx_floor_oak', 'floor', 'cell'],
    ['yx_floor_tile', 'floor', 'cell'],
    ['yx_floor_concrete', 'floor', 'cell'],
    ['yx_floor_darkwood', 'floor', 'cell'],
    ['yx_wall_white', 'wall', 'edge'],
    ['yx_wall_concrete', 'wall', 'edge'],
    ['yx_wall_charcoal', 'wall', 'edge'],
    ['yx_wall_doorway', 'door', 'edge'],
    ['yx_wall_doorway_concrete', 'door', 'edge'],
    ['yx_door_wood', 'door', 'edge'],
    ['yx_door_modern', 'door', 'edge'],
    ['yx_stairs_oak', 'stairs', 'cell'],
    ['yx_stairs_concrete', 'stairs', 'cell'],
    ['yx_spiral_oak', 'stairs', 'cell'],
    ['yx_spiral_concrete', 'stairs', 'cell']
];
for (const [model, buildType, snapMode] of expectedBuildKit) {
    const item = catalog.items.find((candidate) => candidate.model === model);
    if (!item || item.buildType !== buildType || item.snapMode !== snapMode || item.moduleSize !== 2.5) {
        throw new Error(`Invalid modular build-kit entry: ${model}`);
    }
    for (const extension of ['ydr', 'ytd', 'ytyp']) {
        if (!fs.existsSync(path.join(root, 'stream', `${model}.${extension}`))) {
            throw new Error(`Missing streamed ${extension.toUpperCase()} for ${model}`);
        }
    }
    if (!fs.existsSync(path.join(root, 'stream', `${model}_col.ybn`))) {
        throw new Error(`Missing collision YBN for ${model}`);
    }
}
for (const extension of ['ydr', 'ytd', 'ytyp']) {
    if (!fs.existsSync(path.join(root, 'stream', `yx_stairs_collision.${extension}`))) {
        throw new Error(`Missing stair collision helper ${extension.toUpperCase()}`);
    }
}
if (!fs.existsSync(path.join(root, 'stream', 'yx_stairs_collision_col.ybn'))) {
    throw new Error('Missing stair collision helper YBN');
}
const buildKitGenerator = fs.readFileSync(path.join(root, 'tools', 'generate_build_kit.mjs'), 'utf8');
for (const expected of [
    'const stepCount = 20;',
    'const run = 5.0;',
    'const rise = 3.0;',
    "writeGlb('yx_stairs_collision', stairCollision);"
]) {
    if (!buildKitGenerator.includes(expected)) throw new Error(`Walkable stair geometry is missing: ${expected}`);
}
const interactiveDoorModels = [
    'yx_door_wood', 'yx_door_modern', 'prop_door_01', 'prop_motel_door_09',
    'prop_michael_door', 'prop_magenta_door', 'prop_ret_door', 'prop_ret_door_02',
    'prop_ret_door_03', 'prop_ret_door_04', 'prop_strip_door_01', 'prop_ld_jail_door',
    'prop_v_door_44', 'ba_prop_door_club_generic_vip'
];
for (const model of interactiveDoorModels) {
    const item = catalog.items.find((candidate) => candidate.model === model);
    if (!item || !item.door || !Number.isFinite(Number(item.door.openAngle))) {
        throw new Error(`Missing interactive door metadata: ${model}`);
    }
}
const nativeSpiralStairModels = [
    'h4_int_club_spiral_stairs',
    'h4_int_club_small_stairs_spiral',
    'vb_ca_spiralstairs'
];
for (const model of nativeSpiralStairModels) {
    const item = catalog.items.find((candidate) => candidate.model === model);
    if (!item || item.category !== 'construction' || item.buildType !== 'stairs'
        || item.snapMode !== 'cell' || Number(item.rotationStep) !== 45 || item.continuous !== false) {
        throw new Error(`Invalid native spiral stair entry: ${model}`);
    }
}
const rejectedConstructionModels = [
    'prop_cons_ply01',
    'prop_cons_ply02',
    'stt_prop_stunt_bblock_mdm1',
    'prop_const_fence01a',
    'prop_const_fence02a',
    'prop_const_fence03b',
    'prop_fnclink_02a',
    'prop_fnclink_03a'
];
for (const model of rejectedConstructionModels) {
    if (catalog.items.some((item) => item.model === model && item.buildType)) {
        throw new Error(`Mismatched prop is still exposed as a construction piece: ${model}`);
    }
}
for (const model of ['v_ilev_gtdoor02', 'v_ilev_housedoor1', 'v_ilev_janitor_frontdoor', 'v_ilev_ph_gendoor002', 'v_ilev_ra_door2']) {
    if (catalog.items.some((item) => item.model === model)) throw new Error(`Unreliable map-only door is still exposed: ${model}`);
}
for (const implementation of ['updateBuildCamera', 'startConstructionPlacement', 'pointOnBuildPlane', 'drawBuildGrid']) {
    if (!client.includes(`function ${implementation}`)) throw new Error(`Missing empty-space builder implementation: ${implementation}`);
}
for (const implementation of [
    'adoptNativeEntity', 'runHistory', 'setSelectedRotation', 'updateHoveredObject',
    'applyDoorPose', 'updateDoorAnimations', 'attachStairCollision', 'supportsNativeObjectEditing'
]) {
    if (!client.includes(`function ${implementation}`)) throw new Error(`Missing editor upgrade: ${implementation}`);
}
if (!client.includes("snapMode === 'cell'") || !client.includes("snapMode === 'edge'")) {
    throw new Error('Cell/edge modular snapping implementation is missing');
}
if (client.includes("registerNui('transformObject'")) throw new Error('Legacy numeric transform callback is still registered');

const webHtml = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
const webJs = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
if (webHtml.includes('data-transform=')) throw new Error('Legacy numeric transform buttons are still present');
if (!webHtml.includes('gizmo-guide')) throw new Error('3D gizmo instructions are missing from NUI');
if (!webHtml.includes('buildToolHint') || !webHtml.includes('emptyBuildBanner')) throw new Error('Sims-style build interface is missing from NUI');
for (const id of ['undoObject', 'redoObject', 'selectedSource', 'catalogResultCount']) {
    if (!webHtml.includes(`id="${id}"`)) throw new Error(`Missing editor control: ${id}`);
}
for (const className of ['workspace-bar', 'manager-footer', 'catalog-heading', 'inspector-scroll']) {
    if (!webHtml.includes(`class="${className}`)) throw new Error(`Missing redesigned UI region: ${className}`);
}
const webCss = fs.readFileSync(path.join(root, 'web', 'style.css'), 'utf8');
if (/gradient\(|box-shadow:|brand-rail|section-kicker/.test(webCss)) throw new Error('Decorative theme defaults returned');
if (/:root\s*\{[^}]*color-scheme\s*:\s*dark/s.test(webCss)) throw new Error('Global dark color-scheme can turn transparent NUI into a black canvas');
for (const id of ['objectPane','housePane','houseFormPanel','houseSearch','doorTools','previewDoor','managerAccessList','houseAccessList'])
    if (!webHtml.includes(`id="${id}"`)) throw new Error(`Missing task-oriented UI control: ${id}`);
if (/gtaworld|gta\.world/i.test(`${webHtml}\n${webCss}\n${webJs}`)) {
    throw new Error('External design attribution must not be embedded in the resource UI');
}
if (!webJs.includes("event.key === 'F2'") || !webJs.includes("event.key === 'Delete'")) {
    throw new Error('NUI keyboard handoff/delete support is missing');
}
for (const match of webJs.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) {
    if (!webHtml.includes(`id="${match[1]}"`)) throw new Error(`NUI references a missing element: ${match[1]}`);
}

console.log(JSON.stringify({
    ok: true,
    interiors: config.interiors.length,
    catalogItems: catalog.items.length,
    nuiCallbacks: nuiCallbacks.size,
    netHandlers: netHandlers.size,
    commands: [...commands],
    keyMappings: keyMappings.length
}, null, 2));
process.exit(0);
