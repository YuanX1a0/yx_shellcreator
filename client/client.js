'use strict';

const RESOURCE = GetCurrentResourceName();
const EVENT = 'yx_shellcreator';

function loadJson(path, fallback) {
    try {
        const value = LoadResourceFile(RESOURCE, path);
        return value ? JSON.parse(value) : fallback;
    } catch (error) {
        console.error(`[yx_shellcreator] Failed to load ${path}:`, error);
        return fallback;
    }
}

const config = loadJson('config/config.json', {});
const catalog = YXCatalog.merge(
    loadJson('config/catalog.json', { categories: [], items: [] })
);
let catalogUiCache = null;
let catalogUiCacheAt = -Infinity;
const WALKABLE_STAIR_MODELS = new Set(['yx_stairs_oak', 'yx_stairs_concrete', 'yx_spiral_oak', 'yx_spiral_concrete']);
const STAIR_COLLISION_MODEL = 'yx_stairs_collision';

const state = {
    houses: [],
    currentHouse: null,
    interiorDepth: 0,
    objects: new Map(),
    selectedId: null,
    shellEntity: 0,
    foundationEntity: 0,
    pinnedInterior: 0,
    requestedIpls: [],
    managerOpen: false,
    builderActive: false,
    uiVisible: false,
    uiFocused: false,
    pending: new Map(),
    requestCounter: 0,
    saveTimer: null,
    entering: false,
    autoBuildHouseId: null,
    adoptingNative: false,
    nativeRefreshAt: 0,
    history: {
        undo: [],
        redo: [],
        applying: false,
        max: 100
    },
    buildSurface: {
        ready: false,
        origin: { x: 0, y: 0, z: 0 },
        planeZ: 0
    },
    construction: {
        token: 0,
        active: false,
        item: null,
        previewEntity: 0,
        position: null,
        rotation: { x: 0, y: 0, z: 0 },
        groundOffset: 0,
        valid: false,
        placeRequested: false,
        pointerDown: false,
        lastPlacementKey: '',
        lastPlacedAt: 0
    },
    freecam: {
        handle: 0,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        buildView: false,
        target: { x: 0, y: 0, z: 0 },
        distance: 20,
        playerPed: 0,
        playerWasFrozen: false,
        cursorMode: false,
        looking: false,
        pointerDown: false,
        pointerReleased: false,
        pointerMovedObject: false,
        pointerHitId: null,
        pointerTransformBefore: null,
        hoverId: null,
        hoverScanAt: 0,
        gizmoMode: 'translate',
        nativeErrorShown: false
    }
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function number(value, fallback = 0) {
    const result = Number(value);
    return Number.isFinite(result) ? result : fallback;
}

function coordsOf(value) {
    if (!value) return { x: 0, y: 0, z: 0 };
    if (Array.isArray(value)) return { x: number(value[0]), y: number(value[1]), z: number(value[2]) };
    return { x: number(value.x), y: number(value.y), z: number(value.z) };
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, number(value)));
}

function addVectors(a, b) {
    return { x: number(a.x) + number(b.x), y: number(a.y) + number(b.y), z: number(a.z) + number(b.z) };
}

function scaleVector(value, scale) {
    return { x: number(value.x) * scale, y: number(value.y) * scale, z: number(value.z) * scale };
}

function vectorLength(value) {
    return Math.sqrt((number(value.x) ** 2) + (number(value.y) ** 2) + (number(value.z) ** 2));
}

function normalizeVector(value) {
    const length = vectorLength(value);
    return length > 0.0001 ? scaleVector(value, 1 / length) : { x: 0, y: 0, z: 0 };
}

function directionFromRotation(rotation) {
    const yaw = number(rotation.z) * Math.PI / 180;
    const pitch = number(rotation.x) * Math.PI / 180;
    const cosPitch = Math.abs(Math.cos(pitch));
    return {
        x: -Math.sin(yaw) * cosPitch,
        y: Math.cos(yaw) * cosPitch,
        z: Math.sin(pitch)
    };
}

function currentTransform() {
    const ped = PlayerPedId();
    const coords = coordsOf(GetEntityCoords(ped, false));
    return { ...coords, h: number(GetEntityHeading(ped)) };
}

function distance(a, b) {
    if (!a || !b) return Number.MAX_VALUE;
    const x = number(a.x) - number(b.x);
    const y = number(a.y) - number(b.y);
    const z = number(a.z) - number(b.z);
    return Math.sqrt((x * x) + (y * y) + (z * z));
}

