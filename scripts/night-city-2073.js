const MODULE_ID = "daggerheart-night-city-2073-fv13";
const FLAG_SCOPE = MODULE_ID;

const TRAITS = {
  agility: { label: "Рефлексы", className: "" },
  strength: { label: "Телосложение", className: "" },
  instinct: { label: "Восприятие", className: "" },
  presence: { label: "Крутость", className: "" },
  knowledge: { label: "Интеллект", className: "" },
  finesse: { label: "Удача", className: "nc2073-panel__trait--luck" }
};

const CAPACITY_BY_LEVEL = Object.freeze({
  1: 6,
  2: 6,
  3: 7,
  4: 7,
  5: 8,
  6: 8,
  7: 9,
  8: 9,
  9: 10,
  10: 10
});

function selectedActor() {
  return canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? null;
}

function htmlElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function actorFromApplication(app) {
  const candidate = app?.actor ?? app?.document ?? app?.object;
  if (candidate?.documentName === "Actor") return candidate;
  return candidate?.actor?.documentName === "Actor" ? candidate.actor : null;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function currentLevel(actor) {
  return clamp(actor?.system?.levelData?.level?.current ?? 1, 1, 10);
}

function baseCyberpsychosisCapacity(actor) {
  return CAPACITY_BY_LEVEL[currentLevel(actor)] ?? 6;
}

function isNightCityItem(item, kind) {
  return item?.getFlag?.(FLAG_SCOPE, "kind") === kind;
}

function installedImplants(actor) {
  return actor.items.filter(
    item => isNightCityItem(item, "implant") && item.getFlag(FLAG_SCOPE, "equipped") === true
  );
}

function cyberpsychosisCapacity(actor) {
  return Math.max(1, baseCyberpsychosisCapacity(actor) - installedImplants(actor).length);
}

function stressAdvancementBonus(actor) {
  const levelups =
    actor?._source?.system?.levelData?.levelups ??
    actor?.toObject?.()?.system?.levelData?.levelups ??
    {};
  let bonus = 0;
  for (const level of Object.values(levelups)) {
    for (const selection of level?.selections ?? []) {
      if (selection?.type === "stress") bonus += Number(selection.value) || 0;
    }
  }
  return bonus;
}

async function recalculateCyberpsychosis(actor, { render = true } = {}) {
  if (!actor || actor.type !== "character") return;
  const capacity = cyberpsychosisCapacity(actor);
  const storedMax = Math.max(0, capacity - stressAdvancementBonus(actor));
  const sourceMax = actor?._source?.system?.resources?.stress?.max;
  if (sourceMax === storedMax) return capacity;
  await actor.update(
    { "system.resources.stress.max": storedMax },
    { nc2073Sync: true, render }
  );
  return capacity;
}

function resourceData(actor, key, fallbackMax = 0) {
  const resource = actor?.system?.resources?.[key] ?? {};
  return {
    value: Number(resource.value) || 0,
    max: Number.isFinite(Number(resource.max)) ? Number(resource.max) : fallbackMax
  };
}

async function changeResource(actor, key, delta) {
  if (!actor?.isOwner) return;
  const resource = resourceData(actor, key);
  const next = clamp(resource.value + Number(delta), 0, Math.max(0, resource.max));
  await actor.update({ [`system.resources.${key}.value`]: next });
}

function subdermalArmor(actor) {
  return installedImplants(actor).some(
    item => item.getFlag(FLAG_SCOPE, "slug") === "subdermal-armor"
  );
}

function armorData(actor) {
  const native = resourceData(actor, "armor");
  const bonusMax = subdermalArmor(actor) ? 2 : 0;
  const bonusUsed = clamp(actor.getFlag(FLAG_SCOPE, "subdermalArmorUsed") ?? 0, 0, bonusMax);
  return {
    native,
    bonusMax,
    bonusUsed,
    value: native.value + bonusUsed,
    max: native.max + bonusMax
  };
}

async function changeArmor(actor, delta) {
  if (!actor?.isOwner) return;
  const data = armorData(actor);
  if (delta > 0) {
    if (data.native.value < data.native.max && actor.modifyResource) {
      await actor.modifyResource([{ key: "armor", value: 1 }]);
      return;
    }
    if (data.bonusUsed < data.bonusMax) {
      await actor.setFlag(FLAG_SCOPE, "subdermalArmorUsed", data.bonusUsed + 1);
    }
    return;
  }

  if (data.bonusUsed > 0) {
    await actor.setFlag(FLAG_SCOPE, "subdermalArmorUsed", data.bonusUsed - 1);
    return;
  }
  if (data.native.value > 0 && actor.modifyResource) {
    await actor.modifyResource([{ key: "armor", value: -1 }]);
  }
}

function fearData() {
  try {
    const settings = CONFIG?.DH?.SETTINGS?.gameSettings;
    const key = settings?.Resources?.Fear;
    const homebrewKey = settings?.Homebrew;
    const value = key ? game.settings.get("daggerheart", key) : 0;
    const max = homebrewKey
      ? game.settings.get("daggerheart", homebrewKey)?.maxFear ?? 12
      : 12;
    return { value: Number(value) || 0, max: Number(max) || 12, key };
  } catch (error) {
    console.warn(`${MODULE_ID} | Не удалось прочитать ресурс Страха`, error);
    return { value: 0, max: 12, key: null };
  }
}

async function changeFear(delta) {
  if (!game.user?.isGM) return;
  const fear = fearData();
  if (!fear.key) return;
  await game.settings.set(
    "daggerheart",
    fear.key,
    clamp(fear.value + Number(delta), 0, fear.max)
  );
}

async function rollTrait(actor, trait) {
  actor ??= selectedActor();
  if (!actor) return ui.notifications.warn("Выберите токен или назначьте персонажа.");
  if (actor.rollTrait) return actor.rollTrait(trait);

  if (actor.diceRoll) {
    const traitLabel = TRAITS[trait]?.label ?? trait;
    const actionApi = game.system?.api?.data?.actions?.actionsTypes?.base;
    const config = {
      title: `Проверка: ${traitLabel}`,
      headerTitle: `Проверка дуальности: ${actor.name}`,
      effects: actionApi?.getEffects ? await actionApi.getEffects(actor) : [],
      roll: {
        trait,
        type: "trait"
      },
      hasRoll: true,
      actionType: "action"
    };
    const result = await actor.diceRoll(config);
    await result?.resourceUpdates?.updateResources?.();
    return result;
  }

  const modifier = Number(actor.system?.traits?.[trait]?.value) || 0;
  const roll = await new Roll(`1d12 + 1d12 + ${modifier}`).evaluate();
  return roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${TRAITS[trait]?.label ?? trait}: проверка дуальности`
  });
}

async function rollLuck(actor) {
  return rollTrait(actor, "finesse");
}

async function rollWeapon(actor, item) {
  actor ??= selectedActor();
  if (!actor) return ui.notifications.warn("Выберите токен или назначьте персонажа.");
  item ??=
    actor.items.find(entry => isNightCityItem(entry, "weapon") && entry.system?.equipped) ??
    actor.items.find(
      entry =>
        entry.getFlag(FLAG_SCOPE, "integratedWeapon") === true &&
        entry.getFlag(FLAG_SCOPE, "equipped") === true
    );
  if (!item) return ui.notifications.warn("На персонаже нет выбранного оружия Night City 2073.");
  if (item.parent?.id !== actor.id) {
    item = actor.items.get(item.id) ?? item;
  }
  if (
    item.getFlag(FLAG_SCOPE, "integratedWeapon") === true &&
    item.getFlag(FLAG_SCOPE, "equipped") !== true
  ) {
    return ui.notifications.warn(`${item.name} сначала нужно установить как имплант.`);
  }

  const formula = item.getFlag(FLAG_SCOPE, "damageFormula");
  ui.notifications.info(`${item.name}: урон ${formula}, пороги определяет цель.`);
  if (item.use) return item.use();

  const action = item.system?.actionsList?.[0] ?? item.system?.attack;
  if (action?.use) return action.use();
  return rollWeaponDamage(actor, item);
}

async function rollWeaponDamage(actor, item) {
  actor ??= selectedActor();
  if (!actor) return ui.notifications.warn("Выберите токен или назначьте персонажа.");
  item ??= actor.items.find(entry => isNightCityItem(entry, "weapon"));
  if (!item) return ui.notifications.warn("На персонаже нет оружия Night City 2073.");
  const formula = item.getFlag(FLAG_SCOPE, "damageFormula") ?? "@profd6";
  const data = actor.getRollData?.() ?? actor.system ?? {};
  const roll = await new Roll(formula, data).evaluate();
  return roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${item.name} — урон ${formula}`
  });
}

