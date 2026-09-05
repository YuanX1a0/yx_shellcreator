'use strict';

const app = document.getElementById('app');
const managerView = document.getElementById('managerView');
const builderView = document.getElementById('builderView');
const houseForm = document.getElementById('houseForm');
const presetSelect = document.getElementById('presetSelect');
const shellModelGroup = document.getElementById('shellModelGroup');
const presetDescription = document.getElementById('presetDescription');
const houseList = document.getElementById('houseList');
const catalogGrid = document.getElementById('catalogGrid');
const categoryTabs = document.getElementById('categoryTabs');
const objectList = document.getElementById('objectList');

function tr(key, fallback = '') {
    return window.YXLocale ? window.YXLocale.t(key, fallback) : fallback;
}

function trf(key, fallback, values = {}) {
    return window.YXLocale ? window.YXLocale.interpolate(key, fallback, values) : String(fallback).replace(/\{(\w+)\}/g, (_, name) => values[name] == null ? '' : values[name]);
}

function isCjkText(value) {
    return /[\u3400-\u9fff]/.test(String(value || ''));
}

const ui = {
    mode: 'manager',
    houses: [],
    currentHouse: null,
    objects: [],
    catalog: { categories: [], items: [] },
    config: {},
    category: 'all',
    catalogPage: 1,
    search: '',
    selectedId: null,
    focused: true,
    builderHouseId: null,
    construction: { active: false, label: '', buildType: '', rotation: 0 },
    history: { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0, applying: false },
    confirmation: null,
    importDocument: null,
    importError: false,
    houseBusy: false,
    environmentKey: null,
    exportFilename: 'house.json',
    houseSearch: '',
    formOpen: false,
    inspectorTab: 'object',
    accessBusy: false
};

function post(name, data = {}) {
    return fetch(`https://${GetParentResourceName()}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(data)
    }).then((response) => response.json()).catch(() => ({ ok: false }));
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function presetById(id) {
    return (ui.config.interiors || []).find((preset) => preset.id === id) || null;
}

function presetLabel(preset) {
    return preset ? tr(`preset.${preset.id}.label`, preset.label || preset.id) : '';
}

function presetDescriptionText(preset) {
    return preset ? tr(`preset.${preset.id}.description`, preset.description || '') : '';
}

function isEmptyBuilder() {
    const preset = ui.currentHouse ? presetById(ui.currentHouse.presetId) : null;
    return Boolean(preset && preset.type === 'empty');
}

function buildTypeLabel(type) {
    const fallback = ({ floor: '地板', wall: '墙面', door: '门', stairs: '楼梯', railing: '栏杆' })[type] || '建筑部件';
    return tr(`type.${type}`, fallback);
}

function updateSceneChrome() {
    const sceneMode = ui.mode === 'builder' && !ui.focused;
    app.classList.toggle('scene-mode', sceneMode);
    const focusHint = document.getElementById('focusHint');
    focusHint.classList.toggle('hidden', !sceneMode || Boolean(ui.construction.active));
    focusHint.textContent = isEmptyBuilder()
        ? tr('hint.empty', '斜俯视建造 · WASD 平移 · E/Q 或滚轮缩放 · 按住右键旋转 · F2 返回面板')
        : tr('hint.free', '自由视角 · 左键选择/拖拽坐标轴 · 按住右键环视 · F2 返回面板');

    const toolHint = document.getElementById('buildToolHint');
    toolHint.classList.toggle('hidden', !sceneMode || !ui.construction.active);
    if (ui.construction.active) {
        document.getElementById('buildToolName').textContent = ui.construction.label || tr('type.construction', '建筑部件');
        document.getElementById('buildToolMeta').textContent = `${buildTypeLabel(ui.construction.buildType)} · ${tr('hint.rotation', '旋转')} ${Math.round(Number(ui.construction.rotation) || 0)}° · ${tr('hint.step', '步进')} ${Math.round(Number(ui.construction.rotationStep) || 90)}°`;
    }
}

function categoryLabel(id) {
    const category = (ui.catalog.categories || []).find((entry) => entry.id === id);
    return category ? tr(`category.${category.id}`, category.label) : tr(`category.${id}`, id);
}

function coordinates(value) {
    if (!value) return '—';
    return `${Number(value.x).toFixed(2)}, ${Number(value.y).toFixed(2)}, ${Number(value.z).toFixed(2)}`;
}

function setState(data) {
    ui.mode = data.mode || ui.mode;
    ui.houses = Array.isArray(data.houses) ? data.houses : ui.houses;
    ui.currentHouse = data.currentHouse || null;
    ui.objects = Array.isArray(data.objects) ? data.objects : ui.objects;
    ui.catalog = data.catalog || ui.catalog;
    ui.config = data.config || ui.config;
    if (window.YXLocale) window.YXLocale.configure(ui.config.language || ui.config.locale || 'zh');
    ui.construction = data.construction || ui.construction;
    ui.history = data.history || ui.history;
    const currentBuilderHouseId = ui.mode === 'builder' && ui.currentHouse ? ui.currentHouse.id : null;
    if (currentBuilderHouseId && currentBuilderHouseId !== ui.builderHouseId) {
        ui.builderHouseId = currentBuilderHouseId;
        ui.category = isEmptyBuilder() ? 'construction' : 'all';
        ui.search = '';
        ui.catalogPage = 1;
        document.getElementById('catalogSearch').value = '';
    }
    if (ui.selectedId && !ui.objects.some((item) => item.id === ui.selectedId)) ui.selectedId = null;
    render();
}

function render() {
    managerView.classList.toggle('hidden', ui.mode !== 'manager');
    builderView.classList.toggle('hidden', ui.mode !== 'builder');
    updateSceneChrome();
    if (ui.mode === 'manager') {
        renderPresets();
        renderManager();
    } else if (ui.mode === 'builder') {
        renderBuilder();
        renderEnvironment();
    }
}

function renderPresets() {
    const previous = presetSelect.value;
    presetSelect.innerHTML = (ui.config.interiors || [])
        .map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(presetLabel(preset))}</option>`)
        .join('');
    if (previous && [...presetSelect.options].some((option) => option.value === previous)) presetSelect.value = previous;
    updatePresetHelp();
}

