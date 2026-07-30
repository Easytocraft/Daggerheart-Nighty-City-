const MODULE_ID = "daggerheart-night-city-2073-fv13";
const FLAG_SCOPE = MODULE_ID;
const ITEM_PACK_ID = "nc2073-items";
const ACTIVE_TABS = new Map();
const INJECTION_SERIAL = new WeakMap();
const RESIZED_SHEETS = new WeakSet();

const TRAITS = {
  strength: { label: "Сила", className: "" },
  agility: { label: "Ловкость", className: "" },
  knowledge: { label: "Интеллект", className: "" },
  instinct: { label: "Инстинкт", className: "" },
  finesse: { label: "Влияние", className: "" },
  presence: { label: "Крутость", className: "" },
};

const LUCK_ROLL_MODE = Object.freeze({
  normal: { label: "обычная", formula: "1d20" },
  advantage: { label: "преимущество", formula: "2d20kh" },
  disadvantage: { label: "помеха", formula: "2d20kl" }
});

const TAB_DEFINITIONS = Object.freeze([
  { id: "properties", label: "Свойства", icon: "fa-list-check" },
  { id: "implants", label: "Импланты", icon: "fa-microchip" },
  { id: "inventory", label: "Инвентарь", icon: "fa-briefcase" },
  { id: "bio", label: "Биография", icon: "fa-id-card" },
  { id: "effects", label: "Эффекты", icon: "fa-wand-magic-sparkles" }
]);

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

const DAMAGE_THRESHOLDS_BY_CLASS = Object.freeze({
  juggernaut: { light: 7, moderate: 14, heavy: 21 },
  ghost: { light: 6, moderate: 12, heavy: 18 },
  netrunner: { light: 5, moderate: 10, heavy: 15 },
  rocker: { light: 5, moderate: 10, heavy: 15 }
});

const THRESHOLD_IMPLANT_BONUSES = Object.freeze({
  "subdermal-armor": 2,
  "reinforced-arms": 1,
  "mantis-blades": 1,
  "reinforced-legs": 1
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
  const rawMax = resource.max;
  return {
    value: Number(resource.value) || 0,
    max:
      rawMax !== null && rawMax !== undefined && Number.isFinite(Number(rawMax))
        ? Number(rawMax)
        : fallbackMax
  };
}

function armorData(actor) {
  const armorItem = actor?.system?.armor ?? null;
  const nativeValue = Number(armorItem?.system?.marks?.value) || 0;
  const nativeMax = Math.max(0, Number(actor?.system?.armorScore) || 0);
  const subdermalInstalled = installedImplants(actor).some(
    item => ncFlag(item, "slug") === "subdermal-armor"
  );
  const bonusMax = subdermalInstalled ? 2 : 0;
  const storedBonus = Number(actor?.getFlag?.(FLAG_SCOPE, "subdermalArmorMarks"));
  const bonusValue = clamp(Number.isFinite(storedBonus) ? storedBonus : 0, 0, bonusMax);
  return {
    armorItem,
    native: {
      value: clamp(nativeValue, 0, nativeMax),
      max: nativeMax
    },
    bonusMax,
    bonusValue,
    value: clamp(nativeValue, 0, nativeMax) + bonusValue,
    max: nativeMax + bonusMax
  };
}

async function setArmorValue(actor, requested) {
  if (!actor?.isOwner) return;
  const data = armorData(actor);
  const target = clamp(requested, 0, data.max);
  const nativeTarget = Math.min(target, data.native.max);
  const bonusTarget = Math.max(0, target - data.native.max);

  if (nativeTarget !== data.native.value) {
    if (data.armorItem?.update) {
      await data.armorItem.update({ "system.marks.value": nativeTarget });
    } else if (typeof actor.modifyResource === "function") {
      await actor.modifyResource([{ key: "armor", value: nativeTarget - data.native.value }]);
    }
  }
  if (bonusTarget !== data.bonusValue) {
    await actor.setFlag(FLAG_SCOPE, "subdermalArmorMarks", bonusTarget);
  }
}

function rollModeFromEvent(event) {
  if (event?.shiftKey) return "advantage";
  if (event?.altKey) return "disadvantage";
  return "normal";
}

async function rollD20(actor, label, modifier = 0, mode = "normal") {
  actor ??= selectedActor();
  if (!actor) return ui.notifications.warn("Выберите токен или назначьте персонажа.");
  const rollMode = LUCK_ROLL_MODE[mode] ?? LUCK_ROLL_MODE.normal;
  const numericModifier = Number(modifier) || 0;
  const sign = numericModifier >= 0 ? "+" : "-";
  const formula = `${rollMode.formula} ${sign} ${Math.abs(numericModifier)}`;
  const roll = await new Roll(formula).evaluate();
  return roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${label} · d20 · ${rollMode.label}`
  });
}

async function rollDuality(actor, trait, label = null, event = {}) {
  actor ??= selectedActor();
  if (!actor) return ui.notifications.warn("Выберите токен или назначьте персонажа.");
  if (!TRAITS[trait]) return ui.notifications.warn("Для этой проверки не назначена характеристика.");

  if (typeof actor.diceRoll === "function") {
    const rollLabel = label ?? TRAITS[trait].label;
    const effects =
      (await game.system?.api?.data?.actions?.actionsTypes?.base
        ?.getEffects?.(actor)) ?? [];
    const config = {
      event,
      title: `${rollLabel}: ${actor.name}`,
      headerTitle: rollLabel,
      effects,
      roll: {
        trait,
        type: "trait"
      },
      hasRoll: true,
      actionType: "action"
    };
    const result = await actor.diceRoll(config);
    if (!result) return null;
    const resourceUpdates = result.resourceUpdates ?? config.resourceUpdates;
    const costs =
      result.costs
        ?.filter(cost => cost.enabled)
        .map(cost => ({ ...cost, value: -cost.value, total: -cost.total })) ?? [];
    if (costs.length) resourceUpdates?.addResources?.(costs);
    await resourceUpdates?.updateResources?.();
    return result;
  }

  // Fallback only for an incompatible Daggerheart installation without diceRoll().
  const modifier = Number(actor.system?.traits?.[trait]?.value) || 0;
  const sign = modifier >= 0 ? "+" : "-";
  const roll = await new Roll(
    `1d12[Драйв] + 1d12[Страх] ${sign} ${Math.abs(modifier)}`
  ).evaluate();
  const drive = Number(roll.dice?.[0]?.total) || 0;
  const fear = Number(roll.dice?.[1]?.total) || 0;
  const result =
    drive === fear
      ? "критический результат"
      : drive > fear
        ? "результат с Драйвом"
        : "результат со Страхом";
  return roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${label ?? TRAITS[trait].label} · дуальность · Драйв ${drive} / Страх ${fear} · ${result}`
  });
}

async function rollTrait(actor, trait, event = {}) {
  return rollDuality(actor, trait, TRAITS[trait]?.label ?? trait, event);
}

