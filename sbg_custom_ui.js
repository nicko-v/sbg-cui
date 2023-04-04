// ==UserScript==
// @name         SBG CUI
// @namespace    https://3d.sytes.net/
// @version      1.0.22
// @downloadURL  https://raw.githubusercontent.com/nicko-v/sbg-cui/main/sbg_custom_ui.js
// @updateURL    https://raw.githubusercontent.com/nicko-v/sbg-cui/main/sbg_custom_ui.js
// @description  SBG Custom UI
// @author       NV
// @match        https://3d.sytes.net/
// @grant        none
// ==/UserScript==

window.addEventListener('load', async function () {
  'use strict';

  if (document.querySelector('script[src="/intel.js"]')) { return; }


  const LATEST_KNOWN_VERSION = '0.2.7';
  const INVENTORY_LIMIT = 3000;
  const MIN_FREE_SPACE = 100;
  const MAX_TOASTS = 3;
  const IS_DARK = matchMedia('(prefers-color-scheme: dark)').matches;
  const CORES_ENERGY = { 0: 0, 1: 500, 2: 750, 3: 1000, 4: 1500, 5: 2000, 6: 2500, 7: 3500, 8: 4000, 9: 5250, 10: 6500 };
  const CORES_LIMITS = { 0: 0, 1: 6, 2: 6, 3: 6, 4: 3, 5: 3, 6: 2, 7: 2, 8: 1, 9: 1, 10: 1 };
  const LEVEL_TARGETS = [1500, 5000, 12500, 25000, 60000, 125000, 350000, 675000, 1000000, Infinity];
  const ITEMS_TYPES = {
    1: { eng: 'cores', rus: 'ядра' },
    2: { eng: 'catalysers', rus: 'катализаторы' },
    3: { eng: 'refs', rus: 'рефы' }
  };
  const DEFAULT_CONFIG = {
    maxAmountInBag: {
      cores: { I: -1, II: -1, III: -1, IV: -1, V: -1, VI: -1, VII: -1, VIII: -1, IX: -1, X: -1 },
      catalysers: { I: -1, II: -1, III: -1, IV: -1, V: -1, VI: -1, VII: -1, VIII: -1, IX: -1, X: -1 },
      refs: { allied: -1, hostile: -1 },
    },
    autoSelect: {
      deploy: 'min',  // min || max || off
      upgrade: 'min', // min || max || off
      attack: 'max',  // max || latest
    },
    mapFilters: {
      invert: IS_DARK ? 1 : 0,
      hueRotate: IS_DARK ? 180 : 0,
      brightness: IS_DARK ? 0.75 : 1,
      grayscale: IS_DARK ? 1 : 0,
      blur: 0,
    },
    tinting: {
      map: 1,
      point: 'level', // level || team || off
      profile: 1,
    },
  };


  let config;
  if (localStorage.getItem('sbgcui_config')) {
    config = JSON.parse(localStorage.getItem('sbgcui_config'), (key, value) => isNaN(+value) ? value : +value);
    for (let key in DEFAULT_CONFIG) {
      if (!(key in config)) {
        config[key] = DEFAULT_CONFIG[key];
      }
      updateConfigStructure(config, DEFAULT_CONFIG);
      localStorage.setItem('sbgcui_config', JSON.stringify(config));
    }
  } else {
    config = DEFAULT_CONFIG;
    localStorage.setItem('sbgcui_config', JSON.stringify(config));

    let toast = createToast('Сохранённые настройки не найдены. <br>Загружена стандартная конфигурация.');
    toast.options.className = 'error-toast';
    toast.showToast();
  }


  let attackButton = document.querySelector('#attack-menu');
  let attackSlider = document.querySelector('.attack-slider-wrp');
  let coresList = document.querySelector('#cores-list');
  let deployButton = document.querySelector('#deploy');
  let discoverButton = document.querySelector('#discover');
  let inventoryButton = document.querySelector('#ops');
  let invTotalSpan = document.querySelector('#self-info__inv');
  let pointCores = document.querySelector('.i-stat__cores');
  let pointLevelSpan = document.querySelector('#i-level');
  let pointOwnerSpan = document.querySelector('#i-stat__owner');
  let pointPopup = document.querySelector('.info.popup');
  let profileNameSpan = document.querySelector('#pr-name');
  let profilePopup = document.querySelector('.profile.popup');
  let selfExpSpan = document.querySelector('#self-info__exp');
  let selfLvlSpan = document.querySelector('#self-info__explv');
  let selfNameSpan = document.querySelector('#self-info__name');
  let xpDiffSpan = document.querySelector('.xp-diff');
  let zoomContainer = document.querySelector('.ol-zoom');

  let isProfilePopupOpened = !profilePopup.classList.contains('hidden');
  let isPointPopupOpened = !pointPopup.classList.contains('hidden');

  let lastOpenedPoint = {};
  let lastUsedCatalyser = localStorage.getItem('sbgcui_lastUsedCatalyser');


  let numbersConverter = {
    I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
    toDecimal(roman) { return this[roman]; },
    toRoman(decimal) { return Object.keys(this).find(key => this[key] == decimal); }
  };


  class customXHR extends window.XMLHttpRequest {
    get responseText() {
      let response = this.response;
      let path = this.responseURL.match(/\/api\/(discover|inview)/);

      if (!path) { return super.responseText; }

      try {
        response = JSON.parse(response);

        switch (path[1]) {
          case 'discover':
            if ('error' in response) {
              response.error = response.error.replace(/in\s(\d+)\sseconds/, (m, p1) => `in ${+p1 > 90 ? (Math.round(+p1 / 60) + ' minutes') : (+p1 + ' seconds')}`);
            }
            break;
        }

        response = JSON.stringify(response);
      } catch (error) {
        console.log('Ошибка при обработке ответа сервера.', error);
      }

      return response;
    }

    send(body) {
      this.addEventListener('load', _ => {
        let path = this.responseURL.match(/\/api\/(point|deploy|attack2)(?:.*?&(status=1))?/);
        let response = this.response;

        if (!path) { return; }

        try {
          response = JSON.parse(response);

          switch (path[1]) {
            case 'point':
              if ('data' in response && !path[2]) { // path[2] - если есть параметр status=1, то инфа о точке запрашивается в сокращённом виде для рефа.
                lastOpenedPoint = new Point(response.data);
              }
              break;
            case 'deploy':
              if ('data' in response) { // Есди деплой, то массив объектов с ядрами.
                lastOpenedPoint.update(response.data.co, response.data.l);
                lastOpenedPoint.selectCore(config.autoSelect.deploy);
              } else if ('c' in response) { // Если апгрейд, то один объект с ядром.
                lastOpenedPoint.update([response.c], response.l);
                lastOpenedPoint.selectCore(config.autoSelect.upgrade, response.c.l);
              }
              break;
            case 'attack2':
              lastUsedCatalyser = JSON.parse(body).guid;
              localStorage.setItem('sbgcui_lastUsedCatalyser', lastUsedCatalyser);
              break;
          }

          response = JSON.stringify(response);
        } catch (error) {
          console.log('Ошибка при обработке ответа сервера.', error);
        }
      });

      super.send(body);
    }
  }

  class Point {
    constructor(pointData) {
      this.guid = pointData.g;
      this.level = pointData.l;
      this.team = pointData.te;
      this.lines = {
        in: pointData.li.i,
        out: pointData.li.o,
      };
      this.cores = {};

      this.update(pointData.co);
    }

    get emptySlots() {
      return 6 - Object.keys(this.cores);
    }

    get isEmptySlots() {
      return this.emptySlots > 0;
    }

    get playerCores() {
      let playerCores = {};

      for (let key in this.cores) {
        let core = this.cores[key];

        if (core.owner == player.name) {
          if (core.level in playerCores) {
            playerCores[core.level] += 1
          } else {
            playerCores[core.level] = 1;
          }
        }
      }

      return playerCores; // { level: amount }
    }

    update(cores, level) {
      cores.forEach(e => {
        this.cores[e.g] = {
          level: e.l,
          owner: e.o,
        }
      });
      this.level = level;
    }

    selectCore(type, currentLevel) {
      let cachedCores = JSON.parse(localStorage.getItem('inventory-cache')).filter(e => e.t == 1).sort((a, b) => a.l - b.l);
      let playerCores = this.playerCores;
      let core;

      switch (type) {
        case 'min':
          if (currentLevel) { // Если передан уровень ядра - ищем ядро для апгрейда не ниже этого уровня.
            core = cachedCores.find(e => (e.l > currentLevel) && ((playerCores[e.l] || 0) < CORES_LIMITS[e.l]) && (e.l <= player.level));
          } else { // Иначе ищем ядро минимального уровня.
            core = cachedCores.find(e => ((playerCores[e.l] || 0) < CORES_LIMITS[e.l]) && (e.l <= player.level));
          }
          break;
        case 'max':
          core = cachedCores.findLast(e => (e.l <= player.level) && ((playerCores[e.l] || 0) < CORES_LIMITS[e.l]));
          break;
      }

      click(coresList.querySelector(`[data-guid="${core?.g}"]:not(.is-active)`));
    }
  }


  async function getSelfData() {
    return fetch('/api/self', {
      headers: { authorization: `Bearer ${localStorage.getItem('auth')}`, },
      method: "GET",
    })
      .then(r => { return Promise.all([r.headers.get('SBG-Version'), r]); })
      .then(r => Promise.all([r[0], r[1].json()]))
      .then(([version, data]) => { return { name: data.n, team: data.t, exp: data.x, lvl: data.l, guid: data.g, version }; })
      .catch(err => { console.log(`Ошибка при получении данных игрока. ${err}`); });
  }

  async function getPlayerData(guid) {
    return fetch(`/api/profile?guid=${guid}`, {
      headers: { authorization: `Bearer ${localStorage.getItem('auth')}`, },
      method: "GET",
    })
      .then(r => r.json())
      .then(r => r.data)
      .catch(err => { console.log('Ошибка при получении данных игрока.', err); });
  }

  async function getPointData(guid) {
    return fetch(`/api/point?guid=${guid}&status=1`, {
      headers: { authorization: `Bearer ${player.auth}` },
      method: 'GET'
    }).then(r => r.json()).then(r => r.data);
  }

  async function getInventory() {
    return fetch('/api/inventory', {
      headers: { authorization: `Bearer ${player.auth}` },
      method: 'GET',
    }).then(r => r.json()).then(r => r.i);
  }

  async function clearInventory(event, forceClear = false) {
    let maxAmount = config.maxAmountInBag;

    getInventory()
      .then(inventory => {
        let itemsAmount = inventory.reduce((total, e) => total + e.a, 0);

        if (!forceClear && (INVENTORY_LIMIT - itemsAmount >= MIN_FREE_SPACE)) { throw { silent: true }; }

        if (maxAmount.refs.allied == -1 && maxAmount.refs.hostile == -1) { return [inventory, []]; } // Если никакие ключи не надо удалять - не запрашиваем данные точек.
        if (maxAmount.refs.allied == 0 && maxAmount.refs.hostile == 0) { return [inventory, []]; } // Если все ключи надо удалить - не запрашиваем данные точек.

        let pointsData = inventory.map(i => (i.t == 3) ? getPointData(i.l) : undefined).filter(e => e);  // У обычных предметов в ключе l хранится уровень, у рефов - гуид точки. Логично.

        return Promise.all([inventory, ...pointsData]);
      })
      .then(([inventory, ...pointsDataArr]) => {
        let pointsData = {};

        pointsDataArr.forEach(e => {
          pointsData[e.g] = { team: e.te };
        });

        let toDelete = inventory.map(({ t: itemType, l: itemLevel, a: itemAmount, g: itemGuid }) => {
          if (!itemType in ITEMS_TYPES) { return; };

          let itemMaxAmount = -1;
          let amountToDelete = 0;
          let itemName = ITEMS_TYPES[itemType].eng;

          if (itemName == 'refs') {
            if (maxAmount.refs.allied == -1 && maxAmount.refs.hostile == -1) {
              itemMaxAmount = -1;
            } else if (maxAmount.refs.allied == 0 && maxAmount.refs.hostile == 0) {
              itemMaxAmount = 0;
            } else if (Object.keys(pointsData).length) {
              let pointSide = pointsData[itemLevel].team == player.team ? 'allied' : 'hostile';
              itemMaxAmount = maxAmount[itemName][pointSide];
            }
          } else {
            itemMaxAmount = maxAmount[itemName][numbersConverter.toRoman(itemLevel)];
          }

          if (itemMaxAmount != -1 && itemAmount > itemMaxAmount) {
            amountToDelete = itemAmount - itemMaxAmount;
          }

          return { guid: itemGuid, type: itemType, amount: amountToDelete };
        }).filter(i => i?.amount > 0);

        return Promise.all([toDelete, deleteItems(toDelete)]);
      })
      .then(([deleted, responses]) => {
        if (!deleted.length) { return; }

        let invTotal = responses.reduce((total, e) => e.count.total < total ? e.count.total : total, Infinity);
        if (isFinite(invTotal)) { invTotalSpan.innerText = invTotal; }

        if (inventoryButton.style.color.match('accent')) { inventoryButton.style.color = ''; }

        /* Надо удалить предметы из кэша, т.к. при следующем хаке общее количество предметов возьмётся из кэша и счётчик будет некорректным */
        {
          let cache = JSON.parse(localStorage.getItem('inventory-cache')) || [];
          deleted.forEach(e => {
            let cachedItem = cache.find(f => f.g == e.guid);
            if (cachedItem) { cachedItem.a -= e.amount; }
          });
          cache = cache.filter(e => e.a > 0);
          localStorage.setItem('inventory-cache', JSON.stringify(cache));
        }


        deleted = deleted.reduce((total, e) => {
          if (!total.hasOwnProperty(e.type)) { total[e.type] = 0; }
          total[e.type] += e.amount;
          return total;
        }, {});

        let message = '';

        for (let key in deleted) {
          message += `<br><span style="background: var(--team-${player.team}); margin-right: 5px;" class="item-icon type-${key}"></span>x${deleted[key]} ${ITEMS_TYPES[key].eng}`;
        }

        let toast = createToast(`Удалено: ${message}`);
        toast.showToast();
      })
      .catch(err => {
        if (err.silent) { return; }

        let toast = createToast(`Ошибка при проверке или очистке инвентаря. <br>${err.message}`);

        toast.options.className = 'error-toast';
        toast.showToast();

        console.log('Ошибка при удалении предметов.', err);
      });
  }

  async function deleteItems(items) {
    let groupedItems = items.reduce((groups, e) => {
      if (!groups.hasOwnProperty(e.type)) { groups[e.type] = {}; }
      groups[e.type][e.guid] = e.amount;
      return groups;
    }, {});

    return Promise.all(Object.keys(groupedItems).map(async e => {
      return fetch('/api/inventory', {
        headers: {
          authorization: `Bearer ${player.auth}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ selection: groupedItems[e], tab: e }),
        method: 'DELETE'
      }).then(r => r.json());
    }));
  }

  async function repairPoint(guid) {
    return fetch('/api/repair', {
      headers: {
        authorization: `Bearer ${player.auth}`,
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: `guid=${guid}&position%5B%5D=0.0&position%5B%5D=0.0`,
      method: 'POST',
    }).then(r => r.json());
  }

  function createSettingsMenu() {
    function createSection(title, subtitle) {
      let section = document.createElement('details');
      section.classList.add('sbgcui_settings-section');

      let sectionTitle = document.createElement('summary');
      sectionTitle.classList.add('sbgcui_settings-title');
      sectionTitle.innerText = title;

      let sectionSubTitle = document.createElement('h6');
      sectionSubTitle.classList.add('sbgcui_settings-subtitle');
      sectionSubTitle.innerHTML = subtitle;

      section.appendChild(sectionTitle);
      section.appendChild(sectionSubTitle);

      return section;
    }

    function createInput(type, name, checked, text, value) {
      let isCheckbox = type == 'checkbox';
      let wrapper = document.createElement('div');
      let label = document.createElement('label');
      let input = document.createElement('input');

      wrapper.classList.add('sbgcui_settings-input_wrp');

      input.id = isCheckbox ? name : name + Math.random().toString().slice(2);
      input.name = name;
      input.type = type;
      input.value = isCheckbox ? 1 : value;
      input.checked = checked;

      label.htmlFor = input.id;
      label.innerText = text;

      if (isCheckbox) {
        let hiddenInput = document.createElement('input');

        hiddenInput.name = name;
        hiddenInput.type = 'hidden';
        hiddenInput.value = 0;

        wrapper.appendChild(hiddenInput);
      }

      wrapper.append(input, label);

      return wrapper;
    }

    function createRadioGroup(title, inputs = []) {
      let header = document.createElement('h5');
      let inputsWrp = document.createElement('div');
      let radioGroup = document.createElement('div');

      header.classList.add('sbgcui_settings-radio_group-title');
      inputsWrp.classList.add('sbgcui_settings-inputs_group');
      radioGroup.classList.add('sbgcui_settings-radio_group');

      header.innerText = title;

      inputs.forEach(e => { inputsWrp.appendChild(e); });

      radioGroup.append(header, inputsWrp);

      return radioGroup;
    }

    function createAutoDeleteSection(maxAmountInBag) {
      let section = createSection(
        'Автоудаление',
        `Когда в инвентаре останется меньше ${MIN_FREE_SPACE} мест, будут удалены предметы, превышающие указанное количество. <br>Значение "-1" предотвращает удаление.`
      );
      let forceClearButton = document.createElement('button');

      forceClearButton.classList.add('sbgcui_settings-forceclear');
      forceClearButton.innerText = 'Очистить сейчас';
      forceClearButton.addEventListener('click', function (event) {
        event.preventDefault();

        let result = confirm('Произвести очистку инвентаря согласно настройкам?');

        if (result) { clearInventory(undefined, true); }
      });
      section.appendChild(forceClearButton);

      for (let key in maxAmountInBag) {
        let subSection = document.createElement('section');
        let subSectionTitle = document.createElement('h4');
        let maxAmounts = document.createElement('div');

        subSection.classList.add('sbgcui_settings-subsection');
        subSectionTitle.classList.add('sbgcui_settings-title');
        maxAmounts.classList.add('sbgcui_settings-maxamounts');

        subSectionTitle.innerText = (key == 'cores') ? 'Ядра' : (key == 'catalysers') ? 'Катализаторы' : (key == 'refs') ? 'Рефы' : 'N/D';

        for (let type in maxAmountInBag[key]) {
          let wrapper = document.createElement('div');
          let label = document.createElement('label');
          let input = document.createElement('input');

          wrapper.classList.add('sbgcui_settings-amount_input_wrp');
          label.classList.add('sbgcui_settings-amount_label');
          input.classList.add('sbgcui_settings-amount_input');

          if (key == 'refs') {
            label.innerText = (type == 'allied') ? 'Свои:' : 'Чужие:';
            label.classList.add(`sbgcui_settings-amount_label_${type}`);
          } else {
            label.innerText = type + ':';
            label.style.color = `var(--level-${numbersConverter.toDecimal(type)})`;
          }

          input.name = `maxAmountInBag_${key}_${type}`;
          input.type = 'number';
          input.min = -1;
          input.value = maxAmountInBag[key][type];

          wrapper.append(label, input);

          maxAmounts.appendChild(wrapper);
        }

        subSection.append(subSectionTitle, maxAmounts);

        section.appendChild(subSection);
      }

      return section;
    }

    function createAutoSelectSection(autoSelect) {
      let section = createSection(
        'Автовыбор',
        'Можно автоматически выбирать самый мощный катализатор при атаке, самое маленькое ядро при деплое или следующий уровень ядра при каждом апгрейде.'
      );
      let subSection = document.createElement('section');

      let attackMax = createInput('radio', 'autoSelect_attack', (autoSelect.attack == 'max'), 'Самый мощный', 'max');
      let attackLatest = createInput('radio', 'autoSelect_attack', (autoSelect.attack == 'latest'), 'Последний использованный', 'latest');

      let deployMin = createInput('radio', 'autoSelect_deploy', (autoSelect.deploy == 'min'), 'Наименьшее', 'min');
      let deployMax = createInput('radio', 'autoSelect_deploy', (autoSelect.deploy == 'max'), 'Наибольшее', 'max');
      let deployOff = createInput('radio', 'autoSelect_deploy', (autoSelect.deploy == 'off'), 'Вручную', 'off');

      let upgradeMin = createInput('radio', 'autoSelect_upgrade', (autoSelect.upgrade == 'min'), 'Наименьшее', 'min');
      let upgradeMax = createInput('radio', 'autoSelect_upgrade', (autoSelect.upgrade == 'max'), 'Наибольшее', 'max');
      let upgradeOff = createInput('radio', 'autoSelect_upgrade', (autoSelect.upgrade == 'off'), 'Вручную', 'off');

      let attackGroup = createRadioGroup('Катализатор при атаке:', [attackMax, attackLatest]);
      let deployGroup = createRadioGroup('Ядро при деплое:', [deployMin, deployMax, deployOff]);
      let upgradeGroup = createRadioGroup('Ядро при апгрейде:', [upgradeMin, upgradeMax, upgradeOff]);

      subSection.classList.add('sbgcui_settings-subsection');

      subSection.append(attackGroup, deployGroup, upgradeGroup);

      section.appendChild(subSection);

      return section;
    }

    function createColorSchemeSection(mapFilters) {
      function setCssVar(cssVar, value) {
        let filter = cssVar.split('_')[1];
        let units = (filter == 'blur') ? 'px' : (filter == 'hueRotate') ? 'deg' : '';
        document.querySelector(':root').style.setProperty(`--sbgcui-${filter}`, `${value}${units}`);
      }

      function createInput(type, name, min, max, step, value, text) {
        let wrapper = document.createElement('div');
        let label = document.createElement('label');
        let input = document.createElement('input');

        wrapper.classList.add('sbgcui_settings-mapfilters_input_wrp');

        input.type = type;
        input.name = name;
        input.min = min;
        input.max = max;
        input.step = step;
        input.value = value;

        label.innerText = text;

        input.addEventListener('input', event => { setCssVar(name, event.target.value); });

        wrapper.append(label, input);

        return wrapper;
      }

      let section = createSection(
        'Цветовая схема',
        'Настройте оттенок карты.'
      );
      let subSection = document.createElement('section');

      let invert = createInput('range', 'mapFilters_invert', 0, 1, 0.01, +mapFilters.invert, 'Инверсия');
      let hueRotate = createInput('range', 'mapFilters_hueRotate', 0, 360, 1, +mapFilters.hueRotate, 'Цветность');
      let brightness = createInput('range', 'mapFilters_brightness', 0, 1, 0.01, +mapFilters.brightness, 'Яркость');
      let grayscale = createInput('range', 'mapFilters_grayscale', 0, 1, 0.01, +mapFilters.grayscale, 'Оттенок серого');
      let blur = createInput('range', 'mapFilters_blur', 0, 4, 0.1, +mapFilters.blur, 'Размытие');

      subSection.classList.add('sbgcui_settings-subsection');

      subSection.append(invert, hueRotate, brightness, grayscale, blur);

      section.appendChild(subSection);

      return section;
    }

    function createTintingSection(tinting) {
      let section = createSection(
        'Тонирование',
        'Интерфейс браузера будет окрашиваться в зависимости от того, что происходит на экране.'
      );
      let subSection = document.createElement('section');

      let mapTinting = createInput('checkbox', 'tinting_map', +tinting.map, 'При просмотре карты');
      let profileTinting = createInput('checkbox', 'tinting_profile', +tinting.profile, 'При просмотре профиля');
      let pointTintingLvl = createInput('radio', 'tinting_point', (tinting.point == 'level'), 'Цвет уровня', 'level');
      let pointTintingTeam = createInput('radio', 'tinting_point', (tinting.point == 'team'), 'Цвет команды', 'team');
      let pointTintingOff = createInput('radio', 'tinting_point', (tinting.point == 'off'), 'Нет', 'off');

      mapTinting.addEventListener('change', e => {
        if (e.target.checked) {
          addTinting('map');
        } else {
          addTinting('');
        }
      });

      let pointTintingGroup = createRadioGroup('При просмотре точки:', [pointTintingLvl, pointTintingTeam, pointTintingOff]);

      subSection.classList.add('sbgcui_settings-subsection');

      subSection.append(mapTinting, profileTinting, pointTintingGroup);

      section.appendChild(subSection);

      return section;
    }


    let form = document.createElement('form');
    form.classList.add('sbgcui_settings', 'sbgcui_hidden');

    let formHeader = document.createElement('h3');
    formHeader.classList.add('sbgcui_settings-header');
    formHeader.innerText = 'Настройки';

    let submitButton = document.createElement('button');
    submitButton.innerText = 'Сохранить';

    let closeButton = document.createElement('button');
    closeButton.innerText = 'Закрыть';


    closeButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      closeSettingsMenu();
    });


    let buttonsWrp = document.createElement('div');
    buttonsWrp.classList.add('sbgcui_settings-buttons_wrp');
    buttonsWrp.append(submitButton, closeButton);


    let sections = [
      createAutoDeleteSection(config.maxAmountInBag),
      createAutoSelectSection(config.autoSelect),
      createColorSchemeSection(config.mapFilters),
      createTintingSection(config.tinting),
    ];

    sections.forEach(e => {
      e.addEventListener('click', event => {
        sections.forEach(e => {
          if (event.currentTarget != e) { e.removeAttribute('open'); }
        });
      });
    });

    form.append(formHeader, ...sections, buttonsWrp);

    form.addEventListener('submit', e => {
      e.preventDefault();

      try {
        let formData = new FormData(e.target);
        let formEntries = Object.fromEntries(formData);

        for (let key in formEntries) {
          let path = key.split('_');
          if (path[0] == 'maxAmountInBag') {
            config.maxAmountInBag[path[1]][path[2]] = Number.isInteger(+formEntries[key]) ? formEntries[key] : -1;
          } else if (path[0].match(/autoSelect|mapFilters|tinting/)) {
            config[path[0]][path[1]] = formEntries[key];
          }
        }

        localStorage.setItem('sbgcui_config', JSON.stringify(config));

        let toast = createToast('Настройки сохранены');
        toast.showToast();
      } catch (err) {
        let toast = createToast(`Ошибка при сохранении настроек. <br>${err.message}`);

        toast.options.className = 'error-toast';
        toast.showToast();

        console.log(`Ошибка при сохранении настроек. ${err}`);
      }
    });

    return form;
  }

  function closeSettingsMenu() {
    let mapFilters = config.mapFilters;
    let root = document.querySelector(':root');

    for (let key in mapFilters) {
      let units = (key == 'blur') ? 'px' : (key == 'hueRotate') ? 'deg' : '';
      root.style.setProperty(`--sbgcui-${key}`, `${mapFilters[key]}${units}`);
    }

    if (+config.tinting.map && !isPointPopupOpened && !isProfilePopupOpened) { addTinting('map'); }

    document.querySelector('.sbgcui_settings').classList.add('sbgcui_hidden');
    document.querySelectorAll('.sbgcui_settings > details').forEach(e => { e.open = false; });

    document.querySelectorAll('.sbgcui_settings input:not([type="hidden"])').forEach(e => {
      let path = e.name.split('_');
      let value = path.reduce((obj, prop) => obj[prop], config);

      if (e.type.match(/checkbox|number/)) {
        e.value = +value;
        e.checked = +value;
      } else if (e.type == 'radio') {
        e.checked = e.value == value;
      } else if (e.type == 'range') {
        e.value = +value;
      }
    });
  }

  function chooseCatalyser(type) {
    let cachedCatalysers = JSON.parse(localStorage.getItem('inventory-cache')).filter(e => e.t == 2 && e.l <= player.level).sort((a, b) => a.l - b.l);
    let catalyser;

    switch (type) {
      case 'latest':
        catalyser = attackSlider.querySelector(`[data-guid="${lastUsedCatalyser}"]`);
        if (catalyser) { break; } // Если последний использованный кат не найден - проваливаемся ниже и выбираем максимальный.
      case 'max':
        catalyser = attackSlider.querySelector(`[data-guid="${cachedCatalysers[cachedCatalysers.length - 1].g}"]`);
        break;
    }

    return catalyser;
  }

  function click(element) {
    let mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    let mouseUpEvent = new MouseEvent('mouseup', { bubbles: true, cancelable: true });
    let clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });

    element?.dispatchEvent(mouseDownEvent);
    element?.dispatchEvent(mouseUpEvent);
    element?.dispatchEvent(clickEvent);
  }

  function createToast(text = '', position = 'top left', duration = 6000, container = null) {
    let parts = position.split(/\s+/);
    let toast = Toastify({
      text,
      duration,
      gravity: parts[0],
      position: parts[1],
      escapeMarkup: false,
      className: 'interaction-toast',
      selector: container,
    });
    toast.options.id = Math.round(Math.random() * 1e5);;
    toast.options.onClick = () => toast.hideToast();
    return toast;
  }

  function updateExpBar(playerExp) {
    let formatter = new Intl.NumberFormat('en-GB');
    let totalLvlExp = 0;

    for (let i = 0; i < LEVEL_TARGETS.length; i += 1) {
      totalLvlExp += LEVEL_TARGETS[i];

      if (totalLvlExp > playerExp) {
        selfExpSpan.innerText = totalLvlExp != Infinity ?
          `${formatter.format(playerExp - (totalLvlExp - LEVEL_TARGETS[i]))} / ${formatter.format(LEVEL_TARGETS[i])}` :
          formatter.format(playerExp);

        selfLvlSpan.innerText = i + 1;

        return;
      }
    }
  }

  function addTinting(type) {
    function rgb2hex(rgb) {
      if (!rgb) { return ''; }
      return `#${rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/).slice(1).map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('')}`;
    }

    let color;
    let yaRegexp = /ya-title=.*?,\sya-dock=.*?(?=,|$)/;

    switch (type) {
      case 'map':
        color = getComputedStyle(selfNameSpan).color;
        break;
      case 'profile':
        color = getComputedStyle(profileNameSpan).color;
        profilePopup.style.borderColor = color;
        break;
      case 'point_level':
        color = getComputedStyle(pointLevelSpan).color;
        pointPopup.style.borderColor = color;
        break;
      case 'point_team':
        color = getComputedStyle(pointOwnerSpan).color;
        pointPopup.style.borderColor = color;
        break;
      default:
        color = '';
        break;
    }

    color = rgb2hex(color);

    theme.content = color;
    if (!viewport.content.match(yaRegexp)) {
      viewport.content += `, ya-title=${color}, ya-dock=${color}`;
    } else {
      viewport.content = viewport.content.replace(yaRegexp, `ya-title=${color}, ya-dock=${color}`);
    }
  }

  function updateConfigStructure(obj1, obj2) {
    for (let key in obj1) {
      if (typeof obj1[key] != typeof obj2[key]) {
        obj1[key] = obj2[key];
      } else if (typeof obj1[key] == 'object') {
        updateConfigStructure(obj1[key], obj2[key]);
      }
    }
  }

  function showXp(amount) {
    let xpSpan = document.createElement('span');
    xpSpan.classList.add('sbgcui_xpdiff');

    xpSpan.innerText = `+${amount}xp`;
    xpContainer.appendChild(xpSpan);

    setTimeout(_ => { xpSpan.classList.add('sbgcui_xpdiff-out'); }, 100);
    setTimeout(_ => { xpContainer.removeChild(xpSpan); }, 3000);
  }


  window.XMLHttpRequest = customXHR;


  /* Данные о себе и версии игры */
  {
    var selfData = await getSelfData();

    if (LATEST_KNOWN_VERSION != selfData.version) {
      let warns = +localStorage.getItem('sbgcui_version_warns');

      if (warns < 2) {
        let toast = createToast(`Текущая версия игры (${selfData.version}) не соответствует последней известной версии (${LATEST_KNOWN_VERSION}). Возможна некорректная работа.`);
        toast.options.className = 'error-toast';
        toast.showToast();
        localStorage.setItem('sbgcui_version_warns', warns + 1);
      }
    } else {
      localStorage.setItem('sbgcui_version_warns', 0);
    }

    var player = {
      name: selfData.name,
      team: selfData.team,
      exp: {
        total: selfData.exp,
        current: selfData.exp - LEVEL_TARGETS.slice(0, selfData.lvl - 1).reduce((sum, e) => e + sum, 0),
        goal: LEVEL_TARGETS[selfData.lvl - 1],
        get percentage() { return this.current / this.goal * 100; },
        set string(str) { [this.current, this.goal] = str.replaceAll(',', '').split(' / '); }
      },
      auth: localStorage.getItem('auth'),
      guid: selfData.guid,
      get level() { return this._level; },
      set level(str) { this._level = +str.split('').filter(e => e.match(/[0-9]/)).join(''); },
      _level: selfData.lvl,
    };
  }


  /* Мутации */
  {
    let lvlObserver = new MutationObserver((_, observer) => {
      observer.disconnect();

      player.level = selfLvlSpan.textContent;
      selfLvlSpan.innerText = (player.level <= 9 ? '0' : '') + player.level;

      observer.observe(selfLvlSpan, { childList: true });
    });
    lvlObserver.observe(selfLvlSpan, { childList: true });


    let pointLevelObserver = new MutationObserver(records => {
      let event = new Event('pointLevelChanged', { bubbles: true });
      pointLevelSpan.dispatchEvent(event);
    });
    pointLevelObserver.observe(pointLevelSpan, { childList: true });


    let pointOwnerObserver = new MutationObserver(records => {
      let event = new Event('pointOwnerChanged', { bubbles: true });
      pointOwnerSpan.dispatchEvent(event);
    });
    pointOwnerObserver.observe(pointOwnerSpan, { childList: true });


    let pointCoresObserver = new MutationObserver(records => {
      let event = new Event('pointCoresUpdated', { bubbles: true });
      pointCores.dispatchEvent(event);
    });
    pointCoresObserver.observe(pointCores, { childList: true });


    let pointPopupObserver = new MutationObserver(records => {
      isPointPopupOpened = !records[0].target.classList.contains('hidden');
      let event = new Event(isPointPopupOpened ? 'pointPopupOpened' : 'pointPopupClosed', { bubbles: true });
      records[0].target.dispatchEvent(event);
    });
    pointPopupObserver.observe(pointPopup, { attributes: true, attributeFilter: ["class"] });


    let profilePopupObserver = new MutationObserver(records => {
      isProfilePopupOpened = !records[0].target.classList.contains('hidden');
      let event = new Event(isProfilePopupOpened ? 'profilePopupOpened' : 'profilePopupClosed', { bubbles: true });
      records[0].target.dispatchEvent(event);
    });
    profilePopupObserver.observe(profilePopup, { attributes: true, attributeFilter: ["class"] });


    let attackSliderObserver = new MutationObserver(records => {
      let isHidden = records[0].target.classList.contains('hidden');
      let event = new Event(isHidden ? 'attackSliderClosed' : 'attackSliderOpened', { bubbles: true });
      records[0].target.dispatchEvent(event);
    });
    attackSliderObserver.observe(attackSlider, { attributes: true, attributeFilter: ["class"] });


    let inventoryContentObserver = new MutationObserver(records => {
      records.forEach(e => {
        if (e.oldValue.indexOf('loading') > -1 && e.target.classList.contains('loaded')) {
          let energy = e.target.querySelector('.inventory__item-descr').childNodes[4].nodeValue;
          let isAllied = e.target.querySelector('.inventory__item-title').style.color.indexOf(`team-${player.team}`) > -1;

          if (isAllied) {
            e.target.style.setProperty('--sbgcui-energy', `${energy}%`);
            if (energy < 100) {
              e.target.style.setProperty('--sbgcui-display-r-button', 'flex');
            }
          }
        }
      });
    });
    inventoryContentObserver.observe(document.querySelector('.inventory__content'), { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });


    let xpDiffSpanObserver = new MutationObserver(records => {
      let xp = records.find(e => e.addedNodes.length).addedNodes[0].data.match(/\d+/)[0];
      showXp(xp);
    });
    xpDiffSpanObserver.observe(xpDiffSpan, { childList: true });
  }

  /* Прочие события */
  {
    discoverButton.addEventListener('click', clearInventory);

    attackButton.addEventListener('click', _ => { attackButton.classList.toggle('sbgcui_attack-menu-rotate'); });
  }


  /* Стили */
  {
    let mapFilters = config.mapFilters;
    let style = this.document.createElement('style');

    document.head.appendChild(style);

    style.innerHTML = (`
      :root {
        --sbgcui-invert: ${mapFilters.invert};
        --sbgcui-hueRotate: ${mapFilters.hueRotate}deg;
        --sbgcui-brightness: ${mapFilters.brightness};
        --sbgcui-grayscale: ${mapFilters.grayscale};
        --sbgcui-blur: ${mapFilters.blur}px;
      }

      html, button {
        touch-action: manipulation;
      }

      html {
        user-select: none;
        -webkit-user-select: none;
      }

      body {
        display: flex;
	      flex-direction: column;
	      position: relative;
      }

      #attack-slider-fire {
        height: 50px;
      }

      #attack-menu {
        background-color: rgba(110, 110, 110, 0.2);
        background-clip: content-box;
        border-style: groove;
        border-top-style: dotted;
        width: 6em;
        height: 6em;
        padding: 0;
        border-width: 8px;
        border-radius: 50%;
        border-color: var(--team-${player.team});
        box-shadow: 0px 0px 10px 0px rgba(110, 110, 110, 0.2);
        -moz-transform: rotate(-45deg);
      }

      #attack-menu::after {
        display: block;
        content: "";
        width: 50%;
        height: 50%;
        background-color: var(--team-${player.team});
        border-radius: 30%;
        margin: auto;
        transition: transform 0.5s ease, border-radius 0.5s ease 0.2s;
      }

      #catalysers-list > .splide__slide {
        height: initial !important;
      }

      #inventory__close {
        top: initial;
        bottom: 120px;
        right: 50%;
        transform: translateX(50%);
        font-size: 1.5em;
        padding: 0 0.1em;
        z-index: 1;
      }

      #inventory-delete-section {
        margin-right: auto;
      }

      #layers {
        position: initial;
      }

      #logout {
        width: 10em;
        align-self: flex-start;
        margin-left: auto;
        margin-top: 15px;
      }

      #map {
        position: absolute;
	      top: 0;
	      left: 0;
	      z-index: 1;
      }

      #self-info__exp {
        font-size: 1em;
        padding: 0 1em;
      }

      #self-info__explv {
        font-size: 2.2em;
        text-shadow: 3px 3px 2px black;
      }

      #self-info__inv::after {
        content: " / ${INVENTORY_LIMIT}";
      }
      
      #self-info__name {
        font-size: 1.2em;
        position: absolute;
        top: 0em;
        left: 100%;
        z-index: 1;
        pointer-events: auto;
      }

      #toggle-follow {
        transform: rotate(-90deg);
      }
      
      #ops {
        position: absolute;
        left: 0;
        bottom: -10px;
        font-size: inherit;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      #ops, .game-menu > button {
        color: var(--team-${player.team});
	      background-color: var(--ol-background-color);
	      border: 1px solid var(--ol-subtle-background-color);
	      border-radius: 4px;
      }

      .attack-slider-buttons {
        margin-top: 5px;
      }

      .attack-slider-highlevel {
        height: unset;
        padding-bottom: 5px;
      }

      .attack-slider-wrp {
        z-index: 2;
        position: initial;
        top: initial;
        left: initial;
        transform: initial;
        order: 2;
        display: flex;
        flex-direction: column;
        margin-bottom: 5px;
      }

      .bottomleft-container {
        pointer-events: none;
        z-index: 2;
        position: relative;
        bottom: initial;
        left: initial;
        order: 3;
        margin: 0 5px 15px;
        justify-content: center;
      }

      .bottomleft-container button {
        pointer-events: auto;
      }

      .catalysers-list__level {
        font-size: 1.5em;
      }

      .catalysers-list__amount, .attack-slider-highlevel {
        font-size: 1em;
      }

      .catalysers-list__amount, .cores-list__amount {
        width: 100%;
        text-align: center;
      }

      .game-menu button {
        pointer-events: auto;
      }

      .inventory__content {
        order: 1;
	      margin-bottom: 0;
      }

      .inventory__content[data-type="3"] {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      
      .inventory__content[data-type="3"] .inventory__item {
        --sbgcui-energy: 0%;
        --sbgcui-display-r-button: none;
        padding-right: 35px;
        position: relative;
        grid-template-columns: auto 1fr;
      }

      .inventory__content[data-type="3"] .inventory__item-controls::after {
        content: "R";
        background: #666;
        display: var(--sbgcui-display-r-button);
        align-items: center;
        border-radius: 3px;
        position: absolute;
        height: 100%;
        justify-content: center;
        width: 30px;
        right: 0;
        top: 0;
      }

      .inventory__content[data-type="3"] .inventory__item.loaded .inventory__item-left::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        width: var(--sbgcui-energy);
        opacity: 0.3;
        background-color: var(--team-${player.team});
        transition: width 0.5s ease;
      }

      .inventory__manage-amount {
        z-index: 1;
      }

      .inventory__item-controls {
        order: 1;
        overflow: visible;
        display: flex;
	      flex-direction: column;
	      height: 100%;
	      justify-content: space-between;
      }

      .inventory__controls {
        order: 3;
        height: 40px;
      }

      .inventory__item-left {
        order: 2;
        position: relative;
        margin-right: 5px;
      }

      .inventory__tabs {
        order: 2;
	      margin-bottom: 10px;
        padding: 0;
        gap: 0;
      }

      .inventory__tab {
        display: flex;
        align-items: center;
        height: 35px;
        border-bottom: 2px #0000 solid;
        border-top: none;
        flex-grow: 1;
        justify-content: center;
      }

      .inventory__tab.active {
        color: var(--selection);
      }

      .ol-control {
        left: initial;
	      right: 0.5em;
        top: initial;
        bottom: 5px;
        transform: initial;
      }

      .ol-control button {
        color: var(--team-${player.team});
        font-size: 1.7em !important;
      }

      .ol-control button:hover, .ol-control button:focus {
        outline: unset;
        color: var(--team-${player.team});
      }

      .ol-layer__osm {
        filter: invert(var(--sbgcui-invert)) hue-rotate(var(--sbgcui-hueRotate)) brightness(var(--sbgcui-brightness)) grayscale(var(--sbgcui-grayscale)) blur(var(--sbgcui-blur));
      }

      .ol-rotate {
        position: initial;
        margin-top: 10px;
        transform: none !important;
      }

      .ol-rotate.ol-hidden {
        opacity: 0 !important;
        visibility: hidden !important;
      }

      .profile {
        overflow: auto;
      }

      .profile .popup-close {
        position: absolute;
        left: 50%;
        bottom: 15px;
        transform: translateX(-50%);
      }

      .self-info {
        color: var(--team-${player.team});
        font-weight: bold;
        border: none;
        background-color: unset;
        flex-direction: row;
        gap: unset;
        text-shadow: 2px 2px 1px black;
        pointer-events: none;
      }
  
      .self-info__entry {
        display: flex;
        align-items: flex-end;
        position: relative;
        padding-right: 0.5em;
      }

      .toastify:nth-child(n+${MAX_TOASTS + 1}) {
        display: none;
      }

      .topleft-container {
        max-width: unset;
        width: 100%;
        box-sizing: border-box;
        background: linear-gradient(180deg, var(--team-${player.team}) -170%, rgba(255,255,255,0) 100%);
        pointer-events: none;
        position: initial;
        top: initial;
        left: initial;
	      z-index: 2;
	      margin-bottom: auto;
      }

      .xp-diff {
        display: none;
      }

      .sbgcui_compare_stats {
        display: flex;
        gap: 10px;
        padding: 10px 0;
        border-bottom: 1px var(--border-transp) solid;
        border-top: 1px var(--border-transp) solid;
      }

      .sbgcui_compare_stats-timestamp {
        font-size: 0.8em;
        color: var(--text-disabled);
        display: inline;
        margin-right: auto;
      }

      .sbgcui_compare_stats-toast {
        border: 1px var(--team-${player.team}) solid;
        border-color: var(--team-${player.team});
	      box-shadow: 0 0 15px var(--team-${player.team});
        text-align: center;
        background: var(--background);
        color: var(--text);
      }

      .sbgcui_compare_stats-diff-wrp {
        display: flex;
        justify-content: space-between;
        margin: 0;
      }

      .sbgcui_compare_stats-diff-valuePos {
        color: green;
      }

      .sbgcui_compare_stats-diff-valueNeg {
        color: red;
      }

      .sbgcui_settings {
        display: flex;
        flex-direction: column;
        padding: 10px 5px 0 5px;
        margin-top: 10px;
        border: 1px solid #666;
        background: var(--background);
        pointer-events: auto;
        position: relative;
        z-index: 99;
        max-height: 70vh;
        overflow: auto;
        box-shadow: 0px 0px 10px var(--shadow);
      }

      .sbgcui_settings-buttons_wrp {
        display: flex;
        justify-content: space-around;
        position: sticky;
        bottom: 0;
        background: var(--background);
        padding: 10px 0;
      }

      .sbgcui_settings-buttons_wrp > button {
        width: 35%;
        margin: 0 auto;
      }
      
      .sbgcui_settings-header {
        text-align: center;
        margin: 0;
      }
      
      .sbgcui_settings-section {
        margin-bottom: 15px;
      }
      
      .sbgcui_settings-title {
        margin: 0;
        padding-bottom: 5px;
      }
      
      .sbgcui_settings-subtitle {
        margin: 0;
        color: #666;
      }
      
      .sbgcui_settings-subsection {
        padding: 0 15px;
        margin-top: 10px;
      }
      
      .sbgcui_settings-maxamounts {
        padding-left: 15px;
        margin-top: 5px;
        column-count: 2;
      }
      
      .sbgcui_settings-amount_input_wrp {
        margin-bottom: 10px;
        display: flex;
      }
      
      .sbgcui_settings-amount_label {
        flex-basis: 20%;
      }

      .sbgcui_settings-amount_label_allied {
        color: var(--team-${player.team});
      }

      .sbgcui_settings-amount_label_hostile {
        color: #666;
      }
      
      .sbgcui_settings-amount_input {
        margin-left: 10px;
        width: 4em;
      }

      .sbgcui_settings-input_wrp, .sbgcui_settings-mapfilters_input_wrp {
        font-size: 0.8em;
        display: flex;
        margin-top: 10px;
      }

      .sbgcui_settings-input_wrp > label {
        margin-left: 5px;
      }
      
      .sbgcui_settings-input_wrp > input[type="checkbox"] {
        margin-left: 0;
      }

      .sbgcui_settings-inputs_group {
        padding-left: 15px;
      }

      .sbgcui_settings-radio_group-title {
        margin: 0;
      }

      .sbgcui_settings-radio_group {
        margin-top: 10px;
      }

      .sbgcui_settings-mapfilters_input_wrp {
        justify-content: space-between;
      }

      .sbgcui_settings-mapfilters_input_wrp > label {
        word-break: break-all;
      }

      .sbgcui_settings-mapfilters_input_wrp > input {
        flex-basis: 60%;
        flex-shrink: 0;
      }

      .sbgcui_settings-forceclear {
        display: block;
        margin-top: 15px;
      }

      .sbgcui_xpProgressBar {
        border: 1px solid var(--team-${player.team});
        position: relative;
      }

      .sbgcui_xpProgressBarFiller {
        position: absolute;
        top: 0;
        left: 0;
        width: ${player.exp.percentage}%;
        height: 100%;
        background-color: var(--team-${player.team});
        opacity: 0.3;
      }

      .sbgcui_attack-menu-rotate::after {
        transform: rotate(135deg);
	      border-bottom-left-radius: 0 !important;
      }

      .sbgcui_xpdiff-wrapper {
        position: absolute;
        width: 100px;
        height: 100px;
        left: 50%;
        top: 20%;
        z-index: 99;
        transform: translateX(-50%);
        pointer-events: none;
      }

      .sbgcui_xpdiff {
        display: block;
        color: var(--selection);
        transition: 2.5s ease-out;
        white-space: nowrap;
        font-size: 1em;
        width: 100%;
        text-align: center;
        position: absolute;
        bottom: 0;
        text-shadow: 0px 0px 5px black;
        font-weight: bold;
      }

      .sbgcui_xpdiff-out {
        opacity: 0;
        transform: scale(2);
        bottom: 100% !important;
      }

      .sbgcui_pr-stat-header {
        margin: 15px 0 0;
        color: var(--selection);
      }

      .sbgcui_hidden {
        display: none;
      }

      @media (orientation: landscape) {
        #attack-slider-fire {
          height: initial;
        }

        .attack-slider-wrp {
          position: absolute;
          right: 0;
          bottom: 0;
          width: 40%;
          white-space: nowrap;
        }

        .catalysers-list__level {
          font-size: 1.2em;
        }

        .catalysers-list__amount, .attack-slider-highlevel {
          font-size: 0.8em;
        }

        .ol-zoom {
          top: 0.5em;
          bottom: initial;
          transform: translateY(0);
        }

        .sbgcui_attack-menu-rotate::after {
          transform: rotate(-135deg);
        }
      }
  `);
  }


  /* Удаление ненужного, переносы, переименования */
  {
    let ops = document.querySelector('#ops');
    let fw = document.querySelector('#toggle-follow');
    let blContainer = document.querySelector('.bottomleft-container');
    let rotateArrow = document.querySelector('.ol-rotate');
    let invCloseButton = document.querySelector('#inventory__close');
    let profileCloseButton = document.querySelector('.profile.popup .popup-close');
    let layersButton = document.querySelector('#layers');
    let logout = document.querySelector('#logout');


    document.querySelectorAll('.ol-attribution, #attack-slider-close, #link-tg, button[data-href="https://t.me/sbg_game"], .game-menu > a[href="/tasks/"]').forEach(e => { e.remove(); });
    document.querySelectorAll('.self-info__entry, #attack-menu').forEach(e => {
      e.childNodes.forEach(e => {
        if (e.nodeType == 3) { e.remove(); }
      })
    });

    profilePopup.insertBefore(logout, profileCloseButton);

    invCloseButton.innerText = '[x]';

    layersButton.innerText = String.fromCharCode(10019);

    zoomContainer.append(rotateArrow, fw, layersButton);

    fw.innerText = String.fromCharCode(10148);

    blContainer.appendChild(ops);

    ops.replaceChildren('INVENTORY', invTotalSpan);

    selfLvlSpan.innerText = (player.level <= 9 ? '0' : '') + player.level;

    profilePopup.addEventListener('profilePopupOpened', _ => {
      if (profileNameSpan.innerText == player.name) {
        logout.classList.remove('sbgcui_hidden')
      } else {
        logout.classList.add('sbgcui_hidden')
      }
    });
  }


  /* Прогресс-бар опыта */
  {
    let xpProgressBar = document.createElement('div');
    let xpProgressBarFiller = document.createElement('div');
    let selfExpSpan = document.querySelector('#self-info__exp');

    let lvlProgressObserver = new MutationObserver(() => {
      player.exp.string = selfExpSpan.textContent;
      xpProgressBarFiller.style.width = player.exp.percentage + '%';
    });
    lvlProgressObserver.observe(selfExpSpan, { childList: true });

    xpProgressBar.classList.add('sbgcui_xpProgressBar');
    xpProgressBarFiller.classList.add('sbgcui_xpProgressBarFiller');

    selfExpSpan.parentElement.prepend(xpProgressBar);
    xpProgressBar.append(selfExpSpan, xpProgressBarFiller);
  }

  /* Автовыбор */
  {
    attackSlider.addEventListener('attackSliderOpened', _ => {
      click(chooseCatalyser(config.autoSelect.attack));
    });

    pointPopup.addEventListener('pointPopupOpened', _ => {
      lastOpenedPoint.selectCore(config.autoSelect.deploy);
    });

    pointCores.addEventListener('click', event => {
      if (event.target.classList.contains('selected')) {
        lastOpenedPoint.selectCore(config.autoSelect.upgrade, numbersConverter.toDecimal(event.target.innerText));
      }
    });
  }


  /* Добавление зарядки из инвентаря */
  {
    let refsList = document.querySelector('.inventory__content');

    refsList.addEventListener('click', event => {
      if (!event.currentTarget.matches('.inventory__content[data-type="3"]')) { return; }
      if (!event.target.closest('.inventory__item-controls')) { return; }
      if (!event.target.closest('.inventory__item.loaded')) { return; }

      // Ширина блока кнопок "V M" около 30 px.
      // Правее них находится кнопка-псевдоэлемент "R".
      // Если нажато дальше 30px (50 – с запасом на возможное изменение стиля), значит нажата псевдокнопка, если нет – одна из кнопок V/M.
      // Приходится указывать конкретное число (50), потому что кнопка V при нажатии получает display: none и не имеет offsetWidth.
      if (event.offsetX < 50) { return; }

      let pointGuid = event.target.closest('.inventory__item')?.dataset.ref;

      repairPoint(pointGuid)
        .then(r => {
          if (r.error) {
            throw new Error(r.error);
          } else if (r.data) {
            let [pointEnergy, maxEnergy] = r.data.co.reduce((result, core) => [result[0] + core.e, result[1] + CORES_ENERGY[core.l]], [0, 0]);
            let refInfoDiv = document.querySelector(`.inventory__item[data-ref="${pointGuid}"] .inventory__item-left`);
            let refInfoEnergy = refInfoDiv.querySelector('.inventory__item-descr').childNodes[4];
            let percentage = Math.floor(pointEnergy / maxEnergy * 100);
            let inventoryItem = event.target.closest('.inventory__item');

            inventoryItem.style.setProperty('--sbgcui-energy', `${percentage}%`);
            inventoryItem.style.setProperty('--sbgcui-display-r-button', (percentage == 100 ? 'none' : 'flex'));

            if (refInfoEnergy) { refInfoEnergy.nodeValue = percentage; }

            updateExpBar(r.xp.cur);
            showXp(r.xp.diff);
          }
        })
        .catch(err => {
          let toast = createToast(`Ошибка при зарядке. <br>${err.message}`);

          toast.options.className = 'error-toast';
          toast.showToast();

          console.log('Ошибка при зарядке.', err);
        });
    });
  }


  /* Добавление меню настроек и кнопки */
  {
    let settingsMenu = createSettingsMenu();
    document.querySelector('.topleft-container').appendChild(settingsMenu);

    let settingsButton = document.createElement('button');
    settingsButton.innerText = 'Настройки';
    settingsButton.addEventListener('click', event => {
      event.stopPropagation();
      settingsMenu.classList.remove('sbgcui_hidden');
    });
    document.querySelector('.game-menu').appendChild(settingsButton);

    document.body.addEventListener('click', event => {
      if (!settingsMenu.classList.contains('sbgcui_hidden') && !event.target.closest('.sbgcui_settings')) { closeSettingsMenu(); }
    });
  }


  /* Тонирование интерфейса браузера */
  {
    var theme = document.createElement('meta');
    var viewport = document.querySelector('meta[name="viewport"]')

    theme.name = 'theme-color';
    document.head.appendChild(theme);

    let tinting = config.tinting;

    if (+tinting.map) { addTinting('map'); }

    profilePopup.addEventListener('profilePopupOpened', _ => {
      if (+tinting.profile) {
        addTinting('profile');
      } else {
        addTinting('');
      }
    });

    pointPopup.addEventListener('pointPopupOpened', _ => {
      if (tinting.point != 'off') {
        addTinting(`point_${tinting.point}`);
      } else {
        addTinting('');
      }
    });

    pointLevelSpan.addEventListener('pointLevelChanged', _ => {
      if (tinting.point == 'level') { addTinting('point_level'); }
    });

    pointOwnerSpan.addEventListener('pointOwnerChanged', _ => {
      if (tinting.point == 'team') { addTinting('point_team'); }
    });

    pointPopup.addEventListener('pointPopupClosed', _ => {
      if (isProfilePopupOpened) {
        if (+tinting.profile) { addTinting('profile'); }
      } else {
        if (+tinting.map) { addTinting('map'); } else { addTinting(''); }
      }
      pointPopup.style.borderColor = '';
    });

    profilePopup.addEventListener('profilePopupClosed', _ => {
      if (isPointPopupOpened) {
        if (tinting.point != 'off') { addTinting(`point_${tinting.point}`); }
      } else {
        if (+tinting.map) { addTinting('map'); } else { addTinting(''); }
      }
      profilePopup.style.borderColor = '';
    });
  }


  /* Всплывающий опыт */
  {
    var xpContainer = document.createElement('div');
    xpContainer.classList.add('sbgcui_xpdiff-wrapper');
    document.body.appendChild(xpContainer);
  }


  /* Запись статы */
  {
    let compareStatsWrp = document.createElement('div');
    let recordButton = document.createElement('button');
    let compareButton = document.createElement('button');
    let timestamp = document.createElement('span');
    let prStatsDiv = document.querySelector('.pr-stats');

    let previousStats = JSON.parse(localStorage.getItem('sbgcui_stats'), (key, value) => key == 'date' ? new Date(value) : value);

    recordButton.innerText = 'Записать';
    compareButton.innerText = 'Сравнить';

    recordButton.addEventListener('click', _ => {
      if (confirm('Сохранить вашу статистику на текущий момент? \nЭто действие перезапишет сохранённую ранее статистику.')) {
        getPlayerData(player.guid).then(stats => {
          let date = new Date();
          localStorage.setItem('sbgcui_stats', JSON.stringify({ date, stats }));
          timestamp.innerText = `Последняя запись: \n${date.toLocaleString()}`;
        });
      }
    });

    compareButton.addEventListener('click', _ => {
      let previousStats = JSON.parse(localStorage.getItem('sbgcui_stats'), (key, value) => key == 'date' ? new Date(value) : value);

      if (!previousStats) {
        let toast = createToast('Вы ещё не сохраняли свою статистику.');

        toast.options.className = 'error-toast';
        toast.showToast();

        return;
      }

      getPlayerData(player.guid).then(currentStats => {
        let ms = new Date() - previousStats.date;
        let dhms1 = [86400000, 3600000, 60000, 1000];
        let dhms2 = ['day', 'hr', 'min', 'sec'];
        let since = '';
        let diffs = '';

        dhms1.forEach((e, i) => {
          let amount = Math.trunc(ms / e);

          if (!amount) { return; }

          since += `${amount} ${dhms2[i] + (amount > 1 ? 's' : '')}${i == dhms1.length - 1 ? '' : ', '}`;
          ms -= amount * e;
        });

        for (let key in currentStats) {
          let diff = currentStats[key] - previousStats.stats[key];

          if (diff) {
            let isPositive = diff > 0;
            let statName;
            
            switch (key) {
              case 'discoveries':
              case 'captures':
              case 'level':
              case 'cores_deployed':
              case 'cores_destroyed':
              case 'lines_destroyed':
              case 'unique_captures':
              case 'unique_visits':
              case 'owned_points':
                statName = key.charAt(0).toUpperCase() + key.slice(1).replace('_', ' ');
                break;
              case 'xp':
                statName = 'XP';
                break;
              case 'guard_line':
                statName = 'Longest line ownership';
                break;
              case 'guard_point':
                statName = 'Longest point ownership';
                break;
              case 'lines':
                statName = 'Lines drawn';
                break;
              case 'max_line':
                statName = 'Longest drawn line (m)';
                break;
              case 'neutralizes':
                statName = 'Points neutralized';
                break;
              default:
                if (!key.match(/created_at|name|player|team/)) { statName = key; }
            }

            if (statName) {
              diffs += `
                <p class="sbgcui_compare_stats-diff-wrp">
                  <span>${statName}:</span>
                  <span class="sbgcui_compare_stats-diff-value${isPositive ? 'Pos' : 'Neg'}">
                    ${isPositive ? '+' : ''}${diff}
                  </span>
                </p>
              `;
            }
          }
        }

        let toastText = diffs.length ? `Ваша статистика с ${previousStats.date.toLocaleString()}<br>(${since})<br>${diffs}` : 'Ничего не изменилось с прошлого сохранения.';
        let toast = createToast(toastText, 'bottom center', 20000);

        toast.options.className = 'sbgcui_compare_stats-toast';
        toast.showToast();
      });
    });

    if (previousStats) {
      timestamp.innerText = `Последнее сохранение: \n${previousStats.date.toLocaleString()}`;
    }

    timestamp.classList.add('sbgcui_compare_stats-timestamp');

    compareStatsWrp.classList.add('sbgcui_compare_stats');
    compareStatsWrp.append(timestamp, recordButton, compareButton);

    profilePopup.insertBefore(compareStatsWrp, prStatsDiv);

    profilePopup.addEventListener('profilePopupOpened', _ => {
      if (profileNameSpan.innerText == player.name) {
        compareStatsWrp.classList.remove('sbgcui_hidden')
      } else {
        compareStatsWrp.classList.add('sbgcui_hidden')
      }
    });
  }

}, false);