function updatePresetHelp() {
    const preset = presetById(presetSelect.value);
    presetDescription.textContent = presetDescriptionText(preset);
    presetDescription.dataset.type = preset ? preset.type || '' : '';
    shellModelGroup.classList.toggle('hidden', !preset || preset.type !== 'shell');
}

function renderManager() {
    document.getElementById('houseCount').textContent = String(ui.houses.length);
    document.getElementById('openCurrentBuilder').classList.toggle('hidden', !ui.currentHouse);
    document.getElementById('leaveCurrentHouse').classList.toggle('hidden', !ui.currentHouse);

    const query = ui.houseSearch.trim().toLowerCase();
    const houses = ui.houses.filter(house => `${house.label} ${house.slug} ${presetLabel(presetById(house.presetId))}`.toLowerCase().includes(query));
    houseList.innerHTML = houses.map((house) => {
        const preset = presetById(house.presetId);
        const active = ui.currentHouse && ui.currentHouse.id === house.id;
        return `
            <article class="house-row" data-house-id="${escapeHtml(house.id)}">
                <div class="house-name"><h3>${escapeHtml(house.label)}${active ? `<span class="active-state">${tr('manager.active', '当前')}</span>` : ''}</h3><code>${escapeHtml(house.slug)}</code></div>
                <div class="house-type">${escapeHtml(preset ? presetLabel(preset) : house.presetId)}<small>${1 + (house.accessPoints || []).length} ${tr('manager.entrances', '个出入口')}</small></div>
                <div class="house-actions">
                    <button class="button" data-house-action="enter">${tr('button.enter', '进入')}</button>
                    <button class="button ghost" data-house-action="edit">${tr('button.edit', '编辑')}</button>
                    <button class="button ghost danger-text" data-house-action="delete">${tr('button.delete', '删除')}</button>
                </div>
            </article>`;
    }).join('') || `<div class="empty-list"><strong>${ui.houses.length ? tr('manager.noMatch', '没有匹配的房屋') : tr('manager.none', '还没有房屋')}</strong><small>${ui.houses.length ? tr('manager.trySearch', '换一个关键词试试。') : tr('manager.createHint', '站到入口位置，点击右上角「新建房屋」。')}</small></div>`;
    renderAccessPoints();
}

function renderBuilder() {
    document.getElementById('builderHouseName').textContent = ui.currentHouse ? ui.currentHouse.label : tr('builder.defaultName', '室内建造');
    document.getElementById('emptyBuildBanner').classList.toggle('hidden', !isEmptyBuilder());
    document.getElementById('releaseFocus').textContent = isEmptyBuilder() ? tr('builder.releaseEmpty', '进入斜俯视建造 / F2') : tr('builder.releaseFree', '进入自由视角 / F2');
    document.getElementById('undoObject').disabled = !ui.history.canUndo;
    document.getElementById('redoObject').disabled = !ui.history.canRedo;
    renderCategories();
    renderCatalog();
    renderObjects();
    renderSelection();
    renderAccessPoints();
    updateSceneChrome();
}

function renderCategories() {
    const categories = [{ id: 'all', label: '全部' }, ...(ui.catalog.categories || [])];
    categoryTabs.innerHTML = categories.map((category) =>
        `<option value="${escapeHtml(category.id)}">${escapeHtml(categoryLabel(category.id))}</option>`
    ).join('');
    categoryTabs.value = ui.category;
}