function parsePayload(payload, fallback = null) {
    try {
        return typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch (error) {
        console.error('[yx_shellcreator] Invalid event payload:', error);
        return fallback;
    }
}

function requestId() {
    state.requestCounter += 1;
    return `${GetPlayerServerId(PlayerId())}-${GetGameTimer()}-${state.requestCounter}`;
}

function serverRequest(name, data = {}, options = {}) {
    const id = requestId();
    state.pending.set(id, {
        action: name,
        silent: options.silent === true,
        onSuccess: typeof options.onSuccess === 'function' ? options.onSuccess : null,
        onError: typeof options.onError === 'function' ? options.onError : null
    });
    const payload = JSON.stringify({ ...data, requestId: id });
    if (name === 'importHouse') TriggerLatentServerEvent(`${EVENT}:server:${name}`, 131072, payload);
    else emitNet(`${EVENT}:server:${name}`, payload);
    setTimeout(() => {
        const pending = state.pending.get(id);
        if (!pending) return;
        state.pending.delete(id);
        const message = '服务器响应超时，请刷新确认结果；导入操作不要立即重复提交。';
        if (pending.onError) pending.onError(message);
        if (!pending.silent) notify(message, 'error');
        sendUi('operationFailed', { operation: name, message });
    }, options.timeoutMs || 15000);
    return id;
}

function sendUi(action, data = {}) {
    SendNUIMessage({ action, ...data });
}

function notify(message, type = 'info') {
    if (!message) return;
    sendUi('toast', { message, type });
    BeginTextCommandThefeedPost('STRING');
    AddTextComponentSubstringPlayerName(`~b~yx_shellcreator~s~  ${message}`);
    EndTextCommandThefeedPostTicker(false, false);
}

function isSceneEditorActive() {
    return state.builderActive && !state.uiFocused;
}

function leaveSceneCursor() {
    if (!state.freecam.cursorMode) return;
    if (typeof LeaveCursorMode === 'function') LeaveCursorMode();
    state.freecam.cursorMode = false;
}

function enterSceneCursor() {
    if (!isSceneEditorActive() || state.freecam.looking || state.freecam.cursorMode) return;
    if (typeof EnterCursorMode === 'function') {
        EnterCursorMode();
        state.freecam.cursorMode = true;
        if (state.construction.active) return;
        const nativeMode = state.freecam.gizmoMode === 'rotate' ? 'gizmoRotation' : 'gizmoTranslation';
        ExecuteCommand(`+${nativeMode}`);
        setTimeout(() => ExecuteCommand(`-${nativeMode}`), 50);
    }
}

function setUiFocus(focused) {
    if (!focused) stopDoorPreview();
    if (focused) leaveSceneCursor();
    state.uiFocused = focused;
    SetNuiFocus(focused, focused);
    if (typeof SetNuiFocusKeepInput === 'function') SetNuiFocusKeepInput(false);
    if (!focused) enterSceneCursor();
    sendUi('focusState', { focused });
}

function uiState(mode, includeCatalog = true) {
    return {
        mode,
        houses: state.houses,
        currentHouse: state.currentHouse,
        objects: Array.from(state.objects.values()).map(stripEntity),
        construction: constructionStateForUi(),
        history: historyStateForUi(),
        ...(includeCatalog ? { catalog: catalogForUi(), config } : {})
    };
}

function catalogForUi() {
    const now = GetGameTimer();
    if (catalogUiCache && now >= catalogUiCacheAt && now - catalogUiCacheAt < 5000) return catalogUiCache;
    catalogUiCacheAt = now;
    catalogUiCache = { ...catalog, items: (catalog.items || []).map((item) => {
        const hash = GetHashKey(item.model);
        const available = IsModelInCdimage(hash) && IsModelValid(hash);
        return { ...item, available, unavailableReason: available ? '' : '当前游戏构建或已加载资源未注册此模型' };
    }) };
    return catalogUiCache;
}

function openUi(mode) {
    state.uiVisible = true;
    state.managerOpen = mode === 'manager';
    sendUi('open', uiState(mode));
    setUiFocus(true);
}

function closeUi(stopBuilder = false) {
    if (stopBuilder) stopBuilderMode();
    state.uiVisible = false;
    state.managerOpen = false;
    setUiFocus(false);
    sendUi('close');
}

function refreshUi() {
    if (!state.uiVisible) return;
    sendUi('state', uiState(state.builderActive ? 'builder' : 'manager', false));
}

function stripEntity(item) {
    if (!item) return item;
    const {
        entity,
        sourceEntity,
        collisionEntity,
        collisionTransform,
        doorSettings,
        doorHingeOffset,
        doorRatio,
        doorPending,
        doorPreview,
        doorPushRatio,
        doorPushUntil,
        doorLastPush,
        doorBounds,
        ...clean
    } = item;
    return clean;
}

function getPreset(id) {
    return (config.interiors || []).find((preset) => preset.id === id) || null;
}

function currentPreset() {
    return state.currentHouse ? getPreset(state.currentHouse.presetId) : null;
}

function houseAccessPoints(house) {
    return [{ id: 'main', label: '默认出入口', entrance: house.entrance, exit: house.exit }, ...(house.accessPoints || [])];
}

function isEmptyBuildSpace() {
    const preset = currentPreset();
    return Boolean(preset && preset.type === 'empty');
}

function supportsNativeObjectEditing() {
    const preset = currentPreset();
    return Boolean(preset && (preset.type === 'builtin' || preset.type === 'world'));
}

function getCatalogItem(id, model) {
    const items = catalog.items || [];
    if (id) {
        const byId = items.find((item) => item.id === id);
        if (byId) return byId;
    }
    return model ? items.find((item) => item.model.toLowerCase() === String(model).toLowerCase()) || null : null;
}

function getObject(id) {
    return id ? state.objects.get(id) : null;
}

function configureDoorRuntime(item) {
    if (!item) return false;
    const catalogItem = getCatalogItem(null, item.model);
    if (!catalogItem || !catalogItem.door) {
        item.isDoor = false;
        return false;
    }
    const globalSettings = config.doors || {};
    const modelSettings = typeof catalogItem.door === 'object' ? catalogItem.door : {};
    item.isDoor = true;
    item.doorSettings = { ...globalSettings, ...modelSettings };
    item.doorOpen = Boolean(item.doorOpen);
    item.doorRatio = item.doorOpen ? 1 : 0;
    item.doorPending = false;
    item.doorHingeOffset = null;
    item.doorPreview = false;
    item.doorPushRatio = 0;
    item.doorPushUntil = 0;
    item.doorLastPush = -1000;
    return true;
}

function doorBounds(item) {
    if (!item.doorBounds) {
        const bounds = GetModelDimensions(GetEntityModel(item.entity));
        item.doorBounds = { min: coordsOf(bounds[0]), max: coordsOf(bounds[1]) };
    }
    return item.doorBounds;
}

function doorHingeOffset(item) {
    if (!item || !item.isDoor || !item.entity || !DoesEntityExist(item.entity)) return { x: 0, y: 0 };
    if (item.doorHingeOffset) return item.doorHingeOffset;
    const settings = item.doorSettings || {};
    if (settings.hingeOffset) {
        item.doorHingeOffset = {
            x: number(settings.hingeOffset.x),
            y: number(settings.hingeOffset.y)
        };
        return item.doorHingeOffset;
    }
    try {
        const dimensions = GetModelDimensions(GetEntityModel(item.entity));
        if (Array.isArray(dimensions) && dimensions.length >= 2) {
            const minimum = coordsOf(dimensions[0]);
            const maximum = coordsOf(dimensions[1]);
            const xSpan = Math.abs(maximum.x - minimum.x);
            const ySpan = Math.abs(maximum.y - minimum.y);
            const useMaximum = String(settings.hingeSide || '').toLowerCase() === 'max';
            const alongX = xSpan >= ySpan;
            const span = alongX ? xSpan : ySpan;
            const minimumEdge = alongX ? minimum.x : minimum.y;
            const maximumEdge = alongX ? maximum.x : maximum.y;
            const nearestEdge = Math.abs(minimumEdge) <= Math.abs(maximumEdge) ? minimumEdge : maximumEdge;
            // Most GTA door props already place their model origin on the hinge. Custom
            // build-kit doors are centered, so only those need a translated hinge orbit.
            const originAlreadyAtHinge = Math.abs(nearestEdge) <= Math.max(0.08, span * 0.14);
            item.doorHingeOffset = originAlreadyAtHinge
                ? { x: 0, y: 0 }
                : alongX
                    ? { x: useMaximum ? maximum.x : minimum.x, y: 0 }
                    : { x: 0, y: useMaximum ? maximum.y : minimum.y };
            return item.doorHingeOffset;
        }
    } catch (error) {
        console.warn(`[yx_shellcreator] Could not measure door hinge for ${item.model}:`, error);
    }
    item.doorHingeOffset = { x: 0, y: 0 };
    return item.doorHingeOffset;
}

function rotateDoorOffset(offset, angleDegrees) {
    const angle = number(angleDegrees) * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return {
        x: (number(offset.x) * cosine) - (number(offset.y) * sine),
        y: (number(offset.x) * sine) + (number(offset.y) * cosine)
    };
}

function applyDoorPose(item, ratio) {
    if (!item || !item.isDoor || !item.entity || !DoesEntityExist(item.entity) || !item.position || !item.rotation) return;
    const settings = item.doorSettings || {};
    const closedPosition = coordsOf(item.position);
    const closedRotation = coordsOf(item.rotation);
    const hinge = doorHingeOffset(item);
    const closedHingeOffset = rotateDoorOffset(hinge, closedRotation.z);
    const openAngle = number(settings.openAngle, number((config.doors || {}).defaultOpenAngle, 90));
    const currentYaw = closedRotation.z + (openAngle * clamp(ratio, -1, 1));
    const currentHingeOffset = rotateDoorOffset(hinge, currentYaw);
    SetEntityCoordsNoOffset(
        item.entity,
        closedPosition.x + closedHingeOffset.x - currentHingeOffset.x,
        closedPosition.y + closedHingeOffset.y - currentHingeOffset.y,
        closedPosition.z,
        false,
        false,
        false
    );
    SetEntityRotation(item.entity, closedRotation.x, closedRotation.y, currentYaw, 2, false);
    FreezeEntityPosition(item.entity, true);
}

function closeDoorsForEditing() {
    for (const item of state.objects.values()) {
        if (!item.isDoor) continue;
        item.doorPreview = false;
        item.doorRatio = 0;
        applyDoorPose(item, 0);
    }
}

function stopDoorPreview() {
    for (const item of state.objects.values()) {
        if (!item.doorPreview) continue;
        item.doorPreview = false;
        item.doorRatio = 0;
        applyDoorPose(item, 0);
    }
    sendUi('doorPreview', { active: false });
}

function doorContactGeometry(item, position, closed = false) {
    const bounds = doorBounds(item);
    const pose = closed ? item.position : coordsOf(GetEntityCoords(item.entity, false));
    const rotation = closed ? item.rotation : coordsOf(GetEntityRotation(item.entity, 2));
    const local = rotateDoorOffset({ x: position.x - pose.x, y: position.y - pose.y }, -rotation.z);
    const z = position.z - pose.z;
    if (z < bounds.min.z - 0.3 || z > bounds.max.z + 0.4) return null;
    const alongX = bounds.max.x - bounds.min.x >= bounds.max.y - bounds.min.y;
    const widthAxis = alongX ? 'x' : 'y', normalAxis = alongX ? 'y' : 'x';
    const center = (bounds.min[normalAxis] + bounds.max[normalAxis]) * 0.5;
    const side = local[normalAxis] - center;
    const edge = clamp(local[widthAxis], bounds.min[widthAxis], bounds.max[widthAxis]);
    const reach = clamp(number((item.doorSettings || {}).contactDistance, 0.65), 0.3, 0.9);
    if (Math.hypot(local[widthAxis] - edge, side) > reach) return null;
    return { alongX, widthAxis, normalAxis, side, edge, yaw: rotation.z };
}

// Walking into the leaf swings it away from the player; proximity alone cannot open it.
function doorPushDirection(item, position, movement) {
    const contact = doorContactGeometry(item, position);
    if (!contact) return 0;
    const { alongX, widthAxis, normalAxis, side, edge, yaw } = contact;
    const velocity = rotateDoorOffset(movement, -yaw);
    if (Math.abs(velocity[normalAxis]) < 0.12 || side * velocity[normalAxis] >= -0.015) return 0;
    const hinge = doorHingeOffset(item);
    const lever = edge - hinge[widthAxis];
    if (Math.abs(lever) < 0.12) return 0;
    const torque = (alongX ? 1 : -1) * lever * velocity[normalAxis];
    const angle = number(item.doorSettings.openAngle, number((config.doors || {}).defaultOpenAngle, 90));
    return Math.sign(torque * angle);
}

function updateDoorContact(ped, position) {
    if (!state.currentHouse || state.builderActive || state.uiVisible || state.entering || IsPedInAnyVehicle(ped, false) || IsEntityDead(ped)) return;
    let movement = coordsOf(GetEntityVelocity(ped));
    // At the first collision GTA can stop the ped velocity; retain walking intent.
    if (Math.hypot(movement.x, movement.y) < 0.15) {
        const forward = -GetControlNormal(0, 31), right = GetControlNormal(0, 30);
        const heading = coordsOf(GetGameplayCamRot(2)).z * Math.PI / 180;
        movement = Math.hypot(forward, right) < 0.2 ? { x: 0, y: 0 } : {
            x: -Math.sin(heading) * forward + Math.cos(heading) * right,
            y: Math.cos(heading) * forward + Math.sin(heading) * right };
    }
    const now = GetGameTimer();
    for (const item of state.objects.values()) {
        if (!item.isDoor || item.hidden || !item.entity || !DoesEntityExist(item.entity)
            || distance(position, item.position) > 6) continue;
        let direction = doorPushDirection(item, position, movement);
        // Hold an already moving/open leaf while someone occupies the doorway.
        // Do not close through a stationary player, and never open a closed leaf this way.
        if (!direction && Math.abs(item.doorRatio) > 0.08
            && (doorContactGeometry(item, position) || doorContactGeometry(item, position, true))) {
            direction = Math.sign(item.doorRatio);
        }
        if (!direction) continue;
        item.doorPushRatio = direction;
        item.doorPushUntil = now + 1800;
        if (now - item.doorLastPush >= 400) {
            item.doorLastPush = now;
            // Transient swing is synchronized, never written to the database per frame.
            emitNet(`${EVENT}:server:pushDoor`, JSON.stringify({ houseId: state.currentHouse.id, objectId: item.id, direction }));
        }
    }
}

function updateDoorAnimations() {
    const frameTime = clamp(typeof GetFrameTime === 'function' ? GetFrameTime() : 0.016, 0.001, 0.05);
    for (const item of state.objects.values()) {
        if (!item.isDoor || item.hidden || !item.entity || !DoesEntityExist(item.entity)) continue;
        if (state.builderActive && !item.doorPreview) continue;
        const target = item.doorPreview ? 1 : GetGameTimer() < item.doorPushUntil ? item.doorPushRatio : item.doorOpen ? 1 : 0;
        const current = clamp(number(item.doorRatio, target), -1, 1);
        if (Math.abs(target - current) < 0.001) continue;
        const speed = Math.max(0.1, target === 0
            ? number((item.doorSettings || {}).closeSpeed, 0.65)
            : number((item.doorSettings || {}).animationSpeed, 2.8));
        const step = speed * frameTime;
        item.doorRatio = target > current ? Math.min(target, current + step) : Math.max(target, current - step);
        applyDoorPose(item, item.doorRatio);
    }
}

function toggleDoor(item) {
    if (!item || !item.isDoor || item.doorPending || !state.currentHouse) return false;
    const previous = Boolean(item.doorOpen);
    item.doorOpen = !previous;
    item.doorPending = true;
    serverRequest('setDoorState', {
        houseId: state.currentHouse.id,
        objectId: item.id,
        open: item.doorOpen
    }, {
        silent: true,
        onSuccess: () => { item.doorPending = false; },
        onError: () => {
            item.doorOpen = previous;
            item.doorPending = false;
            refreshUi();
        }
    });
    return true;
}

function syncStairCollision(item) {
    if (!item || !item.collisionEntity || !DoesEntityExist(item.collisionEntity)
        || !item.entity || !DoesEntityExist(item.entity)) return;
    const position = coordsOf(GetEntityCoords(item.entity, false));
    const rotation = coordsOf(GetEntityRotation(item.entity, 2));
    const transform = { position, rotation };
    // Repositioning a frozen collision body every frame disrupts the ped's support
    // contact. Only touch the body when the editor actually changes its transform.
    if (transformsEqual(item.collisionTransform, transform, 0.0001)) return;
    SetEntityCoordsNoOffset(item.collisionEntity, position.x, position.y, position.z, false, false, false);
    SetEntityRotation(item.collisionEntity, rotation.x, rotation.y, rotation.z, 2, true);
    FreezeEntityPosition(item.collisionEntity, true);
    item.collisionTransform = transform;
}

async function attachStairCollision(item) {
    if (!item || !WALKABLE_STAIR_MODELS.has(String(item.model || '')) || !item.entity) return;
    const helperModel = String(item.model).startsWith('yx_spiral_') ? 'yx_spiral_collision' : STAIR_COLLISION_MODEL;
    const helper = await createLocalObject(helperModel, item.position, item.rotation, true);
    if (!helper) {
        console.warn(`[yx_shellcreator] Walkable collision helper failed for ${item.model}`);
        return;
    }
    item.collisionEntity = helper;
    item.collisionTransform = null;
    SetEntityVisible(helper, false, false);
    SetEntityAlpha(helper, 0, false);
    SetEntityCollision(helper, true, true);
    SetEntityCollision(item.entity, false, false);
    syncStairCollision(item);
}

function updateStairCollisionHelpers() {
    for (const item of state.objects.values()) {
        if (item.collisionEntity) syncStairCollision(item);
    }
}

function copyTransformValue(value) {
    return value ? {
        position: {
            x: number(value.position && value.position.x),
            y: number(value.position && value.position.y),
            z: number(value.position && value.position.z),
            h: number(value.position && value.position.h)
        },
        rotation: {
            x: number(value.rotation && value.rotation.x),
            y: number(value.rotation && value.rotation.y),
            z: number(value.rotation && value.rotation.z)
        }
    } : null;
}

function objectSnapshot(item) {
    if (!item) return null;
    const transform = item.entity && DoesEntityExist(item.entity) ? syncLocalTransform(item) : {
        position: item.position,
        rotation: item.rotation
    };
    const copied = copyTransformValue(transform);
    if (!copied) return null;
    return {
        model: String(item.model || ''),
        ...copied,
        sourceKind: String(item.sourceKind || 'placed'),
        sourceModelHash: number(item.sourceModelHash),
        sourcePosition: item.sourcePosition ? { ...coordsOf(item.sourcePosition), h: number(item.sourcePosition.h) } : null,
        hidden: Boolean(item.hidden)
    };
}

function transformsEqual(left, right, epsilon = 0.001) {
    if (!left || !right) return false;
    return ['x', 'y', 'z'].every((axis) => Math.abs(number(left.position[axis]) - number(right.position[axis])) <= epsilon)
        && ['x', 'y', 'z'].every((axis) => Math.abs(number(left.rotation[axis]) - number(right.rotation[axis])) <= epsilon);
}

function historyStateForUi() {
    return {
        canUndo: state.history.undo.length > 0 && !state.history.applying,
        canRedo: state.history.redo.length > 0 && !state.history.applying,
        undoCount: state.history.undo.length,
        redoCount: state.history.redo.length,
        applying: state.history.applying
    };
}

function syncHistoryUi() {
    sendUi('historyState', { history: historyStateForUi() });
}

function clearHistory() {
    state.history.undo.length = 0;
    state.history.redo.length = 0;
    state.history.applying = false;
    syncHistoryUi();
}

function pushHistory(action) {
    if (!action || state.history.applying) return;
    state.history.undo.push(action);
    if (state.history.undo.length > state.history.max) state.history.undo.shift();
    state.history.redo.length = 0;
    syncHistoryUi();
}

function remapHistoryObjectId(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    for (const stack of [state.history.undo, state.history.redo]) {
        for (const action of stack) {
            if (action.objectId === oldId) action.objectId = newId;
        }
    }
}

function deleteEntitySafe(entity) {
    if (!entity || !DoesEntityExist(entity)) return;
    SetEntityDrawOutline(entity, false);
    SetEntityAsMissionEntity(entity, true, true);
    DeleteEntity(entity);
}

const modelFailures = new Map();

function reportModelFailure(model, reason) {
    const name = String(model);
    if (modelFailures.get(name) !== reason) {
        const build = typeof GetGameBuildNumber === 'function' ? GetGameBuildNumber() : 'unknown';
        console.warn(`[yx_shellcreator] model=${name} build=${build}: ${reason}`);
    }
    modelFailures.set(name, reason);
}

function modelFailureMessage(model) {
    return `无法生成 ${model}：${modelFailures.get(String(model)) || '实体创建失败'}。详情见 F8。`;
}

async function loadModel(model) {
    const hash = typeof model === 'number' ? model : GetHashKey(String(model));
    if (!IsModelInCdimage(hash) || !IsModelValid(hash)) {
        reportModelFailure(model, String(model).startsWith('yx_')
            ? '模型未注册，请完整安装 stream 并重启资源'
            : '当前游戏未注册此模型，可能缺少对应 DLC 或地图内饰资源');
        return 0;
    }
    RequestModel(hash);
    if (typeof RequestCollisionForModel === 'function') RequestCollisionForModel(hash);
    const timeout = GetGameTimer() + 10000;
    while (!HasModelLoaded(hash) && GetGameTimer() < timeout) await delay(0);
    if (!HasModelLoaded(hash)) {
        SetModelAsNoLongerNeeded(hash);
        reportModelFailure(model, '模型加载超时（10 秒）');
        return 0;
    }
    modelFailures.delete(String(model));
    return hash;
}

function freezeObject(entity) {
    SetEntityAsMissionEntity(entity, true, true);
    SetEntityInvincible(entity, true);
    FreezeEntityPosition(entity, true);
}

async function createLocalObject(model, position, rotation, collision = true) {
    const hash = await loadModel(model);
    if (!hash) return 0;
    const entry = getCatalogItem(null, typeof model === 'number' ? catalogModelFromHash(model) : model);
    // Doors are positioned/animated by this resource, not by GTA's ambient door
    // system. Create them as script props so the archetype door flag cannot reject
    // creation or make the native door controller fight our hinge animation.
    const scriptDoor = Boolean(entry && entry.door);
    let entity = CreateObjectNoOffset(hash, number(position.x), number(position.y), number(position.z), false, false, scriptDoor);
    // Also handle door model names entered manually, outside the catalog.
    if ((!entity || !DoesEntityExist(entity)) && !scriptDoor) {
        entity = CreateObjectNoOffset(hash, number(position.x), number(position.y), number(position.z), false, false, true);
    }
    if (!entity || !DoesEntityExist(entity)) {
        SetModelAsNoLongerNeeded(hash);
        reportModelFailure(model, '模型已加载，但游戏拒绝创建实体');
        return 0;
    }
    RequestCollisionAtCoord(number(position.x), number(position.y), number(position.z));
    freezeObject(entity);
    SetEntityCollision(entity, collision, collision);
    if (rotation) {
        SetEntityRotation(entity, number(rotation.x), number(rotation.y), number(rotation.z), 2, true);
    }
    SetModelAsNoLongerNeeded(hash);
    return entity;
}

function unsignedHash(value) {
    return number(value) >>> 0;
}

let catalogHashIndex = null;

function catalogModelFromHash(hash) {
    if (!catalogHashIndex) {
        catalogHashIndex = new Map();
        for (const item of catalog.items || []) {
            if (!item || !item.model) continue;
            catalogHashIndex.set(unsignedHash(GetHashKey(String(item.model))), String(item.model));
        }
    }
    return catalogHashIndex.get(unsignedHash(hash)) || null;
}

function editableNativeModelName(entity) {
    if (!entity || !DoesEntityExist(entity)) return null;
    const hash = unsignedHash(GetEntityModel(entity));
    const known = catalogModelFromHash(hash);
    if (known) return known;
    try {
        const dimensions = GetModelDimensions(GetEntityModel(entity));
        if (!Array.isArray(dimensions) || dimensions.length < 2) return null;
        const minimum = coordsOf(dimensions[0]);
        const maximum = coordsOf(dimensions[1]);
        const spans = [maximum.x - minimum.x, maximum.y - minimum.y, maximum.z - minimum.z].map((value) => Math.abs(value));
        if (Math.max(...spans) > 10.0 || spans.every((value) => value < 0.01)) return null;
    } catch (error) {
        return null;
    }
    return `native_${hash.toString(16).padStart(8, '0')}`;
}

function nativeSourceEntityFor(item) {
    if (!item || String(item.sourceKind || '') !== 'native' || !item.sourcePosition) return 0;
    if (item.sourceEntity && DoesEntityExist(item.sourceEntity)) return item.sourceEntity;
    if (typeof GetGamePool !== 'function') return 0;
    const wantedHash = unsignedHash(item.sourceModelHash);
    let closest = 0;
    let closestDistance = 0.85;
    for (const entity of GetGamePool('CObject') || []) {
        if (!entity || !DoesEntityExist(entity) || entity === item.entity || entity === state.shellEntity || entity === state.foundationEntity) continue;
        if (unsignedHash(GetEntityModel(entity)) !== wantedHash) continue;
        let managedClone = false;
        for (const candidate of state.objects.values()) {
            if (candidate.entity === entity) {
                managedClone = true;
                break;
            }
        }
        if (managedClone) continue;
        const currentDistance = distance(coordsOf(GetEntityCoords(entity, false)), item.sourcePosition);
        if (currentDistance < closestDistance) {
            closest = entity;
            closestDistance = currentDistance;
        }
    }
    return closest;
}

function hideNativeSource(entity) {
    if (!entity || !DoesEntityExist(entity)) return;
    SetEntityDrawOutline(entity, false);
    SetEntityVisible(entity, false, false);
    SetEntityAlpha(entity, 0, false);
    SetEntityCollision(entity, false, false);
}

function restoreNativeSource(entity) {
    if (!entity || !DoesEntityExist(entity)) return;
    ResetEntityAlpha(entity);
    SetEntityVisible(entity, true, false);
    SetEntityCollision(entity, true, true);
}

function maintainNativeSources() {
    const now = GetGameTimer();
    if (now < state.nativeRefreshAt) return;
    state.nativeRefreshAt = now + 1000;
    for (const item of state.objects.values()) {
        if (item.sourceKind !== 'native') continue;
        const sourceEntity = nativeSourceEntityFor(item);
        if (!sourceEntity) continue;
        item.sourceEntity = sourceEntity;
        hideNativeSource(sourceEntity);
    }
}

function configureBuildSurface(house, foundationEntity = 0, foundationPosition = null) {
    const settings = config.emptyBuild || {};
    const anchor = config.customInteriorAnchor || (house && house.spawn) || { x: 0, y: 0, z: 0 };
    let planeZ = number(house && house.spawn && house.spawn.z, number(anchor.z));

    if (foundationEntity && DoesEntityExist(foundationEntity) && foundationPosition) {
        try {
            const dimensions = GetModelDimensions(GetEntityModel(foundationEntity));
            if (Array.isArray(dimensions) && dimensions.length >= 2) {
                const maximum = coordsOf(dimensions[1]);
                const measuredTop = number(foundationPosition.z) + number(maximum.z);
                if (Number.isFinite(measuredTop)) planeZ = measuredTop;
            }
        } catch (error) {
            console.warn('[yx_shellcreator] Could not measure the empty-space foundation:', error);
        }
    }

    planeZ += number(settings.surfaceOffset, 0.0);
    state.buildSurface.origin = { x: number(anchor.x), y: number(anchor.y), z: planeZ };
    state.buildSurface.planeZ = planeZ;
    state.buildSurface.ready = true;
}

async function spawnDecoration(item) {
    if (!item || !item.id || !item.model || !item.position) return;
    const existing = state.objects.get(item.id);
    if (existing && existing.entity) deleteEntitySafe(existing.entity);
    if (existing && existing.collisionEntity) deleteEntitySafe(existing.collisionEntity);
    const nativeOverride = String(item.sourceKind || '') === 'native';
    const sourceEntity = nativeOverride
        ? nativeSourceEntityFor({ ...item, sourceEntity: existing && existing.sourceEntity })
        : 0;
    if (sourceEntity) hideNativeSource(sourceEntity);
    if (nativeOverride && item.hidden) {
        const hiddenItem = { ...item, entity: 0, sourceEntity, collisionEntity: 0, invalid: false, hidden: true };
        configureDoorRuntime(hiddenItem);
        state.objects.set(item.id, hiddenItem);
        refreshUi();
        return;
    }
    const model = nativeOverride && number(item.sourceModelHash) ? number(item.sourceModelHash) : item.model;
    const entity = await createLocalObject(model, item.position, item.rotation || { x: 0, y: 0, z: 0 }, true);
    if (!entity) {
        notify(modelFailureMessage(model), 'error');
        state.objects.set(item.id, { ...item, entity: 0, sourceEntity, invalid: true });
        refreshUi();
        return;
    }
    const runtimeItem = { ...item, entity, sourceEntity, collisionEntity: 0, invalid: false, hidden: false };
    configureDoorRuntime(runtimeItem);
    state.objects.set(item.id, runtimeItem);
    if (runtimeItem.isDoor) applyDoorPose(runtimeItem, runtimeItem.doorRatio);
    await attachStairCollision(runtimeItem);
    refreshUi();
}

async function spawnEnvironment(house) {
    const preset = getPreset(house.presetId);
    if (!preset) return;

    if (preset.type === 'shell') {
        const anchor = config.customInteriorAnchor || house.spawn;
        state.shellEntity = await createLocalObject(
            house.shellModel,
            anchor,
            { x: 0, y: 0, z: number(anchor.h) },
            true
        );
        if (!state.shellEntity) notify(`Shell 模型无法载入：${house.shellModel}`, 'error');
    } else if (preset.type === 'empty' && config.emptyFoundation && config.emptyFoundation.model) {
        const anchor = config.customInteriorAnchor || house.spawn;
        const offset = config.emptyFoundation.offset || {};
        const position = {
            x: number(anchor.x) + number(offset.x),
            y: number(anchor.y) + number(offset.y),
            z: number(anchor.z) + number(offset.z)
        };
        state.foundationEntity = await createLocalObject(
            config.emptyFoundation.model,
            position,
            config.emptyFoundation.rotation || { x: 0, y: 0, z: 0 },
            true
        );
        configureBuildSurface(house, state.foundationEntity, position);
        if (!state.foundationEntity) notify('空白空间基础平台模型加载失败，可在 config.json 中更换模型', 'error');
    } else if (preset.type === 'empty') {
        configureBuildSurface(house);
    }
}

function hasFreecam() {
    return Boolean(state.freecam.handle && DoesCamExist(state.freecam.handle));
}

function buildCameraSettings() {
    return (config.emptyBuild && config.emptyBuild.camera) || {};
}

function positionBuildCamera() {
    const rotation = state.freecam.rotation;
    const target = state.freecam.target;
    const direction = directionFromRotation(rotation);
    state.freecam.position = addVectors(target, scaleVector(direction, -state.freecam.distance));
}

function initializeBuildCamera() {
    if (!state.buildSurface.ready) configureBuildSurface(state.currentHouse);
    const settings = buildCameraSettings();
    const origin = state.buildSurface.origin;
    state.freecam.buildView = true;
    state.freecam.target = { x: origin.x, y: origin.y, z: state.buildSurface.planeZ };
    state.freecam.distance = clamp(
        number(settings.distance, 22.0),
        number(settings.minDistance, 8.0),
        number(settings.maxDistance, 42.0)
    );
    state.freecam.rotation = {
        x: clamp(number(settings.pitch, -55.0), number(settings.minPitch, -72.0), number(settings.maxPitch, -38.0)),
        y: 0,
        z: number(settings.yaw, 45.0)
    };
    positionBuildCamera();
}

function startBuilderMode() {
    if (!state.currentHouse) return false;
    if (state.builderActive && hasFreecam()) return true;

    const ped = PlayerPedId();
    let cameraPosition = coordsOf(GetGameplayCamCoord());
    const cameraRotation = coordsOf(GetGameplayCamRot(2));

    state.builderActive = true;
    state.freecam.position = cameraPosition;
    state.freecam.rotation = { x: clamp(cameraRotation.x, -89, 89), y: 0, z: number(cameraRotation.z) };
    state.freecam.buildView = false;
    state.freecam.playerPed = ped;
    state.freecam.playerWasFrozen = typeof IsEntityPositionFrozen === 'function' ? IsEntityPositionFrozen(ped) : false;
    state.freecam.looking = false;
    state.freecam.pointerDown = false;
    state.freecam.pointerReleased = false;
    state.freecam.pointerMovedObject = false;
    state.freecam.gizmoMode = 'translate';
    closeDoorsForEditing();

    if (isEmptyBuildSpace()) {
        initializeBuildCamera();
        cameraPosition = state.freecam.position;
    }

    FreezeEntityPosition(ped, true);
    state.freecam.handle = CreateCam('DEFAULT_SCRIPTED_CAMERA', true);
    if (!state.freecam.handle) {
        state.builderActive = false;
        if (!state.freecam.playerWasFrozen) FreezeEntityPosition(ped, false);
        state.freecam.playerPed = 0;
        state.freecam.playerWasFrozen = false;
        notify('无法创建自由相机，请更新 FiveM 客户端后重试', 'error');
        return false;
    }

    SetCamCoord(state.freecam.handle, cameraPosition.x, cameraPosition.y, cameraPosition.z);
    SetCamRot(state.freecam.handle, state.freecam.rotation.x, 0, state.freecam.rotation.z, 2);
    SetCamFov(
        state.freecam.handle,
        state.freecam.buildView ? number(buildCameraSettings().fov, 42.0) : number(GetGameplayCamFov(), 50)
    );
    if (typeof SetCamNearClip === 'function') SetCamNearClip(state.freecam.handle, 0.05);
    SetCamActive(state.freecam.handle, true);
    RenderScriptCams(true, false, 0, true, true);
    const focus = state.freecam.buildView ? state.freecam.target : cameraPosition;
    SetFocusPosAndVel(focus.x, focus.y, focus.z, 0, 0, 0);
    return true;
}

function stopBuilderMode() {
    stopConstructionPlacement(false);
    if (!state.builderActive && !hasFreecam()) return;

    if (state.saveTimer) {
        clearTimeout(state.saveTimer);
        state.saveTimer = null;
        saveSelected(true);
    }

    if (state.freecam.pointerDown) ExecuteCommand('-gizmoSelect');
    state.freecam.pointerDown = false;
    state.freecam.pointerReleased = false;
    state.freecam.pointerMovedObject = false;
    state.freecam.pointerHitId = null;
    state.freecam.pointerTransformBefore = null;
    state.freecam.looking = false;
    if (state.freecam.hoverId && state.freecam.hoverId !== state.selectedId) {
        const hovered = getObject(state.freecam.hoverId);
        if (hovered && hovered.entity && DoesEntityExist(hovered.entity)) SetEntityDrawOutline(hovered.entity, false);
    }
    state.freecam.hoverId = null;
    leaveSceneCursor();

    if (hasFreecam()) {
        SetCamActive(state.freecam.handle, false);
        RenderScriptCams(false, false, 0, true, true);
        DestroyCam(state.freecam.handle, false);
    }
    state.freecam.handle = 0;
    state.freecam.buildView = false;
    ClearFocus();

    const ped = state.freecam.playerPed;
    if (ped && DoesEntityExist(ped) && !state.freecam.playerWasFrozen) FreezeEntityPosition(ped, false);
    state.freecam.playerPed = 0;
    state.freecam.playerWasFrozen = false;
    state.builderActive = false;
    selectObject(null);
}

function updateBuildCamera() {
    const settings = buildCameraSettings();
    const frameTime = clamp(typeof GetFrameTime === 'function' ? GetFrameTime() : 0.016, 0.001, 0.05);
    const rotation = state.freecam.rotation;
    const target = state.freecam.target;

    if (state.freecam.looking) {
        const sensitivity = number(settings.lookSensitivity, 6.0);
        rotation.z -= GetDisabledControlNormal(0, 1) * sensitivity;
        rotation.x = clamp(
            rotation.x - (GetDisabledControlNormal(0, 2) * sensitivity),
            number(settings.minPitch, -72.0),
            number(settings.maxPitch, -38.0)
        );
    }

    const yaw = number(rotation.z) * Math.PI / 180;
    const forward = { x: -Math.sin(yaw), y: Math.cos(yaw), z: 0 };
    const right = { x: Math.cos(yaw), y: Math.sin(yaw), z: 0 };
    let movement = { x: 0, y: 0, z: 0 };
    if (GetDisabledControlNormal(0, 32) > 0.1) movement = addVectors(movement, forward);
    if (GetDisabledControlNormal(0, 33) > 0.1) movement = addVectors(movement, scaleVector(forward, -1));
    if (GetDisabledControlNormal(0, 35) > 0.1) movement = addVectors(movement, right);
    if (GetDisabledControlNormal(0, 34) > 0.1) movement = addVectors(movement, scaleVector(right, -1));

    if (vectorLength(movement) > 0.001) {
        const referenceDistance = Math.max(1.0, number(settings.distance, 22.0));
        let speed = number(settings.panSpeed, 9.0) * (state.freecam.distance / referenceDistance);
        if (GetDisabledControlNormal(0, 21) > 0.1) speed *= number(config.freecam && config.freecam.fastMultiplier, 3.0);
        if (GetDisabledControlNormal(0, 36) > 0.1) speed *= number(config.freecam && config.freecam.slowMultiplier, 0.25);
        const moved = addVectors(target, scaleVector(normalizeVector(movement), speed * frameTime));
        target.x = moved.x;
        target.y = moved.y;
    }

    const zoomSpeed = number(settings.zoomSpeed, 18.0);
    if (GetDisabledControlNormal(0, 38) > 0.1) state.freecam.distance -= zoomSpeed * frameTime;
    if (GetDisabledControlNormal(0, 44) > 0.1) state.freecam.distance += zoomSpeed * frameTime;
    if (IsDisabledControlJustPressed(0, 241)) state.freecam.distance -= number(settings.wheelStep, 2.0);
    if (IsDisabledControlJustPressed(0, 242)) state.freecam.distance += number(settings.wheelStep, 2.0);
    state.freecam.distance = clamp(
        state.freecam.distance,
        number(settings.minDistance, 8.0),
        number(settings.maxDistance, 42.0)
    );

    const origin = state.buildSurface.origin;
    const maxRadius = Math.max(2.0, number((config.emptyBuild || {}).maxBuildRadius, 28.0));
    target.x = clamp(target.x, origin.x - maxRadius, origin.x + maxRadius);
    target.y = clamp(target.y, origin.y - maxRadius, origin.y + maxRadius);
    target.z = state.buildSurface.planeZ;

    positionBuildCamera();
    const position = state.freecam.position;
    SetCamCoord(state.freecam.handle, position.x, position.y, position.z);
    SetCamRot(state.freecam.handle, rotation.x, 0, rotation.z, 2);
    SetFocusPosAndVel(target.x, target.y, target.z, 0, 0, 0);
}

function updateFreecam() {
    if (!hasFreecam()) return;

    if (state.freecam.buildView) {
        updateBuildCamera();
        return;
    }

    const settings = config.freecam || {};
    const frameTime = clamp(typeof GetFrameTime === 'function' ? GetFrameTime() : 0.016, 0.001, 0.05);
    const rotation = state.freecam.rotation;

    if (state.freecam.looking) {
        const sensitivity = number(settings.lookSensitivity, 8.0);
        rotation.z -= GetDisabledControlNormal(0, 1) * sensitivity;
        rotation.x = clamp(rotation.x - (GetDisabledControlNormal(0, 2) * sensitivity), -89, 89);
    }

    const forward = directionFromRotation(rotation);
    const yaw = number(rotation.z) * Math.PI / 180;
    const right = { x: Math.cos(yaw), y: Math.sin(yaw), z: 0 };
    let movement = { x: 0, y: 0, z: 0 };

    if (GetDisabledControlNormal(0, 32) > 0.1) movement = addVectors(movement, forward);
    if (GetDisabledControlNormal(0, 33) > 0.1) movement = addVectors(movement, scaleVector(forward, -1));
    if (GetDisabledControlNormal(0, 35) > 0.1) movement = addVectors(movement, right);
    if (GetDisabledControlNormal(0, 34) > 0.1) movement = addVectors(movement, scaleVector(right, -1));
    if (GetDisabledControlNormal(0, 38) > 0.1) movement.z += 1;
    if (GetDisabledControlNormal(0, 44) > 0.1) movement.z -= 1;

    if (vectorLength(movement) > 0.001) {
        let speed = number(settings.speed, 4.5);
        if (GetDisabledControlNormal(0, 21) > 0.1) speed *= number(settings.fastMultiplier, 3.0);
        if (GetDisabledControlNormal(0, 36) > 0.1) speed *= number(settings.slowMultiplier, 0.25);
        state.freecam.position = addVectors(state.freecam.position, scaleVector(normalizeVector(movement), speed * frameTime));
    }

    const position = state.freecam.position;
    SetCamCoord(state.freecam.handle, position.x, position.y, position.z);
    SetCamRot(state.freecam.handle, rotation.x, 0, rotation.z, 2);
    SetFocusPosAndVel(position.x, position.y, position.z, 0, 0, 0);
}

function editorTransform() {
    if (!state.builderActive || !hasFreecam()) return currentTransform();
    if (state.freecam.buildView) {
        return {
            x: number(state.freecam.target.x),
            y: number(state.freecam.target.y),
            z: number(state.buildSurface.planeZ) + 1.0,
            h: number(state.freecam.rotation.z)
        };
    }
    return {
        x: number(state.freecam.position.x),
        y: number(state.freecam.position.y),
        z: number(state.freecam.position.z) - 1.0,
        h: number(state.freecam.rotation.z)
    };
}

function cleanupInterior() {
    stopConstructionPlacement(false);
    if (state.saveTimer) {
        clearTimeout(state.saveTimer);
        state.saveTimer = null;
    }
    if (state.selectedId) {
        const selected = getObject(state.selectedId);
        if (selected && selected.entity && DoesEntityExist(selected.entity)) SetEntityDrawOutline(selected.entity, false);
    }
    state.selectedId = null;
    for (const item of state.objects.values()) {
        deleteEntitySafe(item.entity);
        deleteEntitySafe(item.collisionEntity);
        restoreNativeSource(item.sourceEntity);
    }
    state.objects.clear();
    state.freecam.hoverId = null;
    state.adoptingNative = false;
    state.nativeRefreshAt = 0;
    clearHistory();
    deleteEntitySafe(state.shellEntity);
    deleteEntitySafe(state.foundationEntity);
    state.shellEntity = 0;
    state.foundationEntity = 0;
    state.buildSurface.ready = false;
    state.buildSurface.origin = { x: 0, y: 0, z: 0 };
    state.buildSurface.planeZ = 0;
    if (state.pinnedInterior) {
        UnpinInterior(state.pinnedInterior);
        state.pinnedInterior = 0;
    }
    for (const ipl of state.requestedIpls) RemoveIpl(ipl);
    state.requestedIpls.length = 0;
}

async function prepareBuiltinInterior(spawn, preset) {
    if (!preset || (preset.type !== 'builtin' && preset.type !== 'world')) return;
    for (const ipl of Array.isArray(preset.ipls) ? preset.ipls : []) {
        const name = String(ipl);
        const alreadyActive = typeof IsIplActive === 'function' && IsIplActive(name);
        RequestIpl(name);
        if (!alreadyActive) state.requestedIpls.push(name);
    }
    RequestCollisionAtCoord(number(spawn.x), number(spawn.y), number(spawn.z));
    const deadline = GetGameTimer() + 2500;
    do {
        const interior = GetInteriorAtCoords(number(spawn.x), number(spawn.y), number(spawn.z));
        if (interior) {
            state.pinnedInterior = interior;
            PinInteriorInMemory(interior);
            RefreshInterior(interior);
            if (IsInteriorReady(interior)) return;
        }
        await delay(0);
    } while (GetGameTimer() < deadline);
}

function setEntryLoadingVisible(visible, objectCount = 0) {
    if (!visible) {
        if (typeof BusyspinnerOff === 'function') BusyspinnerOff();
        return;
    }
    if (typeof BeginTextCommandBusyspinnerOn !== 'function'
        || typeof EndTextCommandBusyspinnerOn !== 'function') return;
    if (typeof BusyspinnerOff === 'function') BusyspinnerOff();
    BeginTextCommandBusyspinnerOn('STRING');
    AddTextComponentSubstringPlayerName(objectCount > 0
        ? `正在加载室内与 ${objectCount} 个物件...`
        : '正在加载室内...');
    EndTextCommandBusyspinnerOn(4);
}

function preRequestDecorationModels(objects) {
    const settings = config.entryLoading || {};
    const limit = Math.max(0, Math.floor(number(settings.preloadModelLimit, 128)));
    const requested = new Set();
    if (limit === 0) return;
    for (const item of objects) {
        if (requested.size >= limit) break;
        if (!item || item.hidden) continue;
        const nativeHash = String(item.sourceKind || '') === 'native' ? number(item.sourceModelHash) : 0;
        const hash = nativeHash || GetHashKey(String(item.model || ''));
        const key = unsignedHash(hash);
        if (!key || requested.has(key) || !IsModelInCdimage(hash) || !IsModelValid(hash)) continue;
        requested.add(key);
        RequestModel(hash);
    }
}

async function waitForInteriorStreaming(ped, position) {
    const settings = config.entryLoading || {};
    const timeout = Math.max(0, number(settings.collisionTimeoutMs, 3500));
    const deadline = GetGameTimer() + timeout;
    let readyFrames = 0;

    if (typeof SetFocusPosAndVel === 'function') {
        SetFocusPosAndVel(number(position.x), number(position.y), number(position.z), 0, 0, 0);
    }
    do {
        RequestCollisionAtCoord(number(position.x), number(position.y), number(position.z));
        const collisionReady = typeof HasCollisionLoadedAroundEntity !== 'function'
            || HasCollisionLoadedAroundEntity(ped);
        const worldReady = typeof IsEntityWaitingForWorldCollision !== 'function'
            || !IsEntityWaitingForWorldCollision(ped);
        readyFrames = collisionReady && worldReady ? readyFrames + 1 : 0;
        if (readyFrames >= 3) break;
        await delay(0);
    } while (GetGameTimer() < deadline);

    const settleDelay = Math.max(0, number(settings.objectSettleMs, 500));
    if (settleDelay > 0) await delay(settleDelay);
}

async function enterInterior(payload) {
    if (!payload || !payload.house || state.entering) return;
    state.entering = true;
    const objects = Array.isArray(payload.objects) ? payload.objects : [];
    const loading = config.entryLoading || {};
    const startedAt = GetGameTimer();
    const fadeOutMs = Math.max(0, number(loading.fadeOutMs, 300));
    const fadeInMs = Math.max(0, number(loading.fadeInMs, 300));
    const batchSize = Math.max(1, Math.floor(number(loading.spawnBatchSize, 16)));
    let ped = 0;
    let loaded = false;

    DoScreenFadeOut(fadeOutMs);
    try {
        await delay(fadeOutMs + 50);
        setEntryLoadingVisible(true, objects.filter((item) => item && !item.hidden).length);
        closeUi(true);
        cleanupInterior();
        state.currentHouse = payload.house;
        if (globalThis.YxHouseEnvironment) YxHouseEnvironment.apply(payload.house.environment);
        state.interiorDepth = Math.max(1, number(payload.depth, 1));

        const spawn = payload.teleport || payload.house.spawn;
        const preset = getPreset(payload.house.presetId);
        RequestCollisionAtCoord(number(spawn.x), number(spawn.y), number(spawn.z));
        preRequestDecorationModels(objects);
        await prepareBuiltinInterior(spawn, preset);
        ped = PlayerPedId();
        SetEntityCoordsNoOffset(ped, number(spawn.x), number(spawn.y), number(spawn.z), false, false, false);
        SetEntityHeading(ped, number(spawn.h));
        FreezeEntityPosition(ped, true);

        await spawnEnvironment(payload.house);
        for (let index = 0; index < objects.length; index += 1) {
            await spawnDecoration(objects[index]);
            if ((index + 1) % batchSize === 0) await delay(0);
        }

        await waitForInteriorStreaming(ped, spawn);
        const minimumDuration = Math.max(0, number(loading.minimumDurationMs, 1500));
        const remaining = minimumDuration - (GetGameTimer() - startedAt);
        if (remaining > 0) await delay(remaining);
        loaded = true;
    } catch (error) {
        console.error('[yx_shellcreator] Interior loading failed:', error);
        notify('室内载入发生错误，可输入 /fixshell 重新加载', 'error');
    } finally {
        setEntryLoadingVisible(false);
        if (typeof ClearFocus === 'function') ClearFocus();
        if (ped && DoesEntityExist(ped)) FreezeEntityPosition(ped, false);
        DoScreenFadeIn(fadeInMs);
        state.entering = false;
    }

    if (!loaded) return;
    if (payload.recovery) notify(`已回到 ${payload.house.label} 的室内入口点`, 'success');
    else if (payload.resumed) notify(`已返回上一层房屋：${payload.house.label}`, 'success');
    else notify(`已进入 ${payload.house.label}`, 'success');
    const shouldAutoBuild = state.autoBuildHouseId === payload.house.id;
    state.autoBuildHouseId = null;
    if (shouldAutoBuild && startBuilderMode()) {
        openUi('builder');
        notify('新房屋已创建并自动进入建造模式', 'success');
    } else {
        refreshUi();
    }
}

async function leaveInterior(payload) {
    DoScreenFadeOut(250);
    await delay(280);
    closeUi(true);
    cleanupInterior();
    state.currentHouse = null;
    if (globalThis.YxHouseEnvironment) YxHouseEnvironment.apply(null);
    state.interiorDepth = 0;
    const entrance = payload && payload.entrance ? payload.entrance : null;
    if (entrance) {
        const ped = PlayerPedId();
        SetEntityCoordsNoOffset(ped, number(entrance.x), number(entrance.y), number(entrance.z) + 0.15, false, false, false);
        SetEntityHeading(ped, number(entrance.h));
    }
    await delay(150);
    DoScreenFadeIn(250);
    if (payload && payload.forced) notify('该房屋已被删除，你已离开室内', 'warning');
}

function selectObject(id) {
    stopDoorPreview();
    const old = getObject(state.selectedId);
    if (old && old.entity && DoesEntityExist(old.entity)) SetEntityDrawOutline(old.entity, false);
    state.selectedId = null;

    const item = getObject(id);
    if (item && item.entity && DoesEntityExist(item.entity)) {
        state.selectedId = id;
        SetEntityDrawOutlineColor(0, 174, 255, 255);
        SetEntityDrawOutline(item.entity, true);
    }
    sendUi('selection', { selectedId: state.selectedId });
}

function setHoveredObject(id) {
    if (id === state.freecam.hoverId) return;
    const previous = getObject(state.freecam.hoverId);
    if (previous && previous.entity && DoesEntityExist(previous.entity) && previous.id !== state.selectedId) {
        SetEntityDrawOutline(previous.entity, false);
    }
    state.freecam.hoverId = null;
    const item = getObject(id);
    if (!item || item.id === state.selectedId || !item.entity || !DoesEntityExist(item.entity)) return;
    state.freecam.hoverId = item.id;
    SetEntityDrawOutlineColor(79, 205, 255, 220);
    SetEntityDrawOutline(item.entity, true);
    const selected = getObject(state.selectedId);
    if (selected && selected.entity && DoesEntityExist(selected.entity)) {
        SetEntityDrawOutlineColor(0, 174, 255, 255);
        SetEntityDrawOutline(selected.entity, true);
    }
}

function frameFreecamOnObject(item) {
    if (!item || !item.entity || !DoesEntityExist(item.entity) || !hasFreecam()) return;

    const origin = coordsOf(GetEntityCoords(item.entity, false));
    if (state.freecam.buildView) {
        state.freecam.target.x = origin.x;
        state.freecam.target.y = origin.y;
        state.freecam.target.z = state.buildSurface.planeZ;
        positionBuildCamera();
        return;
    }
    let center = { ...origin };
    let radius = 1.0;
    try {
        const dimensions = GetModelDimensions(GetEntityModel(item.entity));
        if (Array.isArray(dimensions) && dimensions.length >= 2) {
            const minimum = coordsOf(dimensions[0]);
            const maximum = coordsOf(dimensions[1]);
            center.z += (minimum.z + maximum.z) * 0.5;
            radius = clamp(vectorLength({
                x: maximum.x - minimum.x,
                y: maximum.y - minimum.y,
                z: maximum.z - minimum.z
            }) * 0.65, 0.8, 6.0);
        }
    } catch (error) {
        radius = 1.0;
    }

    const forward = directionFromRotation(state.freecam.rotation);
    const cameraDistance = clamp(radius * 2.2, 2.5, 12.0);
    const position = addVectors(center, scaleVector(forward, -cameraDistance));
    const delta = {
        x: center.x - position.x,
        y: center.y - position.y,
        z: center.z - position.z
    };
    const horizontal = Math.max(0.001, Math.sqrt((delta.x ** 2) + (delta.y ** 2)));
    state.freecam.position = position;
    state.freecam.rotation.x = Math.atan2(delta.z, horizontal) * 180 / Math.PI;
    state.freecam.rotation.z = Math.atan2(-delta.x, delta.y) * 180 / Math.PI;
}

function editObjectInScene(id) {
    stopConstructionPlacement(false);
    selectObject(id);
    if (state.selectedId && state.builderActive) {
        frameFreecamOnObject(getObject(state.selectedId));
        setUiFocus(false);
    }
}

function waitForCreatedObject(id, attempts = 20) {
    if (!id || !state.builderActive) return;
    if (getObject(id)) {
        editObjectInScene(id);
        return;
    }
    if (attempts > 0) setTimeout(() => waitForCreatedObject(id, attempts - 1), 50);
}

function entityTransform(item) {
    if (!item || !item.entity || !DoesEntityExist(item.entity)) return null;
    const position = coordsOf(GetEntityCoords(item.entity, false));
    const rotation = coordsOf(GetEntityRotation(item.entity, 2));
    return {
        position: { ...position, h: 0 },
        rotation
    };
}

function syncLocalTransform(item) {
    // Preview and a live swing are presentation only, not the closed placement.
    if (item && item.isDoor && (item.doorPreview || !state.builderActive)) {
        return copyTransformValue({ position: item.position, rotation: item.rotation });
    }
    const transform = entityTransform(item);
    if (!transform) return null;
    item.position = transform.position;
    item.rotation = transform.rotation;
    syncStairCollision(item);
    return transform;
}

function applyObjectTransform(item, transform) {
    if (!item || !transform || !item.entity || !DoesEntityExist(item.entity)) return false;
    const copied = copyTransformValue(transform);
    if (!copied) return false;
    SetEntityCoordsNoOffset(
        item.entity,
        copied.position.x,
        copied.position.y,
        copied.position.z,
        false,
        false,
        false
    );
    SetEntityRotation(
        item.entity,
        copied.rotation.x,
        copied.rotation.y,
        copied.rotation.z,
        2,
        true
    );
    FreezeEntityPosition(item.entity, true);
    item.position = copied.position;
    item.rotation = copied.rotation;
    if (item.isDoor) applyDoorPose(item, state.builderActive ? 0 : number(item.doorRatio, item.doorOpen ? 1 : 0));
    syncStairCollision(item);
    return true;
}

function normalizedAngle(value) {
    return ((number(value) % 360) + 360) % 360;
}

function signedAngleDistance(left, right) {
    return Math.abs((((normalizedAngle(left) - normalizedAngle(right)) + 540) % 360) - 180);
}

function snapAngleToPreferred(value) {
    const angle = normalizedAngle(value);
    const preferredStep = Math.max(1, number(config.rotationSnap && config.rotationSnap.preferredStep, 45));
    const threshold = Math.max(0, number(config.rotationSnap && config.rotationSnap.threshold, 7));
    const nearest = Math.round(angle / preferredStep) * preferredStep;
    return signedAngleDistance(angle, nearest) <= threshold ? normalizedAngle(nearest) : Math.round(angle * 10) / 10;
}

function snapSelectedPreferredRotation() {
    const item = getObject(state.selectedId);
    if (!item || !item.entity || !DoesEntityExist(item.entity)) return false;
    if (snapSelectedConstruction()) return true;
    if (state.freecam.gizmoMode !== 'rotate') return false;
    const rotation = coordsOf(GetEntityRotation(item.entity, 2));
    const snapped = {
        x: snapAngleToPreferred(rotation.x),
        y: snapAngleToPreferred(rotation.y),
        z: snapAngleToPreferred(rotation.z)
    };
    if (['x', 'y', 'z'].every((axis) => signedAngleDistance(rotation[axis], snapped[axis]) < 0.01)) return false;
    SetEntityRotation(item.entity, snapped.x, snapped.y, snapped.z, 2, true);
    FreezeEntityPosition(item.entity, true);
    syncLocalTransform(item);
    return true;
}

function pushTransformHistory(objectId, before, after) {
    const left = copyTransformValue(before);
    const right = copyTransformValue(after);
    if (!objectId || !left || !right || transformsEqual(left, right)) return;
    pushHistory({ kind: 'transform', objectId, before: left, after: right });
}

function saveSelected(silent = true) {
    const item = getObject(state.selectedId);
    if (!item || !state.currentHouse) return;
    const transform = syncLocalTransform(item);
    if (!transform) return;
    serverRequest('updateObject', {
        houseId: state.currentHouse.id,
        objectId: item.id,
        ...transform
    }, { silent });
    refreshUi();
}

function scheduleSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
        state.saveTimer = null;
        saveSelected(true);
    }, 300);
}

