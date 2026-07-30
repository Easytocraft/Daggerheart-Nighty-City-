const MODULE_ID = "daggerheart-night-city-2073-fv13";
const FLAG_SCOPE = MODULE_ID;

const TRAITS = {
  strength: { label: "Сила", className: "" },
  agility: { label: "Ловкость", className: "" },
  knowledge: { label: "Интеллект", className: "" },
  instinct: { label: "Инстинкт", className: "" },
  finesse: { label: "Влияние", className: "" },
  presence: { label: "Крутость", className: "" },
};

const ROLL_MODE = Object.freeze({
  normal: { label: "обычная", formula: "1d20" },
  advantage: { label: "преимущество", formula: "2d20kh" },
  disadvantage: { label: "помеха", formula: "2d20kl" }
});

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

function armorData(actor) {
  const native = resourceData(actor, "armor");
  return {
    native,
    value: native.value,
    max: native.max
  };
}

async function changeArmor(actor, delta) {
  if (!actor?.isOwner) return;
  const data = armorData(actor);
  if (delta > 0) {
    if (data.native.value < data.native.max && actor.modifyResource) {
      await actor.modifyResource([{ key: "armor", value: 1 }]);
    }
    return;
  }

  if (data.native.value > 0 && actor.modifyResource) {
    await actor.modifyResource([{ key: "armor", value: -1 }]);
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
  const rollMode = ROLL_MODE[mode] ?? ROLL_MODE.normal;
  const numericModifier = Number(modifier) || 0;
  const sign = numericModifier >= 0 ? "+" : "-";
  const formula = `${rollMode.formula} ${sign} ${Math.abs(numericModifier)}`;
  const roll = await new Roll(formula).evaluate();
  return roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${label} · d20 · ${rollMode.label}`
  });
}

async function rollTrait(actor, trait, mode = "normal") {
  actor ??= selectedActor();
  if (!actor) return ui.notifications.warn("Выберите токен или назначьте персонажа.");
  const modifier = Number(actor.system?.traits?.[trait]?.value) || 0;
  return rollD20(actor, TRAITS[trait]?.label ?? trait, modifier, mode);
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

async function rollWeapon(actor, item, mode = "normal") {
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
  const modifier = Number(actor.system?.traits?.[trait]?.value) || 0;
  const traitLabel = item.getFlag(FLAG_SCOPE, "attackTraitLabel") ?? TRAITS[trait]?.label ?? trait;
  await rollD20(actor, `${item.name} · атака (${traitLabel})`, modifier, mode);
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

function effectRows(actor) {
  const effects = Array.from(actor.effects ?? []);
  if (!effects.length) {
    return `<div class="nc2073-panel__empty">На персонажа сейчас не действуют эффекты.</div>`;
  }
  return effects
    .map(effect => {
      const disabled = effect.disabled ? "отключён" : "активен";
      const duration = effect.duration?.remaining
        ? ` · осталось ${effect.duration.remaining}`
        : "";
      return `
        <div class="nc2073-panel__item">
          <span class="nc2073-panel__item-name">
            ${escapeHtml(effect.name ?? effect.label ?? "Эффект")}
            <span class="nc2073-panel__item-meta">${disabled}${duration}</span>
          </span>
        </div>
      `;
    })
    .join("");
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

function featureList(items, emptyText) {
  if (!items.length) return `<div class="nc2073-empty">${escapeHtml(emptyText)}</div>`;
  return items
    .map(item => {
      const direction = ncFlag(item, "direction") ?? item.system?.featureForm ?? "класс";
      const description = itemDescription(item);
      return `
        <button type="button" class="nc2073-card nc2073-card--feature"
          data-nc-action="item" data-item-id="${item.id}">
          <img src="${escapeHtml(item.img)}" alt="">
          <span class="nc2073-card__copy">
            <strong>${escapeHtml(item.name)}</strong>
            <small>${escapeHtml(direction)}</small>
            ${description ? `<span>${escapeHtml(description)}</span>` : ""}
          </span>
        </button>
      `;
    })
    .join("");
}

function inventoryList(items, emptyText, { weapons = false } = {}) {
  if (!items.length) return `<div class="nc2073-empty">${escapeHtml(emptyText)}</div>`;
  return items
    .map(item => {
      const quantity = itemQuantity(item);
      const description = itemDescription(item);
      const formula = ncFlag(item, "damageFormula");
      const range = ncFlag(item, "rangeLabel");
      const meta = formula
        ? `${formula}${range ? ` · ${range}` : ""}`
        : quantity > 1
          ? `x${quantity}`
          : item.type ?? "предмет";
      return `
        <div class="nc2073-card ${weapons ? "nc2073-card--weapon" : ""}">
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
                  title="Клик: обычная атака · Shift: преимущество · Alt: помеха">Атака</button>`
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
      ${action === "weapon" ? 'title="Клик: обычная атака · Shift: преимущество · Alt: помеха"' : ""}>
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
    const delta = target - current;
    if (delta && actor.modifyResource) await actor.modifyResource([{ key: "armor", value: delta }]);
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
    getPropertySafe(actor, "system.biography.value") ??
    getPropertySafe(actor, "system.biography") ??
    getPropertySafe(actor, "system.description.value") ??
    getPropertySafe(actor, "system.description") ??
    ""
  );
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
  panel.querySelectorAll("[data-nc-tab]").forEach(element => {
    element.classList.toggle("is-active", element.dataset.ncTab === tab);
  });
  panel.querySelectorAll("[data-nc-tab-target]").forEach(button => {
    const active = button.dataset.ncTabTarget === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
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
  const weapons = actor.items.filter(
    item =>
      isNightCityItem(item, "weapon") ||
      item.getFlag(FLAG_SCOPE, "integratedWeapon") === true
  );
  const equippedWeapons = weapons.filter(
    item =>
      item.system?.equipped === true ||
      item.getFlag(FLAG_SCOPE, "equipped") === true
  );
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
  const quickWeapon = equippedWeapons[0] ?? weapons[0] ?? null;
  const quickImplant = installedItems[0] ?? implants[0] ?? null;
  const quickConsumable = consumables[0] ?? null;
  const level = currentLevel(actor);
  const recordId = `NC-${actor.id.slice(0, 4).toUpperCase()}-${actor.id.slice(-6).toUpperCase()}`;
  const identityItems = [classItem, subclassItem, factionItem, ancestryItem].filter(Boolean);
  const cpWarning =
    cp.value >= cp.max
      ? `<div class="nc2073-warning">Предел Киберпсихоза достигнут.</div>`
      : "";

  const traitButtons = Object.entries(TRAITS)
    .map(([key, trait]) => {
      const value = Number(actor.system?.traits?.[key]?.value) || 0;
      const prefix = value >= 0 ? "+" : "";
      return `
        <button type="button" class="nc2073-trait ${trait.className}"
          data-nc-action="trait" data-trait="${key}"
          title="Клик: обычная проверка · Shift: преимущество · Alt: помеха">
          <span>${trait.label}</span><strong>${prefix}${value}</strong>
        </button>
      `;
    })
    .join("");

  return `
    <section class="nc2073-panel" data-nc-actor-id="${actor.id}">
      <aside class="nc2073-rail">
        <div class="nc2073-rail-head">
          <span>NC-2073 // CITIZEN RECORD</span>
          <i class="nc2073-live" title="AR-канал активен"></i>
        </div>

        <button type="button" class="nc2073-portrait" data-nc-action="native"
          title="Показать или скрыть системный лист Daggerheart">
          <img src="${escapeHtml(actor.img)}" alt="${escapeHtml(actor.name)}">
          <span class="nc2073-scan"></span>
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
          <button type="button" class="is-active" data-nc-action="tab" data-nc-tab-target="properties" aria-selected="true">Свойства</button>
          <button type="button" data-nc-action="tab" data-nc-tab-target="implants" aria-selected="false">Импланты</button>
          <button type="button" data-nc-action="tab" data-nc-tab-target="inventory" aria-selected="false">Инвентарь</button>
          <button type="button" data-nc-action="tab" data-nc-tab-target="bio" aria-selected="false">Биография</button>
          <button type="button" data-nc-action="tab" data-nc-tab-target="effects" aria-selected="false">Эффекты</button>
        </nav>

        <header class="nc2073-identity">
          <div>
            <div class="nc2073-eyebrow"><span>Персональная запись // Проверена</span><span>AR LINK 100%</span></div>
            <h2>${escapeHtml(actor.name)}</h2>
            <div class="nc2073-chips">
              ${identityChip(classItem, "Класс не выбран")}
              ${identityChip(subclassItem, "Подкласс не выбран")}
              ${identityChip(factionItem, "Фракция не выбрана")}
              ${identityChip(ancestryItem, "Происхождение не выбрано")}
            </div>
          </div>
          <div class="nc2073-level"><span>Уровень</span><strong>${level}</strong></div>
        </header>

        <section class="nc2073-resources">
          <div class="nc2073-resource-row nc2073-resource-row--primary">
            ${resourceTrack("hope", "Драйв", drive, "fa-bolt", { editable })}
            <div class="nc2073-resource nc2073-resource--number">
              <div class="nc2073-track-head"><span>Уклонение</span><strong>${actorEvasion(actor)}</strong></div>
              <small>Порог попадания</small>
            </div>
            <div class="nc2073-resource nc2073-resource--number">
              <div class="nc2073-track-head"><span>Эдди</span><strong>${eddiesValue(actor).toLocaleString("ru-RU")}</strong></div>
              <small>Доступный баланс</small>
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
          <div class="nc2073-tab is-active" data-nc-tab="properties">
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

          <div class="nc2073-tab" data-nc-tab="implants">
            <div class="nc2073-tab-head"><h3>Импланты</h3><span>${installed}/${implants.length} включено</span></div>
            <div class="nc2073-card-list nc2073-card-list--wide">${implantList(implants, editable)}</div>
          </div>

          <div class="nc2073-tab" data-nc-tab="inventory">
            <div class="nc2073-section-grid">
              ${itemSection("Оружие", inventoryList(weapons, "Перетащите оружие из компендиума.", { weapons: true }))}
              ${itemSection("Расходники", inventoryList(consumables, "Расходников нет."))}
              ${itemSection("Добыча", inventoryList(loot, "Добычи нет."))}
            </div>
          </div>

          <div class="nc2073-tab" data-nc-tab="bio">
            <div class="nc2073-bio">${stripHtml(biography) ? escapeHtml(stripHtml(biography)) : "Биография персонажа пока не заполнена."}</div>
            <div class="nc2073-data-grid">
              <div><span>Класс</span><strong>${escapeHtml(classItem?.name ?? "—")}</strong></div>
              <div><span>Подкласс</span><strong>${escapeHtml(subclassItem?.name ?? "—")}</strong></div>
              <div><span>Фракция</span><strong>${escapeHtml(factionItem?.name ?? "—")}</strong></div>
              <div><span>Происхождение</span><strong>${escapeHtml(ancestryItem?.name ?? "—")}</strong></div>
            </div>
          </div>

          <div class="nc2073-tab" data-nc-tab="effects">
            <div class="nc2073-data-list">${effectList(actor)}</div>
          </div>
        </section>

        <footer class="nc2073-footer">
          <span>AUTH // ${recordId} · BIOMETRIC MATCH ACTIVE</span>
          <span class="nc2073-bars"></span>
          <button type="button" data-nc-action="death"><i class="fa-solid fa-skull"></i> Проверка смерти</button>
          <button type="button" data-nc-action="native"><i class="fa-solid fa-sliders"></i> Системный лист</button>
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
    await rollTrait(actor, control.dataset.trait, rollModeFromEvent(event));
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
    await rollWeapon(actor, actor.items.get(control.dataset.itemId), rollModeFromEvent(event));
    return;
  }

  if (action === "item") {
    actor.items.get(control.dataset.itemId)?.sheet?.render?.(true);
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

  if (action === "native") {
    control.closest(".nc2073-passport-host, .window-content, form")?.classList.toggle("nc2073-show-native");
    return;
  }

  if (action === "resource") {
    const delta = Number(control.dataset.delta);
    const resource = control.dataset.resource;
    if (resource === "armor") await changeArmor(actor, delta);
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
  host.classList.add("nc2073-passport-host");
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
    rollDeathSave,
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
