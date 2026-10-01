import translations from './translations.js';

const ID = 'daggerheart-cyberpunk-ru';
const EXPECTED_SYSTEM = '1.9.14';
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function supported() {
    return game.system.id === 'daggerheart' && game.system.version === EXPECTED_SYSTEM
        && Number(game.release.generation) === 13;
}

function applyLabels() {
    if (!supported()) return;
    // This changes only displayed text. Data paths, fields and sheet handlers remain original.
    const nested = foundry.utils.expandObject(translations);
    foundry.utils.mergeObject(game.i18n.translations, nested, { inplace: true, overwrite: true });
}

async function checkContent() {
    const result = { compatible: supported(), documents: 0, packs: 0, failures: [] };
    const module = game.modules.get(ID);
    for (const metadata of module.packs) {
        const collection = `${ID}.${metadata.name}`;
        const pack = game.packs.get(collection);
        if (!pack) { result.failures.push(`Нет библиотеки: ${metadata.label}`); continue; }
        result.packs++;
        try {
            const documents = await pack.getDocuments();
            result.documents += documents.length;
            for (const doc of documents) {
                if (doc.invalid) result.failures.push(`Некорректный документ: ${doc.name}`);
                // Only actual module references; provenance flags point back to the original system.
                const text = JSON.stringify(doc.toObject());
                const references = new Set(text.match(/Compendium\.daggerheart-cyberpunk-ru\.[A-Za-z0-9-]+\.(?:Item|Actor)\.[A-Za-z0-9]+(?:\.(?:Item|ActiveEffect)\.[A-Za-z0-9]+)*/g) ?? []);
                for (const uuid of references) {
                    if (!await fromUuid(uuid)) result.failures.push(`${doc.name}: не найдена связь ${uuid}`);
                }
            }
        } catch (error) {
            result.failures.push(`${metadata.label}: ${error.message}`);
        }
    }
    if (result.documents !== 305) result.failures.push(`Ожидалось 305 документов, найдено ${result.documents}.`);
    console.info(`${ID} | Проверка загрузки`, result);
    return result;
}

class CyberpunkGuide extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'cyberpunk-guide',
        window: { title: 'Киберпанк — четыре класса' },
        position: { width: 650, height: 'auto' },
        actions: { check: CyberpunkGuide.check }
    };
    static PARTS = { body: { template: `modules/${ID}/templates/guide.hbs` } };
    static async check(event, target) {
        target.disabled = true;
        const status = this.element.querySelector('[data-check-status]');
        status.textContent = 'Проверяю загрузку карточек и связи…';
        try {
            const r = await checkContent();
            status.textContent = !r.compatible ? 'Нужны Foundry 13 и Daggerheart 1.9.14.'
                : r.failures.length ? `Найдены проблемы: ${r.failures.join('; ')}`
                : `Загружены ${r.documents} документов из ${r.packs} библиотек. Ссылки доступны. Теперь проверьте игровые действия по инструкции.`;
        } catch (error) { status.textContent = `Проверка не завершена: ${error.message}`; }
        finally { target.disabled = false; }
    }
}

Hooks.once('init', () => {
    game.modules.get(ID).api = Object.freeze({ checkContent });
    game.settings.registerMenu(ID, 'guide', {
        name: 'Киберпанк: инструкция и проверка',
        label: 'Открыть инструкцию',
        hint: 'Четыре класса, создание персонажа и проверка ссылок.',
        icon: 'fas fa-microchip', type: CyberpunkGuide, restricted: true
    });
});
Hooks.once('i18nInit', applyLabels);
Hooks.once('ready', () => {
    if (!supported()) {
        if (game.user.isGM) ui.notifications.error('Киберпанк: эта сборка рассчитана на Foundry 13 и Daggerheart 1.9.14. Переименование интерфейса отключено.');
        return;
    }
    applyLabels();
});