function recordCreatedHistory(created) {
    if (!created || !created.id) return;
    const snapshot = objectSnapshot(created);
    if (!snapshot || snapshot.sourceKind === 'native') return;
    pushHistory({ kind: 'create', objectId: created.id, snapshot });
}

function deleteSelectedObject() {
    const item = getObject(state.selectedId);
    if (!item || !state.currentHouse || item.hidden) return false;
    const snapshot = objectSnapshot(item);
    if (!snapshot) return false;
    serverRequest('deleteObject', {
        houseId: state.currentHouse.id,
        objectId: item.id
    }, {
        onSuccess: () => pushHistory({ kind: 'delete', objectId: item.id, snapshot })
    });
    return true;
}

function restoreNativeObject(objectId, onSuccess = null, onError = null) {
    if (!state.currentHouse || !objectId) return false;
    serverRequest('restoreObject', {
        houseId: state.currentHouse.id,
        objectId
    }, { silent: true, onSuccess, onError });
    return true;
}

function applyHistoryTransform(action, transform, rollback, done) {
    const item = getObject(action.objectId);
    if (!item || !state.currentHouse || !applyObjectTransform(item, transform)) {
        done(false);
        return;
    }
    refreshUi();
    serverRequest('updateObject', {
        houseId: state.currentHouse.id,
        objectId: action.objectId,
        ...copyTransformValue(transform)
    }, {
        silent: true,
        onSuccess: () => done(true),
        onError: () => {
            applyObjectTransform(item, rollback);
            refreshUi();
            done(false);
        }
    });
}