async function toggleImplant(actor, item, equipped) {
  if (!actor?.isOwner || !item || !isNightCityItem(item, "implant")) return;
  if (equipped) {
    const base = baseCyberpsychosisCapacity(actor);
    const installed = installedImplants(actor);
    const alreadyInstalled = installed.some(entry => entry.id === item.id);
    const nextCount = installed.length + (alreadyInstalled ? 0 : 1);
    const nextCapacity = base - nextCount;
    const marked = resourceData(actor, "stress", cyberpsychosisCapacity(actor)).value;
    if (nextCapacity < 1) {
      ui.notifications.warn(
        `Нельзя установить ${item.name}: должна остаться хотя бы 1 ячейка Киберпсихоза.`
      );
      return false;
    }
    if (marked > nextCapacity) {
      ui.notifications.warn(
        `Нельзя установить ${item.name}: отмечено ${marked} яч. Киберпсихоза, а новый максимум будет ${nextCapacity}.`
      );
      return false;
    }
  }

  await item.setFlag(FLAG_SCOPE, "equipped", Boolean(equipped));
  if (!equipped && item.getFlag(FLAG_SCOPE, "slug") === "subdermal-armor") {
    await actor.setFlag(FLAG_SCOPE, "subdermalArmorUsed", 0);
  }
  await recalculateCyberpsychosis(actor);
  return true;
}

