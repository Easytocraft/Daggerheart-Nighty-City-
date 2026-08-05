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

function actorItem(actor, itemId) {
  if (!actor || !itemId) return null;
  return actor.items?.get?.(itemId) ?? actor.items?.find?.(item => item.id === itemId) ?? null;
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
  return rollDuality(actor, trait, `${item.name} · попадание (${traitLabel})`, event);
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

async function showWeaponDialog(actor, item) {
  if (!item) return ui.notifications.warn("Оружие не найдено.");
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2?.wait) {
    item.sheet?.render?.(true);
    return;
  }

  const trait = ncFlag(item, "attackTrait") ?? "agility";
  const traitLabel = ncFlag(item, "attackTraitLabel") ?? TRAITS[trait]?.label ?? trait;
  const formula = ncFlag(item, "damageFormula") ?? "@profd6";
  const range = ncFlag(item, "rangeLabel") ?? "—";
  const weaponType = ncFlag(item, "weaponType") ?? (ncFlag(item, "integratedWeapon") ? "Встроенное оружие" : "Оружие");
  const properties = ncFlag(item, "properties") ?? [];
  const content = `
    <article class="nc2073-weapon-details">
      <img src="${escapeHtml(item.img)}" alt="">
      <div class="nc2073-weapon-details__copy">
        <div class="nc2073-weapon-details__meta">
          <span>${escapeHtml(weaponType)}</span>
          <span>${escapeHtml(range)}</span>
          <span>${escapeHtml(traitLabel)}</span>
          <span>${escapeHtml(formula)}</span>
        </div>
        <p>${escapeHtml(itemDescription(item))}</p>
        ${properties.length ? `<div class="nc2073-weapon-details__tags">${properties.map(property => `<span>${escapeHtml(property)}</span>`).join("")}</div>` : ""}
      </div>
    </article>
  `;
  const action = await DialogV2.wait({
    window: { title: item.name },
    classes: ["nc2073-weapon-dialog"],
    position: { width: 650 },
    content,
    buttons: [
      {
        action: "attack",
        icon: "fa-solid fa-crosshairs",
        label: "Попадание 2d12",
        callback: () => "attack"
      },
      {
        action: "damage",
        icon: "fa-solid fa-burst",
        label: `Урон ${formula}`,
        callback: () => "damage"
      },
      {
        action: "close",
        icon: "fa-solid fa-xmark",
        label: "Закрыть",
        callback: () => null
      }
    ],
    rejectClose: false,
    modal: true
  });
  if (action === "attack") return rollWeapon(actor, item);
  if (action === "damage") return rollWeaponDamage(actor, item);
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

  const changes = { [`flags.${FLAG_SCOPE}.equipped`]: Boolean(equipped) };
  if (item.type === "weapon") changes["system.equipped"] = Boolean(equipped);
  await item.update(changes);
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

function quickPinButton(item, editable) {
  if (!editable) return "";
  const pinned = quickAccessIds(item.parent).includes(item.id);
  return `
    <button type="button" class="nc2073-pin ${pinned ? "is-pinned" : ""}"
      data-nc-action="quick-toggle" data-item-id="${item.id}"
      title="${pinned ? "Убрать из быстрого доступа" : "Добавить в быстрый доступ"}"
      aria-label="${pinned ? "Убрать" : "Добавить"} ${escapeHtml(item.name)} ${pinned ? "из" : "в"} быстрого доступа"
      aria-pressed="${pinned}">
      <i class="fa-solid fa-thumbtack"></i>
    </button>
  `;
}

function featureList(items, emptyText, { quick = true, editable = false } = {}) {
  if (!items.length) return `<div class="nc2073-empty">${escapeHtml(emptyText)}</div>`;
  return items
    .map(item => {
      const direction = ncFlag(item, "direction") ?? item.system?.featureForm ?? "класс";
      const description = itemDescription(item);
      const trait = ncFlag(item, "rollTrait");
      return `
        <div class="nc2073-card nc2073-card--feature"
          ${quick && editable ? `draggable="true" data-nc-drag-item="${item.id}"` : ""}>
          <button type="button" class="nc2073-card__open"
            data-nc-action="item" data-item-id="${item.id}">
            <img src="${escapeHtml(item.img)}" alt="">
            <span class="nc2073-card__copy">
              <strong class="nc2073-card__title">${escapeHtml(item.name)}</strong>
              <small class="nc2073-card__meta">${escapeHtml(direction)}</small>
              ${description ? `<span class="nc2073-card__description">${escapeHtml(description)}</span>` : ""}
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
          ${quick ? quickPinButton(item, editable) : ""}
        </div>
      `;
    })
    .join("");
}

function inventoryList(
  items,
  emptyText,
  { weapons = false, equipment = false, quick = false, deletable = false, editable = false } = {}
) {
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
        }" ${quick && editable ? `draggable="true" data-nc-drag-item="${item.id}"` : ""}>
          <button type="button" class="nc2073-card__open"
            data-nc-action="${weapons ? "weapon-details" : "item"}" data-item-id="${item.id}"
            title="${weapons ? `Открыть описание оружия «${escapeHtml(item.name)}»` : `Открыть «${escapeHtml(item.name)}»`}">
            <img src="${escapeHtml(item.img)}" alt="">
            <span class="nc2073-card__copy">
              <strong class="nc2073-card__title">${escapeHtml(item.name)}</strong>
              <small class="nc2073-card__meta">${escapeHtml(meta)}</small>
              ${!weapons && description ? `<span class="nc2073-card__description">${escapeHtml(description)}</span>` : ""}
              ${weapons ? `<span class="nc2073-card__hint">Нажмите название, чтобы открыть описание</span>` : ""}
            </span>
          </button>
          ${
            weapons
              ? `<span class="nc2073-weapon-rolls">
                  <button type="button" data-nc-action="weapon-attack" data-item-id="${item.id}"
                    title="Бросок попадания: кости дуальности"><i class="fa-solid fa-crosshairs"></i><span>Попадание</span></button>
                  <button type="button" data-nc-action="weapon-damage" data-item-id="${item.id}"
                    title="Бросок урона ${escapeHtml(formula ?? "")}"><i class="fa-solid fa-burst"></i><span>Урон</span></button>
                </span>`
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
          ${quick ? quickPinButton(item, editable) : ""}
          ${
            deletable && editable
              ? `<button type="button" class="nc2073-delete" data-nc-action="item-delete"
                  data-item-id="${item.id}" title="Удалить ${escapeHtml(item.name)}"
                  aria-label="Удалить ${escapeHtml(item.name)}"><i class="fa-solid fa-trash"></i></button>`
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
    const filled = markerValue <= value;
    return `
      <button type="button"
        class="nc2073-marker ${alert ? "is-alert" : ""} ${filled ? "is-filled" : "is-empty"}"
        data-nc-action="resource-set" data-resource="${key}" data-value="${markerValue}"
        data-on="${filled}" ${editable ? "" : "disabled"}
        aria-pressed="${filled}" aria-label="${escapeHtml(label)} ${markerValue}, ${filled ? "заполнено" : "пусто"}">
        <i class="fa-solid ${icon}"></i>
      </button>
    `;
  }).join("");
  return `
    <div class="nc2073-resource" data-resource-track="${key}"
      data-resource-label="${escapeHtml(label)}" data-current="${value}" data-max="${max}">
      <div class="nc2073-track-head">
        <span>${escapeHtml(label)}</span>
        <strong data-resource-counter>${value} / ${max}</strong>
      </div>
      <div class="nc2073-track">${markers || `<span class="nc2073-muted">нет ячеек</span>`}</div>
    </div>
  `;
}