function renderCatalog() {
    const result = YXCatalog.query(ui.catalog, { category: ui.category,
        search: ui.search, page: ui.catalogPage, pageSize: 40, emptyBuilder: isEmptyBuilder() });
    ui.catalogPage = result.page;
    document.getElementById('catalogResultCount').textContent = `${result.total} ${tr('catalog.items', '项')}`;
    document.getElementById('catalogPageLabel').textContent = `${result.page} / ${result.pages}`;
    document.getElementById('catalogPrevious').disabled = result.page <= 1;
    document.getElementById('catalogNext').disabled = result.page >= result.pages;

    catalogGrid.innerHTML = result.items.map((item) => {
        const image = item.image
            ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy">`
            : `<span class="catalog-no-preview"><b>${escapeHtml(categoryLabel(item.category))}</b><span>${tr('catalog.noThumbnail', '无缩略图')}</span></span>`;
        const buildBadge = item.door ? `<em class="build-type door">${tr('catalog.pushDoor', '可推开门扇')}</em>` : item.buildType
            ? `<em class="build-type">${item.buildType === 'door' ? tr('catalog.doorway', '门洞 · 另配门扇') : escapeHtml(buildTypeLabel(item.buildType))}</em>`
            : !item.image ? `<em class="build-type">${escapeHtml(categoryLabel(item.category))} · ${tr('catalog.noThumbnail', '无缩略图')}</em>` : '';
        const unavailableReason = item.unavailableReason ? localizeServerMessage(item.unavailableReason) : tr('catalog.noRegistration', '当前客户端未注册此模型');
        return `
            <button class="catalog-item ${!item.image ? 'no-image' : ''} ${item.category === 'construction' ? 'construction' : ''}" data-item-id="${escapeHtml(item.id)}" data-model="${escapeHtml(item.model)}" title="${escapeHtml(item.model)} · ${escapeHtml(item.searchTags || item.sourceLabel || '')}${item.available === false ? ' · ' + escapeHtml(unavailableReason) : ''}" ${item.available === false ? 'disabled' : ''}>
                <span class="catalog-thumb">${image}</span>
                ${buildBadge}
                <strong>${escapeHtml(catalogItemLabel(item))}</strong>
                ${item.originalLabel && !(window.YXLocale && window.YXLocale.isEnglish() && isCjkText(item.originalLabel)) ? `<small>${escapeHtml(item.originalLabel)}</small>` : ''}
                <small>${item.available === false ? tr('catalog.unavailable', '当前客户端不可用') : escapeHtml(item.model)}</small>
            </button>`;
    }).join('') || `<div class="empty-list"><span>⌕</span><strong>${tr('catalog.noMatch', '没有匹配的模型')}</strong><small>${tr('catalog.trySearch', '尝试更换分类或搜索关键词。')}</small></div>`;
}

function catalogItemLabel(item) {
    if (!item) return '';
    const translated = tr(`item.${item.model}`, '');
    if (translated) return translated;
    const fallback = item.label || item.model;
    return window.YXLocale && window.YXLocale.isEnglish() && isCjkText(fallback) ? item.model : fallback;
}

function objectLabel(item) {
    const entry = (ui.catalog.items || []).find(c => c.model === item.model);
    return entry ? catalogItemLabel(entry) : item.model;
}

function renderObjects() {
    document.getElementById('objectCount').textContent = String(ui.objects.length);
    objectList.innerHTML = ui.objects.map((item, index) => `
        <button class="object-row ${ui.selectedId === item.id ? 'active' : ''} ${item.hidden ? 'hidden-native' : ''}"
            ${item.hidden ? `data-restore-object="${escapeHtml(item.id)}"` : `data-object-id="${escapeHtml(item.id)}"`}>
            <span class="object-name">${escapeHtml(objectLabel(item))}${item.sourceKind === 'native' ? `<small>${tr('object.native', '原生')}</small>` : ''}${item.isDoor ? `<small>${tr('object.doorLeaf', '门扇')}</small>` : ''}</span>
            ${item.hidden ? `<em>${tr('object.restore', '恢复')}</em>` : ''}
        </button>`).join('') || `<p class="muted object-empty">${tr('object.empty', '暂无已放置物件')}</p>`;
}

function renderSelection() {
    const item = ui.objects.find((entry) => entry.id === ui.selectedId);
    document.getElementById('noSelection').classList.toggle('hidden', Boolean(item));
    document.getElementById('selectionPanel').classList.toggle('hidden', !item);
    if (!item) return;
    document.getElementById('selectedLabel').textContent = objectLabel(item) || tr('selection.default', '物件');
    document.getElementById('selectedModel').textContent = item.model;
    document.getElementById('selectedId').textContent = item.id;
    document.getElementById('doorTools').classList.toggle('hidden', !item.isDoor);
    document.getElementById('doorHoldOpen').checked = Boolean(item.doorOpen);
    document.getElementById('selectedSource').textContent = item.sourceKind === 'native'
        ? tr('source.native', '原生室内物件 · 删除后会隐藏，可从列表恢复')
        : item.isDoor ? tr('source.door', '门扇 · 不关联传送点') : tr('source.object', '拖动场景中的坐标轴调整位置');
}