function resourceControl(actor, key, label, data, hint, editable) {
  return `
    <div class="nc2073-panel__resource">
      <button type="button" class="nc2073-panel__step" data-nc-action="resource"
        data-resource="${key}" data-delta="-1" ${editable ? "" : "disabled"}>−</button>
      <div>
        <span class="nc2073-panel__resource-name">${escapeHtml(label)}</span>
        <div class="nc2073-panel__resource-value">${data.value}/${data.max}</div>
        ${hint ? `<span class="nc2073-panel__resource-hint">${escapeHtml(hint)}</span>` : ""}
      </div>
      <button type="button" class="nc2073-panel__step" data-nc-action="resource"
        data-resource="${key}" data-delta="1" ${editable ? "" : "disabled"}>+</button>
    </div>
  `;
}

function buildPanel(actor) {
  const editable = actor.isOwner;
  const wounds = resourceData(actor, "hitPoints");
  const drive = resourceData(actor, "hope", 6);
  const cp = resourceData(actor, "stress", cyberpsychosisCapacity(actor));
  cp.max = cyberpsychosisCapacity(actor);
  const armor = armorData(actor);
  const fear = fearData();
  const implants = actor.items.filter(item => isNightCityItem(item, "implant"));
  const weapons = actor.items.filter(
    item =>
      isNightCityItem(item, "weapon") ||
      item.getFlag(FLAG_SCOPE, "integratedWeapon") === true
  );
  const installed = installedImplants(actor).length;
  const baseCapacity = baseCyberpsychosisCapacity(actor);
  const cpWarning =
    cp.value >= cp.max
      ? `<div class="nc2073-panel__warning">Предел Киберпсихоза достигнут.</div>`
      : "";

  const traitButtons = Object.entries(TRAITS)
    .map(([key, trait]) => {
      const value = Number(actor.system?.traits?.[key]?.value) || 0;
      const prefix = value >= 0 ? "+" : "";
      return `
        <button type="button" class="nc2073-panel__trait ${trait.className}"
          data-nc-action="trait" data-trait="${key}">
          <span class="nc2073-panel__trait-name">${trait.label}</span>
          <span class="nc2073-panel__trait-value">${prefix}${value}</span>
        </button>
      `;
    })
    .join("");

  const weaponRows =
    weapons.length > 0
      ? weapons
          .map(item => {
            const formula = item.getFlag(FLAG_SCOPE, "damageFormula") ?? "—";
            const range = item.getFlag(FLAG_SCOPE, "rangeLabel") ?? "—";
            const integrated = item.getFlag(FLAG_SCOPE, "integratedWeapon") === true;
            const available = !integrated || item.getFlag(FLAG_SCOPE, "equipped") === true;
            return `
              <div class="nc2073-panel__item">
                <span class="nc2073-panel__item-name">
                  ${escapeHtml(item.name)}
                  <span class="nc2073-panel__item-meta">${escapeHtml(formula)} · ${escapeHtml(range)}${available ? "" : " · не установлен"}</span>
                </span>
                <button type="button" class="nc2073-panel__action"
                  data-nc-action="weapon" data-item-id="${item.id}" ${available ? "" : "disabled"}>Атака</button>
              </div>
            `;
          })
          .join("")
      : `<div class="nc2073-panel__item">Перетащите оружие из компендиума на персонажа.</div>`;

  const implantRows =
    implants.length > 0
      ? implants
          .map(item => {
            const zone = item.getFlag(FLAG_SCOPE, "zone") ?? "—";
            const checked = item.getFlag(FLAG_SCOPE, "equipped") === true;
            return `
              <label class="nc2073-panel__item">
                <span class="nc2073-panel__item-name">
                  ${escapeHtml(item.name)}
                  <span class="nc2073-panel__item-meta">${escapeHtml(zone)} · нагрузка 1</span>
                </span>
                <input class="nc2073-panel__toggle" type="checkbox"
                  data-nc-action="implant" data-item-id="${item.id}"
                  ${checked ? "checked" : ""} ${editable ? "" : "disabled"}>
              </label>
            `;
          })
          .join("")
      : `<div class="nc2073-panel__item">Перетащите импланты из компендиума на персонажа.</div>`;

  return `
    <section class="nc2073-panel" data-nc-actor-id="${actor.id}">
      <div class="nc2073-panel__header">
        <div>
          <div class="nc2073-panel__brand">Night City 2073</div>
          <div class="nc2073-panel__subhead">киберпанк-профиль персонажа</div>
        </div>
        <div class="nc2073-panel__status">
          Импланты: ${installed}/${Math.max(0, baseCapacity - 1)}<br>
          Киберпсихоз: база ${baseCapacity}, доступно ${cp.max}
        </div>
      </div>
      <div class="nc2073-panel__grid nc2073-panel__grid--traits">${traitButtons}</div>
      <div class="nc2073-panel__grid nc2073-panel__grid--resources">
        ${resourceControl(actor, "hitPoints", "Раны", wounds, "лёгкий 1 · ощутимый 2 · тяжёлый 3", editable)}
        ${resourceControl(actor, "hope", "Драйв", drive, "заменяет Надежду", editable)}
        ${resourceControl(actor, "stress", "Киберпсихоз", cp, `${installed} импл. занимают ${installed} яч.`, editable)}
        ${resourceControl(actor, "armor", "Броня", armor, armor.bonusMax ? "+2 подкожно" : "ячейки брони", editable)}
        ${resourceControl(actor, "fear", "Страх", fear, "ресурс Ведущего", game.user.isGM)}
      </div>
      ${cpWarning}
      <details>
        <summary>Оружие персонажа (${weapons.length})</summary>
        <div class="nc2073-panel__list">${weaponRows}</div>
      </details>
      <details>
        <summary>Импланты персонажа (${installed}/${implants.length})</summary>
        <div class="nc2073-panel__list">${implantRows}</div>
      </details>
    </section>
  `;
}