function createHistoryObject(action, done) {
    if (!state.currentHouse || !action.snapshot) {
        done(false);
        return;
    }
    const oldId = action.objectId;
    serverRequest('createObject', {
        houseId: state.currentHouse.id,
        model: action.snapshot.model,
        position: action.snapshot.position,
        rotation: action.snapshot.rotation
    }, {
        silent: true,
        onSuccess: (created) => {
            if (!created || !created.id) {
                done(false);
                return;
            }
            action.objectId = created.id;
            remapHistoryObjectId(oldId, created.id);
            waitForCreatedObject(created.id);
            done(true);
        },
        onError: () => done(false)
    });
}

function deleteHistoryObject(action, done) {
    if (!state.currentHouse || !action.objectId) {
        done(false);
        return;
    }
    serverRequest('deleteObject', {
        houseId: state.currentHouse.id,
        objectId: action.objectId
    }, { silent: true, onSuccess: () => done(true), onError: () => done(false) });
}

function applyHistoryAction(action, direction, done) {
    if (action.kind === 'transform') {
        const target = direction === 'undo' ? action.before : action.after;
        const rollback = direction === 'undo' ? action.after : action.before;
        applyHistoryTransform(action, target, rollback, done);
        return;
    }
    if (action.kind === 'create') {
        if (direction === 'undo') deleteHistoryObject(action, done);
        else createHistoryObject(action, done);
        return;
    }
    if (action.kind === 'delete') {
        if (action.snapshot && action.snapshot.sourceKind === 'native') {
            if (direction === 'undo') restoreNativeObject(action.objectId, () => done(true), () => done(false));
            else deleteHistoryObject(action, done);
        } else if (direction === 'undo') {
            createHistoryObject(action, done);
        } else {
            deleteHistoryObject(action, done);
        }
        return;
    }
    done(false);
}

