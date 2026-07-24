import { ClassicLevel } from "/tmp/voidborne-tools/node_modules/classic-level/index.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_ID = "daggerheart-night-city-2073-fv13";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function fail(message) {
  errors.push(message);
}

async function readPack(relative, prefix) {
  const db = new ClassicLevel(path.join(ROOT, relative), { valueEncoding: "utf8" });
  await db.open();
  const documents = [];
  const folders = [];
  for await (const [key, value] of db.iterator()) {
    const parsed = JSON.parse(value);
    if (String(key).startsWith("!folders!")) folders.push(parsed);
    if (String(key).startsWith(`!${prefix}!`) && !String(key).includes(".")) documents.push(parsed);
  }
  await db.close();
  return { documents, folders };
}

const manifest = JSON.parse(await readFile(path.join(ROOT, "module.json"), "utf8"));
if (manifest.id !== MODULE_ID) fail(`Unexpected module id: ${manifest.id}`);
if (manifest.compatibility?.minimum !== "13.346") fail("Foundry minimum must be 13.346.");
if (manifest.compatibility?.verified !== "13.351") fail("Foundry verified version must be 13.351.");
if (manifest.compatibility?.maximum !== "13") fail("Foundry maximum must be 13.");
const daggerheart = manifest.relationships?.systems?.find(system => system.id === "daggerheart");
if (daggerheart?.compatibility?.verified !== "1.9.14") {
  fail("Daggerheart verified version must be 1.9.14.");
}
if (!manifest.relationships?.systems?.some(system => system.id === "daggerheart")) {
  fail("Daggerheart system relationship is missing.");
}

const itemPack = await readPack("packs/nc2073-items", "items");
const macroPack = await readPack("packs/nc2073-macros", "macros");
const ids = new Set();
for (const document of [...itemPack.documents, ...itemPack.folders, ...macroPack.documents]) {
  if (ids.has(document._id)) fail(`Duplicate id: ${document._id}`);
  ids.add(document._id);
  if (!/^[a-z0-9]{16}$/.test(document._id)) fail(`Invalid Foundry id: ${document._id}`);
  if (document._stats?.coreVersion !== "13.351") {
    fail(`${document.name}: unexpected _stats.coreVersion ${document._stats?.coreVersion}.`);
  }
  if (document.type !== "script" && document._stats?.systemVersion !== "1.9.14") {
    fail(`${document.name}: unexpected _stats.systemVersion ${document._stats?.systemVersion}.`);
  }
}

const classes = itemPack.documents.filter(document => document.type === "class");
const features = itemPack.documents.filter(
  document => document.flags?.[MODULE_ID]?.kind === "class-feature"
);
const weapons = itemPack.documents.filter(
  document => document.flags?.[MODULE_ID]?.kind === "weapon"
);
const implants = itemPack.documents.filter(
  document => document.flags?.[MODULE_ID]?.kind === "implant"
);
const rules = features.filter(document => document.flags[MODULE_ID].classSlug === "rules");
const actualClassFeatures = features.filter(
  document => document.flags[MODULE_ID].classSlug !== "rules"
);

if (classes.length !== 4) fail(`Expected 4 classes, got ${classes.length}.`);
if (actualClassFeatures.length !== 20) {
  fail(`Expected 20 class features (4 base + 16 choices), got ${actualClassFeatures.length}.`);
}
if (weapons.length !== 24) fail(`Expected 24 weapons, got ${weapons.length}.`);
if (implants.length !== 11) fail(`Expected 11 implants, got ${implants.length}.`);
if (rules.length !== 8) fail(`Expected 8 rule cards, got ${rules.length}.`);
if (macroPack.documents.length !== 6) fail(`Expected 6 macros, got ${macroPack.documents.length}.`);

