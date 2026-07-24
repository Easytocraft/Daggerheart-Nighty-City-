import { ClassicLevel } from "/tmp/voidborne-tools/node_modules/classic-level/index.js";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_ID = "daggerheart-night-city-2073-fv13";
const ITEM_PACK = "nc2073-items";
const MACRO_PACK = "nc2073-macros";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CREATED = Date.UTC(2026, 6, 24, 12, 0, 0);

function idFor(seed) {
  return createHash("sha256").update(`${MODULE_ID}:${seed}`).digest("hex").slice(0, 16);
}

function uuid(id) {
  return `Compendium.${MODULE_ID}.${ITEM_PACK}.Item.${id}`;
}

function stats(system = true) {
  return {
    coreVersion: "13.351",
    systemId: system ? "daggerheart" : null,
    systemVersion: system ? "1.9.14" : null,
    createdTime: CREATED,
    modifiedTime: CREATED,
    lastModifiedBy: null,
    compendiumSource: null,
    duplicateSource: null,
    exportSource: null
  };
}

function ownership() {
  return { default: 0 };
}

function folder(name, parent = null, type = "Item", sort = 0) {
  const _id = idFor(`folder:${type}:${parent ?? "root"}:${name}`);
  return {
    type,
    folder: parent,
    name,
    color: null,
    sorting: "a",
    _id,
    description: "",
    sort,
    flags: {},
    _stats: stats(type === "Item")
  };
}

function baseItem({ seed, folder, name, type, img, system, sort = 0, flags = {} }) {
  return {
    folder,
    name,
    type,
    _id: idFor(`item:${seed}`),
    img,
    system: {
      attribution: {
        source: "Night City 2073 — домашняя адаптация",
        page: null,
        artist: ""
      },
      ...system
    },
    effects: [],
    sort,
    ownership: ownership(),
    flags,
    _stats: stats()
  };
}

function featureItem({ seed, folder, name, description, img, sort = 0, direction = null, classSlug = null }) {
  return baseItem({
    seed,
    folder,
    name,
    type: "feature",
    img,
    sort,
    system: {
      description,
      resource: null,
      actions: {},
      originItemType: null,
      multiclassOrigin: false,
      identifier: "",
      featureForm: "passive"
    },
    flags: {
      [MODULE_ID]: {
        kind: "class-feature",
        direction,
        classSlug
      }
    }
  });
}

const folders = {};
folders.rules = folder("Правила Night City 2073", null, "Item", 100000);
folders.classes = folder("Классы", null, "Item", 200000);
folders.classFeatures = folder("Классовые способности", folders.classes._id, "Item", 210000);
folders.juggernaut = folder("Джаггернаут", folders.classFeatures._id, "Item", 211000);
folders.netrunner = folder("Нетраннер", folders.classFeatures._id, "Item", 212000);
folders.rocker = folder("Рокер", folders.classFeatures._id, "Item", 213000);
folders.ghost = folder("Призрак", folders.classFeatures._id, "Item", 214000);
folders.weapons = folder("Оружие", null, "Item", 300000);
folders.pistols = folder("Пистолеты", folders.weapons._id, "Item", 310000);
folders.smgs = folder("Пистолеты-пулемёты", folders.weapons._id, "Item", 320000);
folders.shotguns = folder("Дробовики", folders.weapons._id, "Item", 330000);
folders.rifles = folder("Винтовки", folders.weapons._id, "Item", 340000);
folders.heavy = folder("Тяжёлое оружие", folders.weapons._id, "Item", 350000);
folders.melee = folder("Ближний бой", folders.weapons._id, "Item", 360000);
folders.implants = folder("Импланты", null, "Item", 400000);
folders.os = folder("Операционные системы", folders.implants._id, "Item", 410000);
folders.combatImplants = folder("Боевые импланты", folders.implants._id, "Item", 420000);
folders.sensoryImplants = folder("Сенсорные и физические", folders.implants._id, "Item", 430000);
folders.socialImplants = folder("Социальные", folders.implants._id, "Item", 440000);