function actorLuck(actor) {
  const luck = Number(actor?.getFlag?.(FLAG_SCOPE, "luck"));
  return Number.isFinite(luck) ? luck : 0;
}

async function changeLuck(actor, delta) {
  if (!actor?.isOwner) return;
  await actor.setFlag(FLAG_SCOPE, "luck", clamp(actorLuck(actor) + Number(delta), -5, 10));
}

async function rollLuck(actor, mode = "normal") {
  actor ??= selectedActor();
  if (!actor) return ui.notifications.warn("Выберите токен или назначьте персонажа.");
  return rollD20(actor, "Удача", actorLuck(actor), mode);
}

async function rollDeathSave(actor) {
  actor ??= selectedActor();
  if (!actor) return ui.notifications.warn("Выберите токен или назначьте персонажа.");
  const roll = await new Roll("3d20").evaluate();
  const results = roll.dice.flatMap(die =>
    die.results.filter(result => result.active !== false).map(result => Number(result.result))
  );
  const successes = results.filter(result => result > 10).length;
  const stabilized = successes >= 2;
  return roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Проверка смерти · ${successes}/3 успеха · ${
      stabilized ? "ПЕРСОНАЖ СТАБИЛИЗИРОВАН" : "СОСТОЯНИЕ УХУДШАЕТСЯ"
    }`
  });
}

async function rollWeapon(actor, item, event = {}) {
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

  const trait = item.getFlag(FLAG_SCOPE, "attackTrait") ?? "agility";
  const traitLabel = item.getFlag(FLAG_SCOPE, "attackTraitLabel") ?? TRAITS[trait]?.label ?? trait;

  // Native Daggerheart weapon actions are duality rolls and include the system's
  // action dialog, targets, modifiers, Drive/Fear outcome and damage workflow.
  if (typeof item.use === "function") return item.use(event);
  const action = item.system?.actionsList?.[0] ?? item.system?.attack;
  if (typeof action?.use === "function") return action.use(event);

  await rollDuality(actor, trait, `${item.name} · атака (${traitLabel})`, event);
  return rollWeaponDamage(actor, item);
}

async function rollItemDuality(actor, item, event = {}) {
  actor ??= selectedActor();
  if (!actor) return ui.notifications.warn("Выберите токен или назначьте персонажа.");
  if (!item) return ui.notifications.warn("Карточка способности или импланта не найдена.");

  if (
    isNightCityItem(item, "weapon") ||
    item.getFlag(FLAG_SCOPE, "integratedWeapon") === true
  ) {
    return rollWeapon(actor, item, event);
  }

  const trait = item.getFlag(FLAG_SCOPE, "rollTrait");
  if (!trait) {
    item.sheet?.render?.(true);
    return ui.notifications.info(`${item.name}: это пассивная карточка без отдельной проверки.`);
  }
  return rollDuality(actor, trait, `${item.name} · ${TRAITS[trait]?.label ?? trait}`, event);
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

async function toggleEquipment(actor, item) {
  if (!actor?.isOwner || !item || !["armor", "weapon"].includes(item.type)) return;
  const equipped = item.system?.equipped === true;
  if (equipped) {
    await item.update({ "system.equipped": false });
    return;
  }

  if (item.type === "armor") {
    const currentArmor = actor.system?.armor;
    if (currentArmor && currentArmor.id !== item.id) {
      await currentArmor.update({ "system.equipped": false });
    }
    await item.update({ "system.equipped": true });
    return;
  }

  if (actor.effects?.find?.(effect => !effect.disabled && effect.type === "beastform")) {
    return ui.notifications.warn("В форме зверя нельзя экипировать оружие.");
  }
  const unequipBeforeEquip = actor.system?.constructor?.unequipBeforeEquip;
  if (typeof unequipBeforeEquip === "function") {
    await unequipBeforeEquip.call(actor.system, item);
  }
  await item.update({ "system.equipped": true });
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
  if (ncFlag(item, "slug") === "subdermal-armor" && !equipped) {
    await actor.setFlag(FLAG_SCOPE, "subdermalArmorMarks", 0);
  }
  await recalculateCyberpsychosis(actor);
  return true;
}

function ncFlag(item, key) {
  return item?.getFlag?.(FLAG_SCOPE, key);
}

function stripHtml(value) {
  const div = document.createElement("div");
  div.innerHTML = String(value ?? "");
  return div.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function itemDescription(item) {
  const description = item?.system?.description;
  return stripHtml(description?.value ?? description ?? "");
}

function itemQuantity(item) {
  return Number(item?.system?.quantity ?? item?.system?.amount ?? 1) || 1;
}

function getPropertySafe(object, path, fallback = undefined) {
  try {
    return foundry.utils.getProperty(object, path) ?? fallback;
  } catch {
    return fallback;
  }
}

function actorClassSlug(actor) {
  const classItem = actor.items.find(item => ncFlag(item, "kind") === "class") ??
    actor.items.find(item => item.type === "class");
  const slug = ncFlag(classItem, "slug");
  if (slug) return slug;
  const name = classItem?.name?.toLocaleLowerCase?.("ru") ?? "";
  if (name.includes("джаггернаут")) return "juggernaut";
  if (name.includes("призрак")) return "ghost";
  if (name.includes("нетраннер")) return "netrunner";
  if (name.includes("рокер")) return "rocker";
  return null;
}

function damageThresholds(actor) {
  const slug = actorClassSlug(actor);
  const base = DAMAGE_THRESHOLDS_BY_CLASS[slug] ?? { light: 5, moderate: 10, heavy: 15 };
  const bonus = installedImplants(actor).reduce((sum, item) => {
    return sum + (THRESHOLD_IMPLANT_BONUSES[ncFlag(item, "slug")] ?? 0);
  }, 0);
  return {
    light: base.light + bonus,
    moderate: base.moderate + bonus,
    heavy: base.heavy + bonus,
    bonus
  };
}

function eddiesValue(actor) {
  const flagValue = Number(actor.getFlag?.(FLAG_SCOPE, "eddies"));
  if (Number.isFinite(flagValue)) return flagValue;
  const candidates = [
    "system.currency.eddies",
    "system.currency.coins",
    "system.inventory.currency.eddies",
    "system.inventory.currency.coins",
    "system.resources.currency.value",
    "system.resources.gold.value"
  ];
  for (const path of candidates) {
    const value = Number(getPropertySafe(actor, path));
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

async function editEddies(actor) {
  if (!actor?.isOwner) return;
  const current = eddiesValue(actor);
  const requested = window.prompt("Баланс эдди", String(current));
  if (requested === null) return;
  const normalized = String(requested).replace(/\s+/g, "").replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    return ui.notifications.warn("Укажите неотрицательное число эдди.");
  }
  await actor.setFlag(FLAG_SCOPE, "eddies", Math.floor(amount));
}

function featureList(items, emptyText) {
  if (!items.length) return `<div class="nc2073-empty">${escapeHtml(emptyText)}</div>`;
  return items
    .map(item => {
      const direction = ncFlag(item, "direction") ?? item.system?.featureForm ?? "класс";
      const description = itemDescription(item);
      const trait = ncFlag(item, "rollTrait");
      return `
        <div class="nc2073-card nc2073-card--feature">
          <button type="button" class="nc2073-card__open"
            data-nc-action="item" data-item-id="${item.id}">
            <img src="${escapeHtml(item.img)}" alt="">
            <span class="nc2073-card__copy">
              <strong>${escapeHtml(item.name)}</strong>
              <small>${escapeHtml(direction)}</small>
              ${description ? `<span>${escapeHtml(description)}</span>` : ""}
            </span>
          </button>
          ${
            trait
              ? `<button type="button" class="nc2073-action nc2073-action--duality"
                  data-nc-action="duality" data-item-id="${item.id}"
                  title="Проверка дуальности: Драйв d12 + Страх d12">
                  <i class="fa-solid fa-dice-d12"></i><span>2d12</span>
                </button>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

function inventoryList(items, emptyText, { weapons = false, equipment = false } = {}) {
  if (!items.length) return `<div class="nc2073-empty">${escapeHtml(emptyText)}</div>`;
  return items
    .map(item => {
      const quantity = itemQuantity(item);
      const description = itemDescription(item);
      const formula = ncFlag(item, "damageFormula");
      const range = ncFlag(item, "rangeLabel");
      const equipped = item.system?.equipped === true;
      const armorScore =
        item.type === "armor" && Number.isFinite(Number(item.system?.baseScore))
          ? `Броня ${Number(item.system.baseScore)}`
          : null;
      let meta = item.type ?? "предмет";
      if (quantity > 1) meta = `x${quantity}`;
      if (armorScore) meta = armorScore;
      if (formula) meta = `${formula}${range ? ` · ${range}` : ""}`;
      return `
        <div class="nc2073-card ${weapons ? "nc2073-card--weapon" : ""} ${
          equipped ? "is-equipped" : ""
        }">
          <button type="button" class="nc2073-card__open"
            data-nc-action="item" data-item-id="${item.id}">
            <img src="${escapeHtml(item.img)}" alt="">
            <span class="nc2073-card__copy">
              <strong>${escapeHtml(item.name)}</strong>
              <small>${escapeHtml(meta)}</small>
              ${description ? `<span>${escapeHtml(description)}</span>` : ""}
            </span>
          </button>
          ${
            weapons
              ? `<button type="button" class="nc2073-action"
                  data-nc-action="weapon" data-item-id="${item.id}"
                  title="Нативная атака Daggerheart: кости дуальности">Атака</button>`
              : ""
          }
          ${
            equipment
              ? `<button type="button" class="nc2073-equip"
                  data-nc-action="equip" data-item-id="${item.id}"
                  title="${equipped ? "Снять" : "Экипировать"}">
                  <i class="fa-solid ${equipped ? "fa-toggle-on" : "fa-toggle-off"}"></i>
                </button>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

function resourceTrack(key, label, data, icon, { editable = false, alert = false } = {}) {
  const max = Math.max(0, Number(data.max) || 0);
  const value = clamp(data.value, 0, max);
  const markers = Array.from({ length: max }, (_, index) => {
    const markerValue = index + 1;
    return `
      <button type="button" class="nc2073-marker ${alert ? "is-alert" : ""}"
        data-nc-action="resource-set" data-resource="${key}" data-value="${markerValue}"
        data-on="${markerValue <= value}" ${editable ? "" : "disabled"}
        aria-label="${escapeHtml(label)} ${markerValue}, ${markerValue <= value ? "заполнено" : "пусто"}">
        <i class="fa-solid ${icon}"></i>
      </button>
    `;
  }).join("");
  return `
    <div class="nc2073-resource">
      <div class="nc2073-track-head">
        <span>${escapeHtml(label)}</span>
        <strong>${value} / ${max}</strong>
      </div>
      <div class="nc2073-track">${markers || `<span class="nc2073-muted">нет ячеек</span>`}</div>
    </div>
  `;
}

function traitControl(key, trait, value, editable) {
  const prefix = value >= 0 ? "+" : "";
  return `
    <div class="nc2073-trait ${trait.className}">
      <button type="button" class="nc2073-trait__roll"
        data-nc-action="trait" data-trait="${key}"
        title="Проверка дуальности Daggerheart">
        <span>${escapeHtml(trait.label)}</span><strong>${prefix}${value}</strong>
      </button>
      <span class="nc2073-trait__controls">
        <button type="button" data-nc-action="trait-adjust" data-trait="${key}"
          data-delta="-1" ${editable ? "" : "disabled"} aria-label="Уменьшить ${escapeHtml(trait.label)}">−</button>
        <button type="button" data-nc-action="trait-adjust" data-trait="${key}"
          data-delta="1" ${editable ? "" : "disabled"} aria-label="Увеличить ${escapeHtml(trait.label)}">+</button>
      </span>
    </div>
  `;
}

function identityChip(item, fallback) {
  if (!item) return `<span class="nc2073-chip is-empty">${escapeHtml(fallback)}</span>`;
  return `
    <button type="button" class="nc2073-chip" data-nc-action="item" data-item-id="${item.id}">
      <img src="${escapeHtml(item.img)}" alt="">
      <span>${escapeHtml(item.name)}</span>
    </button>
  `;
}

function quickSlot(item, index, meta, action = "item") {
  if (!item) {
    return `
      <div class="nc2073-quick is-empty">
        <span class="nc2073-quick__placeholder"><i class="fa-solid fa-plus"></i></span>
        <span><strong>Свободный слот</strong><small>Добавьте предмет</small></span>
        <b>${String(index).padStart(2, "0")}</b>
      </div>
    `;
  }
  return `
    <button type="button" class="nc2073-quick" data-nc-action="${action}"
      data-item-id="${item.id}"
      ${action === "weapon" ? 'title="Нативная атака Daggerheart: кости дуальности"' : ""}>
      <img src="${escapeHtml(item.img)}" alt="">
      <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(meta)}</small></span>
      <b>${String(index).padStart(2, "0")}</b>
    </button>
  `;
}

function implantList(items, editable) {
  if (!items.length) return `<div class="nc2073-empty">Перетащите импланты из компендиума на персонажа.</div>`;
  return items
    .map(item => {
      const checked = ncFlag(item, "equipped") === true;
      const zone = ncFlag(item, "zone") ?? "—";
      return `
        <div class="nc2073-card nc2073-card--implant ${checked ? "is-installed" : ""}">
          <button type="button" class="nc2073-card__open"
            data-nc-action="item" data-item-id="${item.id}">
            <img src="${escapeHtml(item.img)}" alt="">
            <span class="nc2073-card__copy">
              <strong>${escapeHtml(item.name)}</strong>
              <small>${escapeHtml(zone)} · нагрузка 1</small>
              <span>${escapeHtml(itemDescription(item))}</span>
            </span>
          </button>
          <button type="button" class="nc2073-action nc2073-action--duality"
            data-nc-action="duality" data-item-id="${item.id}"
            title="Использовать имплант с костями дуальности">
            <i class="fa-solid fa-dice-d12"></i><span>2d12</span>
          </button>
          <label class="nc2073-switch">
            <input type="checkbox" data-nc-action="implant" data-item-id="${item.id}"
              ${checked ? "checked" : ""} ${editable ? "" : "disabled"}>
            <span>${checked ? "ВКЛ" : "ВЫКЛ"}</span>
          </label>
        </div>
      `;
    })
    .join("");
}

function effectList(actor) {
  const effects = Array.from(actor.effects ?? []);
  if (!effects.length) return `<div class="nc2073-empty">На персонажа сейчас не действуют эффекты.</div>`;
  return effects
    .map(effect => {
      const disabled = effect.disabled ? "отключён" : "активен";
      const duration = effect.duration?.remaining ? ` · осталось ${effect.duration.remaining}` : "";
      return `
        <div class="nc2073-data-block">
          <img src="${escapeHtml(effect.img ?? "icons/svg/aura.svg")}" alt="">
          <span><strong>${escapeHtml(effect.name ?? effect.label ?? "Эффект")}</strong>
          <small>${disabled}${duration}</small></span>
          ${
            actor.isOwner
              ? `<button type="button" class="nc2073-effect-toggle"
                  data-nc-action="effect-toggle" data-effect-id="${effect.id}"
                  title="${effect.disabled ? "Включить эффект" : "Отключить эффект"}">
                  <i class="fa-solid ${effect.disabled ? "fa-toggle-off" : "fa-toggle-on"}"></i>
                </button>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

function actorEvasion(actor) {
  const candidates = [
    actor?.system?.evasion?.value,
    actor?.system?.evasion,
    actor?.system?.defenses?.evasion?.value
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

async function setResourceValue(actor, key, requested) {
  if (!actor?.isOwner) return;
  if (key === "armor") {
    const current = armorData(actor).value;
    const target = clamp(requested === current ? current - 1 : requested, 0, armorData(actor).max);
    await setArmorValue(actor, target);
    return;
  }
  const resource = resourceData(actor, key);
  const target = clamp(requested === resource.value ? resource.value - 1 : requested, 0, resource.max);
  await actor.update({ [`system.resources.${key}.value`]: target });
}

function normalizeMachineText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "<")
    .replace(/^<+|<+$/g, "")
    .toUpperCase();
}

function activeTabClass(active, expected) {
  return active === expected ? "is-active" : "";
}

function tabSelected(active, expected) {
  return active === expected ? "true" : "false";
}

function actorCallsign(actor) {
  return String(actor.getFlag?.(FLAG_SCOPE, "callsign") ?? "—");
}

function actorAncestry(actor) {
  return actor.items.find(item => item.type === "ancestry") ?? null;
}

function actorFaction(actor) {
  return actor.items.find(item => ncFlag(item, "kind") === "faction" || item.type === "community") ?? null;
}

function selectedClass(actor) {
  return actor.items.find(item => ncFlag(item, "kind") === "class" || item.type === "class") ?? null;
}

function selectedSubclass(actor) {
  return actor.items.find(item => ncFlag(item, "kind") === "subclass" || item.type === "subclass") ?? null;
}

function biographyText(actor) {
  return (
    getPropertySafe(actor, "system.biography.background") ??
    getPropertySafe(actor, "system.biography.value") ??
    getPropertySafe(actor, "system.biography") ??
    getPropertySafe(actor, "system.description.value") ??
    getPropertySafe(actor, "system.description") ??
    ""
  );
}

function biographyPath(actor) {
  if (getPropertySafe(actor, "system.biography.background") !== undefined) {
    return "system.biography.background";
  }
  if (getPropertySafe(actor, "system.biography.value") !== undefined) {
    return "system.biography.value";
  }
  return "system.biography.background";
}

async function saveBiography(actor, panel) {
  if (!actor?.isOwner) return;
  const input = panel?.querySelector?.("[data-nc-bio-input]");
  if (!input) return;
  const value = String(input.value ?? "").trim();
  await actor.update({ [biographyPath(actor)]: value });
  ui.notifications.info("Биография сохранена.");
}

async function editActorImage(actor) {
  if (!actor?.isOwner) return;
  const Picker = foundry.applications?.apps?.FilePicker?.implementation;
  if (!Picker) return ui.notifications.error("Выбор изображения недоступен в этой установке Foundry.");
  const picker = new Picker({
    current: actor.img,
    type: "image",
    callback: async path => actor.update({ img: path })
  });
  return picker.browse();
}

async function editActorName(actor) {
  if (!actor?.isOwner) return;
  const requested = window.prompt("Имя персонажа", actor.name);
  const name = requested?.trim();
  if (name) await actor.update({ name });
}

async function adjustTrait(actor, trait, delta) {
  if (!actor?.isOwner || !TRAITS[trait]) return;
  const current = Number(actor.system?.traits?.[trait]?.value) || 0;
  await actor.update({ [`system.traits.${trait}.value`]: clamp(current + Number(delta), -5, 10) });
}

function itemSection(title, content) {
  return `
    <section class="nc2073-section">
      <h3>${escapeHtml(title)}</h3>
      <div class="nc2073-card-list">${content}</div>
    </section>
  `;
}

function setActiveTab(panel, tab) {
  if (!panel || !TAB_DEFINITIONS.some(entry => entry.id === tab)) return;
  ACTIVE_TABS.set(panel.dataset.ncActorId, tab);
  panel.querySelectorAll("[data-nc-tab]").forEach(element => {
    element.classList.toggle("is-active", element.dataset.ncTab === tab);
  });
  panel.querySelectorAll("[data-nc-tab-target]").forEach(button => {
    const active = button.dataset.ncTabTarget === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function wizardDocumentSource(document) {
  const source = document.toObject();
  delete source._id;
  delete source._stats;
  delete source.folder;
  delete source.ownership;
  return source;
}

function choiceKind(item) {
  return ncFlag(item, "kind");
}

function isWizardChoiceItem(item) {
  return ["class", "subclass", "class-feature", "faction", "faction-feature"].includes(
    choiceKind(item)
  );
}

async function characterPackDocuments() {
  const pack = game.packs.get(`${MODULE_ID}.${ITEM_PACK_ID}`);
  if (!pack) throw new Error("Компендиум Night City 2073 не найден.");
  const documents = await pack.getDocuments();
  const classes = documents.filter(item => choiceKind(item) === "class");
  const subclasses = documents.filter(item => choiceKind(item) === "subclass");
  const factions = documents.filter(item => choiceKind(item) === "faction");
  const features = documents.filter(item => choiceKind(item) === "class-feature");
  if (classes.length !== 4 || subclasses.length !== 8 || factions.length !== 4) {
    throw new Error(
      `Компендиум конструктора повреждён: классы ${classes.length}/4, подклассы ${subclasses.length}/8, фракции ${factions.length}/4.`
    );
  }
  for (const classItem of classes) {
    const slug = ncFlag(classItem, "slug");
    const subclassCount = subclasses.filter(item => ncFlag(item, "classSlug") === slug).length;
    const featureCount = features.filter(item => ncFlag(item, "classSlug") === slug).length;
    if (subclassCount !== 2 || featureCount !== 5) {
      throw new Error(
        `${classItem.name}: ожидаются 2 подкласса и 5 способностей, найдено ${subclassCount} и ${featureCount}.`
      );
    }
  }
  return documents;
}

function wizardChoiceDescription(item) {
  const direction = ncFlag(item, "direction");
  const description = itemDescription(item);
  return [direction, description].filter(Boolean).join(" · ").slice(0, 230);
}

async function choiceDialog({
  title,
  step,
  lead,
  items,
  multiple = false,
  minimum = 1,
  maximum = 1,
  confirmLabel = "Далее"
}) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2?.wait) {
    ui.notifications.error("Для конструктора требуется Foundry VTT 13 с DialogV2.");
    return null;
  }
  if (!items.length) {
    ui.notifications.error(`${title}: в компендиуме нет доступных вариантов.`);
    return null;
  }

  const inputType = multiple ? "checkbox" : "radio";
  const name = `nc2073-choice-${foundry.utils.randomID(6)}`;
  const content = `
    <div class="nc2073-wizard">
      <div class="nc2073-wizard__step">${escapeHtml(step)}</div>
      <p>${escapeHtml(lead)}</p>
      <div class="nc2073-wizard__choices">
        ${items
          .map(
            item => `
              <label class="nc2073-wizard__choice">
                <input type="${inputType}" name="${name}" value="${item.id}">
                <img src="${escapeHtml(item.img)}" alt="">
                <span>
                  <strong>${escapeHtml(item.name)}</strong>
                  <small>${escapeHtml(wizardChoiceDescription(item))}</small>
                </span>
                <i class="fa-solid fa-check"></i>
              </label>
            `
          )
          .join("")}
      </div>
      <div class="nc2073-wizard__counter" data-nc-wizard-counter>
        ${multiple ? `Выберите ровно ${maximum}` : "Выберите один вариант"}
      </div>
    </div>
  `;

  while (true) {
    const result = await DialogV2.wait({
      window: { title },
      classes: ["nc2073-wizard-dialog"],
      position: { width: 720 },
      content,
      buttons: [
        {
          action: "cancel",
          icon: "fa-solid fa-xmark",
          label: "Отмена",
          callback: () => null
        },
        {
          action: "next",
          icon: "fa-solid fa-arrow-right",
          label: confirmLabel,
          default: true,
          callback: (_event, button) => {
            return Array.from(
              button.form?.querySelectorAll(`input[name="${name}"]:checked`) ?? []
            ).map(input => input.value);
          }
        }
      ],
      rejectClose: false,
      modal: true
    });
    if (result === null) return null;
    const values = Array.isArray(result) ? result : [];
    if (values.length >= minimum && values.length <= maximum) return values;
    ui.notifications.warn(
      multiple
        ? `Нужно выбрать ровно ${minimum} способности.`
        : "Сначала выберите один вариант."
    );
  }
}

async function applyCharacterWizard(actor, selection) {
  const previousItems = actor.items.filter(isWizardChoiceItem);
  const previousSources = previousItems.map(item => item.toObject());
  const previousTraits = Object.fromEntries(
    Object.keys(TRAITS).map(key => [key, Number(actor.system?.traits?.[key]?.value) || 0])
  );
  const primaryDocuments = [selection.classItem, selection.subclassItem, selection.factionItem].filter(Boolean);
  const featureDocuments = [
    selection.baseFeature,
    ...selection.abilities,
    selection.factionFeature
  ].filter(Boolean);

  try {
    if (previousItems.length) {
      await actor.deleteEmbeddedDocuments("Item", previousItems.map(item => item.id));
    }
    await actor.createEmbeddedDocuments(
      "Item",
      primaryDocuments.map(wizardDocumentSource)
    );

    // Some Daggerheart sheets materialize linked features automatically. Only
    // create the feature cards that are still absent after class/faction import.
    const missingFeatures = featureDocuments.filter(document => {
      const kind = choiceKind(document);
      return !actor.items.some(
        item => choiceKind(item) === kind && item.name === document.name
      );
    });
    if (missingFeatures.length) {
      await actor.createEmbeddedDocuments(
        "Item",
        missingFeatures.map(wizardDocumentSource)
      );
    }
    const suggestedTraits = selection.classItem.system?.characterGuide?.suggestedTraits ?? {};
    const traitUpdates = {};
    for (const key of Object.keys(TRAITS)) {
      const value = Number(suggestedTraits[key]);
      if (Number.isFinite(value)) traitUpdates[`system.traits.${key}.value`] = value;
    }
    if (Object.keys(traitUpdates).length) await actor.update(traitUpdates);
    await actor.setFlag(FLAG_SCOPE, "wizardComplete", true);
    await recalculateCyberpsychosis(actor, { render: false });
    ui.notifications.info(
      `${actor.name}: ${selection.classItem.name}, ${selection.subclassItem.name}, две способности и фракция добавлены.`
    );
  } catch (error) {
    console.error(`${MODULE_ID} | Не удалось применить мастер создания`, error);
    const currentChoices = actor.items.filter(isWizardChoiceItem);
    if (currentChoices.length) {
      await actor.deleteEmbeddedDocuments("Item", currentChoices.map(item => item.id));
    }
    if (previousSources.length) {
      await actor.createEmbeddedDocuments("Item", previousSources, { keepId: true });
    }
    await actor.update(
      Object.fromEntries(
        Object.entries(previousTraits).map(([key, value]) => [`system.traits.${key}.value`, value])
      )
    );
    ui.notifications.error("Не удалось применить выборы. Предыдущее состояние восстановлено.");
  }
}

async function runCharacterWizard(actor) {
  if (!actor?.isOwner) return ui.notifications.warn("Для изменения персонажа нужны права владельца.");

  let documents;
  try {
    documents = await characterPackDocuments();
  } catch (error) {
    console.error(`${MODULE_ID} | ${error.message}`, error);
    return ui.notifications.error(error.message);
  }

  const hasPrevious = actor.items.some(isWizardChoiceItem);
  const classItems = documents
    .filter(item => choiceKind(item) === "class")
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const classChoice = await choiceDialog({
    title: "Создание персонажа · Класс",
    step: "Шаг 1 из 4",
    lead: hasPrevious
      ? "Выберите класс. После завершения всех шагов прежние выборы класса, подкласса, способностей и фракции будут заменены."
      : "Выберите основной класс персонажа.",
    items: classItems
  });
  if (!classChoice) return;
  const classItem = classItems.find(item => item.id === classChoice[0]);
  if (!classItem) return ui.notifications.error("Выбранный класс не найден.");
  const classSlug = ncFlag(classItem, "slug");

  const subclassItems = documents
    .filter(item => choiceKind(item) === "subclass" && ncFlag(item, "classSlug") === classSlug)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const subclassChoice = await choiceDialog({
    title: "Создание персонажа · Подкласс",
    step: "Шаг 2 из 4",
    lead: `Для класса «${classItem.name}» доступны два направления.`,
    items: subclassItems
  });
  if (!subclassChoice) return;
  const subclassItem = subclassItems.find(item => item.id === subclassChoice[0]);
  if (!subclassItem) return ui.notifications.error("Выбранный подкласс не найден.");

  const classFeatures = documents
    .filter(item => choiceKind(item) === "class-feature" && ncFlag(item, "classSlug") === classSlug)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const baseFeature = classFeatures.find(item => ncFlag(item, "direction") === "Базовая");
  const abilityItems = classFeatures.filter(item => ncFlag(item, "direction") !== "Базовая");
  const abilityChoice = await choiceDialog({
    title: "Создание персонажа · Способности",
    step: "Шаг 3 из 4",
    lead: `Базовая способность «${baseFeature?.name ?? "—"}» добавится автоматически. Выберите ровно две дополнительные способности.`,
    items: abilityItems,
    multiple: true,
    minimum: 2,
    maximum: 2
  });
  if (!abilityChoice) return;
  const abilities = abilityChoice
    .map(id => abilityItems.find(item => item.id === id))
    .filter(Boolean);

  const factionItems = documents
    .filter(item => choiceKind(item) === "faction")
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const factionChoice = await choiceDialog({
    title: "Создание персонажа · Фракция",
    step: "Шаг 4 из 4",
    lead: `Выбрано: ${classItem.name} / ${subclassItem.name} / ${abilities.map(item => item.name).join(", ")}. Теперь выберите фракцию.`,
    items: factionItems,
    confirmLabel: "Применить"
  });
  if (!factionChoice) return;
  const factionItem = factionItems.find(item => item.id === factionChoice[0]);
  if (!factionItem) return ui.notifications.error("Выбранная фракция не найдена.");
  const factionFeature = documents.find(
    item =>
      choiceKind(item) === "faction-feature" &&
      ncFlag(item, "factionSlug") === ncFlag(factionItem, "slug")
  );

  await applyCharacterWizard(actor, {
    classItem,
    subclassItem,
    baseFeature,
    abilities,
    factionItem,
    factionFeature
  });
}

function buildPanel(actor) {
  const editable = actor.isOwner;
  const wounds = resourceData(actor, "hitPoints");
  const drive = resourceData(actor, "hope", 6);
  const cp = resourceData(actor, "stress", cyberpsychosisCapacity(actor));
  cp.max = cyberpsychosisCapacity(actor);
  const armor = armorData(actor);
  const implants = actor.items.filter(item => isNightCityItem(item, "implant"));
  const inventoryWeapons = actor.items.filter(item => isNightCityItem(item, "weapon"));
  const integratedWeapons = actor.items.filter(
    item =>
      isNightCityItem(item, "implant") &&
      item.getFlag(FLAG_SCOPE, "integratedWeapon") === true
  );
  const attackWeapons = [...inventoryWeapons, ...integratedWeapons];
  const equippedWeapons = attackWeapons.filter(
    item =>
      item.system?.equipped === true ||
      item.getFlag(FLAG_SCOPE, "equipped") === true
  );
  const armorItems = actor.items.filter(item => item.type === "armor");
  const classItem = selectedClass(actor);
  const subclassItem = selectedSubclass(actor);
  const factionItem = actorFaction(actor);
  const ancestryItem = actorAncestry(actor);
  const classFeatures = actor.items.filter(item => ncFlag(item, "kind") === "class-feature");
  const factionFeatures = actor.items.filter(item => ncFlag(item, "kind") === "faction-feature");
  const passiveFeatures = [
    ...classFeatures.filter(item => ncFlag(item, "direction") === "Базовая"),
    ...factionFeatures
  ];
  const activeFeatures = classFeatures.filter(item => ncFlag(item, "direction") !== "Базовая");
  const consumables = actor.items.filter(item =>
    item.type === "consumable" || ncFlag(item, "kind") === "consumable"
  );
  const loot = actor.items.filter(item =>
    item.type === "loot" &&
    !isNightCityItem(item, "implant") &&
    !isNightCityItem(item, "weapon") &&
    ncFlag(item, "kind") !== "class-feature"
  );
  const biography = biographyText(actor);
  const thresholds = damageThresholds(actor);
  const installedItems = installedImplants(actor);
  const installed = installedItems.length;
  const baseCapacity = baseCyberpsychosisCapacity(actor);
  const quickWeapon = equippedWeapons[0] ?? inventoryWeapons[0] ?? integratedWeapons[0] ?? null;
  const quickImplant = installedItems[0] ?? implants[0] ?? null;
  const quickConsumable = consumables[0] ?? null;
  const level = currentLevel(actor);
  const recordId = `NC-${actor.id.slice(0, 4).toUpperCase()}-${actor.id.slice(-6).toUpperCase()}`;
  const identityItems = [classItem, subclassItem, factionItem, ancestryItem].filter(Boolean);
  const activeTab = ACTIVE_TABS.get(actor.id) ?? "properties";
  const cpWarning =
    cp.value >= cp.max
      ? `<div class="nc2073-warning">Предел Киберпсихоза достигнут.</div>`
      : "";

  const traitButtons = Object.entries(TRAITS)
    .map(([key, trait]) => {
      const value = Number(actor.system?.traits?.[key]?.value) || 0;
      return traitControl(key, trait, value, editable);
    })
    .join("");

  const tabButtons = TAB_DEFINITIONS.map(
    tab => `
      <button type="button" class="${activeTabClass(activeTab, tab.id)}"
        data-nc-action="tab" data-nc-tab-target="${tab.id}"
        aria-label="${escapeHtml(tab.label)}" title="${escapeHtml(tab.label)}"
        aria-selected="${tabSelected(activeTab, tab.id)}">
        <i class="fa-solid ${tab.icon}" aria-hidden="true"></i>
        <span class="nc2073-sr-only">${escapeHtml(tab.label)}</span>
      </button>
    `
  ).join("");

  return `
    <section class="nc2073-panel" data-nc-actor-id="${actor.id}">
      <aside class="nc2073-rail">
        <div class="nc2073-rail-head">
          <span>NC-2073 // CITIZEN RECORD</span>
          <i class="nc2073-live" title="AR-канал активен"></i>
        </div>

        <button type="button" class="nc2073-portrait" data-nc-action="avatar"
          ${editable ? "" : "disabled"} title="Изменить портрет персонажа">
          <img src="${escapeHtml(actor.img)}" alt="${escapeHtml(actor.name)}">
          <span class="nc2073-scan"></span>
          <span class="nc2073-portrait-edit"><i class="fa-solid fa-camera"></i></span>
        </button>

        <div class="nc2073-mini-grid">
          <div><span>ID записи</span><strong>${recordId}</strong></div>
          <div><span>Статус</span><strong>Активен</strong></div>
          <button type="button" data-nc-action="callsign" ${editable ? "" : "disabled"}>
            <span>Позывной</span><strong>${escapeHtml(actorCallsign(actor))}</strong>
          </button>
          <div><span>Допуск</span><strong>Уровень ${String(level).padStart(2, "0")}</strong></div>
        </div>

        <div class="nc2073-quick-list">
          <h3>Быстрый доступ</h3>
          ${quickSlot(
            quickWeapon,
            1,
            quickWeapon
              ? `${ncFlag(quickWeapon, "damageFormula") ?? "оружие"} · ${ncFlag(quickWeapon, "weaponType") ?? "атака"}`
              : "",
            "weapon"
          )}
          ${quickSlot(
            quickImplant,
            2,
            quickImplant
              ? `Имплант · ${ncFlag(quickImplant, "equipped") === true ? "включён" : "выключен"}`
              : ""
          )}
          ${quickSlot(
            quickConsumable,
            3,
            quickConsumable ? `Расходник · ${itemQuantity(quickConsumable)} шт.` : ""
          )}
        </div>

        <div class="nc2073-machine">
          P&lt;NC2073&lt;${normalizeMachineText(actor.name)}&lt;${normalizeMachineText(actor.id)}&lt;VALID
        </div>
      </aside>

      <main class="nc2073-main">
        <nav class="nc2073-tabs" aria-label="Разделы электронного паспорта">
          ${tabButtons}
        </nav>

        <header class="nc2073-identity">
          <div>
            <div class="nc2073-eyebrow"><span>Персональная запись // Проверена</span><span>AR LINK 100%</span></div>
            <button type="button" class="nc2073-name" data-nc-action="name"
              ${editable ? "" : "disabled"} title="Изменить имя персонажа">
              <h2>${escapeHtml(actor.name)}</h2><i class="fa-solid fa-pen"></i>
            </button>
            <div class="nc2073-chips">
              ${identityChip(classItem, "Класс не выбран")}
              ${identityChip(subclassItem, "Подкласс не выбран")}
              ${identityChip(factionItem, "Фракция не выбрана")}
              ${identityChip(ancestryItem, "Происхождение не выбрано")}
            </div>
          </div>
          <div class="nc2073-identity-actions">
            <button type="button" class="nc2073-wizard-button" data-nc-action="wizard"
              ${editable ? "" : "disabled"}
              title="Пошаговый выбор класса, подкласса, двух способностей и фракции">
              <i class="fa-solid fa-user-gear"></i><span>Конструктор</span>
            </button>
            <div class="nc2073-level"><span>Уровень</span><strong>${level}</strong></div>
          </div>
        </header>

        <section class="nc2073-resources">
          <div class="nc2073-resource-row nc2073-resource-row--primary">
            ${resourceTrack("hope", "Драйв", drive, "fa-bolt", { editable })}
            <div class="nc2073-resource nc2073-resource--number">
              <div class="nc2073-track-head"><span>Уклонение</span><strong>${actorEvasion(actor)}</strong></div>
              <small>Порог попадания</small>
            </div>
            <div class="nc2073-resource nc2073-thresholds">
              <div class="nc2073-track-head"><span>Пороги урона</span><i class="fa-solid fa-wave-square"></i></div>
              <div><span>Лёгкий<strong>${thresholds.light}</strong></span><span>Ощутимый<strong>${thresholds.moderate}</strong></span><span>Тяжёлый<strong>${thresholds.heavy}</strong></span></div>
              ${thresholds.bonus ? `<small>+${thresholds.bonus} от имплантов</small>` : ""}
            </div>
          </div>
          <div class="nc2073-resource-row nc2073-resource-row--secondary">
            ${resourceTrack("hitPoints", "Раны", wounds, "fa-heart-pulse", { editable, alert: true })}
            ${resourceTrack("stress", "Киберпсихоз", cp, "fa-brain", { editable, alert: true })}
            ${resourceTrack("armor", "Броня", armor, "fa-shield-halved", { editable })}
          </div>
          ${cpWarning}
          <div class="nc2073-capacity">Импланты ${installed}/${Math.max(0, baseCapacity - 1)} · базовая вместимость ${baseCapacity} · доступно ${cp.max}</div>
        </section>

        <section class="nc2073-content">
          <div class="nc2073-tab ${activeTabClass(activeTab, "properties")}" data-nc-tab="properties">
            <h3>Характеристики</h3>
            <div class="nc2073-traits">
              ${traitButtons}
              <div class="nc2073-trait nc2073-trait--luck">
                <button type="button" data-nc-action="luck"
                  title="Клик: обычная проверка · Shift: преимущество · Alt: помеха">
                  <span>Удача</span><strong>${actorLuck(actor) >= 0 ? "+" : ""}${actorLuck(actor)}</strong>
                </button>
                <span class="nc2073-luck-controls">
                  <button type="button" data-nc-action="luck-adjust" data-delta="-1" ${editable ? "" : "disabled"}>−</button>
                  <button type="button" data-nc-action="luck-adjust" data-delta="1" ${editable ? "" : "disabled"}>+</button>
                </span>
              </div>
            </div>
            <div class="nc2073-section-grid">
              ${itemSection("Класс, подкласс и фракция", featureList(identityItems, "Выборы персонажа ещё не добавлены."))}
              ${itemSection("Активные способности", featureList(activeFeatures, "Выберите две классовые способности."))}
              ${itemSection("Пассивные свойства", featureList(passiveFeatures, "Пассивные свойства пока не добавлены."))}
            </div>
          </div>

          <div class="nc2073-tab ${activeTabClass(activeTab, "implants")}" data-nc-tab="implants">
            <div class="nc2073-tab-head"><h3>Импланты</h3><span>${installed}/${implants.length} включено</span></div>
            <div class="nc2073-card-list nc2073-card-list--wide">${implantList(implants, editable)}</div>
          </div>

          <div class="nc2073-tab ${activeTabClass(activeTab, "inventory")}" data-nc-tab="inventory">
            <div class="nc2073-wallet">
              <span><i class="fa-solid fa-coins"></i> Эдди</span>
              <strong>${eddiesValue(actor).toLocaleString("ru-RU")}</strong>
              <button type="button" data-nc-action="eddies" ${editable ? "" : "disabled"}
                title="Изменить баланс эдди"><i class="fa-solid fa-pen"></i></button>
            </div>
            <div class="nc2073-section-grid">
              ${itemSection("Оружие", inventoryList(inventoryWeapons, "Перетащите оружие из компендиума.", { weapons: true, equipment: true }))}
              ${itemSection("Броня", inventoryList(armorItems, "Экипированная броня отсутствует.", { equipment: true }))}
              ${itemSection("Расходники", inventoryList(consumables, "Расходников нет."))}
              ${itemSection("Добыча", inventoryList(loot, "Добычи нет."))}
            </div>
          </div>

          <div class="nc2073-tab ${activeTabClass(activeTab, "bio")}" data-nc-tab="bio">
            <div class="nc2073-bio-editor">
              <textarea data-nc-bio-input ${editable ? "" : "disabled"}
                placeholder="Биография персонажа">${escapeHtml(stripHtml(biography))}</textarea>
              ${
                editable
                  ? `<button type="button" data-nc-action="bio-save">
                      <i class="fa-solid fa-floppy-disk"></i> Сохранить биографию
                    </button>`
                  : ""
              }
            </div>
            <div class="nc2073-data-grid">
              <div><span>Класс</span><strong>${escapeHtml(classItem?.name ?? "—")}</strong></div>
              <div><span>Подкласс</span><strong>${escapeHtml(subclassItem?.name ?? "—")}</strong></div>
              <div><span>Фракция</span><strong>${escapeHtml(factionItem?.name ?? "—")}</strong></div>
              <div><span>Происхождение</span><strong>${escapeHtml(ancestryItem?.name ?? "—")}</strong></div>
            </div>
          </div>

          <div class="nc2073-tab ${activeTabClass(activeTab, "effects")}" data-nc-tab="effects">
            <div class="nc2073-data-list">${effectList(actor)}</div>
          </div>
        </section>

        <footer class="nc2073-footer">
          <span>AUTH // ${recordId} · BIOMETRIC MATCH ACTIVE</span>
          <span class="nc2073-bars"></span>
          <button type="button" data-nc-action="death"><i class="fa-solid fa-skull"></i> Проверка смерти</button>
          <button type="button" data-nc-action="refresh"><i class="fa-solid fa-rotate"></i> Обновить</button>
        </footer>
      </main>
    </section>
  `;
}

async function handlePanelClick(event, actor) {
  const control = event.target.closest("[data-nc-action]");
  if (!control) return;
  event.preventDefault();
  const action = control.dataset.ncAction;

  if (action === "tab") {
    setActiveTab(control.closest(".nc2073-panel"), control.dataset.ncTabTarget);
    return;
  }

  if (action === "trait") {
    await rollTrait(actor, control.dataset.trait, event);
    return;
  }

  if (action === "trait-adjust") {
    await adjustTrait(actor, control.dataset.trait, Number(control.dataset.delta));
    return;
  }

  if (action === "luck") {
    await rollLuck(actor, rollModeFromEvent(event));
    return;
  }

  if (action === "luck-adjust") {
    await changeLuck(actor, Number(control.dataset.delta));
    return;
  }

  if (action === "death") {
    await rollDeathSave(actor);
    return;
  }

  if (action === "weapon") {
    await rollWeapon(actor, actor.items.get(control.dataset.itemId), event);
    return;
  }

  if (action === "duality") {
    await rollItemDuality(actor, actor.items.get(control.dataset.itemId), event);
    return;
  }

  if (action === "item") {
    actor.items.get(control.dataset.itemId)?.sheet?.render?.(true);
    return;
  }

  if (action === "equip") {
    await toggleEquipment(actor, actor.items.get(control.dataset.itemId));
    return;
  }

  if (action === "resource-set") {
    await setResourceValue(actor, control.dataset.resource, Number(control.dataset.value));
    return;
  }

  if (action === "callsign") {
    if (!actor.isOwner) return;
    const value = window.prompt("Позывной персонажа", actorCallsign(actor) === "—" ? "" : actorCallsign(actor));
    if (value !== null) await actor.setFlag(FLAG_SCOPE, "callsign", value.trim() || "—");
    return;
  }

  if (action === "avatar") {
    await editActorImage(actor);
    return;
  }

  if (action === "name") {
    await editActorName(actor);
    return;
  }

  if (action === "wizard") {
    await runCharacterWizard(actor);
    return;
  }

  if (action === "eddies") {
    await editEddies(actor);
    return;
  }

  if (action === "bio-save") {
    await saveBiography(actor, control.closest(".nc2073-panel"));
    return;
  }

  if (action === "effect-toggle") {
    const effect = actor.effects?.get?.(control.dataset.effectId);
    if (actor.isOwner && effect) await effect.update({ disabled: !effect.disabled });
    return;
  }

  if (action === "refresh") {
    actor.sheet?.render?.({ force: true });
    return;
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
  if (actor.testUserPermission && !actor.testUserPermission(game.user, "OBSERVER")) return;
  const serial = (INJECTION_SERIAL.get(app) ?? 0) + 1;
  INJECTION_SERIAL.set(app, serial);

  await recalculateCyberpsychosis(actor, { render: false });
  if (INJECTION_SERIAL.get(app) !== serial) return;

  const suppliedRoot = htmlElement(html);
  const applicationRoot =
    htmlElement(app?.element) ??
    suppliedRoot?.closest?.(".application, .window-app") ??
    suppliedRoot;
  if (!applicationRoot) return;

  const host =
    htmlElement(app?.window?.content) ??
    (applicationRoot.matches?.(".window-content") ? applicationRoot : null) ??
    applicationRoot.querySelector?.(":scope > .window-content") ??
    applicationRoot.querySelector?.(".window-content");
  if (!host) return;

  host.querySelectorAll?.(":scope > .nc2073-panel").forEach(panel => panel.remove());
  applicationRoot.classList?.add("nc2073-window");
  host.classList.add("nc2073-passport-host");
  host.dataset.ncActorId = actor.id;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = buildPanel(actor);
  const panel = wrapper.firstElementChild;
  host.prepend(panel);
  panel.addEventListener("click", event => handlePanelClick(event, actor));
  panel.addEventListener("change", event => handlePanelChange(event, actor));

  if (!RESIZED_SHEETS.has(app) && typeof app.setPosition === "function") {
    RESIZED_SHEETS.add(app);
    const width = Math.max(Number(app.position?.width) || 0, 1040);
    const height = Math.max(Number(app.position?.height) || 0, 760);
    app.setPosition({ width, height });
  }
}

async function openPanel(actor) {
  actor ??= selectedActor();
  if (!actor) return ui.notifications.warn("Выберите токен или назначьте персонажа.");
  await recalculateCyberpsychosis(actor);
  actor.sheet?.render?.({ force: true });
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
    rollDuality,
    rollTrait,
    rollLuck,
    rollDeathSave,
    rollWeapon,
    rollItemDuality,
    rollWeaponDamage,
    runCharacterWizard,
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