function resetForm() {
    houseForm.reset();
    document.getElementById('editingHouseId').value = '';
    document.getElementById('houseSlug').disabled = false;
    document.getElementById('formTitle').textContent = tr('form.createTitle', '创建房屋');
    document.getElementById('submitHouse').textContent = tr('form.createHere', '在当前位置创建');
    document.getElementById('resetForm').classList.add('hidden');
    document.getElementById('updateEntranceGroup').classList.add('hidden');
    renderPresets();
    clearHouseImport();
    document.getElementById('houseImportTools').classList.remove('hidden');
    setHouseBusy(false);
    renderAccessPoints();
}

function editHouse(house) {
    if (ui.houseBusy) return;
    setFormOpen(true);
    clearHouseImport();
    document.getElementById('houseImportTools').classList.add('hidden');
    document.getElementById('editingHouseId').value = house.id;
    document.getElementById('houseSlug').value = house.slug;
    document.getElementById('houseSlug').disabled = true;
    document.getElementById('houseLabel').value = house.label;
    presetSelect.value = house.presetId;
    document.getElementById('shellModel').value = house.shellModel || '';
    document.getElementById('useCurrentEntrance').checked = false;
    document.getElementById('formTitle').textContent = tr('form.editTitle', '编辑房屋');
    document.getElementById('submitHouse').textContent = tr('form.saveChanges', '保存修改');
    document.getElementById('resetForm').classList.remove('hidden');
    document.getElementById('updateEntranceGroup').classList.remove('hidden');
    updatePresetHelp();
    renderAccessPoints();
    document.getElementById('houseLabel').focus();
}

function setFormOpen(open) {
    ui.formOpen = open;
    document.getElementById('houseFormPanel').classList.toggle('hidden', !open);
    document.getElementById('managerContent').classList.toggle('form-open', open);
}

function setInspectorTab(tab, focus = false) {
    ui.inspectorTab = tab;
    for (const button of document.querySelectorAll('[data-inspector-tab]')) {
        const active = button.dataset.inspectorTab === tab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        if (active && focus) button.focus();
    }
    document.getElementById('objectPane').classList.toggle('hidden', tab !== 'object');
    document.getElementById('housePane').classList.toggle('hidden', tab !== 'house');
}

function renderAccessPoints() {
    const editingId = document.getElementById('editingHouseId').value;
    const edited = ui.houses.find(h => h.id === editingId);
    document.getElementById('managerAccessTools').classList.toggle('hidden', !edited);
    const inside = edited && ui.currentHouse && ui.currentHouse.id === edited.id;
    document.getElementById('addAccessPoint').disabled = !edited || inside || ui.accessBusy || (edited.accessPoints || []).length >= 15;
    const renderPoints = (house, indoor) => ((house && house.accessPoints) || []).map(point => `
        <div class="access-row" data-point-id="${escapeHtml(point.id)}" data-access-house="${escapeHtml(house.id)}">
            <strong>${escapeHtml(point.label)}</strong><p>${indoor ? tr('access.indoor', '屋内') : tr('access.outside', '外部')}：${escapeHtml(coordinates(indoor ? point.exit : point.entrance))}</p>
            <div class="toolbar-row"><button class="button" data-access-action="${indoor ? 'exit' : 'entrance'}" ${ui.accessBusy || (!indoor && inside) ? 'disabled' : ''}>${indoor ? tr('access.setIndoor', '屋内位置设在此处') : tr('access.setOutside', '外部入口移到此处')}</button><button class="button ghost danger-text" data-access-action="delete" ${ui.accessBusy ? 'disabled' : ''}>${tr('access.delete', '删除')}</button></div>
        </div>`).join('') || `<p class="muted">${tr('access.none', '暂无附加出入口，默认出入口保持不变。')}</p>`;
    document.getElementById('managerAccessList').innerHTML = renderPoints(edited, false);
    document.getElementById('houseAccessList').innerHTML = renderPoints(ui.currentHouse, true);
}

async function changeAccessPoint(data) {
    if (ui.accessBusy) return;
    ui.accessBusy = true; renderAccessPoints();
    const result = await post('accessPoint', data);
    if (!result.ok) { ui.accessBusy = false; renderAccessPoints(); toast(tr('message.accessFailed', '出入口提交失败。'), 'error'); }
}

