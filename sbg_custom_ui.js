// ==UserScript==
// @name         SBG CUI
// @namespace    https://3d.sytes.net/
// @version      1.0.2
// @downloadURL  https://raw.githubusercontent.com/nicko-v/sbg-cui/main/sbg_custom_ui.js
// @description  SBG Custom UI
// @author       NV
// @match        https://3d.sytes.net/
// @grant        none
// ==/UserScript==

window.addEventListener('load', async function () {
  'use strict';

  if (document.querySelector('script[src="/intel.js"]')) { return; }


  const USERSCRIPT_VERSION = '0.2.5';
  const INVENTORY_LIMIT = 3000;
  const MIN_FREE_SPACE = 100;
  const MAX_TOASTS = 3;
  const IS_DARK = matchMedia('(prefers-color-scheme: dark)').matches;
  const CORES_ENERGY = { 0: 0, 1: 500, 2: 750, 3: 1000, 4: 1500, 5: 2000, 6: 2500, 7: 3500, 8: 4000, 9: 5250, 10: 6500 };
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
      deploy: 1,
      upgrade: 1,
      attack: 1,
    },
    mapFilters: {
      invert: IS_DARK ? 1 : 0,
      hueRotate: IS_DARK ? 180 : 0,
      brightness: IS_DARK ? 0.75 : 1,
      grayscale: IS_DARK ? 1 : 0,
      blur: 0,
    },
  };


  let attackSlider = document.querySelector('.attack-slider-wrp');
  let deployButton = document.querySelector('#deploy');
  let discoverButton = document.querySelector('#discover');
  let invTotalSpan = document.querySelector('#self-info__inv');
  let portalCores = document.querySelector('.i-stat__cores');
  let portalPopup = document.querySelector('.info.popup');
  let profileNickname = document.querySelector('#pr-name');
  let profilePopup = document.querySelector('.profile.popup');
  let selfLvlSpan = document.querySelector('#self-info__explv');


  let numbersConverter = {
    I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
    toDecimal(roman) { return this[roman]; },
    toRoman(decimal) { return Object.keys(this).find(key => this[key] == decimal); }
  };


  async function getSelfData() {
    return fetch('/api/self', {
      headers: { authorization: `Bearer ${localStorage.getItem('auth')}`, },
      method: "GET",
    })
      .then(r => { return Promise.all([r.headers.get('SBG-Version'), r]); })
      .then(r => Promise.all([r[0], r[1].json()]))
      .then(([version, data]) => { return { name: data.n, team: data.t, exp: data.x, lvl: data.l, version }; })
      .catch(err => { console.log(`Ошибка при получении данных игрока. ${err}`); });
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
    let maxAmount = JSON.parse(localStorage.getItem('sbgcui_config')).maxAmountInBag;

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

        /* Надо удалить предметы из кэша, т.к. при следующем хаке общее количество предметов возьмётся из кэша и счётчик будет некорректным */
        {
          let cache = JSON.parse(localStorage.getItem('inventory-cache')) || [];
          deleted.forEach(e => {
            let cachedItem = cache.find(f => f.g == e.guid);
            if (cachedItem) { cachedItem.a -= e.amount; }
          });
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

        let toast = createToast(`Ошибка при удалении предметов. <br>${err.message}`);

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

    function createAutoDeleteSection(maxAmountInBag) {
      let section = createSection(
        'Автоудаление',
        `Когда в инвентаре останется меньше ${MIN_FREE_SPACE} мест, будут удалены предметы, превышающие указанное количество. <br>Значение "-1" предотвращает удаление.`
      );
      let forceClearButton = document.createElement('button');


      for (let key in maxAmountInBag) {
        let subSection = document.createElement('section');
        let subsectionTitle = document.createElement('h4');
        let maxAmounts = document.createElement('div');

        subSection.classList.add('sbgcui_settings-subsection');
        subsectionTitle.classList.add('sbgcui_settings-title');
        maxAmounts.classList.add('sbgcui_settings-maxamounts');

        subsectionTitle.innerText = (key == 'cores') ? 'Ядра' : (key == 'catalysers') ? 'Катализаторы' : (key == 'refs') ? 'Рефы' : 'N/D';

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

        subSection.append(subsectionTitle, maxAmounts);

        section.appendChild(subSection);
      }

      forceClearButton.classList.add('sbgcui_settings-forceclear');
      forceClearButton.innerText = 'Очистить сейчас';
      forceClearButton.addEventListener('click', function (event) {
        event.preventDefault();

        let result = confirm('Произвести очистку инвентаря согласно настройкам?');

        if (result) { clearInventory(undefined, true); }
      });
      section.appendChild(forceClearButton);

      return section;
    }

    function createAutoSelectSection(autoSelect) {
      function createInput(type, name, checked, text) {
        let wrapper = document.createElement('div');
        let label = document.createElement('label');
        let input = document.createElement('input');
        let hiddenInput = document.createElement('input');

        wrapper.classList.add('sbgcui_settings-autoselect_input_wrp');

        hiddenInput.name = name;
        hiddenInput.type = 'hidden';
        hiddenInput.value = 0;

        input.id = name;
        input.name = name;
        input.type = type;
        input.value = 1;
        input.checked = checked;

        label.htmlFor = name;
        label.innerText = text;

        wrapper.append(hiddenInput, input, label);

        return wrapper;
      }
      let section = createSection(
        'Автовыбор',
        'Можно автоматически выбирать самый мощный катализатор при атаке, самое маленькое ядро при деплое или следующий уровень ядра при каждом апгрейде.'
      );
      let subSection = document.createElement('section');

      let attack = createInput('checkbox', 'autoSelect_attack', +autoSelect.attack, 'Наибольший катализатор при атаке');
      let deploy = createInput('checkbox', 'autoSelect_deploy', +autoSelect.deploy, 'Наименьшее ядро при деплое');
      let upgrade = createInput('checkbox', 'autoSelect_upgrade', +autoSelect.upgrade, 'Следующее ядро при апгрейде');

      subSection.classList.add('sbgcui_settings-subsection');

      subSection.append(attack, deploy, upgrade);

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


    let config;

    if (localStorage.getItem('sbgcui_config')) {
      config = JSON.parse(localStorage.getItem('sbgcui_config'));
      for (let key in DEFAULT_CONFIG) {
        if (!(key in config)) {
          config[key] = DEFAULT_CONFIG[key];
        }
        localStorage.setItem('sbgcui_config', JSON.stringify(config));
      }
    } else {
      config = DEFAULT_CONFIG;
      localStorage.setItem('sbgcui_config', JSON.stringify(config));
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
          } else if (path[0] == 'autoSelect' || path[0] == 'mapFilters') {
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
    let mapFilters = JSON.parse(localStorage.getItem('sbgcui_config')).mapFilters;
    let root = document.querySelector(':root');

    for (let key in mapFilters) {
      let units = (key == 'blur') ? 'px' : (key == 'hueRotate') ? 'deg' : '';
      root.style.setProperty(`--sbgcui-${key}`, `${mapFilters[key]}${units}`);
      document.querySelector(`input[name="mapFilters_${key}"]`).value = mapFilters[key];
    }

    document.querySelector('.sbgcui_settings').classList.add('sbgcui_hidden');
    document.querySelectorAll('.sbgcui_settings > details').forEach(e => { e.open = false; });
  }

  function chooseCore(romanCurrentLvl) {
    let coresList = document.querySelectorAll('.cores-list__level');
    let lowestAvailableCore = document.querySelector('#cores-list').firstChild || document.body;
    let arabicCurrentLvl = numbersConverter.toDecimal(romanCurrentLvl) || 0;

    if (!Object.keys(numbersConverter).includes(romanCurrentLvl)) { return lowestAvailableCore; }

    [...coresList].reduce((minCoreLvl, i) => {
      let coreLvl = numbersConverter.toDecimal(i.innerText.slice(3));

      if (coreLvl > arabicCurrentLvl && coreLvl < minCoreLvl && coreLvl <= player.level) {
        minCoreLvl = coreLvl;
        lowestAvailableCore = i;
      }

      return minCoreLvl;
    }, Infinity);

    return lowestAvailableCore;
  }

  function chooseCatalyser() {
    let catsList = document.querySelectorAll('.catalysers-list__level');
    let maxAvailableCat = document.querySelector('#catalysers-list').lastChild || document.body;

    [...catsList].reduce((maxCatLvl, e) => {
      let catLvl = numbersConverter.toDecimal(e.innerText.slice(3));

      if (catLvl > maxCatLvl && catLvl <= player.level) {
        maxCatLvl = catLvl;
        maxAvailableCat = e;
      }

      return maxCatLvl;
    }, 0);

    return maxAvailableCat;
  }

  function click(element) {
    let mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    let mouseUpEvent = new MouseEvent('mouseup', { bubbles: true, cancelable: true });
    let clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });

    element.dispatchEvent(mouseDownEvent);
    element.dispatchEvent(mouseUpEvent);
    element.dispatchEvent(clickEvent);
  }

  function createToast(text = '', position = 'top left', container = null) {
    let parts = position.split(/\s+/);
    let toast = Toastify({
      text,
      duration: 6000,
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


  /* Данные о себе и версии игры */
  {
    var selfData = await getSelfData();

    if (USERSCRIPT_VERSION != selfData.version) {
      let warns = +localStorage.getItem('sbgcui_version_warns');

      if (warns < 2) {
        let toast = createToast(`Версия SBG-CUI (${USERSCRIPT_VERSION}) не соответствует текущей версии игры (${selfData.version}). Возможна некорректная работа.`);
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


    let portalPopupObserver = new MutationObserver(records => {
      let isHidden = records[0].target.classList.contains('hidden');
      let event = new Event(isHidden ? 'portalPopupClosed' : 'portalPopupOpened', { bubbles: true });
      records[0].target.dispatchEvent(event);
    });
    portalPopupObserver.observe(portalPopup, { attributes: true, attributeFilter: ["class"] });


    let profilePopupObserver = new MutationObserver(records => {
      let isHidden = records[0].target.classList.contains('hidden');
      let event = new Event(isHidden ? 'profilePopupClosed' : 'profilePopupOpened', { bubbles: true });
      records[0].target.dispatchEvent(event);
    });
    profilePopupObserver.observe(profilePopup, { attributes: true, attributeFilter: ["class"] });


    let attackSliderObserver = new MutationObserver(records => {
      let isHidden = records[0].target.classList.contains('hidden');
      let event = new Event(isHidden ? 'attackSliderClosed' : 'attackSliderOpened', { bubbles: true });
      records[0].target.dispatchEvent(event);
    });
    attackSliderObserver.observe(attackSlider, { attributes: true, attributeFilter: ["class"] });
  }

  /* События */
  {
    attackSlider.addEventListener('attackSliderOpened', _ => {
      let config = JSON.parse(localStorage.getItem('sbgcui_config'));
      if (+config.autoSelect.attack) { click(chooseCatalyser()); }
    });


    profilePopup.addEventListener('profilePopupOpened', _ => {
      if (profileNickname.innerText == player.name) {
        $('#logout').show();
      } else {
        $('#logout').hide();
      }
    });


    portalPopup.addEventListener('portalPopupOpened', _ => {
      let config = JSON.parse(localStorage.getItem('sbgcui_config'));
      if (+config.autoSelect.deploy) { click(chooseCore()); }
    });


    portalCores.addEventListener('click', event => {
      let config = JSON.parse(localStorage.getItem('sbgcui_config'));
      if (+config.autoSelect.upgrade && event.target.classList.contains('selected')) {
        click(chooseCore(event.target.innerText));
      }
    });


    deployButton.addEventListener('click', event => {
      let config = JSON.parse(localStorage.getItem('sbgcui_config'));
      if (+config.autoSelect.upgrade && event.currentTarget.dataset.state == 'upgrade') {
        let nextCoreArrow = document.querySelector('.deploy-slider-wrp .splide__arrow.splide__arrow--next');
        click(nextCoreArrow);
      }
    });


    discoverButton.addEventListener('click', clearInventory);
  }


  /* Стили */
  {
    let style = this.document.createElement('style');
    let config = localStorage.getItem('sbgcui_config');
    let mapFilters = config ? JSON.parse(config).mapFilters : DEFAULT_CONFIG.mapFilters;

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

      .toastify:nth-child(n+${MAX_TOASTS + 1}) {
        display: none;
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
        margin: auto;
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
        transform: rotate(45deg);
        margin: auto;
      }

      #inventory__close {
        top: initial;
        bottom: 60px;
        right: 50%;
        transform: translateX(50%);
        font-size: 1.5em;
        padding: 0 0.1em;
        z-index: 1;
      }

      #inventory-delete-section {
        margin-right: auto;
      }

      #logout {
        width: 10em;
        align-self: flex-start;
        margin-left: auto;
        margin-top: 15px;
      }

      #self-info__exp {
        font-size: 1em;
        padding: 0 1em;
      }

      #self-info__explv {
        font-size: 2.2em;
        text-shadow: 3px 3px 2px black;
      }
      
      #self-info__name {
        font-size: 1.2em;
        position: absolute;
        top: 0em;
        left: 100%;
        z-index: 1;
        pointer-events: auto;
      }

      #toggle-follow, #ops {
        font-size: inherit;
      }

      .attack-slider-wrp {
        top: 70%;
      }

      .bottomleft-container {
        width: 100%;
        bottom: 1em;
        left: 0;
        pointer-events: none;
      }

      .bottomleft-container button {
        pointer-events: auto;
      }

      .game-menu button {
        pointer-events: auto;
      }

      .inventory__manage-amount {
        z-index: 1;
      }

      .inventory__content[data-type="3"] {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      
      .inventory__content[data-type="3"] .inventory__item {
        padding-left: 35px;
        position: relative;
      }

      .inventory__content[data-type="3"] .inventory__item-controls::before {
        content: "R";
        background: #666;
        display: flex;
        align-items: center;
        border-radius: 3px;
        position: absolute;
        height: 100%;
        justify-content: center;
        width: 30px;
        left: 0;
        top: 0;
      }

      .inventory__item-controls {
        overflow: visible;
      }

      .inventory__controls {
        height: 40px;
      }

      .inventory__item-left {
        position: relative;
      }

      .inventory__tab {
        display: flex;
        align-items: center;
        height: 35px;
      }

      .ol-layer__osm {
        filter: invert(var(--sbgcui-invert)) hue-rotate(var(--sbgcui-hueRotate)) brightness(var(--sbgcui-brightness)) grayscale(var(--sbgcui-grayscale)) blur(var(--sbgcui-blur));
      }

      .ol-rotate {
        top: unset;
        bottom: 2.5em;
      }

      .profile {
        overflow: auto;
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

      .topleft-container {
        max-width: unset;
        top: 0;
        left: 0;
        width: 100%;
        box-sizing: border-box;
        background: linear-gradient(180deg, var(--team-${player.team}) -170%, rgba(255,255,255,0) 100%);
        pointer-events: none;
      }
      
      .sbgcui_bottomleft_wrp {
        position: absolute;
        font-size: 1.1em;
        display: flex;
        width: 100%;
        justify-content: space-between;
        left: 0;
        bottom: 0;
        padding: 0 0.5em;
        box-sizing: border-box;
        pointer-events: none;
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

      .sbgcui_settings-autoselect_input_wrp, .sbgcui_settings-mapfilters_input_wrp {
        font-size: 0.8em;
        display: flex;
        margin-top: 10px;
      }

      .sbgcui_settings-autoselect_input_wrp > label {
        margin-left: 5px;
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
        margin: 20px 0 0 auto;
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

      .sbgcui_repairProgressFiller {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        width: 0;
        opacity: 0.3;
        background-color: var(--team-3);
        transition: width 0.5s ease;
      }

      .sbgcui_hidden {
        display: none;
      }
  `);
  }


  /* Удаление ненужного, переносы, переименования */
  {
    $(`
    .ol-attribution,
    #attack-slider-close,
    #link-tg,
    button[data-href="https://t.me/sbg_game"],
    .game-menu > a[href="/tasks/"]
    `).remove();

    $('.self-info__entry, #attack-menu').contents().filter((_, a) => a.nodeType === 3).remove();

    $('#logout').insertBefore($('.profile .popup-close'));

    $('#inventory__close').text('[x]');

    selfLvlSpan.innerText = (player.level <= 9 ? '0' : '') + player.level;
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


  /* Нижнее меню: атака, инвентарь, FW */
  {
    let bottomLeftButtons = document.createElement('div');
    let blContainer = document.querySelector('.bottomleft-container');
    let ops = document.querySelector('#ops');

    bottomLeftButtons.classList.add('sbgcui_bottomleft_wrp');
    bottomLeftButtons.append(document.querySelector('#toggle-follow'), ops);

    blContainer.append(bottomLeftButtons, document.querySelector('.ol-rotate'));

    ops.replaceChildren('INV: ', invTotalSpan);
  }


  /* Добавление зарядки из инвентаря */
  {
    let refsList = document.querySelector('.inventory__content');
    let progressBarFiller = document.createElement('span');

    progressBarFiller.classList.add('sbgcui_repairProgressFiller');

    refsList.addEventListener('click', event => {
      if (!event.currentTarget.matches('.inventory__content[data-type="3"]')) { return; }
      if (!event.target.closest('.inventory__item-controls')) { return; }
      if (event.offsetX < 0) {
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

              if (!refInfoDiv.contains(progressBarFiller)) { refInfoDiv.appendChild(progressBarFiller); }

              progressBarFiller.style.width = percentage + '%';
              refInfoEnergy.nodeValue = percentage;
            }
          })
          .catch(err => {
            let toast = createToast(`Ошибка при зарядке. <br>${err.message}`);

            toast.options.className = 'error-toast';
            toast.showToast();

            console.log('Ошибка при зарядке.', err);
          });
      }
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


}, false);