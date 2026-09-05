'use strict';

(function (root) {
    const english = {
        'language.switchToChinese': '中文',
        'language.switchToEnglish': 'EN',
        'manager.aria': 'House management',
        'manager.title': 'Houses',
        'unit.houses': 'houses',
        'button.refresh': 'Refresh',
        'button.decorateCurrent': 'Edit current house',
        'button.leaveHouse': 'Leave house',
        'button.newHouse': 'New house',
        'button.enter': 'Enter',
        'button.edit': 'Edit',
        'button.delete': 'Delete',
        'button.closeHouseManager': 'Close house management',
        'list.aria': 'Property directory',
        'search.houses.aria': 'Search houses',
        'search.houses.placeholder': 'Search name, ID or template',
        'list.nameId': 'Name / ID',
        'list.template': 'Interior template',
        'list.actions': 'Actions',
        'form.aria': 'House configuration',
        'form.createTitle': 'Create house',
        'form.editTitle': 'Edit house',
        'form.collapse': 'Collapse house configuration',
        'form.intro': 'The new entrance uses your position when submitted.',
        'form.name': 'Name',
        'form.namePlaceholder': 'Example: Lakeside apartment',
        'form.slug': 'House ID',
        'form.slugHint': '2–50 lowercase letters, numbers, _ or -',
        'form.slugPlaceholder': 'Example: lake_01',
        'form.template': 'Interior template',
        'form.shellModel': 'Shell model name',
        'form.shellModelPlaceholder': 'Installed model name',
        'form.importLayout': 'Import layout from file',
        'form.chooseFile': 'Choose data file',
        'form.cancelImport': 'Cancel import',
        'form.pasteJson': 'Paste JSON',
        'form.importJson.aria': 'House import JSON',
        'form.importJson.placeholder': 'Paste complete JSON, max about 2 MiB',
        'form.readJson': 'Read pasted data',
        'form.moveEntrance': 'Move the default entrance to your position',
        'form.cancelEdit': 'Cancel edit',
        'form.accessTitle': 'Additional entrances',
        'form.accessHelp': 'Add an entrance outside the house, then set its interior position after entering. Door models and teleport points are independent.',
        'form.accessName': 'Entrance name',
        'form.accessNamePlaceholder': 'Example: Back door / Terrace',
        'form.addAccess': 'Add entrance at my position',
        'footer.managerClose': 'Close',
        'footer.teleport': 'Press',
        'footer.teleportTail': 'at an entrance marker to teleport; walk into physical doors to push them open.',
        'builder.aria': 'House editor',
        'builder.title': 'Build',
        'builder.defaultName': 'Interior build',
        'button.undo': 'Undo',
        'button.redo': 'Redo',
        'button.undoTitle': 'Undo Ctrl+Z',
        'button.redoTitle': 'Redo Ctrl+Y',
        'button.enterScene': 'Enter scene / F2',
        'builder.releaseEmpty': 'Enter angled build / F2',
        'builder.releaseFree': 'Enter free camera / F2',
        'button.leaveBuilder': 'Leave house',
        'button.finish': 'Done',
        'catalog.aria': 'Object catalog',
        'catalog.title': 'Object catalog',
        'catalog.search.aria': 'Search objects',
        'catalog.search.placeholder': 'Search furniture, doors, stairs…',
        'catalog.category': 'Category',
        'catalog.ariaCategory': 'Object categories',
        'catalog.emptyBuilder': 'Grid build · walls, doors and floors snap automatically',
        'catalog.ariaPage': 'Object catalog pagination',
        'catalog.previous': 'Previous',
        'catalog.next': 'Next',
        'catalog.customModel': 'Add by model name',
        'catalog.customModel.aria': 'Custom model name',
        'catalog.customModel.placeholder': 'Enter GTA model name',
        'catalog.add': 'Add',
        'inspector.aria': 'Properties panel',
        'inspector.tabs.aria': 'Editor settings',
        'inspector.objects': 'Objects',
        'inspector.house': 'House settings',
        'selection.title': 'Select an object',
        'selection.help': 'Click an object in the scene, or add one from the left panel.',
        'selection.default': 'Object',
        'selection.identity': 'Model and ID',
        'door.title': 'Swing door',
        'door.contact': 'Contact push-open',
        'door.help': 'After building, walk into the door leaf to push it open. Doors do not trigger teleportation.',
        'door.preview': 'Test door',
        'door.previewEnd': 'End test',
        'door.previewStatus': 'Preview · not saved',
        'door.hold': 'Keep open (after leaving build mode)',
        'rotation.title': 'Rotation',
        'object.ground': 'Place on ground',
        'object.duplicate': 'Duplicate',
        'object.save': 'Save now',
        'object.delete': 'Delete',
        'guide.title': 'Scene controls',
        'guide.move': 'Move',
        'guide.rotate': 'Rotate',
        'guide.delete': 'Delete',
        'guide.fly': 'Fly',
        'guide.elevate': 'Elevate',
        'guide.help': 'Drag the 3D axis with the left mouse button; hold the right mouse button to look around.',
        'object.browser': 'Placed objects',
        'object.native': 'Native',
        'object.doorLeaf': 'Door leaf',
        'object.restore': 'Restore',
        'object.empty': 'No placed objects',
        'environment.title': 'Weather and time',
        'environment.help': 'Only affects players inside the current house.',
        'environment.weather': 'Weather',
        'environment.inherit': 'Follow server',
        'environment.extrasunny': 'Extra sunny',
        'environment.clear': 'Clear',
        'environment.clouds': 'Clouds',
        'environment.overcast': 'Overcast',
        'environment.smog': 'Smog',
        'environment.foggy': 'Foggy',
        'environment.rain': 'Rain',
        'environment.thunder': 'Thunder',
        'environment.clearing': 'Clearing',
        'environment.neutral': 'Neutral',
        'environment.snow': 'Snow',
        'environment.snowlight': 'Light snow',
        'environment.blizzard': 'Blizzard',
        'environment.xmas': 'Christmas snow',
        'environment.halloween': 'Halloween',
        'environment.fixedTime': 'Fixed time',
        'environment.fixedTime.aria': 'Fixed house time',
        'environment.save': 'Save environment',
        'access.title': 'Entrances',
        'access.help': 'Free camera: use the point 1 meter below the camera; angled top-down view: use the ground point 1 meter above screen center. Add outside entrances in the F6 house configuration.',
        'access.spawn': 'Set as spawn point',
        'access.exit': 'Set as default exit',
        'backup.title': 'Backup and migration',
        'backup.help': 'Exports furniture, points, entrances and environment; model files are not included.',
        'backup.export': 'Export house JSON',
        'builder.footer': 'Object changes save automatically',
        'hint.empty': 'Angled top-down build · WASD pan · E/Q or wheel zoom · hold right mouse to rotate · F2 return to panel',
        'hint.free': 'Free camera · left-click to select/drag axes · hold right mouse to look around · F2 return to panel',
        'hint.place': 'Left click',
        'hint.leftClick': 'Left click',
        'hint.placeTail': 'place',
        'hint.cancel': 'cancel',
        'hint.panel': 'return to panel',
        'hint.rotation': 'Rotation',
        'hint.step': 'Step',
        'export.title': 'House data exported',
        'export.close': 'Close export panel',
        'export.help': 'Copy as a UTF-8 .json file. If the game does not support downloads, retrieve the file from the server.',
        'export.aria': 'Exported house JSON',
        'export.copy': 'Copy JSON',
        'export.download': 'Download JSON',
        'type.floor': 'Floor',
        'type.wall': 'Wall',
        'type.door': 'Door',
        'type.stairs': 'Stairs',
        'type.railing': 'Railing',
        'type.construction': 'Building part',
        'category.all': 'All',
        'category.construction': 'Construction',
        'category.doors': 'Doors',
        'category.structures': 'Structures',
        'category.living-room': 'Living room',
        'category.bedroom': 'Bedroom',
        'category.kitchen': 'Kitchen',
        'category.bathroom': 'Bathroom',
        'category.garden': 'Garden',
        'preset.current_location.label': 'Current location native-map property',
        'preset.current_location.description': 'Use the player position at submission as an independent property on the original GTA map; no shell is generated.',
        'preset.low_apartment.label': 'Low-end apartment',
        'preset.low_apartment.description': 'Native GTA V small apartment; no extra map resource is required.',
        'preset.motel_room.label': 'Motel room',
        'preset.motel_room.description': 'Native GTA V motel room; no extra map resource is required.',
        'preset.mid_apartment.label': 'Mid-range apartment',
        'preset.mid_apartment.description': 'Native GTA V mid-range apartment; no extra map resource is required.',
        'preset.high_apartment.label': 'High-end apartment',
        'preset.high_apartment.description': 'Native GTA V high-end apartment; no extra map resource is required.',
        'preset.executive_apartment_1.label': 'Executive apartment A · Modern',
        'preset.executive_apartment_1.description': 'Native GTA V executive apartment one with a modern style; add objects and take over native furniture that can be targeted independently.',
        'preset.executive_apartment_2.label': 'Executive apartment B · Dark',
        'preset.executive_apartment_2.description': 'Native GTA V executive apartment two with a dark style; no third-party shell resource is required.',
        'preset.executive_apartment_3.label': 'Executive apartment C · Clean',
        'preset.executive_apartment_3.description': 'Native GTA V executive apartment three with a clean style; no third-party shell resource is required.',
        'preset.empty_builder.label': 'Empty build space',
        'preset.empty_builder.description': 'Creates a foundation platform and uses an angled top-down grid to place floors, walls and doors.',
        'preset.custom_shell.label': 'Custom shell model',
        'preset.custom_shell.description': 'Enter a shell model streamed by another resource; this resource does not force a dependency on it.',
        'item.yx_floor_oak': 'Oak plank floor 2.5m',
        'item.yx_floor_tile': 'Light tile floor 2.5m',
        'item.yx_wall_white': 'White interior solid wall 2.5m',
        'item.yx_wall_doorway': 'White doorway wall 2.5m',
        'item.yx_floor_concrete': 'Fair-face concrete floor 2.5m',
        'item.yx_floor_darkwood': 'Dark wood plank floor 2.5m',
        'item.yx_wall_concrete': 'Fair-face concrete solid wall 2.5m',
        'item.yx_wall_charcoal': 'Dark gray modern solid wall 2.5m',
        'item.yx_wall_doorway_concrete': 'Concrete doorway wall 2.5m',
        'item.yx_door_wood': 'Oak interior door',
        'item.yx_door_modern': 'Dark modern interior door',
        'item.yx_stairs_oak': 'Oak straight stairs · 3m rise / 5m run',
        'item.yx_stairs_concrete': 'Concrete straight stairs · 3m rise / 5m run',
        'item.yx_spiral_oak': 'Built-in oak spiral stairs · 3m rise / 3.8m diameter',
        'item.yx_spiral_concrete': 'Built-in concrete spiral stairs · 3m rise / 3.8m diameter',
        'item.h4_int_club_spiral_stairs': 'Native nightclub large spiral stairs · matching interior required',
        'item.h4_int_club_small_stairs_spiral': 'Native nightclub compact spiral stairs · matching interior required',
        'item.vb_ca_spiralstairs': 'Native large metal spiral stairs · matching map resource required',
        'catalog.items': 'items',
        'catalog.noThumbnail': 'No thumbnail',
        'catalog.pushDoor': 'Push-open door leaf',
        'catalog.doorway': 'Doorway · add a door leaf',
        'catalog.noRegistration': 'Model is not registered on this client',
        'catalog.unavailable': 'Unavailable on this client',
        'catalog.noMatch': 'No matching models',
        'catalog.trySearch': 'Try another category or search term.',
        'manager.active': 'Current',
        'manager.entrances': 'entrances',
        'manager.noMatch': 'No matching houses',
        'manager.none': 'No houses yet',
        'manager.trySearch': 'Try another keyword.',
        'manager.createHint': 'Stand at the entrance location and click “New house” in the top right.',
        'access.indoor': 'Interior',
        'access.outside': 'Outside',
        'access.setIndoor': 'Set interior position here',
        'access.setOutside': 'Move outside entrance here',
        'access.delete': 'Delete',
        'access.none': 'No additional entrances; the default entrance is unchanged.',
        'source.native': 'Native interior object · deleting hides it; restore it from the list',
        'source.door': 'Door leaf · not linked to a teleport point',
        'source.object': 'Drag the 3D axes in the scene to adjust position',
        'form.emptyTemplate': 'If no file is selected, an empty house is created from the selected template.',
        'form.createHere': 'Create at current position',
        'form.saveChanges': 'Save changes',
        'form.importCreate': 'Import and create new house',
        'form.importSummaryWorld': 'Keep original world interior coordinates; the new entrance uses your position.',
        'form.importSummaryRelative': 'Restore the layout from the server template origin; the new entrance uses your position.',
        'form.modelsSeparate': 'Model resources must be installed separately.',
        'message.accessFailed': 'Failed to submit entrance.',
        'message.doorFailed': 'Failed to submit door state.',
        'message.enterAccessName': 'Enter an entrance name first.',
        'message.confirmAccess': 'This will delete the entrance, but not the door model.',
        'message.confirmAgain': 'Click delete again within 4 seconds to confirm.',
        'message.confirmObject': 'This will delete object {model}.',
        'message.confirmHouse': 'This will delete “{label}” and all of its building objects.',
        'message.importInvalid': 'Read a valid file again, or click cancel import.',
        'message.submitFailed': 'Submission failed. Check the data and try again.',
        'message.fileTooLarge': 'The file cannot exceed 2 MiB.',
        'message.unsupportedFile': 'Unsupported house data file (version 1).',
        'message.objectLimit': 'The file exceeds this server’s object limit.',
        'message.templateMismatch': 'The matching interior template is not available, or its type differs.',
        'message.jsonInvalid': 'Invalid JSON. Check that quotes, commas and brackets are complete.',
        'message.importNotReady': 'Import not ready: {message}',
        'message.readingFile': 'Reading file, please wait…',
        'message.readFailed': 'File read failed; you can paste the JSON instead.',
        'message.timeInvalid': 'Enter a time from 00:00 to 23:59.',
        'message.jsonCopied': 'Complete JSON copied.',
        'message.copyFallback': 'All data selected. Press Ctrl+C.',
        'message.downloadFallback': 'If the download does not appear in the client, retrieve it from the server exports folder or copy the JSON.',
        'export.serverPath': 'Server resource directory: yx_shellcreator/{filename}',
        'export.serverFailed': 'The server could not save the file. Copy the JSON and save it yourself.',
        'form.importedHouse': 'Imported house'
    };

    // The server resource config is the source of truth. Chinese is the safe
    // fallback until the first state packet provides config.language.
    let locale = 'zh';

    function t(key, fallback = '') {
        return locale === 'en' && Object.prototype.hasOwnProperty.call(english, key) ? english[key] : fallback;
    }

    function interpolate(key, fallback, values = {}) {
        return String(t(key, fallback)).replace(/\{(\w+)\}/g, (_, name) => values[name] == null ? '' : values[name]);
    }

    function rememberDefault(element, property) {
        const attribute = `data-i18n-${property}-default`;
        const current = property === 'text' ? element.textContent : property === 'aria' ? element.getAttribute('aria-label') : element[property];
        if (!element.hasAttribute(attribute)) element.setAttribute(attribute, current || '');
        return element.getAttribute(attribute) || '';
    }

    function applyStaticTranslations() {
        document.querySelectorAll('[data-i18n]').forEach((element) => {
            const fallback = rememberDefault(element, 'text');
            element.textContent = t(element.dataset.i18n, fallback);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
            const fallback = rememberDefault(element, 'placeholder');
            element.placeholder = t(element.dataset.i18nPlaceholder, fallback);
        });
        document.querySelectorAll('[data-i18n-aria]').forEach((element) => {
            const fallback = rememberDefault(element, 'aria');
            element.setAttribute('aria-label', t(element.dataset.i18nAria, fallback));
        });
        document.querySelectorAll('[data-i18n-title]').forEach((element) => {
            const fallback = rememberDefault(element, 'title');
            element.title = t(element.dataset.i18nTitle, fallback);
        });
        const languageToggle = document.getElementById('languageToggle');
        if (languageToggle) {
            languageToggle.textContent = t('language.switchToChinese', 'EN');
            languageToggle.setAttribute('aria-label', locale === 'en' ? '切换到中文' : 'Switch to English');
            languageToggle.title = locale === 'en' ? '切换到中文' : 'Switch to English';
        }
        document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
    }

    function configure(next) {
        locale = next === 'en' ? 'en' : 'zh';
        applyStaticTranslations();
    }

    function set(next) {
        configure(next);
        window.dispatchEvent(new Event('yx-locale-change'));
    }

    root.YXLocale = {
        get: () => locale,
        isEnglish: () => locale === 'en',
        t,
        interpolate,
        configure,
        set,
        apply: applyStaticTranslations
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyStaticTranslations, { once: true });
    else applyStaticTranslations();
})(window);

