(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.YXCatalog = api;
})(globalThis, function () {
    'use strict';
    function merge(...documents) {
        const items = [], categories = [], ids = new Set(), models = new Set(), categoryIds = new Set();
        for (const document of documents) {
            for (const category of document.categories || []) {
                if (categoryIds.has(category.id)) continue;
                categoryIds.add(category.id);
                categories.push({ ...category });
            }
            for (const item of document.items || []) {
                const model = String(item.model || '').toLowerCase();
                if (!/^[a-z0-9_]{1,100}$/.test(model) || !item.id || ids.has(item.id) || models.has(model)) continue;
                ids.add(item.id); models.add(model);
                items.push({ source: 'base', sourceLabel: '现有目录', ...item, model });
            }
        }
        return { categories, items };
    }

    function query(catalog, options = {}) {
        const labels = new Map((catalog.categories || []).map(c => [c.id, c.label]));
        const words = String(options.search || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        const filtered = (catalog.items || []).filter(item => {
            if (item.hiddenFromCatalog) return false;
            if (options.category === 'doors' ? !item.door : options.category && options.category !== 'all' && item.category !== options.category) return false;
            if (options.source && options.source !== 'all' && item.source !== options.source) return false;
            const text = `${item.model} ${item.label || ''} ${labels.get(item.category) || ''} ${item.searchTags || ''} ${item.sourceLabel || ''}`.toLowerCase();
            return words.every(word => text.includes(word));
        });
        if (options.emptyBuilder) {
            const order = { floor: 0, wall: 1, door: 2, stairs: 3, railing: 4 };
            filtered.sort((a, b) => (order[a.buildType] ?? 9) - (order[b.buildType] ?? 9));
        }
        const pageSize = Math.max(1, Math.min(100, Math.trunc(Number(options.pageSize)) || 40));
        const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
        const page = Math.max(1, Math.min(pages, Math.trunc(Number(options.page)) || 1));
        return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, pages, page, pageSize };
    }
    return { merge, query };
});
