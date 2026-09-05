'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
let clock = 0;
const calls = [], handlers = new Map();
const hash = text => [...text].reduce((sum,c) => sum*31+c.charCodeAt(0),0) >>> 0;
const context = vm.createContext({
    GetGameTimer:()=>clock, GetHashKey:hash, GetPrevWeatherTypeHashName:()=>hash('CLEAR'),
    GetClockHours:()=>9, GetClockMinutes:()=>10, GetClockSeconds:()=>0, GetMillisecondsPerGameMinute:()=>2000,
    GetCurrentResourceName:()=> 'yx_shellcreator', setTick() {}, on:(name,cb)=>handlers.set(name,cb), emit() {},
    ClearOverrideWeather:()=>calls.push(['clearWeather']), ClearWeatherTypePersist:()=>calls.push(['clearPersist']),
    SetWeatherTypeNow:type=>calls.push(['restoreWeather',type]), SetWeatherTypeNowPersist:type=>calls.push(['weather',type]),
    NetworkOverrideClockTime:(...args)=>calls.push(['clock',...args]), NetworkClearClockTimeOverride:()=>calls.push(['clearClock']),
    SetClockTime:(...args)=>calls.push(['restoreClock',...args])
});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../client/environment.js'),'utf8'),context);
const env=context.YxHouseEnvironment;
env.apply({weather:'INHERIT'}); env.tick();
assert.equal(calls.length,0,'default must leave world environment alone');
env.apply({weather:'RAIN',hour:23,minute:59});
assert(calls.some(c=>c[0]==='weather' && c[1]==='RAIN'));
assert(calls.some(c=>c[0]==='clock' && c[1]===23 && c[2]===59));
clock=2000;
env.apply({weather:'SNOW',hour:5,minute:30});
assert(!calls.some(c=>c[0]==='restoreClock'),'nested custom house must preserve the original outside snapshot');
clock=4000;
env.apply(null);
assert.deepEqual(calls.find(c=>c[0]==='restoreClock'),['restoreClock',9,12,0]);
assert.deepEqual(calls.find(c=>c[0]==='restoreWeather'),['restoreWeather','CLEAR']);
assert.equal(env.isOverridden(),false);
calls.length=0; env.apply(null); assert.equal(calls.length,0,'cleanup must be idempotent');
for(const invalid of [{hour:24,minute:0},{hour:-1,minute:0},{hour:12,minute:60},{hour:NaN,minute:0},{hour:12.5,minute:0},{hour:'12',minute:0}]) {
    env.apply(invalid); assert.equal(env.isOverridden(),false);
}
assert.equal(calls.length,0,'invalid time must never reach crashing native');
env.apply({weather:'THUNDER',hour:0,minute:0});
handlers.get('onResourceStop')('different_resource'); assert(env.isOverridden());
handlers.get('onResourceStop')('yx_shellcreator'); assert(!env.isOverridden());
console.log('PASS: inherited environment, room switching, nested baseline, clock progression, validation and resource-stop cleanup');