async function handlePanelClick(event, actor) {
  const control = event.target.closest("[data-nc-action]");
  if (!control) return;
  const action = control.dataset.ncAction;

  if (action === "trait") {
    await rollTrait(actor, control.dataset.trait);
    return;
  }

  if (action === "weapon") {
    await rollWeapon(actor, actor.items.get(control.dataset.itemId));
    return;
  }

  if (action === "resource") {
    const delta = Number(control.dataset.delta);
    const resource = control.dataset.resource;
    if (resource === "armor") await changeArmor(actor, delta);
    else if (resource === "fear") await changeFear(delta);
    else await changeResource(actor, resource, delta);
  }
}

async function handlePanelChange(event, actor) {
  const control = event.target.closest('[data-nc-action="implant"]');
  if (!control) return;
  const item = actor.items.get(control.dataset.itemId);
  const success = await toggleImplant(actor, item, control.checked);
  if (success === false) control.checked = false;
}

async function injectPanel(app, html) {
  if (!game.settings.get(MODULE_ID, "showCharacterPanel")) return;
  const actor = actorFromApplication(app);
  if (!actor || actor.type !== "character") return;
  const root = htmlElement(html);
  if (!root || root.querySelector(".nc2073-panel")) return;

  await recalculateCyberpsychosis(actor, { render: false });

  const host =
    root.querySelector(".window-content") ??
    root.querySelector("form") ??
    root;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = buildPanel(actor);
  const panel = wrapper.firstElementChild;
  host.prepend(panel);
  panel.addEventListener("click", event => handlePanelClick(event, actor));
  panel.addEventListener("change", event => handlePanelChange(event, actor));
}

