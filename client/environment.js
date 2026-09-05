'use strict';

// This resource never broadcasts world weather/time or pauses the global clock.
// Other weather resources can subscribe to the local override event to cooperate.
globalThis.YxHouseEnvironment = (() => {
    const weatherTypes = ['EXTRASUNNY','CLEAR','CLOUDS','SMOG','FOGGY','OVERCAST','RAIN','THUNDER','CLEARING','NEUTRAL','SNOW','BLIZZARD','SNOWLIGHT','XMAS','HALLOWEEN'];
    let weather = null, time = null, baselineWeather = null, baselineTime = null;
    let lastWeatherApply = -1000;
    const now = () => GetGameTimer();
    const validTime = (value) => value && Number.isInteger(value.hour) && value.hour >= 0 && value.hour < 24
        && Number.isInteger(value.minute) && value.minute >= 0 && value.minute < 60;

    function restoreWeather() {
        if (!weather) return;
        ClearOverrideWeather();
        ClearWeatherTypePersist();
        if (baselineWeather) SetWeatherTypeNow(baselineWeather);
        weather = null; baselineWeather = null;
    }

    function restoreTime() {
        if (!time) return;
        NetworkClearClockTimeOverride();
        // Standalone fallback: let the outside clock advance while the house clock
        // is frozen. A server weather/time resource can immediately resync on exit.
        if (baselineTime) {
            const elapsed = Math.max(0, now() - baselineTime.at);
            const seconds = Math.floor(baselineTime.seconds + elapsed * 60 / baselineTime.msPerMinute) % 86400;
            SetClockTime(Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60);
        }
        time = null; baselineTime = null;
    }

    function apply(value) {
        value = value || {};
        const nextWeather = weatherTypes.includes(value.weather) ? value.weather : null;
        const nextTime = validTime(value) ? { hour: value.hour, minute: value.minute } : null;
        if (nextWeather && !weather) {
            const previous = GetPrevWeatherTypeHashName() >>> 0;
            baselineWeather = weatherTypes.find(name => (GetHashKey(name) >>> 0) === previous) || null;
        }
        if (!nextWeather) restoreWeather();
        if (nextTime && !time) {
            baselineTime = { at: now(), seconds: GetClockHours()*3600 + GetClockMinutes()*60 + GetClockSeconds(),
                msPerMinute: Math.max(1, typeof GetMillisecondsPerGameMinute === 'function' ? GetMillisecondsPerGameMinute() : 2000) };
        }
        if (!nextTime) restoreTime();
        weather = nextWeather; time = nextTime; lastWeatherApply = -1000;
        tick();
        if (typeof emit === 'function') emit('yx_shellcreator:client:environmentOverride', {
            enabled: Boolean(weather || time), weather: Boolean(weather), time: Boolean(time)
        });
    }

    function tick() {
        if (time) NetworkOverrideClockTime(time.hour, time.minute, 0);
        if (weather && now() - lastWeatherApply >= 500) {
            SetWeatherTypeNowPersist(weather);
            lastWeatherApply = now();
        }
    }
    setTick(tick);
    on('onResourceStop', (resource) => { if (resource === GetCurrentResourceName()) apply(null); });
    return { apply, tick, isOverridden: () => Boolean(weather || time) };
})();