function runHistory(direction) {
    if (!state.currentHouse || state.history.applying) return false;
    const source = direction === 'undo' ? state.history.undo : state.history.redo;
    const target = direction === 'undo' ? state.history.redo : state.history.undo;
    const action = source.pop();
    if (!action) {
        notify(direction === 'undo' ? '没有可以撤销的修改' : '没有可以重做的修改', 'info');
        syncHistoryUi();
        return false;
    }
    state.history.applying = true;
    syncHistoryUi();
    applyHistoryAction(action, direction, (success) => {
        state.history.applying = false;
        if (success) {
            target.push(action);
            notify(direction === 'undo' ? '已撤销上一步修改' : '已重做修改', 'success');
        } else {
            source.push(action);
        }
        syncHistoryUi();
    });
    return true;
}

function setSelectedRotation(value, relative = false) {
    const item = getObject(state.selectedId);
    if (!item || !item.entity || !DoesEntityExist(item.entity)) return false;
    const before = copyTransformValue(entityTransform(item));
    const rotation = coordsOf(GetEntityRotation(item.entity, 2));
    rotation.z = normalizedAngle(relative ? rotation.z + number(value) : number(value));
    SetEntityRotation(item.entity, rotation.x, rotation.y, rotation.z, 2, true);
    FreezeEntityPosition(item.entity, true);
    if (isEmptyBuildSpace()) snapSelectedConstruction();
    const after = syncLocalTransform(item);
    pushTransformHistory(item.id, before, after);
    saveSelected(false);
    return true;
}

function cameraDirection() {
    if (state.builderActive && hasFreecam()) return directionFromRotation(state.freecam.rotation);
    return directionFromRotation(coordsOf(GetGameplayCamRot(2)));
}

function makeEntityMatrix(entity) {
    const values = GetEntityMatrix(entity);
    if (!Array.isArray(values) || values.length < 4) return null;
    const forward = coordsOf(values[0]);
    const right = coordsOf(values[1]);
    const up = coordsOf(values[2]);
    const position = coordsOf(values[3]);
    return new Float32Array([
        right.x, right.y, right.z, 0,
        forward.x, forward.y, forward.z, 0,
        up.x, up.y, up.z, 0,
        position.x, position.y, position.z, 1
    ]);
}

function applyEntityMatrix(entity, matrix) {
    SetEntityMatrix(
        entity,
        matrix[4], matrix[5], matrix[6],
        matrix[0], matrix[1], matrix[2],
        matrix[8], matrix[9], matrix[10],
        matrix[12], matrix[13], matrix[14]
    );
    FreezeEntityPosition(entity, true);
}

function drawSelectedGizmo() {
    const item = getObject(state.selectedId);
    if (!item || !item.entity || !DoesEntityExist(item.entity) || state.freecam.looking) return false;

    try {
        const matrix = makeEntityMatrix(item.entity);
        if (!matrix || typeof DrawGizmo !== 'function') return false;
        const changed = DrawGizmo(matrix, `yx_shellcreator:${item.id}`);
        if (!changed) return false;
        applyEntityMatrix(item.entity, matrix);
        syncLocalTransform(item);
        state.freecam.pointerMovedObject = true;
        scheduleSave();
        return true;
    } catch (error) {
        if (!state.freecam.nativeErrorShown) {
            state.freecam.nativeErrorShown = true;
            console.error('[yx_shellcreator] FiveM DrawGizmo failed:', error);
            notify('三维拖拽组件启动失败，请更新 FiveM 客户端', 'error');
        }
        return false;
    }
}

function placeSelectedOnGround() {
    const item = getObject(state.selectedId);
    if (!item || !item.entity || !DoesEntityExist(item.entity)) return;
    const before = copyTransformValue(entityTransform(item));
    FreezeEntityPosition(item.entity, false);
    PlaceObjectOnGroundProperly(item.entity);
    FreezeEntityPosition(item.entity, true);
    const after = syncLocalTransform(item);
    pushTransformHistory(item.id, before, after);
    saveSelected(false);
}

function cursorWorldRay() {
    let origin = hasFreecam() ? { ...state.freecam.position } : coordsOf(GetGameplayCamCoord());
    let direction = cameraDirection();

    if (typeof GetWorldCoordFromScreenCoord === 'function') {
        const screenX = clamp(GetDisabledControlNormal(0, 239), 0, 1);
        const screenY = clamp(GetDisabledControlNormal(0, 240), 0, 1);
        const projection = GetWorldCoordFromScreenCoord(screenX, screenY);
        if (Array.isArray(projection) && projection.length >= 2) {
            origin = coordsOf(projection[0]);
            direction = normalizeVector(coordsOf(projection[1]));
        }
    }

    return { origin, direction };
}

function pointOnBuildPlane() {
    const ray = cursorWorldRay();
    if (Math.abs(ray.direction.z) < 0.0001) return null;
    const rayDistance = (state.buildSurface.planeZ - ray.origin.z) / ray.direction.z;
    if (rayDistance <= 0 || rayDistance > 250) return null;
    return addVectors(ray.origin, scaleVector(ray.direction, rayDistance));
}

function entityGroundOffset(entity) {
    if (!entity || !DoesEntityExist(entity)) return 0;
    try {
        const dimensions = GetModelDimensions(GetEntityModel(entity));
        const matrix = GetEntityMatrix(entity);
        if (!Array.isArray(dimensions) || dimensions.length < 2 || !Array.isArray(matrix) || matrix.length < 3) return 0;
        const minimum = coordsOf(dimensions[0]);
        const maximum = coordsOf(dimensions[1]);
        const forward = coordsOf(matrix[0]);
        const right = coordsOf(matrix[1]);
        const up = coordsOf(matrix[2]);
        let minimumZ = Number.POSITIVE_INFINITY;

        for (const x of [minimum.x, maximum.x]) {
            for (const y of [minimum.y, maximum.y]) {
                for (const z of [minimum.z, maximum.z]) {
                    const relativeZ = (right.z * x) + (forward.z * y) + (up.z * z);
                    minimumZ = Math.min(minimumZ, relativeZ);
                }
            }
        }
        return Number.isFinite(minimumZ) ? -minimumZ : 0;
    } catch (error) {
        return 0;
    }
}