async function openPanel(actor) {
  actor ??= selectedActor();
  if (!actor) return ui.notifications.warn("Выберите токен или назначьте персонажа.");
  await recalculateCyberpsychosis(actor);
  actor.sheet?.render?.(true);
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "showCharacterPanel", {
    name: "Показывать панель Night City 2073",
    hint: "Добавляет на лист персонажа характеристики, ресурсы, оружие и импланты адаптации.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
});

Hooks.once("ready", async () => {
  if (game.system.id !== "daggerheart") return;
  const api = {
    selectedActor,
    openPanel,
    rollTrait,
    rollLuck,
    rollWeapon,
    rollWeaponDamage,
    recalculateCyberpsychosis,
    baseCyberpsychosisCapacity,
    cyberpsychosisCapacity,
    installedImplants,
    toggleImplant
  };
  game.modules.get(MODULE_ID).api = api;
  globalThis.NightCity2073 = api;

  if (game.user.isGM) {
    for (const actor of game.actors.filter(entry => entry.type === "character")) {
      await recalculateCyberpsychosis(actor, { render: false });
    }
  }
  console.log(`${MODULE_ID} | Готово. API доступно как NightCity2073.`);
});

Hooks.on("renderActorSheet", injectPanel);
Hooks.on("renderActorSheetV2", injectPanel);
Hooks.on("renderApplicationV2", (app, html) => injectPanel(app, html));

Hooks.on("createItem", async item => {
  if (item.parent?.documentName === "Actor" && isNightCityItem(item, "implant")) {
    await recalculateCyberpsychosis(item.parent);
  }
});

Hooks.on("updateItem", async (item, changes) => {
  if (
    item.parent?.documentName === "Actor" &&
    isNightCityItem(item, "implant") &&
    foundry.utils.hasProperty(changes, `flags.${FLAG_SCOPE}.equipped`)
  ) {
    await recalculateCyberpsychosis(item.parent);
  }
});

Hooks.on("deleteItem", async item => {
  if (item.parent?.documentName === "Actor" && isNightCityItem(item, "implant")) {
    await recalculateCyberpsychosis(item.parent);
  }
});

Hooks.on("updateActor", async (actor, changes, options) => {
  if (options?.nc2073Sync || actor.type !== "character") return;
  if (foundry.utils.hasProperty(changes, "system.levelData.level.current")) {
    await recalculateCyberpsychosis(actor);
  }
});