const rules = [
  {
    seed: "rules-resources",
    name: "Основные ресурсы",
    img: "icons/commodities/tech/battery-lit-blue.webp",
    description: `
      <h2>Ресурсы персонажа</h2>
      <p><strong>Раны</strong> заменяют системный ресурс здоровья. Лёгкий урон отмечает 1 Рану, ощутимый — 2, тяжёлый — 3.</p>
      <p><strong>Драйв</strong> заменяет Надежду и получается при броске дуальности с Драйвом.</p>
      <p><strong>Киберпсихоз</strong> заменяет Стресс. Способности и перегрузка имплантов могут отмечать его ячейки.</p>
      <p><strong>Броня</strong> сохраняет стандартные ячейки Daggerheart. <strong>Страх</strong> остаётся ресурсом Ведущего.</p>
    `
  },
  {
    seed: "rules-traits",
    name: "Характеристики",
    img: "icons/skills/trades/academics-investigation-puzzles.webp",
    description: `
      <h2>Характеристики</h2>
      <ul>
        <li><strong>Рефлексы:</strong> скорость, реакция, уклонение и стрельба.</li>
        <li><strong>Телосложение:</strong> сила, выносливость и тяжёлое оружие.</li>
        <li><strong>Восприятие:</strong> наблюдение, засады и поиск слабостей.</li>
        <li><strong>Крутость:</strong> обман, запугивание, убеждение и самообладание.</li>
        <li><strong>Интеллект:</strong> взлом, анализ, знания, ремонт и импланты.</li>
        <li><strong>Удача:</strong> смерть персонажа, вероятность случайного события и азартные игры.</li>
      </ul>
      <p>Удача не заменяет обычную проверку навыка и используется только тогда, когда исход действительно решает случай.</p>
    `
  },
  {
    seed: "rules-damage",
    name: "Урон и Раны",
    img: "icons/skills/wounds/blood-drip-droplet-red.webp",
    description: `
      <h2>Формула урона</h2>
      <p>Оружие бросает кость за каждую единицу Мастерства: <code>@profd6</code>, <code>@profd8</code>, <code>@profd10</code> или <code>@profd12</code>.</p>
      <p>Итог сравнивается с порогами цели. Ниже ощутимого порога — лёгкий урон и 1 Рана; от ощутимого до тяжёлого — 2 Раны; от тяжёлого — 3 Раны.</p>
      <p>Один источник свойств оружия не может повысить тяжесть более чем на одну ступень. Классовая способность может прямо отменять это ограничение.</p>
    `
  },
  {
    seed: "rules-duality",
    name: "Дуальность и Страх",
    img: "icons/sundries/gaming/dice-pair-white-green.webp",
    description: `
      <h2>Бросок дуальности</h2>
      <p>Проверки совершаются двумя d12 — костью Драйва и костью Страха — плюс характеристика и подходящие модификаторы.</p>
      <p>Если выше Драйв, персонаж получает 1 Драйв. Если выше Страх, Ведущий получает 1 Страх. Равные значения дают критический успех по правилам Daggerheart.</p>
      <p>Модуль использует нативную автоматику Daggerheart, поэтому эти ресурсы обновляются обычным системным броском.</p>
    `
  },
  {
    seed: "rules-cyberpsychosis",
    name: "Киберпсихоз и нагрузка имплантов",
    img: "icons/magic/control/hypnosis-mesmerism-eye.webp",
    description: `
      <h2>Вместимость Киберпсихоза</h2>
      <p><strong>Максимум = базовая вместимость уровня − число установленных имплантов.</strong> Парная система считается одним имплантом.</p>
      <p>Уровни 1–2: 6; 3–4: 7; 5–6: 8; 7–8: 9; 9–10: 10.</p>
      <p>Всегда должна оставаться хотя бы 1 ячейка. Снятие импланта возвращает максимум, но не очищает уже отмеченный Киберпсихоз.</p>
      <p>Панель Night City 2073 автоматически считает установленные импланты и не позволяет превысить предел.</p>
    `
  },
  {
    seed: "rules-weapon-types",
    name: "Типы оружия",
    img: "icons/weapons/guns/gun-pistol-brass.webp",
    description: `
      <h2>Силовое</h2>
      <p><strong>Рикошет:</strong> если цель частично закрыта лёгким укрытием и рядом видна твёрдая отражающая поверхность, укрытие не даёт преимущества. Не работает через дым, мягкое или полное укрытие.</p>
      <h2>Техническое</h2>
      <p>Потратьте действие на зарядку. До конца следующего хода выберите одно: повысить тяжесть урона на ступень, игнорировать лёгкое укрытие, пробить одну цель и попасть в стоящую за ней или заставить цель потратить дополнительную ячейку брони.</p>
      <h2>Энергетическое</h2>
      <p>Зарядите энергооружие действием, чтобы усилить пробитие и повысить тяжесть урона на ступень. Энергетические выстрелы особенно эффективны против брони и техники.</p>
      <h2>Умное</h2>
      <p>Требует умного интерфейса. Потратьте действие на захват цели. Частичное укрытие и обычное перемещение не сбрасывают захват; бросок атаки всё равно требуется.</p>
    `
  },
  {
    seed: "rules-properties",
    name: "Свойства оружия",
    img: "icons/tools/smithing/hammer-sledge-steel-grey.webp",
    description: `
      <p><strong>Скрытное:</strong> атака из скрытности не выдаёт точную позицию сразу. <strong>Быстрое:</strong> после успеха можно сместиться на Очень близкую дистанцию или достать другое оружие. <strong>Автоматическое:</strong> до двух целей, отдельные проверки; второй цели урон на ступень ниже.</p>
      <p><strong>Точное:</strong> после прицеливания тяжесть успешной атаки повышается на ступень. <strong>Заряд:</strong> действие на зарядку; затем +1 ступень или игнорирование укрытия. <strong>Наведение:</strong> после захвата можно атаковать через сенсор, камеру или частичное укрытие.</p>
      <p><strong>Бронебойное:</strong> цель тратит 2 ячейки брони вместо 1 для снижения урона. <strong>Отбрасывание:</strong> сдвиньте цель на одну дистанцию. <strong>Область:</strong> отдельная проверка против каждой цели в зоне, каждой урон на ступень ниже.</p>
      <p><strong>Взрывное:</strong> повреждает укрытия, двери и транспорт. <strong>Несмертельное:</strong> заполнение Ран выводит из строя, а не убивает. <strong>Глушитель:</strong> позиция не раскрывается автоматически.</p>
    `
  },
  {
    seed: "rules-ranges",
    name: "Дистанции",
    img: "icons/skills/ranged/target-bullseye-arrow-glowing.webp",
    description: `
      <ul>
        <li><strong>Вплотную:</strong> рукопашная дистанция.</li>
        <li><strong>Очень близко:</strong> несколько шагов или небольшая комната.</li>
        <li><strong>Близко:</strong> помещение, переулок или короткая улица.</li>
        <li><strong>Далеко:</strong> большая улица, площадь или соседняя крыша.</li>
        <li><strong>Очень далеко:</strong> снайперская дистанция, определяемая сценой.</li>
      </ul>
    `
  }
].map((entry, index) =>
  featureItem({
    ...entry,
    folder: folders.rules._id,
    sort: (index + 1) * 100000,
    classSlug: "rules"
  })
);