function updateResourceTrackState(track, requested) {
  if (!track) return;
  const max = Math.max(0, Number(track.dataset.max) || 0);
  const value = clamp(requested, 0, max);
  const label = track.dataset.resourceLabel ?? "Ресурс";
  track.dataset.current = String(value);
  const counter = track.querySelector("[data-resource-counter]");
  if (counter) counter.textContent = `${value} / ${max}`;
  track.querySelectorAll(".nc2073-marker").forEach(marker => {
    const filled = Number(marker.dataset.value) <= value;
    marker.dataset.on = String(filled);
    marker.classList.toggle("is-filled", filled);
    marker.classList.toggle("is-empty", !filled);
    marker.setAttribute("aria-pressed", String(filled));
    marker.setAttribute(
      "aria-label",
      `${label} ${marker.dataset.value}, ${filled ? "заполнено" : "пусто"}`
    );
  });
}

function traitControl(key, trait, value, editable) {
  const prefix = value >= 0 ? "+" : "";
  return `
    <div class="nc2073-trait ${trait.className}">
      <span class="nc2073-trait__label">${escapeHtml(trait.label)}</span>
      <button type="button" class="nc2073-trait__roll"
        data-nc-action="trait" data-trait="${key}"
        title="Проверка дуальности Daggerheart">
        <strong class="nc2073-trait__value">${prefix}${value}</strong>
        <small>2d12</small>
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

function legacyQuickSlotIds(actor) {
  const weapons = actor.items.filter(item => isNightCityItem(item, "weapon"));
  const integratedWeapons = actor.items.filter(
    item =>
      isNightCityItem(item, "implant") &&
      item.getFlag(FLAG_SCOPE, "integratedWeapon") === true
  );
  const equippedWeapons = [...weapons, ...integratedWeapons].filter(
    item => item.system?.equipped === true || ncFlag(item, "equipped") === true
  );
  const implants = actor.items.filter(item => isNightCityItem(item, "implant"));
  const installed = installedImplants(actor);
  const consumables = actor.items.filter(
    item => item.type === "consumable" || ncFlag(item, "kind") === "consumable"
  );
  return [
    equippedWeapons[0] ?? weapons[0] ?? integratedWeapons[0] ?? null,
    installed[0] ?? implants[0] ?? null,
    consumables[0] ?? null
  ].map(item => item?.id ?? null);
}

function quickAccessIds(actor) {
  const stored = actor?.getFlag?.(FLAG_SCOPE, "quickAccess");
  const legacyStored = actor?.getFlag?.(FLAG_SCOPE, "quickSlots");
  const source = Array.isArray(stored)
    ? stored
    : Array.isArray(legacyStored)
      ? legacyStored
      : legacyQuickSlotIds(actor);
  return Array.from(
    new Set(source.filter(itemId => typeof itemId === "string" && itemId && actorItem(actor, itemId)))
  );
}

async function setQuickAccess(actor, itemIds) {
  if (!actor?.isOwner) return false;
  const normalized = Array.from(
    new Set(
      (Array.isArray(itemIds) ? itemIds : []).filter(
        itemId => typeof itemId === "string" && itemId && actorItem(actor, itemId)
      )
    )
  );
  await actor.setFlag(FLAG_SCOPE, "quickAccess", normalized);
  return true;
}

async function addQuickItem(actor, item) {
  if (!actor?.isOwner || !item) return false;
  if (!quickAccessCandidates(actor).some(candidate => candidate.id === item.id)) {
    ui.notifications.warn("В быстрый доступ можно добавить оружие, имплант, способность или расходник.");
    return false;
  }
  const current = quickAccessIds(actor);
  if (current.includes(item.id)) return true;
  return setQuickAccess(actor, [...current, item.id]);
}

async function removeQuickItem(actor, itemId) {
  if (!actor?.isOwner) return false;
  return setQuickAccess(actor, quickAccessIds(actor).filter(currentId => currentId !== itemId));
}

function quickAccessCandidates(actor) {
  return actor.items.filter(item => {
    const kind = ncFlag(item, "kind");
    return (
      ["weapon", "implant", "class-feature", "faction-feature", "consumable"].includes(kind) ||
      ["weapon", "consumable"].includes(item.type)
    );
  });
}

function quickItemMeta(item) {
  if (!item) return "";
  const kind = ncFlag(item, "kind");
  if (kind === "weapon" || ncFlag(item, "integratedWeapon") === true) {
    return `${ncFlag(item, "damageFormula") ?? "оружие"} · ${ncFlag(item, "weaponType") ?? "атака"}`;
  }
  if (kind === "implant") {
    return `Имплант · ${ncFlag(item, "equipped") === true ? "включён" : "выключен"}`;
  }
  if (item.type === "consumable" || kind === "consumable") {
    return `Расходник · ${itemQuantity(item)} шт.`;
  }
  return ncFlag(item, "direction") ?? "Способность";
}

async function chooseQuickItem(actor) {
  if (!actor?.isOwner) return;
  const pinned = new Set(quickAccessIds(actor));
  const items = quickAccessCandidates(actor).filter(item => !pinned.has(item.id));
  if (!items.length) return ui.notifications.info("Все доступные предметы уже добавлены.");
  const choice = await choiceDialog({
    title: "Быстрый доступ",
    step: "Добавление предмета",
    lead: "Выберите оружие, имплант, способность или расходник.",
    items,
    confirmLabel: "Добавить"
  });
  if (!choice) return;
  await addQuickItem(actor, actorItem(actor, choice[0]));
}

async function toggleQuickItem(actor, item) {
  if (!actor?.isOwner || !item) return;
  if (quickAccessIds(actor).includes(item.id)) return removeQuickItem(actor, item.id);
  return addQuickItem(actor, item);
}

async function useQuickItem(actor, item, event = {}) {
  if (!item) return ui.notifications.warn("Предмет быстрого доступа больше не существует.");
  if (isNightCityItem(item, "weapon") || ncFlag(item, "integratedWeapon") === true) {
    return showWeaponDialog(actor, item, event);
  }
  const kind = ncFlag(item, "kind");
  if (["implant", "class-feature", "faction-feature"].includes(kind)) {
    return rollItemDuality(actor, item, event);
  }
  if (typeof item.use === "function") return item.use(event);
  item.sheet?.render?.(true);
}

function quickAccessItem(item, index, editable) {
  const displayIndex = String(index + 1).padStart(2, "0");
  return `
    <div class="nc2073-quick" data-nc-quick-index="${index}" data-item-id="${item.id}"
      ${editable ? `draggable="true" data-nc-drag-item="${item.id}"` : ""}>
      <button type="button" class="nc2073-quick__use"
        data-nc-action="quick-use" data-item-id="${item.id}"
        title="Использовать ${escapeHtml(item.name)}">
        <img src="${escapeHtml(item.img)}" alt="">
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(quickItemMeta(item))}</small></span>
      </button>
      ${
        editable
          ? `<button type="button" class="nc2073-quick__remove"
              data-nc-action="quick-remove" data-item-id="${item.id}"
              title="Убрать из быстрого доступа" aria-label="Убрать ${escapeHtml(item.name)} из быстрого доступа">
              <i class="fa-solid fa-xmark"></i>
            </button>`
          : ""
      }
      <b>${displayIndex}</b>
    </div>
  `;
}

function quickAccessMarkup(items, editable) {
  return `
    <div class="nc2073-quick-list" data-nc-quick-drop tabindex="${editable ? "0" : "-1"}">
      <div class="nc2073-quick-head">
        <h3>Быстрый доступ <span>${items.length}</span></h3>
        ${
          editable
            ? `<button type="button" data-nc-action="quick-add" title="Добавить предмет">
                <i class="fa-solid fa-plus"></i>
              </button>`
            : ""
        }
      </div>
      <div class="nc2073-quick-items">
        ${items.map((item, index) => quickAccessItem(item, index, editable)).join("")}
      </div>
      <div class="nc2073-quick-drop-hint">
        <i class="fa-solid fa-arrow-down"></i>
        <span>${editable ? "Перетащите сюда оружие, имплант или расходник" : "Быстрый доступ пуст"}</span>
      </div>
    </div>
  `;
}

function handlePanelDragStart(event, actor) {
  const source = event.target.closest?.("[data-nc-drag-item]");
  if (!source || !actor?.isOwner || !event.dataTransfer) return;
  const item = actorItem(actor, source.dataset.ncDragItem);
  if (!item) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(
    "text/plain",
    JSON.stringify({ type: "Item", uuid: item.uuid, actorId: actor.id, itemId: item.id })
  );
}

function dragEventData(event) {
  const helper = globalThis.TextEditor?.getDragEventData;
  if (typeof helper === "function") {
    try {
      const data = helper(event);
      if (data && Object.keys(data).length) return data;
    } catch {
      // Fall back to the plain text payload below.
    }
  }
  const raw = event.dataTransfer?.getData?.("text/plain");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function resolveDroppedItem(actor, data) {
  const direct = actorItem(actor, data.itemId ?? data.id);
  if (direct) return direct;
  if (!data.uuid) return null;
  const resolver = foundry.utils?.fromUuid ?? globalThis.fromUuid;
  const document = typeof resolver === "function" ? await resolver(data.uuid) : null;
  if (!document || document.documentName !== "Item") return null;
  if (document.parent?.id === actor.id) return actorItem(actor, document.id) ?? document;
  if (!actor.isOwner) return null;

  const source = document.toObject();
  delete source._id;
  delete source.folder;
  delete source.ownership;
  source._stats = { ...(source._stats ?? {}), compendiumSource: document.uuid };
  const created = await actor.createEmbeddedDocuments("Item", [source]);
  return created?.[0] ?? null;
}

async function handleQuickDrop(event, actor) {
  const dropZone = event.target.closest?.("[data-nc-quick-drop]");
  if (!dropZone || !actor?.isOwner) return;
  event.preventDefault();
  event.stopPropagation();
  dropZone.classList.remove("is-dragover");
  try {
    const item = await resolveDroppedItem(actor, dragEventData(event));
    if (!item) return ui.notifications.warn("Не удалось распознать перетаскиваемый предмет.");
    await addQuickItem(actor, item);
  } catch (error) {
    console.error(`${MODULE_ID} | Не удалось добавить предмет перетаскиванием`, error);
    ui.notifications.error(`Не удалось добавить предмет: ${error.message}`);
  }
}

function handleQuickDragOver(event, actor) {
  const dropZone = event.target.closest?.("[data-nc-quick-drop]");
  if (!dropZone || !actor?.isOwner) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  dropZone.classList.add("is-dragover");
}

function handleQuickDragLeave(event) {
  const dropZone = event.target.closest?.("[data-nc-quick-drop]");
  if (!dropZone || dropZone.contains(event.relatedTarget)) return;
  dropZone.classList.remove("is-dragover");
}

async function confirmItemDeletion(item) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2?.wait) return window.confirm(`Удалить «${item.name}» из инвентаря персонажа?`);
  const result = await DialogV2.wait({
    window: { title: "Удаление предмета" },
    classes: ["nc2073-confirm-dialog"],
    position: { width: 430 },
    content: `<div class="nc2073-confirm"><i class="fa-solid fa-triangle-exclamation"></i><p>Удалить <strong>«${escapeHtml(item.name)}»</strong> из инвентаря персонажа? Это не просто удаление из быстрого доступа.</p></div>`,
    buttons: [
      { action: "cancel", icon: "fa-solid fa-xmark", label: "Отмена", callback: () => false },
      { action: "delete", icon: "fa-solid fa-trash", label: "Удалить", callback: () => true }
    ],
    rejectClose: false,
    modal: true
  });
  return result === true;
}

async function deleteActorItem(actor, item) {
  if (!actor?.isOwner || !item) return;
  if (!(await confirmItemDeletion(item))) return;
  await removeQuickItem(actor, item.id);
  await actor.deleteEmbeddedDocuments("Item", [item.id]);
  if (isNightCityItem(item, "implant")) await recalculateCyberpsychosis(actor);
}

function implantList(items, editable) {
  if (!items.length) return `<div class="nc2073-empty">Перетащите импланты из компендиума на персонажа.</div>`;
  return items
    .map(item => {
      const checked = ncFlag(item, "equipped") === true;
      const zone = ncFlag(item, "zone") ?? "—";
      return `
        <div class="nc2073-card nc2073-card--implant ${checked ? "is-installed" : ""}"
          ${editable ? `draggable="true" data-nc-drag-item="${item.id}"` : ""}>
          <button type="button" class="nc2073-card__open"
            data-nc-action="item" data-item-id="${item.id}">
            <img src="${escapeHtml(item.img)}" alt="">
            <span class="nc2073-card__copy">
              <strong class="nc2073-card__title">${escapeHtml(item.name)}</strong>
              <small class="nc2073-card__meta">${escapeHtml(zone)} · нагрузка 1</small>
              <span class="nc2073-card__description">${escapeHtml(itemDescription(item))}</span>
            </span>
          </button>
          <button type="button" class="nc2073-action nc2073-action--duality"
            data-nc-action="duality" data-item-id="${item.id}"
            title="Использовать имплант с костями дуальности">
            <i class="fa-solid fa-dice-d12"></i><span>2d12</span>
          </button>
          ${quickPinButton(item, editable)}
          <button type="button" class="nc2073-switch" data-nc-action="implant-toggle"
            data-item-id="${item.id}" aria-pressed="${checked}" ${editable ? "" : "disabled"}
            title="${checked ? "Выключить" : "Включить"} ${escapeHtml(item.name)}">
            <i class="fa-solid ${checked ? "fa-toggle-on" : "fa-toggle-off"}"></i>
            <span>${checked ? "ВКЛ" : "ВЫКЛ"}</span>
          </button>
          ${
            editable
              ? `<button type="button" class="nc2073-delete" data-nc-action="item-delete"
                  data-item-id="${item.id}" title="Удалить ${escapeHtml(item.name)}"
                  aria-label="Удалить ${escapeHtml(item.name)}"><i class="fa-solid fa-trash"></i></button>`
              : ""
          }
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
  if (!actor?.isOwner) return null;
  if (key === "armor") {
    const current = armorData(actor).value;
    const target = clamp(requested === current ? current - 1 : requested, 0, armorData(actor).max);
    await setArmorValue(actor, target);
    return target;
  }
  const resource = resourceData(actor, key);
  const target = clamp(requested === resource.value ? resource.value - 1 : requested, 0, resource.max);
  await actor.update({ [`system.resources.${key}.value`]: target });
  return target;
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
  delete source.folder;
  delete source.ownership;
  // Daggerheart 1.9.14 validates subclasses against the compendium UUIDs
  // stored on the selected class. Keep the source UUID exactly as its own
  // character creator does; without it the subclass is rejected and the
  // entire wizard appears to reset.
  source.uuid = document.uuid;
  source._stats = {
    ...(source._stats ?? {}),
    compendiumSource: document.uuid
  };
  return source;
}