document.getElementById('newHouseButton').addEventListener('click', () => {
    if (ui.houseBusy) return;
    resetForm(); setFormOpen(true); document.getElementById('houseLabel').focus();
});
document.getElementById('closeHouseForm').addEventListener('click', () => { if (!ui.houseBusy) setFormOpen(false); });
document.getElementById('houseSearch').addEventListener('input', event => { ui.houseSearch = event.target.value; renderManager(); });
document.querySelectorAll('[data-inspector-tab]').forEach(button => {
    button.addEventListener('click', () => setInspectorTab(button.dataset.inspectorTab));
    button.addEventListener('keydown', event => {
        if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
            event.preventDefault(); setInspectorTab(event.key === 'Home' ? 'object' : event.key === 'End' ? 'house' : ui.inspectorTab === 'object' ? 'house' : 'object', true);
        }
    });
});
document.getElementById('previewDoor').addEventListener('click', () => post('previewDoor'));
document.getElementById('doorHoldOpen').addEventListener('change', async () => {
    const input = document.getElementById('doorHoldOpen');
    input.disabled = true;
    const result = await post('toggleDoorHold');
    input.disabled = false;
    if (!result.ok) { renderSelection(); toast(tr('message.doorFailed', '门状态提交失败。'), 'error'); }
});
document.getElementById('addAccessPoint').addEventListener('click', () => {
    const label = document.getElementById('accessPointLabel').value.trim();
    if (!label) { document.getElementById('accessPointLabel').focus(); toast(tr('message.enterAccessName', '先填写出入口名称。')); return; }
    changeAccessPoint({houseId: document.getElementById('editingHouseId').value, action:'add', label});
});
for (const id of ['managerAccessList','houseAccessList']) document.getElementById(id).addEventListener('click', event => {
    const button = event.target.closest('[data-access-action]'), row = event.target.closest('[data-point-id]');
    if (!button || !row) return;
    const action = () => changeAccessPoint({houseId:row.dataset.accessHouse, pointId:row.dataset.pointId, action:button.dataset.accessAction});
    if (button.dataset.accessAction === 'delete') confirmTwice(`access:${row.dataset.pointId}`, tr('message.confirmAccess', '即将删除这个出入口，不删除门模型。'), action);
    else action();
});

function toast(message, type = 'info') {
    const element = document.createElement('div');
    element.className = `toast ${type}`;
    element.textContent = message;
    document.getElementById('toastContainer').appendChild(element);
    setTimeout(() => element.remove(), 3500);
}

function confirmTwice(key, message, action) {
    const now = Date.now();
    if (ui.confirmation && ui.confirmation.key === key && ui.confirmation.expires > now) {
        ui.confirmation = null;
        action();
        return;
    }
    ui.confirmation = { key, expires: now + 4000 };
    toast(`${message} ${tr('message.confirmAgain', '请在 4 秒内再次点击删除确认。')}`, 'warning');
}

presetSelect.addEventListener('change', updatePresetHelp);
document.getElementById('resetForm').addEventListener('click', resetForm);
document.getElementById('refreshButton').addEventListener('click', () => post('refresh'));
document.getElementById('openCurrentBuilder').addEventListener('click', () => post('openBuilder'));
document.getElementById('leaveCurrentHouse').addEventListener('click', () => post('leaveHouse'));
document.getElementById('builderLeave').addEventListener('click', () => post('leaveHouse'));
document.getElementById('releaseFocus').addEventListener('click', () => post('releaseFocus'));
document.getElementById('setSpawnPoint').addEventListener('click', () => post('setInteriorPoint', { kind: 'spawn' }));
document.getElementById('setExitPoint').addEventListener('click', () => post('setInteriorPoint', { kind: 'exit' }));
document.getElementById('groundObject').addEventListener('click', () => post('groundObject'));
document.getElementById('saveObject').addEventListener('click', () => post('saveObject'));
document.getElementById('duplicateObject').addEventListener('click', () => post('duplicateObject'));
document.getElementById('undoObject').addEventListener('click', () => post('undo'));
document.getElementById('redoObject').addEventListener('click', () => post('redo'));

document.querySelectorAll('[data-rotation], [data-rotation-relative]').forEach((button) => {
    button.addEventListener('click', () => {
        const relative = button.dataset.rotationRelative != null;
        const value = relative ? button.dataset.rotationRelative : button.dataset.rotation;
        post('setRotation', { value: Number(value), relative });
    });
});

document.getElementById('deleteObject').addEventListener('click', () => {
    const item = ui.objects.find((entry) => entry.id === ui.selectedId);
    if (item) confirmTwice(`object:${item.id}`, trf('message.confirmObject', `即将删除物件 ${item.model}。`, { model: item.model }), () => post('deleteObject'));
});

document.querySelectorAll('.close-button').forEach((button) => {
    button.addEventListener('click', () => post('close'));
});

houseForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (ui.houseBusy) return;
    if (ui.importError) { toast(tr('message.importInvalid', '请重新读取有效文件，或点击取消导入。'), 'error'); return; }
    const houseId = document.getElementById('editingHouseId').value;
    const data = {
        slug: document.getElementById('houseSlug').value,
        label: document.getElementById('houseLabel').value,
        presetId: presetSelect.value,
        shellModel: document.getElementById('shellModel').value
    };
    setHouseBusy(true);
    const operation = houseId ? 'updateHouse' : ui.importDocument ? 'importHouse' : 'createHouse';
    const payload = houseId ? { ...data, houseId, useCurrentEntrance: document.getElementById('useCurrentEntrance').checked }
        : ui.importDocument ? { ...data, document: ui.importDocument } : data;
    post(operation, payload).then(result => { if (!result.ok) { setHouseBusy(false); toast(tr('message.submitFailed', '提交失败，请检查数据后重试。'),'error'); } });
});