const classDefinitions = [
  {
    slug: "juggernaut",
    name: "Джаггернаут",
    folder: folders.juggernaut._id,
    img: "icons/equipment/shield/targe-steel-blue.webp",
    hitPoints: 7,
    evasion: 9,
    traits: { agility: 1, strength: 2, finesse: 0, instinct: 0, presence: 1, knowledge: -1 },
    description: `
      <p>Джаггернаут — передовой боец, который выдерживает огонь, ломает позиции и прикрывает команду.</p>
      <p><strong>Основные характеристики:</strong> Телосложение, Рефлексы и Крутость.</p>
      <p><strong>Выбор способностей:</strong> возьмите ровно две из четырёх карт. Можно взять обе из направления «Штурм», обе из «Защиты» или смешать направления.</p>
    `,
    base: {
      name: "Передовая",
      img: "icons/skills/melee/shield-block-gray-orange.webp",
      description: `<p>Вы обучены тяжёлому оружию и боевой броне. Для тяжёлого оружия используйте <strong>Телосложение</strong>. Когда вы удерживаете проход, ломаете преграду или противостоите принудительному перемещению, Ведущий должен считать вашу подготовку достаточным основанием для проверки Телосложения.</p>`
    },
    choices: [
      {
        direction: "Штурм",
        name: "Пролом",
        img: "icons/skills/movement/figure-running-gray.webp",
        description: `<p>Если перед успешной атакой вы переместились к цели, выберите одно: повысить тяжесть урона на ступень, отбросить цель или разрушить находящееся рядом лёгкое укрытие либо преграду.</p>`
      },
      {
        direction: "Штурм",
        name: "Ответный удар",
        img: "icons/skills/melee/strike-sword-blood-red.webp",
        description: `<p>Когда вы получаете урон от атаки Вплотную и отмечаете Рану или ячейку Брони, отметьте 1 Киберпсихоз, чтобы немедленно совершить базовую атаку против нападавшего.</p>`
      },
      {
        direction: "Защита",
        name: "Перехват",
        img: "icons/skills/melee/shield-block-bash-blue.webp",
        description: `<p>Когда враг попадает по союзнику рядом с вами, отметьте 1 Киберпсихоз и станьте целью вместо него. Союзник избегает попадания; вы применяете урон и Броню как обычно.</p>`
      },
      {
        direction: "Защита",
        name: "Броневой щит",
        img: "icons/magic/defensive/shield-barrier-flaming-diamond-blue.webp",
        description: `<p>Когда союзник рядом получает урон, потратьте 1 ячейку Брони, чтобы снизить тяжесть этого урона на одну ступень.</p>`
      }
    ],
    questions: [
      "Кого вы однажды не сумели защитить и почему до сих пор об этом помните?",
      "Какое улучшение тела заставило вас впервые почувствовать себя неуязвимым?",
      "Где проходит ваша граница между защитником и живым оружием?"
    ],
    connections: [
      "Когда я впервые прикрыл вас собой?",
      "Почему вы доверяете мне остановить вас, если Киберпсихоз возьмёт верх?",
      "Какую тяжёлую правду вы знаете о моём прошлом?"
    ]
  },
  {
    slug: "netrunner",
    name: "Нетраннер",
    folder: folders.netrunner._id,
    img: "icons/magic/lightning/orb-ball-blue.webp",
    hitPoints: 5,
    evasion: 10,
    traits: { agility: 0, strength: -1, finesse: 0, instinct: 1, presence: 1, knowledge: 2 },
    description: `
      <p>Нетраннер управляет цифровым полем боя: вскрывает сети, атакует импланты и перепрошивает устройства.</p>
      <p><strong>Основные характеристики:</strong> Интеллект, Восприятие и Крутость.</p>
      <p><strong>Выбор способностей:</strong> возьмите ровно две карты из направлений «Штурм» и «Контроль» в любой комбинации.</p>
    `,
    base: {
      name: "Подключение",
      img: "icons/magic/symbols/runes-triangle-blue.webp",
      description: `<p>Используйте <strong>Интеллект</strong>, чтобы взаимодействовать с сетевыми устройствами и имплантами: открывать и блокировать доступ, читать и менять данные, управлять камерами, турелями и тревогой. Удалённая работа требует доступной сети, беспроводного канала или кибердеки.</p>`
    },
    choices: [
      {
        direction: "Штурм",
        name: "Киберудар",
        img: "icons/magic/lightning/bolt-forked-blue.webp",
        description: `<p>После успешного взлома вражеского импланта или устройства выберите: нанести лёгкий нейронный урон, отключить один имплант до конца следующего хода или отключить связанное оружие. Отметьте 1 Киберпсихоз, чтобы повысить лёгкий урон до ощутимого.</p>`
      },
      {
        direction: "Штурм",
        name: "Цепная перегрузка",
        img: "icons/magic/lightning/bolts-forked-large-blue.webp",
        description: `<p>После успешного взлома потратьте 1 Драйв, чтобы перенести тот же эффект на другую подключённую цель или устройство рядом. Эффект на второй цели на одну ступень слабее.</p>`
      },
      {
        direction: "Контроль",
        name: "Глубокое погружение",
        img: "icons/magic/perception/eye-ringed-glow-angry-large-blue.webp",
        description: `<p>При успехе против защищённой системы выберите два: увидеть подключённые устройства, найти главный узел, обнаружить скрытую защиту, найти обходной маршрут, оставить команде устойчивый доступ или определить последнего пользователя.</p>`
      },
      {
        direction: "Контроль",
        name: "Перепрошивка",
        img: "icons/magic/control/buff-flight-wings-blue.webp",
        description: `<p>Подключившись к импланту союзника, выберите: снять негативный эффект, позволить игнорировать следующий сбой, дать преимущество следующей проверке или временно усилить одну функцию импланта. Особенно мощное усиление может потребовать отметить 1 Киберпсихоз.</p>`
      }
    ],
    questions: [
      "Какую сеть вы взломали слишком рано и кто теперь ищет вас?",
      "Как выглядит цифровой след, который вы всегда оставляете?",
      "Какой фрагмент чужой памяти вы не можете удалить из собственной головы?"
    ],
    connections: [
      "Почему вы единственный, кому я разрешаю подключаться к моим имплантам?",
      "Какой компромат на меня вы нашли, но не использовали?",
      "Кто из нас вытащил другого из неудачного глубокого погружения?"
    ]
  },
  {
    slug: "rocker",
    name: "Рокер",
    folder: folders.rocker._id,
    img: "icons/tools/instruments/microphone-gray.webp",
    hitPoints: 5,
    evasion: 10,
    traits: { agility: 0, strength: -1, finesse: 0, instinct: 1, presence: 2, knowledge: 1 },
    description: `
      <p>Рокер — голос, способный повести за собой команду или развалить строй врага. Это может быть музыкант, активист, журналист, стример или уличный лидер.</p>
      <p><strong>Основные характеристики:</strong> Крутость, Восприятие и Интеллект.</p>
      <p><strong>Выбор способностей:</strong> возьмите две карты из направлений «Вдохновитель» и «Провокатор» в любой комбинации.</p>
    `,
    base: {
      name: "Сцена",
      img: "icons/magic/sonic/scream-wail-shout-teal.webp",
      description: `<p>Если группа видит или слышит вас, используйте <strong>Крутость</strong>, чтобы воздействовать на неё речью, музыкой, трансляцией или провокацией. Через камеры, экраны и динамики это может работать удалённо.</p>`
    },
    choices: [
      {
        direction: "Вдохновитель",
        name: "Командный ритм",
        img: "icons/magic/sonic/projectile-sound-rings-wave.webp",
        description: `<p>После успешной проверки Крутости выберите слышащего вас союзника. Он получает преимущество следующей проверки, немедленно перемещается в безопасную позицию или получает преимущество в совместном действии.</p>`
      },
      {
        direction: "Вдохновитель",
        name: "Не сдавайся",
        img: "icons/magic/life/heart-cross-strong-flame-green.webp",
        description: `<p>Когда союзник рядом отмечает Рану или Киберпсихоз, потратьте 1 Драйв. Он немедленно перемещается на Близкую дистанцию, совершает простое действие или получает преимущество следующей проверки.</p>`
      },
      {
        direction: "Провокатор",
        name: "На крючке",
        img: "icons/magic/control/debuff-chains-shackles-movement-red.webp",
        description: `<p>Совершите проверку Крутости против врага. При успехе до конца его следующего хода он сосредоточен на вас и получает помеху, если атакует кого-либо другого.</p>`
      },
      {
        direction: "Провокатор",
        name: "Вирусный сигнал",
        img: "icons/magic/sonic/explosion-shock-wave-teal.webp",
        description: `<p>Потратьте 1 Драйв и проверьте Крутость против группы или толпы. При успехе выберите: строй распадается, один враг отступает, враги спорят, лидер теряет контроль, союзники перемещаются незамеченными или толпа становится укрытием.</p>`
      }
    ],
    questions: [
      "Какое выступление сделало ваше имя известным всему району?",
      "Кто превратил ваши слова в оружие против вас?",
      "Что вы готовы потерять, чтобы вас продолжали слышать?"
    ],
    connections: [
      "Какая моя фраза стала частью вашей самой известной записи?",
      "Когда ваш голос не сработал и я спас ситуацию?",
      "Почему именно мне вы показываете себя без публики?"
    ]
  },
  {
    slug: "ghost",
    name: "Призрак",
    folder: folders.ghost._id,
    img: "icons/magic/perception/silhouette-stealth-shadow.webp",
    hitPoints: 6,
    evasion: 12,
    traits: { agility: 2, strength: -1, finesse: 0, instinct: 1, presence: 1, knowledge: 0 },
    description: `
      <p>Призрак специализируется на скрытности, проникновении, разведке и точных убийствах. В открытом бою он действует быстро и методично.</p>
      <p><strong>Основные характеристики:</strong> Рефлексы, Восприятие и Крутость.</p>
      <p><strong>Выбор способностей:</strong> возьмите ровно две из четырёх карт в любой комбинации.</p>
    `,
    base: {
      name: "Тень",
      img: "icons/magic/perception/eye-ringed-glow-angry-small-purple.webp",
      description: `<p>Если вас никто не видит напрямую, проверьте Восприятие или Крутость, чтобы стать Скрытым. Пока вы скрыты, вас нельзя выбрать прямой целью, вы перемещаетесь между укрытиями и получаете преимущество первой атаки. Обычная атака раскрывает вас, если способность не говорит обратного.</p>`
    },
    choices: [
      {
        direction: "Точность",
        name: "Точка поражения",
        img: "icons/skills/ranged/target-bullseye-arrow-glowing.webp",
        description: `<p>Атакуя из скрытности или после изучения цели, при попадании выберите: повысить тяжесть на ступень, игнорировать укрытие, отключить оружие либо небольшое снаряжение или провести атаку бесшумно.</p>`
      },
      {
        direction: "Штурм",
        name: "Шквальный проход",
        img: "icons/skills/ranged/person-running-bow-quick-yellow.webp",
        description: `<p>Потратьте 1 Драйв и выберите до трёх целей на Близкой дистанции, доступных пистолету, ПП, клинку или рукопашной атаке. Совершите отдельную проверку Рефлексов против каждой. Одна выбранная цель получает обычный урон оружия, остальные — лёгкий. После атак переместитесь к одной поражённой цели.</p>`
      },
      {
        direction: "Разведка",
        name: "Подготовка цели",
        img: "icons/magic/perception/eye-ringed-green.webp",
        description: `<p>Потратьте действие на наблюдение и проверьте Восприятие. При успехе узнайте два: слабую точку, тип брони, импланты, маршрут патруля, ближайшее укрытие или лидера группы. Следующая атака ваша или союзника получает преимущество.</p>`
      },
      {
        direction: "Скрытность",
        name: "Исчезновение после атаки",
        img: "icons/magic/movement/trail-streak-impact-blue.webp",
        description: `<p>После успешной атаки отметьте 1 Киберпсихоз, чтобы переместиться к ближайшему укрытию, покинуть линию видимости, снова попытаться скрыться и не позволить врагу немедленно определить вашу позицию.</p>`
      }
    ],
    questions: [
      "Кого вы однажды должны были устранить, но отпустили?",
      "Какой незаметный ритуал вы выполняете перед работой?",
      "Кто знает ваше настоящее имя и почему ещё жив?"
    ],
    connections: [
      "Когда вы впервые заметили меня, хотя я был Скрыт?",
      "Почему я всегда оставляю вам путь отхода?",
      "Какое задание мы провалили, но никому об этом не рассказали?"
    ]
  }
];

