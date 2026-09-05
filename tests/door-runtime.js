'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const entities = new Map(), net = new Map(), nui = new Map(), network = [], ui = [];
let now = 1000, velocity = {x:0,y:0,z:0}, controls = {}, vehicle = false;
const ctx = vm.createContext({
    YXCatalog: require('../client/catalog'),
    console, GetCurrentResourceName: () => 'yx_shellcreator',
    LoadResourceFile: (_,file) => fs.readFileSync(path.join(root,file),'utf8'),
    RegisterNuiCallbackType() {}, on: (name,fn) => nui.set(name,fn), onNet: (name,fn) => net.set(name,fn),
    RegisterCommand() {}, RegisterKeyMapping() {}, setTick() {},
    GetGameTimer: () => now, GetFrameTime: () => .05,
    GetEntityVelocity: () => velocity, IsPedInAnyVehicle: () => vehicle, IsEntityDead: () => false,
    GetControlNormal: (_,key) => controls[key] || 0, GetGameplayCamRot: () => [0,0,0],
    emitNet: (...args) => network.push(args), SendNUIMessage: msg => ui.push(msg),
    DoesEntityExist: id => entities.has(id), GetEntityModel: () => 1,
    GetModelDimensions: () => [[-.5,-.05,0],[.5,.05,2.2]],
    GetEntityCoords: id => entities.get(id).position, GetEntityRotation: id => entities.get(id).rotation,
    SetEntityCoordsNoOffset: (id,x,y,z) => { entities.get(id).position = {x,y,z}; },
    SetEntityRotation: (id,x,y,z,order,deadCheck) => { assert.equal(deadCheck,false); entities.get(id).rotation = {x,y,z}; },
    FreezeEntityPosition: (_,frozen) => assert.equal(frozen,true)
});
vm.runInContext(fs.readFileSync(path.join(root,'client/client.js'),'utf8') + `
globalThis.api = {state,configureDoorRuntime,doorPushDirection,doorHingeOffset,rotateDoorOffset,
applyDoorPose,updateDoorContact,updateDoorAnimations,syncLocalTransform,stripEntity,
closeDoorsForEditing,stopDoorPreview,houseAccessPoints};`,ctx);
const a = ctx.api;
function reset(model='yx_door_wood', yaw=0) {
    a.state.objects.clear(); network.length=0; ui.length=0; vehicle=false; controls={};
    velocity={x:0,y:0,z:0}; a.state.builderActive=false; a.state.uiVisible=false;
    a.state.entering=false; a.state.currentHouse={id:'house'};
    const item={id:'door',model,entity:1,position:{x:10,y:20,z:30},rotation:{x:0,y:0,z:yaw}};
    entities.set(1,{position:{...item.position},rotation:{...item.rotation}});
    a.configureDoorRuntime(item); a.state.objects.set(item.id,item); a.state.selectedId=item.id;
    return item;
}
const positive={x:10.2,y:20.5,z:31}, negative={x:10.2,y:19.5,z:31};
let item=reset();
assert(item.isDoor);
const first=a.doorPushDirection(item,positive,{x:0,y:-1});
assert.notEqual(first,0);
assert.equal(a.doorPushDirection(item,negative,{x:0,y:1}),-first,'opposite sides must push opposite ways');
for(const movement of [{x:0,y:0},{x:1,y:0},{x:0,y:1}]) assert.equal(a.doorPushDirection(item,positive,movement),0);
assert.equal(a.doorPushDirection(item,{x:10.2,y:22,z:31},{x:0,y:-1}),0,'proximity is not contact');
assert.equal(a.doorPushDirection(item,{...positive,z:35},{x:0,y:-1}),0,'other floor');
assert.equal(a.doorPushDirection(item,{x:9.5,y:20.5,z:31},{x:0,y:-1}),0,'hinge has no lever');
item=reset('YX_DOOR_WOOD',90);
assert(item.isDoor,'manual model names are case insensitive');
assert.equal(a.doorPushDirection(item,{x:9.5,y:20.2,z:31},{x:1,y:0}),first,'rotation must preserve local contact');