houseList.addEventListener('click', (event) => {
    const action = event.target.closest('[data-house-action]');
    const card = event.target.closest('[data-house-id]');
    if (!action || !card) return;
    const house = ui.houses.find((entry) => entry.id === card.dataset.houseId);
    if (!house) return;
    if (action.dataset.houseAction === 'enter') post('enterHouse', { houseId: house.id });
    if (action.dataset.houseAction === 'edit') editHouse(house);
    if (action.dataset.houseAction === 'delete') {
        confirmTwice(`house:${house.id}`, trf('message.confirmHouse', `即将删除“${house.label}”及其全部建筑物。`, { label: house.label }), () => post('deleteHouse', { houseId: house.id }));
    }
});

categoryTabs.addEventListener('change', (event) => {
    ui.category = event.target.value;
    ui.catalogPage = 1;
    renderCatalog();
    catalogGrid.scrollTop = 0;
});

document.getElementById('catalogSearch').addEventListener('input', (event) => {
    ui.search = event.target.value;
    ui.catalogPage = 1;
    renderCatalog();
    catalogGrid.scrollTop = 0;
});

for (const [id, delta] of [['catalogPrevious', -1], ['catalogNext', 1]]) {
    document.getElementById(id).addEventListener('click', () => {
        ui.catalogPage += delta;
        renderCatalog(); catalogGrid.scrollTop = 0;
    });
}

catalogGrid.addEventListener('click', (event) => {
    const item = event.target.closest('[data-model]');
    if (item) post('createObject', { itemId: item.dataset.itemId, model: item.dataset.model });
});

document.getElementById('addCustomModel').addEventListener('click', () => {
    const input = document.getElementById('customModel');
    const model = input.value.trim();
    if (!model) return;
    post('createObject', { model });
    input.select();
});

objectList.addEventListener('click', (event) => {
    const restore = event.target.closest('[data-restore-object]');
    if (restore) {
        post('restoreObject', { objectId: restore.dataset.restoreObject });
        return;
    }
    const item = event.target.closest('[data-object-id]');
    if (item) post('selectObject', { objectId: item.dataset.objectId });
});

window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.action === 'open') {
        app.classList.remove('hidden');
        setState(data);
    } else if (data.action === 'state') {
        setState(data);
    } else if (data.action === 'selection') {
        ui.selectedId = data.selectedId || null;
        if (ui.selectedId) setInspectorTab('object');
        renderObjects();
        renderSelection();
    } else if (data.action === 'focusState') {
        ui.focused = Boolean(data.focused);
        updateSceneChrome();
    } else if (data.action === 'constructionMode') {
        ui.construction = data.construction || { active: false, label: '', buildType: '', rotation: 0 };
        updateSceneChrome();
    } else if (data.action === 'historyState') {
        ui.history = data.history || ui.history;
        document.getElementById('undoObject').disabled = !ui.history.canUndo;
        document.getElementById('redoObject').disabled = !ui.history.canRedo;
    } else if (data.action === 'toast') {
        toast(localizeServerMessage(data.message), data.type);
    } else if (data.action === 'operationResult') {
        if (['createHouse', 'importHouse', 'updateHouse', 'deleteHouse'].includes(data.operation)) resetForm();
        if (data.operation === 'accessPoint') { ui.accessBusy = false; renderAccessPoints(); }
        if (data.operation === 'setEnvironment') document.getElementById('saveHouseEnvironment').disabled = false;
    } else if (data.action === 'operationFailed') {
        if (data.operation === 'accessPoint') { ui.accessBusy = false; renderAccessPoints(); }
        if (['createHouse','importHouse','updateHouse','deleteHouse'].includes(data.operation)) setHouseBusy(false);
        if (data.operation === 'exportHouse') document.getElementById('exportHouseData').disabled = false;
        if (data.operation === 'setEnvironment') document.getElementById('saveHouseEnvironment').disabled = false;
    } else if (data.action === 'doorPreview') {
        document.getElementById('previewDoor').textContent = data.active ? tr('door.previewEnd', '结束试开') : tr('door.preview', '试开门');
        document.getElementById('doorPreviewStatus').textContent = data.active ? tr('door.previewStatus', '预览中 · 不保存') : tr('door.contact', '接触推开');
    } else if (data.action === 'houseExport') {
        document.getElementById('exportHouseData').disabled = false;
        ui.exportFilename = String(data.filename || 'house.json').split('/').pop();
        document.getElementById('houseExportText').value = JSON.stringify(data.document, null, 2);
        document.getElementById('houseExportLocation').textContent = data.saved
            ? trf('export.serverPath', `服务器资源目录：yx_shellcreator/${data.filename}`, { filename: data.filename }) : tr('export.serverFailed', '服务器未能保存文件，请复制 JSON 后自行保存。');
        document.getElementById('houseExportPanel').classList.remove('hidden');
        document.getElementById('closeHouseExport').focus();
    } else if (data.action === 'close') {
        ui.builderHouseId = null;
        ui.construction = { active: false, label: '', buildType: '', rotation: 0 };
        app.classList.add('hidden');
        document.getElementById('houseExportPanel').classList.add('hidden');
    }
});