const classItems = [];
const classFeatures = [];
for (const [classIndex, definition] of classDefinitions.entries()) {
  const base = featureItem({
    seed: `${definition.slug}-base`,
    folder: definition.folder,
    name: definition.base.name,
    description: definition.base.description,
    img: definition.base.img,
    sort: 100000,
    direction: "Базовая",
    classSlug: definition.slug
  });
  classFeatures.push(base);

  for (const [choiceIndex, choice] of definition.choices.entries()) {
    classFeatures.push(
      featureItem({
        seed: `${definition.slug}-choice-${choiceIndex + 1}`,
        folder: definition.folder,
        name: `[${choice.direction}] ${choice.name}`,
        description: `<p><em>Направление: ${choice.direction}. Выберите две способности класса в любой комбинации.</em></p>${choice.description}`,
        img: choice.img,
        sort: (choiceIndex + 2) * 100000,
        direction: choice.direction,
        classSlug: definition.slug
      })
    );
  }

  classItems.push(
    baseItem({
      seed: `class-${definition.slug}`,
      folder: folders.classes._id,
      name: definition.name,
      type: "class",
      img: definition.img,
      sort: (classIndex + 1) * 100000,
      system: {
        description: definition.description,
        domains: [],
        classItems: [],
        hitPoints: definition.hitPoints,
        evasion: definition.evasion,
        features: [{ type: "class", item: uuid(base._id) }],
        subclasses: [],
        inventory: { take: [], choiceA: [], choiceB: [] },
        characterGuide: {
          suggestedTraits: definition.traits,
          suggestedPrimaryWeapon: null,
          suggestedSecondaryWeapon: null,
          suggestedArmor: null
        },
        backgroundQuestions: definition.questions,
        connections: definition.connections,
        isMulticlass: false
      },
      flags: {
        [MODULE_ID]: {
          kind: "class",
          slug: definition.slug,
          selectableAbilities: 2
        }
      }
    })
  );
}

const rangeMap = {
  melee: "melee",
  veryClose: "veryClose",
  close: "close",
  far: "far",
  veryFar: "veryFar"
};

