'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Catalog = require('../client/catalog');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const documents = ['config/catalog.json'].map(read);
const before = JSON.stringify(documents);
const catalog = Catalog.merge(...documents);
assert.equal(JSON.stringify(documents), before, 'merging must not change saved metadata');
assert.equal(catalog.items.length, 358);
assert.equal(new Set(catalog.items.map(i => i.model)).size, catalog.items.length);
assert.equal(new Set(catalog.items.map(i => i.id)).size, catalog.items.length);
for (const item of catalog.items) {
    assert(catalog.categories.some(c => c.id === item.category), `missing category: ${item.model}`);
    assert.match(item.model, /^[a-z0-9_]{1,100}$/);
    assert(!('price' in item));
    if (item.image) assert(fs.existsSync(path.join(root, 'web', item.image)));
}
for (const model of ['yx_door_wood', 'yx_door_modern']) {
    assert(catalog.items.find(i => i.model === model).door, 'legacy placed doors must retain runtime settings');
    assert(fs.existsSync(path.join(root, 'stream', model + '.ydr')), 'legacy assets must remain');
    assert.equal(Catalog.query(catalog, {search:model}).total, 0, 'withdrawn doors must not appear in new placement lists');
}
const found = new Set();
const first = Catalog.query(catalog);
assert.equal(first.total, 356);
for (let page=1; page<=first.pages; page++) {
    const result = Catalog.query(catalog, {page});
    assert(result.items.length <= 40);
    result.items.forEach(i => { assert(!found.has(i.id)); found.add(i.id); });
}
assert.equal(found.size, first.total, 'all models, including those beyond 400, must be reachable');
assert.equal(Catalog.query(catalog, {page:1e9}).page, first.pages);
assert.equal(Catalog.query(catalog, {search:'no_such_furniture',page:6}).page, 1);
assert(Catalog.query(catalog, {search:'台灯'}).items.every(i => i.category === 'lighting'));
assert(Catalog.query(catalog, {search:'sofa'}).total > 0);
assert(Catalog.query(catalog, {category:'doors'}).items.every(i => i.door && !i.hiddenFromCatalog));
assert.equal(Catalog.query(catalog, {emptyBuilder:true}).items[0].buildType, 'floor');
const duplicates = Catalog.merge(documents[0], {items:[
    {...documents[0].items[0], id:'duplicate-model', model:documents[0].items[0].model.toUpperCase()},
    {...documents[0].items[0], model:'another_model'}, {id:'unsafe',model:'../bad'}
]});
assert.equal(duplicates.items.length, documents[0].items.length);

let now=10, registered=true, checks=0;
const ctx=vm.createContext({
    console, YXCatalog:Catalog, GetCurrentResourceName:()=> 'yx_shellcreator',
    LoadResourceFile:(_,file)=>fs.readFileSync(path.join(root,file),'utf8'),
    RegisterNuiCallbackType() {}, on() {}, onNet() {}, RegisterCommand() {}, RegisterKeyMapping() {}, setTick() {},
    GetGameTimer:()=>now,
    GetHashKey:name=>name, IsModelInCdimage:()=>{checks++;return registered;}, IsModelValid:()=>registered
});
vm.runInContext(fs.readFileSync(path.join(root,'client/client.js'),'utf8')+'\nglobalThis.catalogUi=catalogForUi; globalThis.snapshot=uiState;',ctx);
assert(ctx.catalogUi().items.every(i => i.available));
const count = checks;
for(let i=0;i<20;i++) ctx.catalogUi();
assert.equal(checks, count, 'frequent state updates must not recheck the whole catalog');
assert(ctx.catalogUi().items.every(i=>i.available));
now += 5001; registered=false;
assert(ctx.catalogUi().items.every(i=>!i.available), 'availability applies to all models, not only doors/stairs');
now=0; registered=true;
assert(ctx.catalogUi().items.every(i=>i.available), 'timer rollover must invalidate availability cache');
assert(!('catalog' in ctx.snapshot('builder', false)), 'object edits must not resend the large catalog');
assert(ctx.snapshot('builder').catalog, 'opening a panel must receive the current full catalog');
console.log('PASS: 358 original catalogue entries, 356 visible items; legacy preservation, search, all pages and cached per-client model availability');