window.addEventListener('keydown', (event) => {
    const editingText = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement && document.activeElement.tagName);
    if (!document.getElementById('houseExportPanel').classList.contains('hidden')) {
        if (event.key === 'Escape') closeExport();
        if (event.key === 'Escape' || event.key === 'F2') event.preventDefault();
        if (event.key === 'Tab') {
            const nodes = [...document.getElementById('houseExportPanel').querySelectorAll('button,textarea')];
            const first = nodes[0], last = nodes[nodes.length-1];
            if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
            if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
        }
        return;
    }
    if (event.key === 'Escape') post('close');
    if (event.key === 'F2' && ui.mode === 'builder') {
        event.preventDefault();
        post('releaseFocus');
    }
    if (!editingText && event.key === 'Delete' && ui.mode === 'builder' && ui.selectedId) {
        event.preventDefault();
        post('deleteObject');
    }
    if (!editingText && event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        post('undo');
    }
    if (!editingText && event.ctrlKey && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
        event.preventDefault();
        post('redo');
    }
});

function renderEnvironment() {
    const house = ui.currentHouse;
    const env = (house && house.environment) || { weather: 'INHERIT' };
    const key = JSON.stringify([house && house.id, env]);
    if (key === ui.environmentKey) return;
    ui.environmentKey = key;
    document.getElementById('houseWeather').value = env.weather || 'INHERIT';
    const fixed = Number.isInteger(env.hour) && Number.isInteger(env.minute);
    document.getElementById('houseFixedTime').checked = fixed;
    document.getElementById('houseTime').disabled = !fixed;
    document.getElementById('houseTime').value = fixed ? `${String(env.hour).padStart(2,'0')}:${String(env.minute).padStart(2,'0')}` : '12:00';
}

function localizeServerMessage(message) {
    const text = String(message == null ? '' : message);
    const known = {
        '出入口提交失败。': 'message.accessFailed',
        '门状态提交失败。': 'message.doorFailed',
        '提交失败，请检查数据后重试。': 'message.submitFailed',
        '文件不能超过 2 MiB。': 'message.fileTooLarge',
        '文件物件数量超过本服上限。': 'message.objectLimit',
        'JSON 格式有误，请检查引号、逗号和括号是否完整。': 'message.jsonInvalid',
        '文件读取失败，可改用粘贴 JSON。': 'message.readFailed',
        '当前游戏构建或已加载资源未注册此模型': 'catalog.noRegistration'
    };
    return known[text] ? tr(known[text], text) : text;
}

function setHouseBusy(value) {
    ui.houseBusy = value;
    document.getElementById('submitHouse').disabled = value;
    document.getElementById('chooseHouseImport').disabled = value;
    document.getElementById('parseHouseImport').disabled = value;
    document.getElementById('clearHouseImport').disabled = value;
}

let importReadToken = 0;
function clearHouseImport() {
    importReadToken++;
    ui.importDocument = null; ui.importError = false;
    document.getElementById('houseImportFile').value = '';
    document.getElementById('houseImportText').value = '';
    document.getElementById('houseImportSummary').textContent = tr('form.emptyTemplate', '不选择文件则按所选模板创建空房屋。');
    presetSelect.disabled = false;
    document.getElementById('shellModel').disabled = false;
    if (!document.getElementById('editingHouseId').value) document.getElementById('submitHouse').textContent = tr('form.createHere', '在当前位置创建');
}