function wizardKindFromSource(source) {
  return source?.flags?.[FLAG_SCOPE]?.kind ?? null;
}

function cloneWizardSource(source) {
  const cloned = foundry.utils.deepClone
    ? foundry.utils.deepClone(source)
    : JSON.parse(JSON.stringify(source));
  const compendiumSource = cloned?._stats?.compendiumSource;
  if (!cloned.uuid && compendiumSource) cloned.uuid = compendiumSource;
  return cloned;
}

async function createWizardDocument(actor, documentOrSource, { keepId = false } = {}) {
  const source = documentOrSource?.toObject
    ? wizardDocumentSource(documentOrSource)
    : cloneWizardSource(documentOrSource);
  const expectedKind = wizardKindFromSource(source);
  const expectedName = source.name ?? "выбранная карточка";
  const created = await actor.createEmbeddedDocuments(
    "Item",
    [source],
    keepId ? { keepId: true } : {}
  );
  const result = created?.find?.(item => {
    const kind = choiceKind(item);
    return (!expectedKind || kind === expectedKind) && item.name === expectedName;
  });
  if (!result) {
    throw new Error(`Daggerheart отклонил карточку «${expectedName}» (${expectedKind ?? source.type}).`);
  }
  return result;
}

async function deleteWizardItems(actor, items = actor.items.filter(isWizardChoiceItem)) {
  const deletionOrder = [
    "class-feature",
    "faction-feature",
    "subclass",
    "faction",
    "class"
  ];
  for (const kind of deletionOrder) {
    const ids = items
      .filter(item => choiceKind(item) === kind && actor.items.get(item.id))
      .map(item => item.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
  }
}

async function restoreWizardSnapshot(actor, sources) {
  const creationOrder = ["class", "subclass", "faction", "class-feature", "faction-feature"];
  for (const kind of creationOrder) {
    for (const source of sources.filter(entry => wizardKindFromSource(entry) === kind)) {
      // Creating a class/community may already materialize its linked base
      // feature. Do not duplicate it while restoring a previous build.
      if (
        ["class-feature", "faction-feature"].includes(kind) &&
        actor.items.some(item => choiceKind(item) === kind && item.name === source.name)
      ) {
        continue;
      }
      await createWizardDocument(actor, source, { keepId: true });
    }
  }
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
  const previousBuild = actor.getFlag?.(FLAG_SCOPE, "characterBuild");
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
    if (previousItems.length) await deleteWizardItems(actor, previousItems);

    // These documents must be created one after another. Daggerheart's
    // subclass pre-create hook checks the actor's already embedded class.
    for (const document of primaryDocuments) {
      await createWizardDocument(actor, document);
    }

    // Some Daggerheart sheets materialize linked features automatically. Only
    // create the feature cards that are still absent after class/faction import.
    const missingFeatures = featureDocuments.filter(document => {
      const kind = choiceKind(document);
      return !actor.items.some(
        item => choiceKind(item) === kind && item.name === document.name
      );
    });
    if (missingFeatures.length) {
      const created = await actor.createEmbeddedDocuments(
        "Item",
        missingFeatures.map(wizardDocumentSource)
      );
      if (created.length !== missingFeatures.length) {
        throw new Error(
          `Daggerheart добавил ${created.length} из ${missingFeatures.length} выбранных способностей.`
        );
      }
    }
    const suggestedTraits = selection.classItem.system?.characterGuide?.suggestedTraits ?? {};
    const traitUpdates = {};
    for (const key of Object.keys(TRAITS)) {
      const value = Number(suggestedTraits[key]);
      if (Number.isFinite(value)) traitUpdates[`system.traits.${key}.value`] = value;
    }
    if (Object.keys(traitUpdates).length) await actor.update(traitUpdates);
    const createdChoices = actor.items.filter(isWizardChoiceItem);
    const createdKinds = createdChoices.map(choiceKind);
    const expectedCounts = {
      class: 1,
      subclass: 1,
      "class-feature": 3,
      faction: 1,
      "faction-feature": 1
    };
    for (const [kind, expected] of Object.entries(expectedCounts)) {
      const actual = createdKinds.filter(value => value === kind).length;
      if (actual !== expected) {
        throw new Error(`После сохранения ${kind}: ${actual}/${expected}.`);
      }
    }

    await actor.setFlag(FLAG_SCOPE, "characterBuild", {
      schema: 1,
      class: {
        name: selection.classItem.name,
        slug: ncFlag(selection.classItem, "slug"),
        uuid: selection.classItem.uuid
      },
      subclass: {
        name: selection.subclassItem.name,
        slug: ncFlag(selection.subclassItem, "slug"),
        uuid: selection.subclassItem.uuid
      },
      abilities: selection.abilities.map(item => ({
        name: item.name,
        uuid: item.uuid
      })),
      faction: {
        name: selection.factionItem.name,
        slug: ncFlag(selection.factionItem, "slug"),
        uuid: selection.factionItem.uuid
      }
    });
    await actor.setFlag(FLAG_SCOPE, "wizardComplete", true);
    await recalculateCyberpsychosis(actor, { render: false });
    ui.notifications.info(
      `${actor.name}: ${selection.classItem.name}, ${selection.subclassItem.name}, две способности и фракция добавлены.`
    );
  } catch (error) {
    console.error(`${MODULE_ID} | Не удалось применить мастер создания`, error);
    try {
      await deleteWizardItems(actor);
      if (previousSources.length) await restoreWizardSnapshot(actor, previousSources);
      await actor.update(
        Object.fromEntries(
          Object.entries(previousTraits).map(([key, value]) => [`system.traits.${key}.value`, value])
        )
      );
      if (previousBuild !== undefined) {
        await actor.setFlag(FLAG_SCOPE, "characterBuild", previousBuild);
      }
      ui.notifications.error(
        `Не удалось применить выборы: ${error.message} Предыдущее состояние восстановлено.`
      );
    } catch (restoreError) {
      console.error(`${MODULE_ID} | Не удалось восстановить прежний выбор`, restoreError);
      ui.notifications.error(
        `Не удалось сохранить конструктор: ${error.message}. Восстановление также завершилось ошибкой.`
      );
    }
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

async function openNativeLevelUp(actor) {
  if (!actor?.isOwner) return ui.notifications.warn("Для повышения персонажа нужны права владельца.");
  if (!selectedClass(actor)) {
    return ui.notifications.warn("Сначала создайте персонажа и выберите класс.");
  }
  if (currentLevel(actor) >= 10) return ui.notifications.info("Персонаж уже достиг 10 уровня.");

  const exposedConstructors = [
    game.system?.api?.applications?.CharacterLevelup,
    game.system?.api?.applications?.CharacterLevelUp,
    globalThis.CONFIG?.DH?.applications?.CharacterLevelup,
    globalThis.CONFIG?.DH?.applications?.CharacterLevelUp
  ].filter(candidate => typeof candidate === "function");
  let LevelUp = exposedConstructors[0] ?? null;
  if (!LevelUp) {
    for (const path of [
      "/systems/daggerheart/module/applications/levelup/characterLevelup.mjs",
      "/systems/daggerheart/module/applications/levelup/_module.mjs"
    ]) {
      try {
        const imported = await import(path);
        LevelUp = imported.default ?? imported.CharacterLevelup ?? imported.CharacterLevelUp;
        if (typeof LevelUp === "function") break;
      } catch (error) {
        console.debug(`${MODULE_ID} | Нативный модуль повышения недоступен по ${path}`, error);
      }
    }
  }
  if (typeof LevelUp !== "function") {
    return ui.notifications.error(
      "Не удалось открыть процесс повышения Daggerheart. Проверьте, что установлена версия системы 1.9.14."
    );
  }
  const application = new LevelUp(actor);
  try {
    return application.render({ force: true });
  } catch {
    return application.render(true);
  }
}

async function openProgressionMenu(actor) {
  if (!actor?.isOwner) return ui.notifications.warn("Для изменения персонажа нужны права владельца.");
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2?.wait) return runCharacterWizard(actor);
  const choice = await DialogV2.wait({
    window: { title: "Развитие персонажа" },
    classes: ["nc2073-progression-dialog"],
    position: { width: 430 },
    content: `
      <div class="nc2073-progression-menu">
        <p>Выберите действие для <strong>${escapeHtml(actor.name)}</strong>.</p>
        <div>
          <span><i class="fa-solid fa-user-plus"></i><strong>Создать</strong><small>Класс → подкласс → две способности → фракция</small></span>
          <span><i class="fa-solid fa-arrow-up-right-dots"></i><strong>Повысить</strong><small>Нативный процесс повышения Daggerheart</small></span>
        </div>
      </div>
    `,
    buttons: [
      { action: "create", icon: "fa-solid fa-user-plus", label: "Создать", callback: () => "create" },
      { action: "levelup", icon: "fa-solid fa-arrow-up-right-dots", label: "Повысить", callback: () => "levelup" },
      { action: "cancel", icon: "fa-solid fa-xmark", label: "Отмена", callback: () => null }
    ],
    rejectClose: false,
    modal: true
  });
  if (choice === "create") return runCharacterWizard(actor);
  if (choice === "levelup") return openNativeLevelUp(actor);
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
  const armorItems = actor.items.filter(item => item.type === "armor");
  const classItem = selectedClass(actor);
  const subclassItem = selectedSubclass(actor);
  const factionItem = actorFaction(actor);
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
  const quickItems = quickAccessIds(actor).map(itemId => actorItem(actor, itemId)).filter(Boolean);
  const level = currentLevel(actor);
  const recordId = `NC-${actor.id.slice(0, 4).toUpperCase()}-${actor.id.slice(-6).toUpperCase()}`;
  const identityItems = [classItem, subclassItem, factionItem].filter(Boolean);
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

        ${quickAccessMarkup(quickItems, editable)}

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
              <span class="nc2073-name__text">${escapeHtml(actor.name)}</span>
              <i class="fa-solid fa-pen"></i>
            </button>
            <div class="nc2073-chips">
              ${identityChip(classItem, "Класс не выбран")}
              ${identityChip(subclassItem, "Подкласс не выбран")}
              ${identityChip(factionItem, "Фракция не выбрана")}
            </div>
          </div>
          <div class="nc2073-identity-actions">
            <button type="button" class="nc2073-progression-button" data-nc-action="progression"
              ${editable ? "" : "disabled"}
              title="Создание или повышение персонажа" aria-label="Создание или повышение персонажа">
              <i class="fa-solid fa-arrow-up-right-dots"></i>
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
                <span class="nc2073-trait__label">Удача</span>
                <button type="button" class="nc2073-trait__roll" data-nc-action="luck"
                  title="Клик: обычная проверка · Shift: преимущество · Alt: помеха">
                  <strong class="nc2073-trait__value">${actorLuck(actor) >= 0 ? "+" : ""}${actorLuck(actor)}</strong>
                  <small>d20</small>
                </button>
                <span class="nc2073-luck-controls">
                  <button type="button" data-nc-action="luck-adjust" data-delta="-1" ${editable ? "" : "disabled"}>−</button>
                  <button type="button" data-nc-action="luck-adjust" data-delta="1" ${editable ? "" : "disabled"}>+</button>
                </span>
              </div>
            </div>
            <div class="nc2073-section-grid nc2073-section-grid--properties">
              ${itemSection("Класс, подкласс и фракция", featureList(identityItems, "Выборы персонажа ещё не добавлены.", { quick: false, editable }))}
              ${itemSection("Активные способности", featureList(activeFeatures, "Выберите две классовые способности.", { editable }))}
              ${itemSection("Пассивные свойства", featureList(passiveFeatures, "Пассивные свойства пока не добавлены.", { editable }))}
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
              ${itemSection("Оружие", inventoryList(inventoryWeapons, "Перетащите оружие из компендиума.", { weapons: true, equipment: true, quick: true, deletable: true, editable }))}
              ${itemSection("Броня", inventoryList(armorItems, "Экипированная броня отсутствует.", { equipment: true, editable }))}
              ${itemSection("Расходники", inventoryList(consumables, "Расходников нет.", { quick: true, deletable: true, editable }))}
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

  if (action === "weapon-attack") {
    await rollWeapon(actor, actor.items.get(control.dataset.itemId), event);
    return;
  }

  if (action === "weapon-damage") {
    await rollWeaponDamage(actor, actor.items.get(control.dataset.itemId));
    return;
  }

  if (action === "weapon-details") {
    await showWeaponDialog(actor, actor.items.get(control.dataset.itemId));
    return;
  }

  if (action === "duality") {
    await rollItemDuality(actor, actor.items.get(control.dataset.itemId), event);
    return;
  }

  if (action === "quick-use") {
    await useQuickItem(actor, actorItem(actor, control.dataset.itemId), event);
    return;
  }

  if (action === "quick-add") {
    await chooseQuickItem(actor);
    return;
  }

  if (action === "quick-remove") {
    await removeQuickItem(actor, control.dataset.itemId);
    return;
  }

  if (action === "quick-toggle") {
    await toggleQuickItem(actor, actorItem(actor, control.dataset.itemId));
    return;
  }

  if (action === "item") {
    actorItem(actor, control.dataset.itemId)?.sheet?.render?.(true);
    return;
  }

  if (action === "equip") {
    await toggleEquipment(actor, actorItem(actor, control.dataset.itemId));
    return;
  }

  if (action === "implant-toggle") {
    const item = actorItem(actor, control.dataset.itemId);
    await toggleImplant(actor, item, ncFlag(item, "equipped") !== true);
    return;
  }

  if (action === "item-delete") {
    await deleteActorItem(actor, actorItem(actor, control.dataset.itemId));
    return;
  }

  if (action === "resource-set") {
    const track = control.closest("[data-resource-track]");
    const previous = Number(track?.dataset.current) || 0;
    const requested = Number(control.dataset.value);
    const optimistic = requested === previous ? previous - 1 : requested;
    updateResourceTrackState(track, optimistic);
    try {
      const actual = await setResourceValue(actor, control.dataset.resource, requested);
      if (actual !== null && track?.isConnected) updateResourceTrackState(track, actual);
    } catch (error) {
      if (track?.isConnected) updateResourceTrackState(track, previous);
      console.error(`${MODULE_ID} | Не удалось изменить ресурс`, error);
      ui.notifications.error("Не удалось изменить ресурс персонажа.");
    }
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

  if (action === "progression") {
    await openProgressionMenu(actor);
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
  panel.addEventListener("dragstart", event => handlePanelDragStart(event, actor));
  panel.addEventListener("dragover", event => handleQuickDragOver(event, actor));
  panel.addEventListener("dragleave", handleQuickDragLeave);
  panel.addEventListener("drop", event => handleQuickDrop(event, actor));

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
    toggleImplant,
    quickAccessIds,
    setQuickAccess,
    addQuickItem,
    removeQuickItem,
    openProgressionMenu,
    openNativeLevelUp
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
  const actor = item.parent?.documentName === "Actor" ? item.parent : null;
  if (!actor) return;
  const quickAccess = actor.getFlag?.(FLAG_SCOPE, "quickAccess");
  if (Array.isArray(quickAccess) && quickAccess.includes(item.id)) {
    await actor.setFlag(FLAG_SCOPE, "quickAccess", quickAccess.filter(itemId => itemId !== item.id));
  }
  const storedSlots = actor.getFlag?.(FLAG_SCOPE, "quickSlots");
  if (Array.isArray(storedSlots) && storedSlots.includes(item.id)) {
    await actor.setFlag(FLAG_SCOPE, "quickSlots", storedSlots.map(itemId => (itemId === item.id ? null : itemId)));
  }
  if (isNightCityItem(item, "implant")) await recalculateCyberpsychosis(actor);
});

Hooks.on("updateActor", async (actor, changes, options) => {
  if (options?.nc2073Sync || actor.type !== "character") return;
  if (foundry.utils.hasProperty(changes, "system.levelData.level.current")) {
    await recalculateCyberpsychosis(actor);
  }
});