function buildRotation(item, zRotation = null) {
    const base = (item && item.defaultRotation) || {};
    return {
        x: number(base.x),
        y: number(base.y),
        z: zRotation == null ? number(base.z) : number(zRotation)
    };
}

function snapBuildPoint(point, item, groundOffset = 0, zRotation = null) {
    const settings = config.emptyBuild || {};
    const origin = state.buildSurface.origin;
    const gridSize = Math.max(
        0.05,
        number(item && item.moduleSize, number(item && item.snap, number(settings.gridSize, 2.5)))
    );
    const buildType = String((item && item.buildType) || '');
    const snapMode = String((item && item.snapMode) || (buildType === 'floor' ? 'cell' : 'edge'));
    let offsetX = 0;
    let offsetY = 0;

    if (snapMode === 'cell') {
        offsetX = gridSize * 0.5;
        offsetY = gridSize * 0.5;
    } else if (snapMode === 'edge') {
        const baseRotation = (item && item.defaultRotation) || {};
        const angle = ((number(zRotation, number(baseRotation.z)) % 180) + 180) % 180;
        const runsAlongX = angle < 45 || angle >= 135;
        offsetX = runsAlongX ? gridSize * 0.5 : 0;
        offsetY = runsAlongX ? 0 : gridSize * 0.5;
    }

    const snapAxis = (value, axisOrigin, offset) => axisOrigin
        + offset
        + (Math.round((number(value) - axisOrigin - offset) / gridSize) * gridSize);

    return {
        x: snapAxis(point.x, origin.x, offsetX),
        y: snapAxis(point.y, origin.y, offsetY),
        z: state.buildSurface.planeZ + number(groundOffset) + number(item && item.zOffset, 0.01),
        h: 0
    };
}

function constructionStateForUi() {
    const item = state.construction.item;
    return {
        active: state.construction.active,
        label: item ? item.label || item.model : '',
        buildType: item ? item.buildType || '' : '',
        rotation: number(state.construction.rotation.z),
        rotationStep: Math.max(1.0, number(item && item.rotationStep, 90.0))
    };
}

function syncConstructionUi() {
    sendUi('constructionMode', { construction: constructionStateForUi() });
}

function stopConstructionPlacement(announce = false) {
    state.construction.token += 1;
    deleteEntitySafe(state.construction.previewEntity);
    state.construction.active = false;
    state.construction.item = null;
    state.construction.previewEntity = 0;
    state.construction.position = null;
    state.construction.rotation = { x: 0, y: 0, z: 0 };
    state.construction.groundOffset = 0;
    state.construction.valid = false;
    state.construction.placeRequested = false;
    state.construction.pointerDown = false;
    state.construction.lastPlacementKey = '';
    syncConstructionUi();
    if (announce) notify('已取消连续建造工具', 'info');
}

async function startConstructionPlacement(item) {
    if (!item || !item.model || !item.buildType || !isEmptyBuildSpace()) return false;
    stopConstructionPlacement(false);
    selectObject(null);
    const token = ++state.construction.token;
    const rotation = buildRotation(item);
    const startPoint = state.freecam.buildView
        ? { ...state.freecam.target }
        : { ...state.buildSurface.origin };
    const entity = await createLocalObject(item.model, startPoint, rotation, false);

    if (token !== state.construction.token) {
        deleteEntitySafe(entity);
        return false;
    }
    if (!entity) {
        notify(modelFailureMessage(item.model), 'error');
        return false;
    }

    SetEntityAlpha(entity, 155, false);
    SetEntityCollision(entity, false, false);
    SetEntityDrawOutlineColor(59, 209, 139, 255);
    SetEntityDrawOutline(entity, true);
    state.construction.active = true;
    state.construction.item = item;
    state.construction.previewEntity = entity;
    state.construction.rotation = rotation;
    state.construction.groundOffset = entityGroundOffset(entity);
    state.construction.position = snapBuildPoint(startPoint, item, state.construction.groundOffset, rotation.z);
    state.construction.valid = true;
    state.construction.lastPlacementKey = '';
    SetEntityCoordsNoOffset(entity, state.construction.position.x, state.construction.position.y, state.construction.position.z, false, false, false);
    syncConstructionUi();
    setUiFocus(false);
    return true;
}

function rotateConstructionPlacement() {
    if (!state.construction.active) return false;
    const item = state.construction.item;
    const step = Math.max(1.0, number(item && item.rotationStep, 90.0));
    state.construction.rotation.z = ((state.construction.rotation.z + step) % 360 + 360) % 360;
    const entity = state.construction.previewEntity;
    if (entity && DoesEntityExist(entity)) {
        const rotation = state.construction.rotation;
        SetEntityRotation(entity, rotation.x, rotation.y, rotation.z, 2, true);
        state.construction.groundOffset = entityGroundOffset(entity);
    }
    syncConstructionUi();
    return true;
}

function updateConstructionPreview() {
    if (!state.construction.active) return;
    if (state.freecam.looking) return;
    const entity = state.construction.previewEntity;
    if (!entity || !DoesEntityExist(entity)) {
        stopConstructionPlacement(false);
        return;
    }

    const point = pointOnBuildPlane();
    if (!point) {
        state.construction.valid = false;
        SetEntityAlpha(entity, 75, false);
        return;
    }

    SetEntityRotation(
        entity,
        state.construction.rotation.x,
        state.construction.rotation.y,
        state.construction.rotation.z,
        2,
        true
    );
    state.construction.groundOffset = entityGroundOffset(entity);
    const position = snapBuildPoint(
        point,
        state.construction.item,
        state.construction.groundOffset,
        state.construction.rotation.z
    );
    const maxRadius = Math.max(2.0, number((config.emptyBuild || {}).maxBuildRadius, 28.0));
    state.construction.valid = Math.abs(position.x - state.buildSurface.origin.x) <= maxRadius
        && Math.abs(position.y - state.buildSurface.origin.y) <= maxRadius;
    state.construction.position = position;
    SetEntityCoordsNoOffset(entity, position.x, position.y, position.z, false, false, false);
    SetEntityAlpha(entity, state.construction.valid ? 155 : 75, false);
    SetEntityDrawOutlineColor(...(state.construction.valid ? [59, 209, 139, 255] : [239, 68, 85, 255]));

    const item = state.construction.item;
    const continuous = item && (item.continuous === true || (item.continuous == null && ['floor', 'wall'].includes(item.buildType)));
    if (state.construction.pointerDown && continuous) {
        const placementKey = `${position.x.toFixed(3)}:${position.y.toFixed(3)}:${state.construction.rotation.z.toFixed(1)}`;
        if (placementKey !== state.construction.lastPlacementKey) state.construction.placeRequested = true;
    }

    DrawMarker(
        28,
        position.x, position.y, state.buildSurface.planeZ + 0.04,
        0, 0, 0, 0, 0, 0,
        0.14, 0.14, 0.14,
        state.construction.valid ? 59 : 239,
        state.construction.valid ? 209 : 68,
        state.construction.valid ? 139 : 85,
        210,
        false, false, 2, false, null, null, false
    );
}

function placeConstructionObject() {
    if (!state.construction.active || !state.construction.placeRequested) return;
    state.construction.placeRequested = false;
    if (!state.construction.valid || !state.construction.position || !state.currentHouse) return;
    const now = GetGameTimer();
    if (now - state.construction.lastPlacedAt < 140) return;
    state.construction.lastPlacedAt = now;
    state.construction.lastPlacementKey = `${state.construction.position.x.toFixed(3)}:${state.construction.position.y.toFixed(3)}:${state.construction.rotation.z.toFixed(1)}`;

    serverRequest('createObject', {
        houseId: state.currentHouse.id,
        model: state.construction.item.model,
        position: { ...state.construction.position },
        rotation: { ...state.construction.rotation }
    }, {
        silent: true,
        onSuccess: (created) => recordCreatedHistory(created)
    });
}

function snapSelectedConstruction() {
    if (!isEmptyBuildSpace()) return false;
    const item = getObject(state.selectedId);
    if (!item || !item.entity || !DoesEntityExist(item.entity)) return false;
    const catalogItem = getCatalogItem(null, item.model);
    if (!catalogItem || !catalogItem.buildType) return false;

    const currentPosition = coordsOf(GetEntityCoords(item.entity, false));
    const currentRotation = coordsOf(GetEntityRotation(item.entity, 2));
    const base = buildRotation(catalogItem);
    const step = Math.max(1.0, number(catalogItem.rotationStep, 90.0));
    const snappedZ = base.z + (Math.round((currentRotation.z - base.z) / step) * step);
    const rotation = { x: base.x, y: base.y, z: snappedZ };
    SetEntityRotation(item.entity, rotation.x, rotation.y, rotation.z, 2, true);
    const snappedPosition = snapBuildPoint(
        currentPosition,
        catalogItem,
        entityGroundOffset(item.entity),
        rotation.z
    );
    SetEntityCoordsNoOffset(item.entity, snappedPosition.x, snappedPosition.y, snappedPosition.z, false, false, false);
    FreezeEntityPosition(item.entity, true);
    return true;
}

function drawBuildGrid() {
    if (!state.freecam.buildView || !state.buildSurface.ready) return;
    const settings = config.emptyBuild || {};
    const step = Math.max(0.25, number(settings.gridSize, 1.25));
    const extent = Math.max(step * 2, number(settings.gridExtent, 25.0));
    const count = Math.min(80, Math.floor(extent / step));
    const origin = state.buildSurface.origin;
    const z = state.buildSurface.planeZ + 0.025;

    for (let index = -count; index <= count; index += 1) {
        const offset = index * step;
        const major = index % 4 === 0;
        const color = major ? [0, 174, 255, 145] : [118, 155, 176, 65];
        DrawLine(origin.x - extent, origin.y + offset, z, origin.x + extent, origin.y + offset, z, ...color);
        DrawLine(origin.x + offset, origin.y - extent, z, origin.x + offset, origin.y + extent, z, ...color);
    }

    DrawLine(origin.x - extent, origin.y - extent, z, origin.x + extent, origin.y - extent, z, 255, 139, 45, 190);
    DrawLine(origin.x + extent, origin.y - extent, z, origin.x + extent, origin.y + extent, z, 255, 139, 45, 190);
    DrawLine(origin.x + extent, origin.y + extent, z, origin.x - extent, origin.y + extent, z, 255, 139, 45, 190);
    DrawLine(origin.x - extent, origin.y + extent, z, origin.x - extent, origin.y - extent, z, 255, 139, 45, 190);
}

function objectIdForEntity(entity) {
    if (!entity) return null;
    for (const item of state.objects.values()) {
        if (item.entity === entity || item.collisionEntity === entity) return item.id;
    }
    return null;
}

function raycastEntityAtCursor() {
    const { origin, direction } = cursorWorldRay();

    const endpoint = {
        x: origin.x + (direction.x * 100),
        y: origin.y + (direction.y * 100),
        z: origin.z + (direction.z * 100)
    };
    const test = typeof StartExpensiveSynchronousShapeTestLosProbe === 'function'
        ? StartExpensiveSynchronousShapeTestLosProbe(origin.x, origin.y, origin.z, endpoint.x, endpoint.y, endpoint.z, 511, PlayerPedId(), 7)
        : StartShapeTestRay(origin.x, origin.y, origin.z, endpoint.x, endpoint.y, endpoint.z, 511, PlayerPedId(), 7);
    const result = GetShapeTestResult(test);
    const entity = Array.isArray(result) ? result[4] : 0;
    return entity && DoesEntityExist(entity) ? entity : 0;
}

function projectedObjectAtCursor() {
    const cursorX = clamp(GetDisabledControlNormal(0, 239), 0, 1);
    const cursorY = clamp(GetDisabledControlNormal(0, 240), 0, 1);
    let bestId = null;
    let bestScore = 0.04;
    for (const item of state.objects.values()) {
        if (!item.entity || !DoesEntityExist(item.entity) || item.hidden) continue;
        const position = coordsOf(GetEntityCoords(item.entity, false));
        const projected = World3dToScreen2d(position.x, position.y, position.z);
        if (!Array.isArray(projected) || !projected[0]) continue;
        const dx = number(projected[1]) - cursorX;
        const dy = number(projected[2]) - cursorY;
        const score = Math.sqrt((dx * dx) + (dy * dy));
        if (score < bestScore) {
            bestScore = score;
            bestId = item.id;
        }
    }
    return bestId;
}

function raycastObjectAtCursor() {
    const entity = raycastEntityAtCursor();
    return objectIdForEntity(entity) || projectedObjectAtCursor();
}

async function adoptNativeEntity(entity) {
    if (!supportsNativeObjectEditing() || state.adoptingNative || !entity || !DoesEntityExist(entity)) return false;
    if (typeof GetEntityType === 'function' && GetEntityType(entity) !== 3) return false;
    if (entity === state.shellEntity || entity === state.foundationEntity || objectIdForEntity(entity)) return false;
    const hash = unsignedHash(GetEntityModel(entity));
    const model = editableNativeModelName(entity);
    if (!model) return false;

    for (const item of state.objects.values()) {
        if (item.sourceEntity === entity) {
            if (!item.hidden) selectObject(item.id);
            return true;
        }
    }

    const position = coordsOf(GetEntityCoords(entity, false));
    const rotation = coordsOf(GetEntityRotation(entity, 2));
    state.adoptingNative = true;
    serverRequest('createNativeObject', {
        houseId: state.currentHouse.id,
        model,
        sourceModelHash: hash,
        sourcePosition: { ...position, h: 0 },
        position: { ...position, h: 0 },
        rotation
    }, {
        silent: true,
        onSuccess: (created) => {
            state.adoptingNative = false;
            waitForCreatedObject(created && created.id);
            notify('已接管原生室内物件，可以拖拽编辑或按 DEL 隐藏', 'success');
        },
        onError: () => {
            state.adoptingNative = false;
        }
    });
    return true;
}

function updateHoveredObject() {
    if (state.freecam.pointerDown || state.freecam.looking || state.construction.active) return;
    const now = GetGameTimer();
    if (now < state.freecam.hoverScanAt) return;
    state.freecam.hoverScanAt = now + 80;
    setHoveredObject(raycastObjectAtCursor());
}