for(const yaw of [0,45,90,180,270]) for(const ratio of [-1,-.4,.4,1]) {
    item=reset('yx_door_wood',yaw);
    const hinge=a.doorHingeOffset(item), offset=a.rotateDoorOffset(hinge,yaw);
    const expected={x:item.position.x+offset.x,y:item.position.y+offset.y};
    a.applyDoorPose(item,ratio);
    const pose=entities.get(1), actualOffset=a.rotateDoorOffset(hinge,pose.rotation.z);
    assert(Math.hypot(pose.position.x+actualOffset.x-expected.x,pose.position.y+actualOffset.y-expected.y)<1e-8,'hinge drift');
    assert.equal(item.position.x,10,'animation must not alter saved placement');
}

item=reset();
a.updateDoorContact(100,positive);
assert.equal(network.length,0,'standing near a closed door cannot open it');
velocity={x:0,y:-1,z:0};
a.updateDoorContact(100,positive);
assert.equal(item.doorPushRatio,first); assert.equal(network.length,1);
assert.equal(network[0][0],'yx_shellcreator:server:pushDoor');
assert.equal(JSON.parse(network[0][1]).objectId,'door');
for(let i=0;i<50;i++) a.updateDoorContact(100,positive);
assert.equal(network.length,1,'no network event per frame');
for(let i=0;i<15;i++) { now+=50; a.updateDoorAnimations(); }
assert.equal(item.doorRatio,first);
assert.equal(item.doorOpen,false,'walking must not modify persistent hold state');
velocity={x:0,y:0,z:0}; now+=3000;
a.updateDoorContact(100,positive); a.updateDoorAnimations();
assert.equal(item.doorRatio,first,'occupancy holds an already open door');
for(let i=0;i<90;i++) { now+=50; a.updateDoorContact(100,{x:100,y:100,z:31}); a.updateDoorAnimations(); }
assert(Math.abs(item.doorRatio)<.001,'unoccupied door should close');

item=reset(); controls={31:-1};
a.updateDoorContact(100,negative);
assert.equal(network.length,1,'walking intent must work when collision stops velocity');
item=reset(); vehicle=true; velocity={x:0,y:-1,z:0};
a.updateDoorContact(100,positive); assert.equal(network.length,0,'vehicle must not trigger character push');
item=reset(); a.state.builderActive=true; velocity={x:0,y:-1,z:0};
a.updateDoorContact(100,positive); assert.equal(network.length,0,'builder must not push');
item.doorPreview=true;
for(let i=0;i<12;i++) a.updateDoorAnimations();
assert.equal(item.doorRatio,1,'preview animates in builder');
const saved=a.syncLocalTransform(item);
assert.equal(saved.position.x,10); assert.equal(saved.rotation.z,0,'preview angle must not be saved');
a.stopDoorPreview(); assert.equal(item.doorRatio,0); assert.equal(entities.get(1).rotation.z,0);
assert.equal(JSON.parse(JSON.stringify(ui.at(-1))).active,false);
item.doorRatio=1; a.closeDoorsForEditing(); assert.equal(item.doorRatio,0);
const clean=a.stripEntity(item);
for(const field of ['doorPushRatio','doorPushUntil','doorLastPush','doorBounds','doorPreview','doorHingeOffset','entity']) assert(!(field in clean));

item=reset();
net.get('yx_shellcreator:client:doorPushed')(JSON.stringify({houseId:'other',objectId:'door',direction:1}));
assert.equal(item.doorPushUntil,0);
net.get('yx_shellcreator:client:doorPushed')(JSON.stringify({houseId:'house',objectId:'door',direction:2}));
assert.equal(item.doorPushUntil,0);
net.get('yx_shellcreator:client:doorPushed')(JSON.stringify({houseId:'house',objectId:'door',direction:-1}));
assert.equal(item.doorPushRatio,-1); assert(item.doorPushUntil>now);
item=reset(); item.doorOpen=true;
for(let i=0;i<12;i++) a.updateDoorAnimations();
assert.equal(item.doorRatio,1,'legacy hold-open state remains supported');
const main={entrance:{x:1},exit:{x:2}}, extra={id:'side',entrance:{x:3},exit:{x:4}};
assert.equal(a.houseAccessPoints(main).length,1);
assert.equal(a.houseAccessPoints({...main,accessPoints:[extra]})[1].id,'side');
console.log('PASS: two-sided contact, rotated hinges, idle/vehicle/editor guards, intent at collision, occupancy hold, return spring, preview placement safety, sync throttling and legacy hold-open');
