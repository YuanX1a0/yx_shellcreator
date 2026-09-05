'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const requests=[], markers=[], callbacks=new Map();
let position=[100,200,30], pressed=true, tick;
const ctx=vm.createContext({
    YXCatalog: require('../client/catalog'),
    console, GetCurrentResourceName: ()=>'yx_shellcreator',
    LoadResourceFile: (_,file)=>fs.readFileSync(path.join(root,file),'utf8'),
    RegisterNuiCallbackType() {}, RegisterCommand() {}, RegisterKeyMapping() {},
    on: (name,fn)=>callbacks.set(name,fn), onNet() {}, setTick: fn=>{tick=fn;},
    PlayerPedId: ()=>10, GetEntityCoords: ()=>position, GetEntityHeading: ()=>90,
    GetPlayerServerId: ()=>1, PlayerId: ()=>1, GetGameTimer: ()=>1,
    IsControlJustReleased: (_,control)=>pressed && control===38,
    setTimeout() {}, SendNUIMessage() {},
    emitNet: (name,payload)=>requests.push({name,payload:JSON.parse(payload)}),
    recordMarker: p=>markers.push(p), DoesCamExist: ()=>true
});
vm.runInContext(fs.readFileSync(path.join(root,'client/client.js'),'utf8')+`
drawMarkerAt=(p)=>recordMarker(p); drawText3d=()=>{};
maintainNativeSources=()=>{}; updateDoorContact=()=>{}; updateDoorAnimations=()=>{}; updateStairCollisionHelpers=()=>{};
globalThis.api={state};`,ctx);
const s=ctx.api.state;
const house={id:'room',entrance:{x:0,y:0,z:30},exit:{x:1000,y:0,z:30},
    accessPoints:[{id:'rear',label:'后门',entrance:{x:100,y:200,z:30},exit:{x:1010,y:0,z:30}},
        {id:'side',label:'侧门',entrance:{x:110,y:200,z:30},exit:{x:1020,y:0,z:30}}]};
s.houses=[house];
tick();
assert.equal(requests.at(-1).name,'yx_shellcreator:server:enterHouse');
assert.equal(requests.at(-1).payload.pointId,'rear');
assert.equal(requests.at(-1).payload.houseId,'room');
position=[110,200,30]; tick(); assert.equal(requests.at(-1).payload.pointId,'side');
pressed=false; requests.length=0; tick(); assert.equal(requests.length,0,'enter requires deliberate E');
pressed=true; s.currentHouse=house; position=[1020,0,30]; tick();
assert.equal(requests.at(-1).name,'yx_shellcreator:server:leaveHouse');
assert.equal(requests.at(-1).payload.pointId,'side');
position=[1000,0,30]; tick(); assert.equal(requests.at(-1).payload.pointId,'main');
requests.length=0; position=[1050,0,30];
s.objects.set('door',{id:'door',model:'yx_door_wood',isDoor:true,position:{x:1050,y:0,z:30}});
tick(); assert.equal(requests.length,0,'E at a door without a marker must not teleport or toggle it');
s.entering=true; position=[1000,0,30]; tick(); assert.equal(requests.length,0,'loading guard'); s.entering=false;
const call=(name,data)=>new Promise(resolve=>callbacks.get('__cfx_nui:'+name)(data,resolve));
(async()=>{
    assert.equal((await call('accessPoint',{houseId:'missing',action:'add'})).ok,false);
    position=[150,250,30];
    assert.equal((await call('accessPoint',{houseId:'room',action:'add',label:' 后门二 '})).ok,true);
    assert.equal(requests.at(-1).payload.label,'后门二');
    assert.deepEqual(requests.at(-1).payload.transform,{x:150,y:250,z:30,h:90});
    s.builderActive=true; s.freecam.handle=1; s.freecam.buildView=false;
    s.freecam.position={x:1001,y:3,z:32}; s.freecam.rotation={x:0,y:0,z:45};
    await call('accessPoint',{houseId:'room',action:'exit',pointId:'rear'});
    assert.equal(requests.at(-1).payload.pointId,'rear');
    assert.deepEqual(requests.at(-1).payload.transform,{x:1001,y:3,z:31,h:45});
    s.freecam.buildView=true; s.freecam.target={x:1004,y:4,z:30}; s.buildSurface.planeZ=30;
    await call('accessPoint',{houseId:'room',action:'exit',pointId:'side'});
    assert.deepEqual(requests.at(-1).payload.transform,{x:1004,y:4,z:31,h:45},'top-down point uses target, not elevated camera');
    console.log('PASS: nearest paired entrance/exit, main compatibility, E-only markers independent of doors, loading guard and camera point capture');
})().catch(error=>{console.error(error);process.exitCode=1;});