const weaponDefinitions = [
  ["lexington", "M-10AF Lexington", "pistols", "d6", "Очень близко–Близко", "close", "Силовое", "agility", "Рефлексы", ["Одноручное"]],
  ["her-majesty", "Her Majesty", "pistols", "d8", "Близко", "close", "Силовое", "agility", "Рефлексы", ["Скрытное", "Глушитель", "Точное", "Одноручное"]],
  ["lizzie", "Lizzie", "pistols", "d8", "Близко–Далеко", "far", "Энергетическое", "agility", "Рефлексы", ["Заряд", "Бронебойное", "Одноручное"]],
  ["genjiroh", "Genjiroh", "pistols", "d8", "Близко", "close", "Умное", "agility", "Рефлексы", ["Наведение", "Одноручное"]],
  ["fenrir", "Fenrir", "smgs", "d6", "Очень близко–Близко", "close", "Силовое", "agility", "Рефлексы", ["Скрытное", "Автоматическое"]],
  ["buzzsaw", "Buzzsaw", "smgs", "d8", "Близко", "close", "Силовое", "agility", "Рефлексы", ["Глушитель", "Автоматическое"]],
  ["raiju", "Raiju", "smgs", "d8", "Близко–Далеко", "far", "Энергетическое", "agility", "Рефлексы", ["Заряд", "Бронебойное", "Автоматическое"]],
  ["yinglong", "Yinglong", "smgs", "d8", "Близко", "close", "Умное", "agility", "Рефлексы", ["Наведение", "Автоматическое"]],
  ["mox", "Mox", "shotguns", "d10", "Вплотную–Очень близко", "veryClose", "Силовое", "agility", "Рефлексы", ["Двуручное", "Отбрасывание"]],
  ["guts", "Guts", "shotguns", "d10", "Очень близко", "veryClose", "Силовое", "agility", "Рефлексы", ["Тяжёлое", "Отбрасывание", "Двуручное"]],
  ["order", "Order", "shotguns", "d10", "Очень близко–Близко", "close", "Энергетическое", "agility", "Рефлексы", ["Заряд", "Бронебойное", "Двуручное"]],
  ["ba-xing-chong", "Ba Xing Chong", "shotguns", "d10", "Очень близко", "veryClose", "Умное", "agility", "Рефлексы", ["Наведение", "Область", "Двуручное"]],
  ["copperhead", "D5 Copperhead", "rifles", "d8", "Близко–Далеко", "far", "Силовое", "agility", "Рефлексы", ["Автоматическое", "Двуручное"]],
  ["overwatch", "Overwatch", "rifles", "d10", "Далеко–Очень далеко", "veryFar", "Силовое", "agility", "Рефлексы", ["Глушитель", "Точное", "Двуручное"]],
  ["widow-maker", "Widow Maker", "rifles", "d10", "Близко–Далеко", "far", "Энергетическое", "agility", "Рефлексы", ["Заряд", "Бронебойное", "Двуручное"]],
  ["ashura", "Ashura", "rifles", "d12", "Далеко–Очень далеко", "veryFar", "Умное", "agility", "Рефлексы", ["Наведение", "Точное", "Двуручное"]],
  ["defender", "M-2067 Defender", "heavy", "d10", "Близко–Далеко", "far", "Силовое", "strength", "Телосложение", ["Автоматическое", "Тяжёлое", "Двуручное"]],
  ["ma70-hb", "MA70 HB", "heavy", "d10", "Близко–Далеко", "far", "Силовое", "strength", "Телосложение", ["Автоматическое", "Тяжёлое", "Двуручное"]],
  ["rl7-chytomyr", "RL-7 Читомир", "heavy", "d12", "Близко–Далеко", "far", "Энергетическое", "strength", "Телосложение", ["Область", "Взрывное", "Тяжёлое", "Двуручное"]],
  ["hercules-3ax", "Hercules 3AX", "heavy", "d12", "Далеко", "far", "Умное", "strength", "Телосложение", ["Наведение", "Область", "Тяжёлое", "Двуручное"]],
  ["neurotoxin-knife", "Нейротоксиновый нож", "melee", "d6", "Вплотную", "melee", "Ближний бой", "agility", "Рефлексы", ["Скрытное", "Быстрое", "Одноручное"]],
  ["scalpel", "Scalpel", "melee", "d8", "Вплотную", "melee", "Ближний бой", "agility", "Рефлексы", ["Скрытное", "Точное", "Одноручное"]],
  ["satori", "Satori", "melee", "d10", "Вплотную", "melee", "Ближний бой", "agility", "Рефлексы", ["Точное", "Быстрое", "Двуручное"]],
  ["kanabo", "Kanabo", "melee", "d10", "Вплотную", "melee", "Ближний бой", "strength", "Телосложение", ["Тяжёлое", "Отбрасывание", "Двуручное"]]
].map(([slug, name, category, die, rangeLabel, range, weaponType, trait, traitLabel, properties]) => ({
  slug,
  name,
  category,
  die,
  rangeLabel,
  range,
  weaponType,
  trait,
  traitLabel,
  properties
}));

const weaponFolder = {
  pistols: folders.pistols._id,
  smgs: folders.smgs._id,
  shotguns: folders.shotguns._id,
  rifles: folders.rifles._id,
  heavy: folders.heavy._id,
  melee: folders.melee._id
};

const weaponImages = {
  pistols: "icons/weapons/guns/gun-pistol-brass.webp",
  smgs: "icons/weapons/guns/gun-pistol-flintlock-metal.webp",
  shotguns: "icons/weapons/guns/gun-blunderbuss-brass.webp",
  rifles: "icons/weapons/guns/gun-rifle-brown.webp",
  heavy: "icons/weapons/guns/gun-topbarrel-black.webp",
  melee: "icons/weapons/swords/sword-guard-steel.webp"
};

function typeRule(type) {
  if (type === "Силовое") return "Надёжно и не требует импланта. При подходящей поверхности может использовать Рикошет.";
  if (type === "Техническое") return "Можно зарядить действием: +1 ступень тяжести, игнорирование лёгкого укрытия, сквозной выстрел или усиленное пробитие брони.";
  if (type === "Энергетическое") return "Энергетический выстрел можно зарядить действием, чтобы усилить пробитие и повысить тяжесть урона.";
  if (type === "Умное") return "Требует умного интерфейса. После захвата цели игнорирует обычное перемещение и частичное укрытие.";
  return "Использует правила оружия ближнего боя.";
}

