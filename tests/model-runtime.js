'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const calls = [];
const entities = new Map();
let nextEntity = 1;
let registered = true;
let loaded = true;
let reject = false;
let now = 0;
const ctx = vm.createContext({
    YXCatalog: require('../client/catalog'),
    console: { log() {}, warn() {}, error() {} },
    GetCurrentResourceName: () => 'yx_shellcreator',
    LoadResourceFile: (_, name) => fs.readFileSync(path.join(root, name), 'utf8'),
    RegisterNuiCallbackType() {}, on() {}, onNet() {}, RegisterCommand() {}, RegisterKeyMapping() {}, setTick() {},
    GetGameTimer: () => now, GetGameBuildNumber: () => 3095,
    setTimeout: (fn) => { now += 1000; queueMicrotask(fn); },
    GetHashKey: (name) => name, IsModelInCdimage: () => registered, IsModelValid: () => registered,
    RequestModel() {}, RequestCollisionForModel() {}, HasModelLoaded: () => loaded,
    SetModelAsNoLongerNeeded: (hash) => calls.push(['release', hash]),
    CreateObjectNoOffset: (hash, x, y, z, network, mission, door) => {
        calls.push(['create',hash,network,door]);
        if (reject || (hash === 'manual_door' && !door)) return 0;
        const entity = nextEntity++;
        entities.set(entity, { position:{x,y,z}, rotation:{x:0,y:0,z:0} });
        return entity;
    },
    DoesEntityExist: (entity) => entities.has(entity),
    RequestCollisionAtCoord() {}, SetEntityAsMissionEntity() {}, SetEntityInvincible() {}, FreezeEntityPosition() {},
    SetEntityVisible() {}, SetEntityAlpha() {},
    SetEntityCollision: (...args) => calls.push(['collision',...args]),
    GetEntityCoords: (entity) => entities.get(entity).position,
    GetEntityRotation: (entity) => entities.get(entity).rotation,
    SetEntityCoordsNoOffset: (entity,x,y,z) => { calls.push(['move',entity]); entities.get(entity).position={x,y,z}; },
    SetEntityRotation: (entity,x,y,z) => { calls.push(['rotate',entity]); entities.get(entity).rotation={x,y,z}; }
});
vm.runInContext(fs.readFileSync(path.join(root,'client/client.js'),'utf8') + `
globalThis.api = {createLocalObject,loadModel,modelFailures,syncStairCollision,attachStairCollision,stripEntity,catalogForUi};`,ctx);

(async () => {
    const {api} = ctx;
    const origin={x:10,y:20,z:30}, rotation={x:0,y:0,z:90};
    for (const model of ['yx_door_wood','prop_motel_door_09','ba_prop_door_club_generic_vip']) {
        calls.length=0;
        assert(await api.createLocalObject(model,origin,rotation));
        assert.deepEqual(calls.find(c=>c[0]==='create'),['create',model,false,true]);
    }
    calls.length=0;
    assert(await api.createLocalObject('manual_door',origin,rotation));
    assert.equal(calls.filter(c=>c[0]==='create').length,2);
    assert.equal(calls.filter(c=>c[0]==='create')[1][3],true);

    registered=false; calls.length=0;
    assert.equal(await api.createLocalObject('missing',origin,rotation),0);
    assert.equal(calls.some(c=>c[0]==='create'),false);
    assert(api.modelFailures.get('missing').includes('未注册'));
    assert(api.catalogForUi().items.filter(i=>i.door || i.buildType==='stairs').every(i=>i.available===false));
    registered=true; loaded=false; calls.length=0;
    assert.equal(await api.loadModel('timeout'),0);
    assert(api.modelFailures.get('timeout').includes('超时'));
    assert(calls.some(c=>c[0]==='release'));
    loaded=true; reject=true; calls.length=0;
    assert.equal(await api.createLocalObject('rejected',origin,rotation),0);
    assert(api.modelFailures.get('rejected').includes('拒绝创建'));
    assert(calls.some(c=>c[0]==='release'));
    reject=false;

    for (const [model,helperModel] of [['yx_stairs_oak','yx_stairs_collision'],['yx_spiral_oak','yx_spiral_collision']]) {
        const entity=await api.createLocalObject(model,origin,rotation);
        const item={model,entity,position:origin,rotation};
        calls.length=0;
        await api.attachStairCollision(item);
        assert(calls.some(c=>c[0]==='create' && c[1]===helperModel));
        assert(calls.some(c=>c[0]==='collision' && c[1]===entity && c[2]===false));
        calls.length=0;
        for(let i=0;i<300;i++) api.syncStairCollision(item);
        assert.equal(calls.length,0,'stationary stair must not be teleported each frame');
        entities.get(entity).position={x:11,y:22,z:33};
        api.syncStairCollision(item);
        assert.equal(calls.filter(c=>c[0]==='move').length,1);
        api.syncStairCollision(item);
        assert.equal(calls.filter(c=>c[0]==='move').length,1);
        const clean=api.stripEntity(item);
        assert.equal('collisionTransform' in clean,false);
        assert.equal('collisionEntity' in clean,false);
    }
    const item={model:'yx_stairs_oak',entity:await api.createLocalObject('yx_stairs_oak',origin,rotation),position:origin,rotation};
    reject=true; calls.length=0;
    await api.attachStairCollision(item);
    assert(!calls.some(c=>c[0]==='collision' && c[1]===item.entity && c[2]===false),'failed helper must retain visual model collision');
    console.log('PASS: door creation flags/retry, missing models/timeouts, failure cleanup, catalog availability, stair helper selection and stationary collision caching');
})().catch(error=>{console.error(error);process.exitCode=1;});