function readHouseImport(text) {
    ui.importDocument = null; ui.importError = true;
    try {
        if (new Blob([text]).size > 2*1024*1024-4096) throw new Error(tr('message.fileTooLarge', '文件不能超过 2 MiB。'));
        const data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
        if (!data || data.format !== 'yx_shellcreator.house' || data.version !== 1 || data.coordinateMode !== 'relative'
            || !data.house || !Array.isArray(data.objects)) throw new Error(tr('message.unsupportedFile', '不是支持的房屋数据文件（版本 1）。'));
        if (data.objects.length > (ui.config.maxObjectsPerHouse || 800)) throw new Error(tr('message.objectLimit', '文件物件数量超过本服上限。'));
        const preset = presetById(data.house.presetId);
        if (!preset || preset.type !== data.house.presetType) throw new Error(tr('message.templateMismatch', '本服没有对应室内模板，或模板类型不同。'));
        ui.importDocument = data; ui.importError = false;
        presetSelect.value = preset.id; presetSelect.disabled = true;
        document.getElementById('shellModel').value = data.house.shellModel || '';
        document.getElementById('shellModel').disabled = true;
        if (!document.getElementById('houseLabel').value) document.getElementById('houseLabel').value = String(data.house.label || tr('form.importedHouse', '导入房屋')).slice(0,80);
        if (!document.getElementById('houseSlug').value) document.getElementById('houseSlug').value = `import_${Date.now().toString(36)}`;
        updatePresetHelp();
        document.getElementById('submitHouse').textContent = tr('form.importCreate', '导入并创建新房屋');
        document.getElementById('houseImportSummary').textContent = `${data.objects.length} ${tr('catalog.items', '个物件')} · ${presetLabel(preset)}。${preset.type === 'world'
            ? tr('form.importSummaryWorld', '保留原地图室内坐标；新入口为人物当前位置。') : tr('form.importSummaryRelative', '按本服模板原点还原布局；新入口为人物当前位置。')} ${tr('form.modelsSeparate', '模型资源需另行安装。')}`;
    } catch (error) {
        const message = error instanceof SyntaxError ? tr('message.jsonInvalid', 'JSON 格式有误，请检查引号、逗号和括号是否完整。') : localizeServerMessage(error.message);
        document.getElementById('houseImportSummary').textContent = trf('message.importNotReady', `导入未就绪：${message}`, { message });
        toast(message, 'error');
    }
}

document.getElementById('chooseHouseImport').addEventListener('click', () => document.getElementById('houseImportFile').click());
document.getElementById('clearHouseImport').addEventListener('click', clearHouseImport);
document.getElementById('parseHouseImport').addEventListener('click', () => { importReadToken++; readHouseImport(document.getElementById('houseImportText').value); });
document.getElementById('houseImportFile').addEventListener('change', async event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const token = ++importReadToken;
    ui.importDocument = null; ui.importError = true;
    document.getElementById('houseImportSummary').textContent = tr('message.readingFile', '正在读取文件，请稍候…');
    if (file.size > 2*1024*1024-4096) {
        const message = tr('message.fileTooLarge', '文件不能超过 2 MiB。');
        document.getElementById('houseImportSummary').textContent = trf('message.importNotReady', `导入未就绪：${message}`, { message });
        toast(message, 'error');
        return;
    }
    try { const text = await file.text(); if (token === importReadToken) readHouseImport(text); }
    catch { if (token === importReadToken) {
        const message = tr('message.readFailed', '文件读取失败，可改用粘贴 JSON。');
        document.getElementById('houseImportSummary').textContent = message;
        toast(message,'error');
    } }
});
document.getElementById('houseFixedTime').addEventListener('change', event => { document.getElementById('houseTime').disabled = !event.target.checked; });
document.getElementById('saveHouseEnvironment').addEventListener('click', async event => {
    const fixed = document.getElementById('houseFixedTime').checked;
    const time = document.getElementById('houseTime').value;
    if (fixed && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { toast(tr('message.timeInvalid', '请填写 00:00 至 23:59 的时间。'),'error'); return; }
    event.target.disabled = true;
    const [hour,minute] = time.split(':').map(Number);
    const result = await post('setEnvironment', { environment: { weather: document.getElementById('houseWeather').value,
        hour: fixed ? hour : null, minute: fixed ? minute : null } });
    if (!result.ok) event.target.disabled = false;
});
document.getElementById('exportHouseData').addEventListener('click', async event => {
    event.target.disabled = true;
    const result = await post('exportHouse');
    if (!result.ok) event.target.disabled = false;
});
function closeExport() { document.getElementById('houseExportPanel').classList.add('hidden'); document.getElementById('exportHouseData').focus(); }
document.getElementById('closeHouseExport').addEventListener('click', closeExport);
document.getElementById('copyHouseExport').addEventListener('click', async () => {
    const field = document.getElementById('houseExportText');
    try { await navigator.clipboard.writeText(field.value); toast(tr('message.jsonCopied', '完整 JSON 已复制。'),'success'); }
    catch { field.focus(); field.select(); toast(document.execCommand('copy') ? tr('message.jsonCopied', '完整 JSON 已复制。') : tr('message.copyFallback', '已选中全部数据，请按 Ctrl+C。')); }
});
document.getElementById('downloadHouseExport').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([document.getElementById('houseExportText').value], {type:'application/json;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = ui.exportFilename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url),30000);
    toast(tr('message.downloadFallback', '若客户端未出现下载，请从服务器 exports 目录取文件或复制 JSON。'));
});

// FiveM can retain the previous NUI document while a resource restarts.
// Always begin fully hidden; only an explicit client "open" message may reveal it.
app.classList.add('hidden');