const weapons = weaponDefinitions.map((weapon, index) => {
  const formula = `@prof${weapon.die}`;
  const burden =
    weapon.properties.includes("Двуручное") || weapon.properties.includes("Тяжёлое")
      ? "twoHanded"
      : "oneHanded";
  const targetAmount = weapon.properties.includes("Область")
    ? 3
    : weapon.properties.includes("Автоматическое")
      ? 2
      : 1;
  const actionId = idFor(`action:weapon:${weapon.slug}`);
  return baseItem({
    seed: `weapon-${weapon.slug}`,
    folder: weaponFolder[weapon.category],
    name: weapon.name,
    type: "weapon",
    img: weaponImages[weapon.category],
    sort: (index + 1) * 100000,
    system: {
      description: `
        <p><strong>Категория:</strong> ${weapon.weaponType}. <strong>Дистанция:</strong> ${weapon.rangeLabel}. <strong>Проверка:</strong> ${weapon.traitLabel}.</p>
        <p><strong>Урон:</strong> <code>${formula}</code> физического урона.</p>
        <p><strong>Свойства:</strong> ${weapon.properties.join(", ")}.</p>
        <p>${typeRule(weapon.weaponType)}</p>
      `,
      actions: {},
      attached: [],
      tier: 1,
      equipped: false,
      secondary: false,
      burden,
      weaponFeatures: [],
      attack: {
        name: `Атака: ${weapon.name}`,
        img: weaponImages[weapon.category],
        _id: actionId,
        baseAction: true,
        chatDisplay: false,
        systemPath: "attack",
        type: "attack",
        range: rangeMap[weapon.range],
        target: { type: "any", amount: targetAmount },
        roll: {
          trait: weapon.trait,
          type: "attack",
          difficulty: null,
          bonus: null,
          advState: "neutral",
          diceRolling: {
            multiplier: "prof",
            flatMultiplier: 1,
            dice: "d6",
            compare: null,
            treshold: null
          },
          useDefault: false
        },
        damage: {
          parts: [
            {
              type: ["physical"],
              value: {
                multiplier: "prof",
                dice: weapon.die,
                flatMultiplier: 1,
                bonus: null,
                custom: { enabled: true, formula }
              },
              applyTo: "hitPoints",
              resultBased: false,
              valueAlt: {
                multiplier: "flat",
                flatMultiplier: 1,
                dice: "d6",
                bonus: null,
                custom: { enabled: false, formula: "" }
              },
              base: false
            }
          ],
          includeBase: false,
          direct: false
        },
        description: "",
        actionType: "action",
        cost: [],
        uses: {
          value: null,
          max: null,
          recovery: null
        },
        effects: [],
        save: { trait: null, difficulty: null, damageMod: "none" }
      },
      rules: { attack: { roll: { trait: null } } }
    },
    flags: {
      [MODULE_ID]: {
        kind: "weapon",
        slug: weapon.slug,
        category: weapon.category,
        weaponType: weapon.weaponType,
        damageDie: weapon.die,
        damageFormula: formula,
        attackTrait: weapon.trait,
        attackTraitLabel: weapon.traitLabel,
        range: weapon.range,
        rangeLabel: weapon.rangeLabel,
        properties: weapon.properties,
        armorSlotsToReduce: weapon.properties.includes("Бронебойное") ? 2 : 1,
        targetAmount
      }
    }
  });
});

const implantDefinitions = [
  {
    slug: "cyberdeck",
    folder: folders.os._id,
    name: "Кибердека",
    zone: "Операционная система",
    category: "Сетевая",
    img: "icons/commodities/tech/cog-brass.webp",
    description: `
      <p><strong>Пассивно:</strong> даёт удалённое подключение к доступным сетям, устройствам и имплантам.</p>
      <p><strong>Глубокое подключение — 1 Драйв:</strong> получите полный доступ к защищённой системе или нескольким простым устройствам.</p>
      <p><strong>Перегрузка — 1 Киберпсихоз:</strong> работайте без физического соединения, сохраните доступ после ухода, скройте присутствие или атакуйте систему высокой защиты.</p>
      <p>При Страхе возможны трассировка, защитный протокол или цифровой след.</p>
    `
  },
  {
    slug: "sandevistan",
    folder: folders.os._id,
    name: "Сандевистан",
    zone: "Операционная система",
    category: "Нейронная, экстремальная",
    img: "icons/magic/movement/trail-streak-impact-blue.webp",
    description: `
      <p><strong>Активация — 1 Киберпсихоз:</strong> совершите два связанных действия до реакции противника. Одно должно быть перемещением или атакой.</p>
      <p><strong>Экстремальная скорость — 1 Драйв и 1 Киберпсихоз:</strong> увеличьте дистанцию, добавьте вторую цель, уклонитесь от прямой атаки или выполните сложное скоростное действие.</p>
      <p>При Страхе Ведущий может вызвать перегрев, нарушение зрения, координации или краткое отключение.</p>
    `
  },
  {
    slug: "berserk",
    folder: folders.os._id,
    name: "Берсерк",
    zone: "Операционная система",
    category: "Боевая, экстремальная",
    img: "icons/skills/melee/unarmed-punch-fist-yellow-red.webp",
    description: `
      <p><strong>Активация — 1 Киберпсихоз:</strong> до конца сцены игнорируйте обычные штрафы тяжёлого оружия и брони, сохраняйте темп после Раны, отбрасывайте рукопашными атаками и игнорируйте обычное принудительное перемещение.</p>
      <p><strong>Перегрузка — 1 Драйв:</strong> повысьте тяжесть рукопашного урона, усилите отбрасывание или разрушьте лёгкое укрытие.</p>
    `
  },
  {
    slug: "voice-resonator",
    folder: folders.socialImplants._id,
    name: "Голосовой резонатор",
    zone: "Шея",
    category: "Социальная, активная",
    img: "icons/tools/instruments/microphone-gray.webp",
    description: `
      <p>Заменяет голосовые связки. Голос остаётся ясным в шуме, усиливается, меняет тембр, копирует услышанное и идеально записывает либо воспроизводит речь.</p>
      <p><strong>Публичный канал — 1 Драйв:</strong> передайте речь большой группе через динамики и терминалы на Далёкой дистанции; следующая голосовая способность охватывает всю группу.</p>
      <p><strong>Перегрузка — 1 Киберпсихоз:</strong> точно имитируйте человека, говорите через несколько устройств, захватите внимание толпы, сорвите передачу или дезориентируйте звуковой волной.</p>
    `
  },
  {
    slug: "reinforced-arms",
    folder: folders.combatImplants._id,
    name: "Усиленные руки",
    zone: "Руки",
    category: "Боевая конечность",
    img: "icons/skills/melee/unarmed-punch-fist-white.webp",
    damageFormula: "@profd8",
    description: `
      <p><strong>Встроенное оружие:</strong> <code>@profd8</code>, Вплотную, Телосложение; свойства «Тяжёлое» и «Отбрасывание».</p>
      <p>Пассивно усиливают подъём, удержание, разрушение и захват.</p>
      <p><strong>Усиленный удар — 1 Киберпсихоз:</strong> повысьте тяжесть на ступень, сломайте лёгкое укрытие, сильнее отбросьте или удержите цель.</p>
    `
  },
  {
    slug: "mantis-blades",
    folder: folders.combatImplants._id,
    name: "Клинки богомола",
    zone: "Руки",
    category: "Боевая конечность",
    img: "icons/weapons/swords/sword-hooked-worn-purple.webp",
    damageFormula: "@profd8",
    description: `
      <p><strong>Встроенное оружие:</strong> <code>@profd8</code>, Вплотную, Рефлексы; свойства «Скрытное», «Быстрое» и «Точное».</p>
      <p><strong>Бросок хищника — 1 Драйв:</strong> после успеха переместитесь к другой цели Очень близко и атакуйте её; при бесшумном убийстве и наличии укрытия можно сохранить скрытность.</p>
    `
  },
  {
    slug: "monowire",
    folder: folders.combatImplants._id,
    name: "Моноструна",
    zone: "Руки",
    category: "Боевая конечность",
    img: "icons/skills/melee/strike-whip-red-yellow.webp",
    damageFormula: "@profd8",
    description: `
      <p><strong>Встроенное оружие:</strong> <code>@profd8</code>, Очень близко, Рефлексы; свойства «Быстрое», «Скрытное» и «Область».</p>
      <p><strong>Круговой разрез — 1 Киберпсихоз:</strong> отдельно атакуйте до трёх целей; каждая получает лёгкий урон, если способность или крит не повышают его.</p>
      <p>Моноструну можно использовать как физический кабель подключения.</p>
    `
  },
  {
    slug: "wallbreaker-caliber",
    folder: folders.combatImplants._id,
    name: "Пробивной калибр",
    zone: "Руки и плечевой пояс",
    category: "Боевая конечность, тяжёлая",
    img: "icons/weapons/guns/gun-topbarrel-black.webp",
    damageFormula: "@profd12",
    description: `
      <p><strong>Встроенное оружие:</strong> <code>@profd12</code>, Близко–Далеко, Телосложение; свойства «Тяжёлое», «Бронебойное» и «Пробитие».</p>
      <p>Пробивает лёгкое укрытие, дерево и тонкие стены. Толстый бетон требует заряженного выстрела. Несколько целей на одной линии получают урон последовательно, каждая следующая — на ступень ниже.</p>
      <p><strong>Пробивной заряд — 1 Драйв:</strong> пробейте тяжёлую стену, заставьте цель потратить дополнительную Броню, поразите до трёх целей на линии или разрушьте укреплённую дверь.</p>
      <p>Занимает обе руки или требует усиленного второго плеча, не скрывается и создаёт сильный шум.</p>
    `
  },
  {
    slug: "reinforced-legs",
    folder: folders.combatImplants._id,
    name: "Усиленные ноги",
    zone: "Ноги",
    category: "Боевая конечность",
    img: "icons/skills/movement/feet-winged-boots-brown.webp",
    damageFormula: "@profd8",
    description: `
      <p><strong>Встроенное оружие:</strong> <code>@profd8</code>, Вплотную, Телосложение; свойства «Быстрое» и «Отбрасывание».</p>
      <p>Пассивно усиливают скорость, прыжки, сопротивление падению и принудительному перемещению.</p>
      <p><strong>Силовой прыжок — 1 Киберпсихоз:</strong> прыгните на одну дистанцию, приземлитесь рядом с целью, атакуйте с отбрасыванием или покиньте опасную зону без обычного перемещения.</p>
    `
  },
  {
    slug: "kiroshi-eyes",
    folder: folders.sensoryImplants._id,
    name: "Глаза Киро́ши",
    zone: "Глаза",
    category: "Сенсорная, активная",
    img: "icons/magic/perception/eye-ringed-glow-angry-large-blue.webp",
    description: `
      <p>Улучшенное зрение, приближение, запись, распознавание лиц и биометрии, анализ деталей и совместимость с умным оружием.</p>
      <p><strong>Сканирование — 1 Киберпсихоз:</strong> определите импланты и слабости цели, смотрите через дым или слабое искажение либо передайте данные союзникам.</p>
    `
  },
  {
    slug: "subdermal-armor",
    folder: folders.sensoryImplants._id,
    name: "Подкожная броня",
    zone: "Кожа",
    category: "Физическая, пассивная",
    img: "icons/equipment/chest/breastplate-layered-steel.webp",
    description: `
      <p>Добавляет <strong>2 дополнительные ячейки Брони</strong>. Эти ячейки отображаются в панели Night City 2073 и восстанавливаются вместе с обычной Бронёй.</p>
      <p>Имплант не требует активации, но занимает одну ячейку вместимости Киберпсихоза, как любой другой имплант.</p>
    `
  }
];