function processScenePointerRelease() {
    if (state.construction.active) {
        state.freecam.pointerReleased = false;
        state.freecam.pointerMovedObject = false;
        return;
    }
    if (!state.freecam.pointerReleased) return;
    state.freecam.pointerReleased = false;

    if (state.freecam.pointerMovedObject) {
        if (state.saveTimer) {
            clearTimeout(state.saveTimer);
            state.saveTimer = null;
        }
        snapSelectedPreferredRotation();
        const item = getObject(state.selectedId);
        const after = item ? syncLocalTransform(item) : null;
        pushTransformHistory(state.selectedId, state.freecam.pointerTransformBefore, after);
        saveSelected(true);
    }
    state.freecam.pointerMovedObject = false;
    state.freecam.pointerHitId = null;
    state.freecam.pointerTransformBefore = null;
}

function drawText3d(position, text) {
    const visible = World3dToScreen2d(number(position.x), number(position.y), number(position.z));
    if (!Array.isArray(visible) || !visible[0]) return;
    SetTextScale(0.0, 0.31);
    SetTextFont(4);
    SetTextProportional(true);
    SetTextColour(235, 241, 246, 225);
    SetTextCentre(true);
    SetTextOutline();
    BeginTextCommandDisplayText('STRING');
    AddTextComponentSubstringPlayerName(text);
    EndTextCommandDisplayText(number(visible[1]), number(visible[2]));
}

function drawHelp(text) {
    BeginTextCommandDisplayHelp('STRING');
    AddTextComponentSubstringPlayerName(text);
    EndTextCommandDisplayHelp(0, false, false, -1);
}

function drawMarkerAt(position, color) {
    DrawMarker(
        2,
        number(position.x), number(position.y), number(position.z) + 0.25,
        0, 0, 0, 0, 180, 0,
        0.28, 0.28, 0.28,
        color[0], color[1], color[2], 190,
        false, true, 2, false, null, null, false
    );
}

function registerNui(name, handler) {
    RegisterNuiCallbackType(name);
    on(`__cfx_nui:${name}`, async (data, callback) => {
        try {
            const result = await handler(data || {});
            callback(result || { ok: true });
        } catch (error) {
            console.error(`[yx_shellcreator] NUI ${name} failed:`, error);
            callback({ ok: false, error: String(error) });
        }
    });
}

registerNui('close', async () => {
    closeUi(state.builderActive);
});

registerNui('releaseFocus', async () => {
    setUiFocus(false);
    notify(
        state.freecam.buildView ? '已进入斜俯视建造视角，按 F2 返回建造面板' : '已进入自由视角，按 F2 返回建造面板',
        'info'
    );
});

registerNui('refresh', async () => {
    serverRequest('requestState');
});

registerNui('createHouse', async (data) => {
    serverRequest('createHouse', {
        slug: String(data.slug || '').trim().toLowerCase(),
        label: String(data.label || '').trim(),
        presetId: String(data.presetId || ''),
        shellModel: String(data.shellModel || '').trim(),
        entrance: currentTransform()
    }, {
        onSuccess: (created) => {
            if (!created || !created.id) return;
            state.autoBuildHouseId = created.id;
            closeUi(false);
            serverRequest('enterHouse', { houseId: created.id }, {
                silent: true,
                onError: () => {
                    state.autoBuildHouseId = null;
                }
            });
        }
    });
});

registerNui('importHouse', async (data) => {
    if (!data.document || JSON.stringify(data.document).length > 2 * 1024 * 1024 - 4096) return { ok: false };
    serverRequest('importHouse', {
        slug: String(data.slug || '').trim().toLowerCase(), label: String(data.label || '').trim(),
        entrance: currentTransform(), document: data.document
    }, {
        timeoutMs: 120000,
        onSuccess: (created) => {
            if (!created || !created.id) return;
            state.autoBuildHouseId = created.id;
            closeUi(false);
            serverRequest('enterHouse', { houseId: created.id }, { silent: true,
                onError: () => { state.autoBuildHouseId = null; } });
        }
    });
    return { ok: true };
});

registerNui('setEnvironment', async (data) => {
    if (!state.currentHouse) return { ok: false };
    serverRequest('setEnvironment', { houseId: state.currentHouse.id, environment: data.environment });
    return { ok: true };
});

registerNui('previewDoor', async () => {
    const item = getObject(state.selectedId);
    if (!state.builderActive || !item || !item.isDoor || !item.entity || !DoesEntityExist(item.entity)) return { ok: false };
    const active = !item.doorPreview;
    stopDoorPreview();
    item.doorPreview = active;
    sendUi('doorPreview', { objectId: item.id, active });
    return { ok: true };
});

registerNui('toggleDoorHold', async () => ({ ok: Boolean(state.builderActive && toggleDoor(getObject(state.selectedId))) }));

registerNui('accessPoint', async (data) => {
    const house = state.houses.find(h => h.id === data.houseId);
    if (!house) return { ok: false };
    serverRequest('accessPoint', { houseId: house.id, action: data.action, pointId: data.pointId,
        label: String(data.label || '').trim(), transform: data.action === 'exit' ? editorTransform() : currentTransform() });
    return { ok: true };
});

registerNui('exportHouse', async () => {
    if (!state.currentHouse) return { ok: false };
    const houseId = state.currentHouse.id;
    const mutations = new Set(['createObject','updateObject','deleteObject','restoreObject','createNativeObject','setDoorState','setEnvironment','setInteriorPoint','accessPoint']);
    if ([...state.pending.values()].some(p => mutations.has(p.action)) || state.history.applying) {
        notify('还有修改正在保存，请保存完成后再导出。', 'warning');
        return { ok: false };
    }
    // Flush the pending 300ms editor debounce before taking a database snapshot.
    if (state.saveTimer) {
        clearTimeout(state.saveTimer); state.saveTimer = null;
        const item = getObject(state.selectedId);
        const transform = item && syncLocalTransform(item);
        if (transform) {
            const saved = await new Promise(resolve => serverRequest('updateObject', {
                houseId, objectId: item.id, ...transform
            }, { silent: true, onSuccess: () => resolve(true), onError: () => resolve(false) }));
            if (!saved) return { ok: false };
        }
    }
    if (!state.currentHouse || state.currentHouse.id !== houseId) return { ok: false };
    serverRequest('exportHouse', { houseId }, { timeoutMs: 60000,
        onSuccess: (result) => sendUi('houseExport', result) });
    return { ok: true };
});

registerNui('updateHouse', async (data) => {
    const house = state.houses.find((entry) => entry.id === data.houseId);
    if (!house) return { ok: false };
    const playerPosition = currentTransform();
    serverRequest('updateHouse', {
        houseId: house.id,
        label: String(data.label || '').trim(),
        presetId: String(data.presetId || house.presetId),
        shellModel: String(data.shellModel || '').trim(),
        entrance: data.useCurrentEntrance ? playerPosition : house.entrance,
        currentPosition: playerPosition
    });
});

registerNui('deleteHouse', async (data) => {
    serverRequest('deleteHouse', { houseId: data.houseId });
});

registerNui('enterHouse', async (data) => {
    serverRequest('enterHouse', { houseId: data.houseId });
    closeUi(false);
});

registerNui('leaveHouse', async () => {
    serverRequest('leaveHouse');
});

registerNui('openBuilder', async () => {
    if (!state.currentHouse) return { ok: false, error: 'not_inside' };
    if (!startBuilderMode()) return { ok: false, error: 'camera_failed' };
    openUi('builder');
});

registerNui('createObject', async (data) => {
    if (!state.currentHouse) return { ok: false };
    const houseId = state.currentHouse.id;
    const catalogItem = getCatalogItem(String(data.itemId || ''), String(data.model || '').trim());
    const model = String((catalogItem && catalogItem.model) || data.model || '').trim();
    if (state.builderActive && isEmptyBuildSpace() && catalogItem && catalogItem.buildType) {
        const started = await startConstructionPlacement(catalogItem);
        return { ok: started, construction: true };
    }

    stopConstructionPlacement(false);
    const hash = await loadModel(model);
    if (!hash) {
        notify(modelFailureMessage(model), 'error');
        return { ok: false };
    }
    SetModelAsNoLongerNeeded(hash);
    const ped = PlayerPedId();
    const editorCamera = state.builderActive && hasFreecam();
    const direction = editorCamera ? cameraDirection() : null;
    const distanceFromCamera = number(config.freecam && config.freecam.objectSpawnDistance, 3.0);
    const position = editorCamera && state.freecam.buildView
        ? { x: state.freecam.target.x, y: state.freecam.target.y, z: state.buildSurface.planeZ }
        : editorCamera
            ? addVectors(state.freecam.position, scaleVector(direction, distanceFromCamera))
            : coordsOf(GetOffsetFromEntityInWorldCoords(ped, 0.0, 2.0, 0.0));
    position.h = 0;
    const rotation = catalogItem && catalogItem.defaultRotation
        ? buildRotation(catalogItem)
        : { x: 0, y: 0, z: editorCamera && !state.freecam.buildView ? number(state.freecam.rotation.z) : number(GetEntityHeading(ped)) };
    // A loaded drawable is not proof that GTA can instantiate the archetype.
    // Check locally before committing a new record to the database.
    const probe = await createLocalObject(model, position, rotation, false);
    if (!probe) {
        notify(modelFailureMessage(model), 'error');
        return { ok: false };
    }
    SetEntityVisible(probe, false, false);
    deleteEntitySafe(probe);
    if (!state.currentHouse || state.currentHouse.id !== houseId) return { ok: false };
    serverRequest('createObject', {
        houseId,
        model,
        position,
        rotation
    }, {
        onSuccess: (created) => {
            recordCreatedHistory(created);
            waitForCreatedObject(created && created.id);
        }
    });
});

registerNui('selectObject', async (data) => {
    editObjectInScene(data.objectId);
});

registerNui('groundObject', async () => {
    placeSelectedOnGround();
});

registerNui('saveObject', async () => {
    saveSelected(false);
});

registerNui('duplicateObject', async () => {
    const item = getObject(state.selectedId);
    if (!item || !state.currentHouse) return { ok: false };
    const transform = entityTransform(item);
    if (!transform) return { ok: false };
    if (item.sourceKind === 'native' && String(item.model || '').startsWith('native_')) {
        notify('这个原生模型没有可用名称，不能直接复制，但仍可移动、旋转或隐藏', 'warning');
        return { ok: false };
    }
    transform.position.x += 0.5;
    serverRequest('createObject', {
        houseId: state.currentHouse.id,
        model: item.model,
        ...transform
    }, {
        onSuccess: (created) => {
            recordCreatedHistory(created);
            waitForCreatedObject(created && created.id);
        }
    });
});

registerNui('deleteObject', async () => {
    return { ok: deleteSelectedObject() };
});

registerNui('restoreObject', async (data) => {
    const objectId = String(data.objectId || '');
    const item = getObject(objectId);
    if (!item || item.sourceKind !== 'native' || !item.hidden) return { ok: false };
    restoreNativeObject(objectId, (restored) => {
        if (restored && restored.id) waitForCreatedObject(restored.id);
    });
    return { ok: true };
});

registerNui('undo', async () => ({ ok: runHistory('undo') }));
registerNui('redo', async () => ({ ok: runHistory('redo') }));

registerNui('setRotation', async (data) => ({
    ok: setSelectedRotation(number(data.value), Boolean(data.relative))
}));

registerNui('toggleBuilderPanel', async () => {
    if (!state.builderActive) return { ok: false };
    setUiFocus(!state.uiFocused);
    return { ok: true };
});

registerNui('setInteriorPoint', async (data) => {
    if (!state.currentHouse || !['spawn', 'exit'].includes(data.kind)) return { ok: false };
    serverRequest('setInteriorPoint', {
        houseId: state.currentHouse.id,
        kind: data.kind,
        transform: editorTransform()
    });
});

onNet(`${EVENT}:client:response`, (payload) => {
    const response = parsePayload(payload, {});
    const pending = response.requestId ? state.pending.get(response.requestId) : null;
    if (response.requestId) state.pending.delete(response.requestId);
    if (response.ok) {
        if (pending && pending.onSuccess) pending.onSuccess(response.data);
        if (pending) sendUi('operationResult', { operation: pending.action, data: response.data || null });
        if ((!pending || !pending.silent) && response.message) notify(response.message, 'success');
    } else {
        if (pending && pending.onError) pending.onError(response.message);
        if (pending) sendUi('operationFailed', { operation: pending.action, message: response.message });
        notify(response.message || '操作失败', 'error');
    }
});

onNet(`${EVENT}:client:houses`, (payload) => {
    state.houses = parsePayload(payload, []);
    if (state.currentHouse) {
        const latest = state.houses.find((house) => house.id === state.currentHouse.id);
        if (latest) {
            state.currentHouse = latest;
            if (globalThis.YxHouseEnvironment) YxHouseEnvironment.apply(latest.environment);
        }
    }
    refreshUi();
});

onNet(`${EVENT}:client:entered`, (payload) => {
    enterInterior(parsePayload(payload, null));
});

onNet(`${EVENT}:client:left`, (payload) => {
    leaveInterior(parsePayload(payload, {}));
});

onNet(`${EVENT}:client:houseUpdated`, (payload) => {
    const updated = parsePayload(payload, null);
    if (!updated || !state.currentHouse || updated.id !== state.currentHouse.id) return;
    const changedEnvironment = updated.presetId !== state.currentHouse.presetId || updated.shellModel !== state.currentHouse.shellModel;
    state.currentHouse = updated;
    if (globalThis.YxHouseEnvironment) YxHouseEnvironment.apply(updated.environment);
    refreshUi();
    if (changedEnvironment) notify('室内模板已修改，离开并重新进入后生效', 'warning');
});

onNet(`${EVENT}:client:objectCreated`, async (payload) => {
    const item = parsePayload(payload, null);
    if (!item || !state.currentHouse || item.houseId !== state.currentHouse.id) return;
    await spawnDecoration(item);
});

onNet(`${EVENT}:client:objectRestored`, async (payload) => {
    const item = parsePayload(payload, null);
    if (!item || !state.currentHouse || item.houseId !== state.currentHouse.id) return;
    await spawnDecoration(item);
});

