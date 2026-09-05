'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const handlers = new Map(), network = new Map(), timers = [], requests = [], messages = [];
const environmentChanges = [];
const ctx = vm.createContext({
    YXCatalog: require('../client/catalog'),
    console, RegisterNuiCallbackType() {}, RegisterCommand() {}, RegisterKeyMapping() {}, setTick() {},
    on: (name, handler) => handlers.set(name, handler), onNet: (name, handler) => network.set(name, handler),
    GetCurrentResourceName: () => 'yx_shellcreator',
    LoadResourceFile: (_, file) => fs.readFileSync(path.join(root, file), 'utf8'),
    GetPlayerServerId: () => 1, PlayerId: () => 1, PlayerPedId: () => 10, GetGameTimer: () => 42,
    GetEntityCoords: () => [100, 200, 30], GetEntityHeading: () => 90,
    emitNet: (name, payload) => requests.push({name, payload:JSON.parse(payload), latent:false}),
    TriggerLatentServerEvent: (name, bps, payload) => requests.push({name, bps, payload:JSON.parse(payload), latent:true}),
    SendNUIMessage: message => messages.push(message),
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    BeginTextCommandThefeedPost() {}, AddTextComponentSubstringPlayerName() {}, EndTextCommandThefeedPostTicker() {},
    YxHouseEnvironment: { apply: value => environmentChanges.push(value) }
});
vm.runInContext(fs.readFileSync(path.join(root, 'client/client.js'), 'utf8') + '\nglobalThis.api = {state,serverRequest};', ctx);
const callNui = (name, data = {}) => new Promise(resolve => handlers.get(`__cfx_nui:${name}`)(data, resolve));
const respond = (request, ok, data) => network.get('yx_shellcreator:client:response')({requestId:request.payload.requestId,ok,data});

(async () => {
    assert.equal((await callNui('setEnvironment')).ok, false, 'outdoor settings must be rejected');
    assert.equal((await callNui('exportHouse')).ok, false, 'outdoor export must be rejected');
    const house = {id:'current',presetId:'empty_builder',environment:{weather:'INHERIT',hour:null,minute:null}};
    ctx.api.state.currentHouse = house;
    const env = {weather:'THUNDER',hour:0,minute:0};
    assert.equal((await callNui('setEnvironment',{environment:env})).ok,true);
    const climate = requests.at(-1);
    assert.equal(climate.payload.houseId,'current');
    assert.deepEqual(climate.payload.environment,env);
    assert.equal(climate.latent,false);
    assert.equal((await callNui('exportHouse')).ok,false,'pending climate save must block stale export');
    respond(climate,true,house);
    network.get('yx_shellcreator:client:houses')([{...house,environment:env}]);
    assert.equal(environmentChanges.at(-1),env,'current house update did not reach local environment');
    assert.equal((await callNui('exportHouse')).ok,true);
    const exported = requests.at(-1);
    const document = JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/house-v1.json'),'utf8'));
    respond(exported,true,{document,filename:'exports/test.json',saved:true});
    assert(messages.some(m=>m.action==='houseExport' && m.document===document));
    assert.equal((await callNui('importHouse',{slug:'copy',label:'副本',document})).ok,true);
    const imported = requests.at(-1);
    assert.equal(imported.latent,true,'import must use latent transport');
    assert.equal(imported.bps,131072);
    assert.deepEqual(imported.payload.entrance,{x:100,y:200,z:30,h:90});
    assert.deepEqual(imported.payload.document,document);
    respond(imported,false,null);
    assert(messages.some(m=>m.action==='operationFailed' && m.operation==='importHouse'));
    const errorCount = messages.filter(m=>m.action==='operationFailed').length;
    let expired = false;
    ctx.api.serverRequest('updateObject',{}, {onError:()=>{expired=true;}});
    timers.at(-1)();
    assert(expired,'timeout must release pending save promise');
    assert.equal(messages.filter(m=>m.action==='operationFailed').length,errorCount+1);
    console.log('PASS: house environment NUI, live update routing, export save guard, JSON response, latent import, failed requests and timeout cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