const integratedWeaponConfig = {
  "reinforced-arms": {
    die: "d8",
    trait: "strength",
    traitLabel: "Телосложение",
    range: "melee",
    rangeLabel: "Вплотную",
    burden: "twoHanded",
    properties: ["Тяжёлое", "Отбрасывание"]
  },
  "mantis-blades": {
    die: "d8",
    trait: "agility",
    traitLabel: "Рефлексы",
    range: "melee",
    rangeLabel: "Вплотную",
    burden: "oneHanded",
    properties: ["Скрытное", "Быстрое", "Точное"]
  },
  monowire: {
    die: "d8",
    trait: "agility",
    traitLabel: "Рефлексы",
    range: "veryClose",
    rangeLabel: "Очень близко",
    burden: "oneHanded",
    properties: ["Быстрое", "Скрытное", "Область"]
  },
  "wallbreaker-caliber": {
    die: "d12",
    trait: "strength",
    traitLabel: "Телосложение",
    range: "far",
    rangeLabel: "Близко–Далеко",
    burden: "twoHanded",
    properties: ["Тяжёлое", "Бронебойное", "Пробитие"]
  },
  "reinforced-legs": {
    die: "d8",
    trait: "strength",
    traitLabel: "Телосложение",
    range: "melee",
    rangeLabel: "Вплотную",
    burden: "oneHanded",
    properties: ["Быстрое", "Отбрасывание"]
  }
};