for (const classItem of classes) {
  const slug = classItem.flags?.[MODULE_ID]?.slug;
  const matching = actualClassFeatures.filter(
    feature => feature.flags?.[MODULE_ID]?.classSlug === slug
  );
  if (matching.length !== 5) {
    fail(`${classItem.name}: expected 5 linked/choice feature cards, got ${matching.length}.`);
  }
  const baseRefs = classItem.system?.features ?? [];
  if (baseRefs.length !== 1) fail(`${classItem.name}: expected exactly one automatic base feature.`);
  for (const reference of baseRefs) {
    if (!reference.item?.startsWith(`Compendium.${MODULE_ID}.${manifest.packs[0].name}.Item.`)) {
      fail(`${classItem.name}: feature reference uses the wrong module or pack: ${reference.item}.`);
    }
    const id = reference.item?.split(".").at(-1);
    if (!ids.has(id)) fail(`${classItem.name}: missing feature reference ${reference.item}.`);
  }
}

for (const weapon of weapons) {
  const flags = weapon.flags[MODULE_ID];
  const expectedFormula = `@prof${flags.damageDie}`;
  const damageParts = weapon.system?.attack?.damage?.parts;
  if (!Array.isArray(damageParts)) {
    fail(`${weapon.name}: Foundry 13/Daggerheart 1.9 damage.parts must be an array.`);
    continue;
  }
  for (const legacyKey of ["areas"]) {
    if (legacyKey in weapon.system.attack) {
      fail(`${weapon.name}: unsupported Daggerheart 1.9 action field ${legacyKey} remains.`);
    }
  }
  const hitPointPart = damageParts.find(part => part.applyTo === "hitPoints");
  const nativeFormula = hitPointPart?.value?.custom?.formula;
  if (flags.damageFormula !== expectedFormula) {
    fail(`${weapon.name}: flag formula ${flags.damageFormula} != ${expectedFormula}.`);
  }
  if (nativeFormula !== expectedFormula) {
    fail(`${weapon.name}: native formula ${nativeFormula} != ${expectedFormula}.`);
  }
  if (hitPointPart?.value?.custom?.enabled !== true) {
    fail(`${weapon.name}: custom native damage formula is disabled.`);
  }
  if (!weapon.system?.attack?.roll?.trait) fail(`${weapon.name}: attack trait is missing.`);
  if (!weapon.system?.attack?.range) fail(`${weapon.name}: attack range is missing.`);
}

for (const implant of implants) {
  const flags = implant.flags[MODULE_ID];
  if (flags.load !== 1) fail(`${implant.name}: implant load must be 1.`);
  if (flags.equipped !== false) fail(`${implant.name}: compendium implant must start unequipped.`);
  if (!flags.zone) fail(`${implant.name}: body zone is missing.`);
  if (flags.integratedWeapon) {
    const damageParts = implant.system?.attack?.damage?.parts;
    if (!Array.isArray(damageParts)) {
      fail(`${implant.name}: Foundry 13/Daggerheart 1.9 damage.parts must be an array.`);
      continue;
    }
    const nativeFormula =
      damageParts.find(part => part.applyTo === "hitPoints")?.value?.custom?.formula;
    if (implant.type !== "weapon") fail(`${implant.name}: integrated weapon must use weapon item type.`);
    if (nativeFormula !== flags.damageFormula) {
      fail(`${implant.name}: integrated weapon formula does not match its flag.`);
    }
  }
}

const formulas = JSON.parse(await readFile(path.join(ROOT, "data", "weapon-formulas.json"), "utf8"));
if (Object.keys(formulas).length !== 29) {
  fail(`weapon-formulas.json contains ${Object.keys(formulas).length} entries instead of 29.`);
}

const forbiddenEnglish = /\b(Hope|Stress|Hit Points|Agility|Strength|Finesse|Instinct|Presence|Knowledge)\b/;
for (const document of itemPack.documents) {
  const visible = `${document.name}\n${document.system?.description ?? ""}`;
  if (forbiddenEnglish.test(visible)) fail(`${document.name}: visible English system term remains.`);
}

if (errors.length) {
  console.error(`Validation failed with ${errors.length} problem(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Validation passed.");
  console.log(
    `Items ${itemPack.documents.length}; folders ${itemPack.folders.length}; macros ${macroPack.documents.length}.`
  );
  console.log(
    `Classes ${classes.length}; class features ${actualClassFeatures.length}; weapons ${weapons.length}; implants ${implants.length}; rules ${rules.length}.`
  );
}