onNet(`${EVENT}:client:objectUpdated`, (payload) => {
    const update = parsePayload(payload, null);
    if (!update || !state.currentHouse || update.houseId !== state.currentHouse.id) return;
    const item = getObject(update.id);
    if (!item || !item.entity || !DoesEntityExist(item.entity)) return;
    item.position = update.position;
    item.rotation = update.rotation;
    SetEntityCoordsNoOffset(item.entity, number(update.position.x), number(update.position.y), number(update.position.z), false, false, false);
    SetEntityRotation(item.entity, number(update.rotation.x), number(update.rotation.y), number(update.rotation.z), 2, true);
    if (item.isDoor) applyDoorPose(item, state.builderActive ? 0 : number(item.doorRatio, item.doorOpen ? 1 : 0));
    syncStairCollision(item);
    refreshUi();
});

onNet(`${EVENT}:client:doorState`, (payload) => {
    const update = parsePayload(payload, null);
    if (!update || !state.currentHouse || update.houseId !== state.currentHouse.id) return;
    const item = getObject(update.objectId);
    if (!item || !item.isDoor) return;
    item.doorOpen = Boolean(update.open);
    item.doorPending = false;
    refreshUi();
});

onNet(`${EVENT}:client:doorPushed`, (payload) => {
    const update = parsePayload(payload, null);
    if (!update || !state.currentHouse || update.houseId !== state.currentHouse.id) return;
    const item = getObject(update.objectId);
    if (!item || !item.isDoor || ![-1, 1].includes(update.direction)) return;
    item.doorPushRatio = update.direction;
    item.doorPushUntil = GetGameTimer() + 1800;
});

onNet(`${EVENT}:client:objectDeleted`, (payload) => {
    const update = parsePayload(payload, null);
    if (!update || !state.currentHouse || update.houseId !== state.currentHouse.id) return;
    const item = getObject(update.objectId);
    if (item) deleteEntitySafe(item.entity);
    if (item) deleteEntitySafe(item.collisionEntity);
    if (item && update.native) {
        item.entity = 0;
        item.hidden = true;
        hideNativeSource(item.sourceEntity);
    } else {
        state.objects.delete(update.objectId);
    }
    if (state.selectedId === update.objectId) selectObject(null);
    refreshUi();
});

RegisterCommand(config.commands && config.commands.manager ? config.commands.manager : 'shellcreator', () => {
    if (state.builderActive) {
        if (!state.uiVisible || state.managerOpen) openUi('builder');
        else if (!state.uiFocused) setUiFocus(true);
        return;
    }
    if (state.uiVisible && state.managerOpen) closeUi(false);
    else {
        serverRequest('requestState', {}, { silent: true });
        openUi('manager');
    }
}, false);

RegisterCommand(config.commands && config.commands.builder ? config.commands.builder : 'yxbuild', () => {
    if (!state.currentHouse) {
        notify('请先进入一个房屋', 'error');
        return;
    }
    if (state.builderActive) closeUi(true);
    else {
        if (startBuilderMode()) openUi('builder');
    }
}, false);

RegisterCommand(config.commands && config.commands.leave ? config.commands.leave : 'yxleave', () => {
    if (state.currentHouse) serverRequest('leaveHouse');
}, false);

function requestLocationRepair() {
    serverRequest('fixLocation', {}, { silent: true });
}

RegisterCommand('fixshell', requestLocationRepair, false);
RegisterCommand('fixloc', requestLocationRepair, false);

let modelCheckRunning = false;
RegisterCommand('yxmodelcheck', async (_, args) => {
    if (modelCheckRunning) return;
    modelCheckRunning = true;
    const models = args.length ? [String(args[0])] : (catalog.items || [])
        .filter((item) => item.door || item.buildType === 'stairs').map((item) => item.model);
    let passed = 0;
    notify('正在检查门与楼梯模型，完整结果将输出到 F8；不会写入房屋数据。');
    try {
        for (const model of models) {
            const position = coordsOf(GetEntityCoords(PlayerPedId(), false));
            position.z -= 20;
            const entity = await createLocalObject(model, position, { x: 0, y: 0, z: 0 }, false);
            if (entity) {
                SetEntityVisible(entity, false, false);
                deleteEntitySafe(entity);
                passed++;
                console.log(`[yx_shellcreator] modelcheck PASS ${model}`);
            } else console.warn(`[yx_shellcreator] modelcheck FAIL ${model}: ${modelFailures.get(model)}`);
            await delay(0);
        }
        notify(`模型检查完成：${passed}/${models.length} 可创建。详见 F8（仅检查生成，不代表行走测试）。`);
        refreshUi();
    } finally { modelCheckRunning = false; }
}, false);

RegisterCommand('+yx_shellcreator_panel', () => {
    if (!state.builderActive) return;
    if (!state.uiVisible) {
        openUi('builder');
        return;
    }
    setUiFocus(!state.uiFocused);
}, false);
RegisterCommand('-yx_shellcreator_panel', () => {}, false);

RegisterCommand('+yx_shellcreator_gizmo_select', () => {
    if (!isSceneEditorActive() || state.freecam.looking) return;
    if (state.construction.active) {
        state.construction.pointerDown = true;
        state.construction.lastPlacementKey = '';
        state.construction.placeRequested = true;
        return;
    }

    const directEntity = raycastEntityAtCursor();
    const directId = objectIdForEntity(directEntity);
    if (directId && directId !== state.selectedId) {
        selectObject(directId);
        setHoveredObject(null);
        return;
    }
    if (!directId && supportsNativeObjectEditing() && directEntity
        && typeof GetEntityType === 'function' && GetEntityType(directEntity) === 3
        && editableNativeModelName(directEntity)) {
        adoptNativeEntity(directEntity);
        return;
    }
    const projectedId = directId || projectedObjectAtCursor();
    if (projectedId && projectedId !== state.selectedId) {
        selectObject(projectedId);
        setHoveredObject(null);
        return;
    }
    if (!state.selectedId) return;

    state.freecam.pointerDown = true;
    state.freecam.pointerReleased = false;
    state.freecam.pointerMovedObject = false;
    state.freecam.pointerHitId = state.selectedId;
    state.freecam.pointerTransformBefore = copyTransformValue(entityTransform(getObject(state.selectedId)));
    ExecuteCommand('+gizmoSelect');
}, false);

RegisterCommand('-yx_shellcreator_gizmo_select', () => {
    if (state.construction.active) {
        state.construction.pointerDown = false;
        return;
    }
    if (!state.freecam.pointerDown) return;
    ExecuteCommand('-gizmoSelect');
    state.freecam.pointerDown = false;
    state.freecam.pointerReleased = true;
}, false);

RegisterCommand('+yx_shellcreator_freecam_look', () => {
    if (!isSceneEditorActive() || state.freecam.pointerDown || state.construction.pointerDown) return;
    state.freecam.looking = true;
    leaveSceneCursor();
}, false);

RegisterCommand('-yx_shellcreator_freecam_look', () => {
    if (!state.freecam.looking) return;
    state.freecam.looking = false;
    enterSceneCursor();
}, false);

RegisterCommand('+yx_shellcreator_gizmo_translate', () => {
    if (!isSceneEditorActive() || state.construction.active) return;
    state.freecam.gizmoMode = 'translate';
    ExecuteCommand('+gizmoTranslation');
}, false);
RegisterCommand('-yx_shellcreator_gizmo_translate', () => {
    if (!state.construction.active) ExecuteCommand('-gizmoTranslation');
}, false);

RegisterCommand('+yx_shellcreator_gizmo_rotate', () => {
    if (!isSceneEditorActive()) return;
    if (rotateConstructionPlacement()) return;
    state.freecam.gizmoMode = 'rotate';
    ExecuteCommand('+gizmoRotation');
}, false);
RegisterCommand('-yx_shellcreator_gizmo_rotate', () => {
    if (!state.construction.active) ExecuteCommand('-gizmoRotation');
}, false);

RegisterCommand('+yx_shellcreator_build_cancel', () => {
    if (!isSceneEditorActive()) return;
    if (state.construction.active) stopConstructionPlacement(true);
    else selectObject(null);
}, false);
RegisterCommand('-yx_shellcreator_build_cancel', () => {}, false);

RegisterCommand('+yx_shellcreator_delete_selected', () => {
    if (!isSceneEditorActive() || state.construction.active) return;
    deleteSelectedObject();
}, false);
RegisterCommand('-yx_shellcreator_delete_selected', () => {}, false);

RegisterCommand('yxundo', () => {
    if (state.builderActive) runHistory('undo');
}, false);
RegisterCommand('yxredo', () => {
    if (state.builderActive) runHistory('redo');
}, false);

RegisterKeyMapping(config.commands && config.commands.manager ? config.commands.manager : 'shellcreator', '打开房屋创建器', 'keyboard', config.keys && config.keys.manager ? config.keys.manager : 'F6');
RegisterKeyMapping(config.commands && config.commands.builder ? config.commands.builder : 'yxbuild', '打开室内建造器', 'keyboard', config.keys && config.keys.builder ? config.keys.builder : 'F7');
RegisterKeyMapping('+yx_shellcreator_panel', '切换建造面板鼠标焦点', 'keyboard', config.keys && config.keys.panel ? config.keys.panel : 'F2');
RegisterKeyMapping('+yx_shellcreator_gizmo_select', '选择或拖拽建造物件', 'MOUSE_BUTTON', 'MOUSE_LEFT');
RegisterKeyMapping('+yx_shellcreator_freecam_look', '自由相机环视', 'MOUSE_BUTTON', 'MOUSE_RIGHT');
RegisterKeyMapping('+yx_shellcreator_gizmo_translate', '三维手柄：移动模式', 'keyboard', 'G');
RegisterKeyMapping('+yx_shellcreator_gizmo_rotate', '三维手柄：旋转模式', 'keyboard', 'R');
RegisterKeyMapping('+yx_shellcreator_build_cancel', '取消连续建造工具或取消选择', 'keyboard', 'X');
RegisterKeyMapping('+yx_shellcreator_delete_selected', '删除当前选中物件（可撤销）', 'keyboard', 'DELETE');

setTick(() => {
    const ped = PlayerPedId();
    if (!ped || state.entering) return;
    const playerCoords = coordsOf(GetEntityCoords(ped, false));

    if (!state.currentHouse) {
        let nearest = null;
        let nearestDistance = Number.MAX_VALUE;
        for (const house of state.houses) for (const point of houseAccessPoints(house)) {
            const currentDistance = distance(playerCoords, point.entrance);
            if (currentDistance > number(config.drawDistance, 30)) continue;
            drawMarkerAt(point.entrance, [0, 174, 255]);
            if (currentDistance < 8.0) drawText3d({ ...point.entrance, z: number(point.entrance.z) + 0.55 }, `${house.label} · ${point.label}~n~~b~[E]~s~ 进入`);
            if (currentDistance < nearestDistance) {
                nearest = { house, point };
                nearestDistance = currentDistance;
            }
        }
        if (nearest && nearestDistance <= number(config.interactDistance, 1.8) && IsControlJustReleased(0, 38)) {
            serverRequest('enterHouse', { houseId: nearest.house.id, pointId: nearest.point.id });
        }
        return;
    }

    updateStairCollisionHelpers();
    updateDoorContact(ped, playerCoords);
    updateDoorAnimations();

    if (!state.builderActive) {
        maintainNativeSources();
        let nearestExit = null, exitDistance = Number.MAX_VALUE;
        for (const point of houseAccessPoints(state.currentHouse)) {
            const d = distance(playerCoords, point.exit);
            if (d < exitDistance) { nearestExit = point; exitDistance = d; }
            if (d <= number(config.drawDistance, 30)) drawMarkerAt(point.exit, [255, 139, 45]);
        }
        if (nearestExit && exitDistance < 8) drawText3d({ ...nearestExit.exit, z: number(nearestExit.exit.z) + 0.55 }, `~o~[E]~s~ ${nearestExit.label} · 离开房屋`);
        if (IsControlJustReleased(0, 38)) {
            if (nearestExit && exitDistance <= number(config.interactDistance, 1.8)) {
                serverRequest('leaveHouse', { pointId: nearestExit.id });
            }
        }
        return;
    }

    DisableAllControlActions(0);
    DisableAllControlActions(1);
    DisablePlayerFiring(PlayerId(), true);
    FreezeEntityPosition(ped, true);
    maintainNativeSources();

    if (!hasFreecam() && !startBuilderMode()) return;
    if (state.uiFocused) return;

    enterSceneCursor();
    updateFreecam();
    if (state.freecam.buildView) drawBuildGrid();

    if (IsDisabledControlPressed(0, 36) && IsDisabledControlJustPressed(0, 20)) runHistory('undo');
    if (IsDisabledControlPressed(0, 36) && IsDisabledControlJustPressed(0, 246)) runHistory('redo');

    if (state.construction.active) {
        updateConstructionPreview();
        placeConstructionObject();
        const item = state.construction.item;
        const label = item ? item.label || item.model : '建筑部件';
        const rotationStep = Math.max(1.0, number(item && item.rotationStep, 90.0));
        drawHelp(`~o~斜俯视建造~s~  ${label}~n~左键点按/拖动连续铺设  R旋转${rotationStep}°  X取消  WASD平移  E/Q及滚轮缩放  按住右键旋转视角  F2面板`);
    } else {
        updateHoveredObject();
        drawSelectedGizmo();
        processScenePointerRelease();
        const mode = state.freecam.gizmoMode === 'rotate' ? '~o~旋转~s~' : '~g~移动~s~';
        const cameraHelp = state.freecam.buildView
            ? '~b~斜俯视建造~s~  WASD平移  E/Q及滚轮缩放  按住右键旋转视角  左键选择/拖拽'
            : '~b~自由视角~s~  WASD移动  E/Q升降  按住右键环视  左键选择/拖拽';
        drawHelp(`${cameraHelp}~n~G移动  R旋转  DEL删除  Ctrl+Z/Y撤销/重做  X取消选择  当前：${mode}  F2面板`);
    }
});

on('onClientResourceStart', (resourceName) => {
    if (resourceName !== RESOURCE) return;
    state.uiVisible = false;
    state.managerOpen = false;
    state.builderActive = false;
    SetNuiFocus(false, false);
    if (typeof SetNuiFocusKeepInput === 'function') SetNuiFocusKeepInput(false);
    sendUi('close');
    setTimeout(() => serverRequest('requestState', {}, { silent: true }), 750);
});

on('onResourceStop', (resourceName) => {
    if (resourceName !== RESOURCE) return;
    stopBuilderMode();
    cleanupInterior();
    SetNuiFocus(false, false);
});