const implants = implantDefinitions.map((implant, index) => {
  const integrated = integratedWeaponConfig[implant.slug];
  const commonFlags = {
    kind: "implant",
    slug: implant.slug,
    zone: implant.zone,
    category: implant.category,
    load: 1,
    equipped: false,
    damageFormula: implant.damageFormula ?? null,
    integratedWeapon: Boolean(integrated),
    rangeLabel: integrated?.rangeLabel ?? null,
    attackTraitLabel: integrated?.traitLabel ?? null,
    properties: integrated?.properties ?? []
  };
  const description = `
    <p><strong>Зона:</strong> ${implant.zone}. <strong>Тип:</strong> ${implant.category}. <strong>Нагрузка:</strong> 1.</p>
    ${implant.description}
  `;

  if (!integrated) {
    return baseItem({
      seed: `implant-${implant.slug}`,
      folder: implant.folder,
      name: implant.name,
      type: "loot",
      img: implant.img,
      sort: (index + 1) * 100000,
      system: {
        description,
        quantity: 1,
        actions: {}
      },
      flags: { [MODULE_ID]: commonFlags }
    });
  }

  const formula = `@prof${integrated.die}`;
  const actionId = idFor(`action:implant:${implant.slug}`);
  return baseItem({
    seed: `implant-${implant.slug}`,
    folder: implant.folder,
    name: implant.name,
    type: "weapon",
    img: implant.img,
    sort: (index + 1) * 100000,
    system: {
      description,
      actions: {},
      attached: [],
      tier: 1,
      equipped: false,
      secondary: false,
      burden: integrated.burden,
      weaponFeatures: [],
      attack: {
        name: `Атака: ${implant.name}`,
        img: implant.img,
        _id: actionId,
        baseAction: true,
        chatDisplay: false,
        systemPath: "attack",
        type: "attack",
        range: integrated.range,
        target: { type: "any", amount: 1 },
        roll: {
          trait: integrated.trait,
          type: "attack",
          difficulty: null,
          bonus: null,
          advState: "neutral",
          diceRolling: {
            multiplier: "prof",
            flatMultiplier: 1,
            dice: "d6",
            compare: null,
            treshold: null
          },
          useDefault: false
        },
        damage: {
          parts: [
            {
              type: ["physical"],
              value: {
                multiplier: "prof",
                dice: integrated.die,
                flatMultiplier: 1,
                bonus: null,
                custom: { enabled: true, formula }
              },
              applyTo: "hitPoints",
              resultBased: false,
              valueAlt: {
                multiplier: "flat",
                flatMultiplier: 1,
                dice: "d6",
                bonus: null,
                custom: { enabled: false, formula: "" }
              },
              base: false
            }
          ],
          includeBase: false,
          direct: false
        },
        description: "",
        actionType: "action",
        cost: [],
        uses: {
          value: null,
          max: null,
          recovery: null
        },
        effects: [],
        save: { trait: null, difficulty: null, damageMod: "none" }
      },
      rules: { attack: { roll: { trait: null } } }
    },
    flags: {
      [MODULE_ID]: {
        ...commonFlags,
        damageDie: integrated.die,
        damageFormula: formula,
        attackTrait: integrated.trait,
        range: integrated.range
      }
    }
  });
});

const macroDefinitions = [
  {
    slug: "open-panel",
    name: "NC2073 — открыть панель",
    img: "icons/svg/eye.svg",
    command: `await NightCity2073.openPanel(NightCity2073.selectedActor());`
  },
  {
    slug: "luck",
    name: "NC2073 — проверка Удачи",
    img: "icons/sundries/gaming/dice-runed-brown.webp",
    command: `await NightCity2073.rollLuck(NightCity2073.selectedActor());`
  },
  {
    slug: "reflexes",
    name: "NC2073 — проверка Рефлексов",
    img: "icons/skills/movement/feet-winged-boots-brown.webp",
    command: `await NightCity2073.rollTrait(NightCity2073.selectedActor(), "agility");`
  },
  {
    slug: "weapon",
    name: "NC2073 — атака оружием",
    img: "icons/weapons/guns/gun-pistol-brass.webp",
    command: `await NightCity2073.rollWeapon(NightCity2073.selectedActor());`
  },
  {
    slug: "damage",
    name: "NC2073 — только урон оружия",
    img: "icons/svg/dice-target.svg",
    command: `await NightCity2073.rollWeaponDamage(NightCity2073.selectedActor());`
  },
  {
    slug: "sync-cyberpsychosis",
    name: "NC2073 — синхронизировать Киберпсихоз",
    img: "icons/magic/control/hypnosis-mesmerism-eye.webp",
    command: `const actor = NightCity2073.selectedActor(); if (actor) { await NightCity2073.recalculateCyberpsychosis(actor); ui.notifications.info("Вместимость Киберпсихоза пересчитана."); }`
  }
];

const macros = macroDefinitions.map((macro, index) => ({
  name: macro.name,
  type: "script",
  _id: idFor(`macro:${macro.slug}`),
  author: null,
  img: macro.img,
  scope: "global",
  command: macro.command,
  folder: null,
  sort: (index + 1) * 100000,
  ownership: ownership(),
  flags: { [MODULE_ID]: { kind: "macro", slug: macro.slug } },
  _stats: stats()
}));

const items = [...rules, ...classItems, ...classFeatures, ...weapons, ...implants];

async function writePack(packPath, folderDocuments, documents, prefix) {
  await rm(packPath, { recursive: true, force: true });
  await mkdir(packPath, { recursive: true });
  const db = new ClassicLevel(packPath, { valueEncoding: "utf8" });
  await db.open();
  const operations = [
    ...folderDocuments.map(document => ({
      type: "put",
      key: `!folders!${document._id}`,
      value: JSON.stringify(document)
    })),
    ...documents.map(document => ({
      type: "put",
      key: `!${prefix}!${document._id}`,
      value: JSON.stringify(document)
    }))
  ];
  await db.batch(operations);
  await db.compactRange("", "~");
  await db.close();
  return operations.length;
}

const itemCount = await writePack(
  path.join(ROOT, "packs", ITEM_PACK),
  Object.values(folders),
  items,
  "items"
);
const macroCount = await writePack(
  path.join(ROOT, "packs", MACRO_PACK),
  [],
  macros,
  "macros"
);

await mkdir(path.join(ROOT, "data"), { recursive: true });
const formulaItems = [
  ...weapons,
  ...implants.filter(item => item.flags[MODULE_ID].integratedWeapon === true)
];
await writeFile(
  path.join(ROOT, "data", "weapon-formulas.json"),
  `${JSON.stringify(
    Object.fromEntries(
      formulaItems.map(weapon => [
        weapon.flags[MODULE_ID].slug,
        {
          name: weapon.name,
          formula: weapon.flags[MODULE_ID].damageFormula,
          die:
            weapon.flags[MODULE_ID].damageDie ??
            weapon.flags[MODULE_ID].damageFormula?.match(/d\d+$/)?.[0],
          trait: weapon.flags[MODULE_ID].attackTraitLabel,
          range: weapon.flags[MODULE_ID].rangeLabel,
          type:
            weapon.flags[MODULE_ID].weaponType ??
            (weapon.flags[MODULE_ID].integratedWeapon ? "Встроенное оружие" : null),
          properties: weapon.flags[MODULE_ID].properties
        }
      ])
    ),
    null,
    2
  )}\n`,
  "utf8"
);

console.log(`Items pack: ${itemCount} LevelDB records (${items.length} items).`);
console.log(`Macros pack: ${macroCount} LevelDB records (${macros.length} macros).`);
console.log(`Classes: ${classItems.length}; class features: ${classFeatures.length}.`);
console.log(`Weapons: ${weapons.length}; implants: ${implants.length}; rules: ${rules.length}.`);
