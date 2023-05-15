// ==UserScript==
// @name         SBG CUI
// @namespace    https://3d.sytes.net/
// @version      1.5.2
// @downloadURL  https://nicko-v.github.io/sbg-cui/index.min.js
// @updateURL    https://nicko-v.github.io/sbg-cui/index.min.js
// @description  SBG Custom UI
// @author       NV
// @match        https://3d.sytes.net/*
// @grant        none
// ==/UserScript==

window.addEventListener('load', () => setTimeout(main, 1000), false);

async function main() {
	'use strict';

	if (document.querySelector('script[src="/intel.js"]')) { return; }


	const USERSCRIPT_VERSION = '1.5.2';
	const LATEST_KNOWN_VERSION = '0.3.0';
	const INVENTORY_LIMIT = 3000;
	const MIN_FREE_SPACE = 100;
	const DISCOVERY_COOLDOWN = 90;
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
			sepia: 0,
			blur: 0,
		},
		tinting: {
			map: 1,
			point: 'level', // level || team || off
			profile: 1,
		},
		vibration: {
			buttons: 1,
			notifications: 1,
		},
		ui: {
			pointBgImage: 1,
			pointBtnsRtl: 0,
			pointBgImageBlur: 0,
			pointsHighlighting: 'fav', // fav || ref || off
		},
	};

	const thousandSeparator = Intl.NumberFormat(i18next.language).formatToParts(1111)[1].value;
	const decimalSeparator = Intl.NumberFormat(i18next.language).formatToParts(1.1)[1].value;


	class DiscoverModifier {
		constructor(loot, refs) {
			this.loot = loot;
			this.refs = refs;
		}

		get isActive() {
			return !(this.loot && this.refs);
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
			this.image = `https://lh3.googleusercontent.com/${pointData.i}`;

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

	class Favorite {
		#cooldown;

		constructor(guid, cooldown, name) {
			this.guid = guid;
			this.name = name || guid;
			this.cooldown = cooldown;
			this.discoveriesLeft = undefined;
			this.timeoutID = undefined;
			this.isActive = 1;

			if (!name) { this.#getName(); }
		}

		#getName() {
			getPointData(this.guid)
				.then(data => { this.name = data.t; })
				.catch(error => { console.log('SBG CUI: Ошибка при получении данных точки.', error); });
		}

		#notify() {
			if (!this.isActive) { return; }

			let message = `"${this.name}": точка остыла.`;

			if (!isMobile() && 'Notification' in window && Notification.permission == 'granted') {
				let notification = new Notification(message, { icon: '/icons/icon_512.png' });
			} else {
				let toast = createToast(message, 'top left', -1);

				toast.options.className = 'sbgcui_toast-selection';
				toast.showToast();

				if ('vibrate' in window.navigator && config.vibration.notifications) {
					window.navigator.vibrate(0);
					window.navigator.vibrate([500, 300, 500, 300, 500]);
				}
			}
		}

		#remindAt(timestamp) {
			function onTimeout() {
				this.#notify();
				this.cooldown = null;
			}

			let delay = timestamp - Date.now();

			clearTimeout(this.timeoutID);
			this.timeoutID = setTimeout(onTimeout.bind(this), delay);
		}

		toJSON() {
			return this.cooldown > Date.now() ? this.cooldown : null;
		}

		get hasActiveCooldown() {
			return this.cooldown - Date.now() > 0;
		}

		get cooldown() {
			return this.#cooldown;
		}

		get timer() {
			if (!this.cooldown) { return ''; }

			let diff = new Date(this.cooldown - Date.now());

			if (diff < 0) { return ''; }

			let options = { hour: 'numeric', minute: 'numeric', second: 'numeric', timeZone: 'UTC' };
			let formatter = new Intl.DateTimeFormat('ru-RU', options);

			return formatter.format(diff);
		}

		set cooldown(timestamp) {
			this.#cooldown = timestamp > Date.now() ? timestamp : null;
			if (this.#cooldown) {
				this.discoveriesLeft = undefined;
				this.#remindAt(this.#cooldown);
			}
		}
	}


	let config;
	if (localStorage.getItem('sbgcui_config')) {
		config = JSON.parse(localStorage.getItem('sbgcui_config'), (key, value) => isNaN(+value) ? value : +value);
		config = { ...DEFAULT_CONFIG, ...config };
		updateConfigStructure(config, DEFAULT_CONFIG);
		localStorage.setItem('sbgcui_config', JSON.stringify(config));
	} else {
		config = DEFAULT_CONFIG;
		localStorage.setItem('sbgcui_config', JSON.stringify(config));

		let toast = createToast('Сохранённые настройки не найдены. <br>Загружена стандартная конфигурация.');
		toast.options.className = 'error-toast';
		toast.showToast();
	}

	let originalFetch = window.fetch;
	window.fetch = proxiedFetch;

	let html = document.documentElement;
	let attackButton = document.querySelector('#attack-menu');
	let attackSlider = document.querySelector('.attack-slider-wrp');
	let coresList = document.querySelector('#cores-list');
	let discoverButton = document.querySelector('#discover');
	let inventoryButton = document.querySelector('#ops');
	let invCloseButton = document.querySelector('#inventory__close');
	let inventoryContent = document.querySelector('.inventory__content');
	let invTotalSpan = document.querySelector('#self-info__inv');
	let pointCores = document.querySelector('.i-stat__cores');
	let pointImage = document.querySelector('#i-image');
	let pointImageBox = document.querySelector('.i-image-box');
	let pointLevelSpan = document.querySelector('#i-level');
	let pointOwnerSpan = document.querySelector('#i-stat__owner');
	let pointTitleSpan = document.querySelector('#i-title');
	let pointPopup = document.querySelector('.info.popup');
	let pointPopupCloseButton = document.querySelector('.info.popup > .popup-close');
	let profileNameSpan = document.querySelector('#pr-name');
	let profilePopup = document.querySelector('.profile.popup');
	let profilePopupCloseButton = document.querySelector('.profile.popup > .popup-close');
	let selfExpSpan = document.querySelector('#self-info__exp');
	let selfLvlSpan = document.querySelector('#self-info__explv');
	let selfNameSpan = document.querySelector('#self-info__name');
	let xpDiffSpan = document.querySelector('.xp-diff');
	let zoomContainer = document.querySelector('.ol-zoom');

	let isProfilePopupOpened = !profilePopup.classList.contains('hidden');
	let isPointPopupOpened = !pointPopup.classList.contains('hidden');

	let lastOpenedPoint = {};
	let lastUsedCatalyser = localStorage.getItem('sbgcui_lastUsedCatalyser');

	let discoverModifier;


	let numbersConverter = {
		I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
		toDecimal(roman) { return this[roman]; },
		toRoman(decimal) { return Object.keys(this).find(key => this[key] == decimal); }
	};


	async function proxiedFetch(url, options) {
		return new Promise((resolve, reject) => {
			originalFetch(url, options)
				.then(async response => {
					let clonedResponse = response.clone();
					let path = url.match(/\/api\/(point|deploy|attack2|discover)(?:.*?&(status=1))?/);

					if (path == null) { resolve(response); return; }

					clonedResponse.json().then(async parsedResponse => {
						switch (path[1]) {
							case 'point':
								if ('data' in parsedResponse && !path[2]) { // path[2] - если есть параметр status=1, то инфа о точке запрашивается в сокращённом виде для рефа.
									lastOpenedPoint = new Point(parsedResponse.data);
								}
								break;
							case 'deploy':
								if ('data' in parsedResponse) { // Есди деплой, то массив объектов с ядрами.
									lastOpenedPoint.update(parsedResponse.data.co, parsedResponse.data.l);
									lastOpenedPoint.selectCore(config.autoSelect.deploy);
								} else if ('c' in parsedResponse) { // Если апгрейд, то один объект с ядром.
									lastOpenedPoint.update([parsedResponse.c], parsedResponse.l);
									lastOpenedPoint.selectCore(config.autoSelect.upgrade, parsedResponse.c.l);
								}
								break;
							case 'attack2':
								lastUsedCatalyser = JSON.parse(options.body).guid;
								localStorage.setItem('sbgcui_lastUsedCatalyser', lastUsedCatalyser);
								break;
							case 'discover':
								if ('loot' in parsedResponse && discoverModifier.isActive) {
									let toDelete = parsedResponse.loot
										.filter(e => !discoverModifier.refs ? e.t == 3 : e.t != 3)
										.map(e => ({ guid: e.g, type: e.t, amount: e.a }));

									if (toDelete.length == 0) { return; }

									try {
										let responses = await deleteItems(toDelete);

										responses.forEach(response => { if ('error' in response) { throw response.error; } });
										parsedResponse.loot = parsedResponse.loot.filter(e => !discoverModifier.refs ? (e.t != 3) : (e.t == 3));

										let body = JSON.stringify(parsedResponse);
										let options = {
											status: response.status,
											statusText: response.statusText,
											headers: response.headers,
										};
										let modifiedResponse = new Response(body, options);

										Object.defineProperty(modifiedResponse, 'url', { value: response.url, enumerable: true, });

										resolve(modifiedResponse);
									} catch (error) {
										let toast = createToast('Ошибка при фильтрации лута.');
										toast.options.className = 'error-toast';
										toast.showToast();

										console.log('SBG CUI: Ошибка при фильтрации лута.', error);
									}
								}

								if ('burnout' in parsedResponse || 'cooldown' in parsedResponse) {
									let dateNow = Date.now();
									let discoveriesLeft;

									// Пока точка не выжжена, в burnout приходит оставшее количество хаков.
									// После выжигания в burnout приходит таймстамп остывания точки.
									// 20 хаков – с запасом на случай ивентов.
									if (parsedResponse.burnout <= 20) {
										discoveriesLeft = parsedResponse.burnout;
									} else if (parsedResponse.cooldown <= DISCOVERY_COOLDOWN || parsedResponse.burnout < dateNow) {
										break;
									}

									let guid; // Тело запроса дискавера передаётся в виде объекта, а не JSON. Возможно исправят.
									try {
										guid = JSON.parse(options.body).guid;
									} catch {
										guid = new URLSearchParams(options.body).get('guid');
									}

									if (guid in favorites) {
										if (discoveriesLeft) { favorites[guid].discoveriesLeft = discoveriesLeft; break; }
										if (favorites[guid].hasActiveCooldown) { break; }

										let cooldown = parsedResponse.burnout || (dateNow + parsedResponse.cooldown * 1000);

										favorites[guid].cooldown = cooldown;
										favorites.save();
									}
								}

								break;
						}
					}).catch(error => {
						console.log('SBG CUI: Ошибка при обработке ответа сервера.', error);
					}).finally(() => {
						resolve(response);
					});
				})
				.catch(error => { reject(error); });
		});
	}

	async function getSelfData() {
		return fetch('/api/self', {
			headers: { authorization: `Bearer ${localStorage.getItem('auth')}`, },
			method: "GET",
		})
			.then(response => response.json().then(parsedResponse => ({
				version: response.headers.get('SBG-Version'),
				name: parsedResponse.n,
				team: parsedResponse.t,
				exp: parsedResponse.x,
				lvl: parsedResponse.l,
				guid: parsedResponse.g,
			})))
			.catch(error => { console.log('SBG CUI: Ошибка при получении данных игрока.', error); });
	}

	async function getPlayerData(guid) {
		return fetch(`/api/profile?guid=${guid}`, {
			headers: { authorization: `Bearer ${localStorage.getItem('auth')}`, },
			method: "GET",
		})
			.then(r => r.json())
			.then(r => r.data)
			.catch(error => { console.log('SBG CUI: Ошибка при получении данных игрока.', error); });
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
				deleteFromCache(deleted);


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
			.catch(error => {
				if (error.silent) { return; }

				let toast = createToast(`Ошибка при проверке или очистке инвентаря. <br>${error.message}`);

				toast.options.className = 'error-toast';
				toast.showToast();

				console.log('SBG CUI: Ошибка при удалении предметов.', error);
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

	function isMobile() {
		if ('maxTouchPoints' in window.navigator) {
			return window.navigator.maxTouchPoints > 0;
		} else if ('msMaxTouchPoints' in window.navigator) {
			return window.navigator.msMaxTouchPoints > 0;
		} else if ('orientation' in window) {
			return true;
		} else {
			return (/\b(BlackBerry|webOS|iPhone|IEMobile|Android|Windows Phone|iPad|iPod)\b/i).test(window.navigator.userAgent);
		}
	}

	function deleteFromCache(items) {
		let cache = JSON.parse(localStorage.getItem('inventory-cache')) || [];

		items.forEach(e => {
			let cachedItem = cache.find(f => f.g == e.guid);
			if (cachedItem) { cachedItem.a -= e.amount; }
		});
		cache = cache.filter(e => e.a > 0);

		localStorage.setItem('inventory-cache', JSON.stringify(cache));
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
				html.style.setProperty(`--sbgcui-${filter}`, `${value}${units}`);
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
			let brightness = createInput('range', 'mapFilters_brightness', 0, 5, 0.01, +mapFilters.brightness, 'Яркость');
			let grayscale = createInput('range', 'mapFilters_grayscale', 0, 1, 0.01, +mapFilters.grayscale, 'Оттенок серого');
			let sepia = createInput('range', 'mapFilters_sepia', 0, 1, 0.01, +mapFilters.sepia, 'Сепия');
			let blur = createInput('range', 'mapFilters_blur', 0, 4, 0.1, +mapFilters.blur, 'Размытие');

			subSection.classList.add('sbgcui_settings-subsection');

			subSection.append(invert, hueRotate, brightness, grayscale, sepia, blur);

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

		function createVibrationSection(vibration) {
			let section = createSection(
				'Вибрация',
				'Устройство будет откликаться на ваши действия. Может потребоваться выдача соответствующего разрешения в браузере или системе.'
			);
			let subSection = document.createElement('section');

			let buttonsVibration = createInput('checkbox', 'vibration_buttons', +vibration.buttons, 'При нажатии кнопок');
			let notificationsVibration = createInput('checkbox', 'vibration_notifications', +vibration.notifications, 'При уведомлениях');

			subSection.classList.add('sbgcui_settings-subsection');

			subSection.append(buttonsVibration, notificationsVibration);

			section.appendChild(subSection);

			if (!('vibrate' in window.navigator)) { section.classList.add('sbgcui_hidden'); }

			return section;
		}

		function createUISection(ui) {
			let section = createSection(
				'Интерфейс',
				'Некоторые аспекты дизайна можно отключить или изменить для большего удобства.'
			);
			let subSection = document.createElement('section');

			let pointBgImage = createInput('checkbox', 'ui_pointBgImage', +ui.pointBgImage, 'Фото точки вместо фона');
			let pointBgImageBlur = createInput('checkbox', 'ui_pointBgImageBlur', +ui.pointBgImageBlur, 'Размытие фонового фото');
			let pointBtnsRtl = createInput('checkbox', 'ui_pointBtnsRtl', +ui.pointBtnsRtl, 'Отразить кнопки в карточке точки');
			let pointsHighlightingFav = createInput('radio', 'ui_pointsHighlighting', (ui.pointsHighlighting == 'fav'), 'Избранные', 'fav');
			let pointsHighlightingRef = createInput('radio', 'ui_pointsHighlighting', (ui.pointsHighlighting == 'ref'), 'Имеется реф', 'ref');
			let pointsHighlightingOff = createInput('radio', 'ui_pointsHighlighting', (ui.pointsHighlighting == 'off'), 'Нет', 'off');

			let pointsHighlightingGroup = createRadioGroup('Подсвечивать точки:', [pointsHighlightingFav, pointsHighlightingRef, pointsHighlightingOff]);

			pointBgImage.addEventListener('click', event => {
				if (event.target.id == 'ui_pointBgImage') {
					if (event.target.checked) {
						pointBgImageBlur.childNodes[1].removeAttribute('disabled');
					} else {
						pointBgImageBlur.childNodes[1].checked = 0;
						pointBgImageBlur.childNodes[1].setAttribute('disabled', '');
					}
				}
			});

			subSection.classList.add('sbgcui_settings-subsection');

			subSection.append(pointBgImage, pointBgImageBlur, pointBtnsRtl, pointsHighlightingGroup);

			section.appendChild(subSection);

			return section;
		}


		let form = document.createElement('form');
		form.classList.add('sbgcui_settings', 'sbgcui_hidden');

		let version = document.createElement('span');
		version.classList.add('sbgcui_settings-version');
		version.innerText = `v${USERSCRIPT_VERSION}`;

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
			createVibrationSection(config.vibration),
			createUISection(config.ui),
		];

		sections.forEach(e => {
			e.addEventListener('click', event => {
				sections.forEach(e => {
					if (event.currentTarget != e) { e.removeAttribute('open'); }
				});
			});
		});

		form.append(version, formHeader, ...sections, buttonsWrp);

		form.addEventListener('submit', e => {
			e.preventDefault();

			try {
				let formData = new FormData(e.target);
				let formEntries = Object.fromEntries(formData);

				for (let key in formEntries) {
					let path = key.split('_');
					if (path[0] == 'maxAmountInBag') {
						config.maxAmountInBag[path[1]][path[2]] = Number.isInteger(+formEntries[key]) ? formEntries[key] : -1;
					} else if (path[0].match(/autoSelect|mapFilters|tinting|vibration|ui/)) {
						let value = formEntries[key];
						config[path[0]][path[1]] = isNaN(+value) ? value : +value;
					}
				}

				localStorage.setItem('sbgcui_config', JSON.stringify(config));

				let toast = createToast('Настройки сохранены');
				toast.showToast();
			} catch (error) {
				let toast = createToast(`Ошибка при сохранении настроек. <br>${error.message}`);

				toast.options.className = 'error-toast';
				toast.showToast();

				console.log('SBG CUI: Ошибка при сохранении настроек.', error);
			}
		});

		return form;
	}

	function closeSettingsMenu() {
		let { mapFilters, ui } = config;

		for (let key in mapFilters) {
			let units = (key == 'blur') ? 'px' : (key == 'hueRotate') ? 'deg' : '';
			html.style.setProperty(`--sbgcui-${key}`, `${mapFilters[key]}${units}`);
		}

		html.style.setProperty('--sbgcui-point-btns-rtl', ui.pointBtnsRtl ? 'rtl' : 'ltr');
		html.style.setProperty('--sbgcui-point-image-blur', ui.pointBgImageBlur ? '2px' : '0px');

		if (+config.tinting.map && !isPointPopupOpened && !isProfilePopupOpened) { addTinting('map'); }

		document.querySelector('.sbgcui_settings').classList.add('sbgcui_hidden');
		document.querySelectorAll('.sbgcui_settings > details').forEach(e => { e.open = false; });

		document.querySelectorAll('.sbgcui_settings input:not([type="hidden"])').forEach(e => {
			let path = e.name.split('_');
			let value = path.reduce((obj, prop) => obj[prop], config);

			switch (e.type) {
				case 'number':
				case 'range':
					e.value = +value;
					break;
				case 'checkbox':
					e.checked = +value;
					break;
				case 'radio':
					e.checked = e.value == value;
					break;
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

	function createToast(text = '', position = 'top left', duration = 4000, container = null) {
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
				pointTitleSpan.style.color = color;
				break;
			case 'point_team':
				color = getComputedStyle(pointOwnerSpan).color;
				pointPopup.style.borderColor = color;
				pointTitleSpan.style.color = color;
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

	function updateConfigStructure(storedConfig, defaultConfig) {
		for (let key in defaultConfig) {
			if (typeof defaultConfig[key] != typeof storedConfig[key]) {
				storedConfig[key] = defaultConfig[key];
			} else if (typeof defaultConfig[key] == 'object') {
				updateConfigStructure(storedConfig[key], defaultConfig[key]);
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
				get percentage() { return (this.goal == Infinity) ? 100 : this.current / this.goal * 100; },
				set string(str) { [this.current, this.goal = Infinity] = str.replace(/\s|,/g, '').split('/'); }
			},
			auth: localStorage.getItem('auth'),
			guid: selfData.guid,
			get level() { return this._level; },
			set level(str) { this._level = +str.split('').filter(e => e.match(/[0-9]/)).join(''); },
			_level: selfData.lvl,
		};
	}


	/* Стили */
	{
		let mapFilters = config.mapFilters;
		let ui = config.ui;
		let cssVars = document.createElement('style');
		let styles = document.createElement('link');
		let fa = document.createElement('link');
		let faRegular = document.createElement('link');
		let faSolid = document.createElement('link');

		cssVars.innerHTML = (`
      :root {
        --sbgcui-player-team: var(--team-${player.team});
        --sbgcui-player-exp-percentage: ${player.exp.percentage}%;
        --sbgcui-inventory-limit: " / ${INVENTORY_LIMIT}";
        --sbgcui-invert: ${mapFilters.invert};
        --sbgcui-hueRotate: ${mapFilters.hueRotate}deg;
        --sbgcui-brightness: ${mapFilters.brightness};
        --sbgcui-grayscale: ${mapFilters.grayscale};
        --sbgcui-sepia: ${mapFilters.sepia};
        --sbgcui-blur: ${mapFilters.blur}px;
        --sbgcui-point-bg: #ccc;
        --sbgcui-point-image: '';
        --sbgcui-point-image-blur: ${ui.pointBgImageBlur ? 2 : 0}px;
        --sbgcui-point-btns-rtl: ${ui.pointBtnsRtl ? 'rtl' : 'ltr'};
      }
  	`);

		[styles, fa, faRegular, faSolid].forEach(e => e.setAttribute('rel', 'stylesheet'));

		styles.setAttribute('href', 'https://nicko-v.github.io/sbg-cui/styles.min.css');
		fa.setAttribute('href', 'https://nicko-v.github.io/sbg-cui/assets/fontawesome/css/fontawesome.min.css');
		faRegular.setAttribute('href', 'https://nicko-v.github.io/sbg-cui/assets/fontawesome/css/regular.min.css');
		faSolid.setAttribute('href', 'https://nicko-v.github.io/sbg-cui/assets/fontawesome/css/solid.min.css');

		document.head.append(cssVars, fa, faRegular, faSolid, styles);
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
			let event;

			if (records[0].target.classList.contains('hidden')) {
				event = new Event('pointPopupClosed');
				isPointPopupOpened = false;
			} else if (records[0].oldValue?.includes('hidden')) {
				event = new Event('pointPopupOpened');
				isPointPopupOpened = true;
			}

			if (event) { records[0].target.dispatchEvent(event); }
		});
		pointPopupObserver.observe(pointPopup, { attributes: true, attributeOldValue: true, attributeFilter: ["class"] });


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
					let energy = e.target.querySelector('.inventory__item-descr').childNodes[4].nodeValue.replace(',', '.');
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
		inventoryContentObserver.observe(inventoryContent, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });


		let xpDiffSpanObserver = new MutationObserver(records => {
			let xp = records.find(e => e.addedNodes.length).addedNodes[0].data.match(/\d+/)[0];
			showXp(xp);
		});
		xpDiffSpanObserver.observe(xpDiffSpan, { childList: true });


		let refsListObserver = new MutationObserver(() => {
			let refs = Array.from(document.querySelectorAll('.inventory__content[data-type="3"] > .inventory__item'));

			if (refs.every(e => e.classList.contains('loaded'))) {
				let event = new Event('refsListLoaded');
				inventoryContent.dispatchEvent(event);
			}
		});
		refsListObserver.observe(inventoryContent, { subtree: true, attributes: true, attributeFilter: ['class'] })
	}


	/* Прочие события */
	{
		discoverButton.addEventListener('click', event => { if (event.target == discoverButton) { clearInventory(); } });

		attackButton.addEventListener('click', _ => { attackButton.classList.toggle('sbgcui_attack-menu-rotate'); });

		pointPopup.addEventListener('pointPopupOpened', () => {
			let settings = JSON.parse(localStorage.getItem('settings')) || {};

			if (config.ui.pointBgImage) {
				html.style.setProperty(`--sbgcui-point-image`, settings.imghid ? '' : `url("${lastOpenedPoint.image}")`);
				pointPopup.classList.add('sbgcui_point-popup-bg');
				pointImage.classList.add('sbgcui_no_bg_image');
			} else {
				html.style.setProperty(`--sbgcui-point-image`, '');
				pointPopup.style.backgroundImage = '';
				pointPopup.classList.remove('sbgcui_point-popup-bg');
				pointImage.classList.remove('sbgcui_no_bg_image');
			}
		});

		document.addEventListener("backbutton", () => {
			if (isProfilePopupOpened) {
				click(pointPopupCloseButton);
			} else if (isPointPopupOpened) {
				click(profilePopupCloseButton);
			}
			return false;
		});
	}


	/* Удаление ненужного, переносы, переименования */
	{
		let ops = document.querySelector('#ops');
		let fw = document.querySelector('#toggle-follow');
		let blContainer = document.querySelector('.bottomleft-container');
		let rotateArrow = document.querySelector('.ol-rotate');
		let layersButton = document.querySelector('#layers');
		let attackSliderClose = document.querySelector('#attack-slider-close');

		document.querySelectorAll('[data-i18n="self-info.name"], [data-i18n="self-info.xp"], [data-i18n="units.pts-xp"], [data-i18n="self-info.inventory"], [data-i18n="self-info.position"]').forEach(e => { e.remove(); });
		document.querySelectorAll('.self-info__entry').forEach(e => {
			let toDelete = [];

			e.childNodes.forEach(e => {
				if (e.nodeType == 3) { toDelete.push(e); }
			});

			toDelete.forEach(e => { e.remove(); });
		});

		attackSliderClose.remove; // Кнопка закрытия слайдера не нужна.
		attackButton.childNodes[0].remove(); // Надпись Attack.

		invCloseButton.innerText = '[x]';

		layersButton.innerText = '';
		layersButton.classList.add('fa-solid', 'fa-layer-group');

		zoomContainer.append(rotateArrow, fw, layersButton);

		fw.innerText = '';
		fw.classList.add('fa-solid', 'fa-location-crosshairs');

		blContainer.appendChild(ops);

		ops.replaceChildren('INVENTORY', invTotalSpan);

		selfLvlSpan.innerText = (player.level <= 9 ? '0' : '') + player.level;
	}


	/* Прогресс-бар опыта */
	{
		let xpProgressBar = document.createElement('div');
		let xpProgressBarFiller = document.createElement('div');
		let selfExpSpan = document.querySelector('#self-info__exp');

		let lvlProgressObserver = new MutationObserver(() => {
			player.exp.string = selfExpSpan.textContent;
			html.style.setProperty('--sbgcui-player-exp-percentage', `${player.exp.percentage}%`);
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
				let currentLvl = event.target.innerText.match(/^[0-9]{1,2}$/) ? +event.target.innerText : numbersConverter.toDecimal(event.target.innerText);
				lastOpenedPoint.selectCore(config.autoSelect.upgrade, currentLvl);
			}
		});
	}


	/* Зарядка из инвентаря */
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
						let refsCache = JSON.parse(localStorage.getItem('refs-cache'));

						let inventoryItem = event.target.closest('.inventory__item');

						inventoryItem.style.setProperty('--sbgcui-energy', `${percentage}%`);
						inventoryItem.style.setProperty('--sbgcui-display-r-button', (percentage == 100 ? 'none' : 'flex'));

						if (refInfoEnergy) { refInfoEnergy.nodeValue = percentage; }

						updateExpBar(r.xp.cur);
						showXp(r.xp.diff);

						refsCache[pointGuid].e = percentage;
						localStorage.setItem('refs-cache', JSON.stringify(refsCache));
					}
				})
				.catch(error => {
					let toast = createToast(`Ошибка при зарядке. <br>${error.message}`);

					toast.options.className = 'error-toast';
					toast.showToast();

					console.log('SBG CUI: Ошибка при зарядке.', error);
				});
		});
	}


	/* Меню настроек */
	{
		let gameSettingsPopup = document.querySelector('.settings.popup');
		let gameSettingsContent = document.querySelector('.settings-content');
		let userscriptSettingsMenu = createSettingsMenu();
		document.querySelector('.topleft-container').appendChild(userscriptSettingsMenu);

		let settingsButton = document.createElement('button');
		settingsButton.classList.add('sbgcui_settings_button');
		settingsButton.innerText = 'Настройки SBG CUI';
		settingsButton.addEventListener('click', _ => {
			gameSettingsPopup.classList.add('hidden');
			userscriptSettingsMenu.classList.toggle('sbgcui_hidden');
		});
		gameSettingsContent.appendChild(settingsButton);

		document.body.addEventListener('click', event => {
			if (
				!userscriptSettingsMenu.classList.contains('sbgcui_hidden') &&
				!event.target.closest('.sbgcui_settings') &&
				!event.target.closest('.sbgcui_settings_button')
			) { closeSettingsMenu(); }
		});
	}


	/* Тонирование интерфейса */
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
			pointTitleSpan.style.color = '';
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

					since += `${since.length ? ', ' : ''}${amount} ${dhms2[i] + (amount > 1 ? 's' : '')}`;
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


	/* Кнопка обновления страницы */
	{
		if (window.navigator.userAgent.toLowerCase().includes('wv')) {
			let gameMenu = document.querySelector('.game-menu');
			let reloadButton = document.createElement('button');

			reloadButton.classList.add('fa-solid', 'fa-rotate');
			reloadButton.addEventListener('click', _ => { window.location.reload(); });
			gameMenu.appendChild(reloadButton);
		}
	}


	/* Показ гуида точки */
	{
		pointImage.addEventListener('click', _ => {
			if (pointImage.hasAttribute('sbgcui_clicks')) {
				let clicks = +pointImage.getAttribute('sbgcui_clicks');

				if (clicks + 1 == 5) {
					let iStat = document.querySelector('.i-stat');
					let guid = document.querySelector('.info.popup').dataset.guid;
					let guidSpan = document.createElement('span');

					guidSpan.innerText = `GUID: ${guid}`;

					guidSpan.addEventListener('click', _ => {
						window.navigator.clipboard.writeText(`https://3d.sytes.net/?point=${guid}`).then(_ => {
							let toast = createToast('Ссылка на точку скопирована в буфер обмена.');
							toast.showToast();
						});
					});

					iStat.prepend(guidSpan);

					pointPopup.addEventListener('pointPopupClosed', _ => {
						guidSpan.remove();
						pointImage.setAttribute('sbgcui_clicks', 0);
					});
				}

				pointImage.setAttribute('sbgcui_clicks', clicks + 1);
			} else {
				pointImage.setAttribute('sbgcui_clicks', 1);
			}
		});
	}


	/* Вибрация */
	{
		if ('vibrate' in window.navigator) {
			document.body.addEventListener('click', event => {
				if (config.vibration.buttons && event.target.nodeName == 'BUTTON') {
					window.navigator.vibrate(0);
					window.navigator.vibrate(50);
				}
			});
		}
	}


	/* Избранные точки */
	{
		function reviver(guid, cooldown) {
			return guid ? new Favorite(guid, cooldown) : cooldown;
		}


		var favorites = JSON.parse(localStorage.getItem('sbgcui_favorites'), reviver) || {};
		Object.defineProperty(favorites, 'save', {
			value: function () {
				let activeFavs = {};

				for (let guid in this) {
					if (this[guid].isActive) { activeFavs[guid] = this[guid]; }
				}

				localStorage.setItem('sbgcui_favorites', JSON.stringify(activeFavs));
			},
		});


		/* Старый вариант хранения избранного */
		{
			let legacyFavs = JSON.parse(localStorage.getItem('sbgcui_pointsSubscriptions'));
			let legacyReminders = JSON.parse(localStorage.getItem('sbgcui_reminders'));

			if (legacyFavs) {
				for (let guid of legacyFavs) {
					let cooldown = legacyReminders[guid];
					favorites[guid] = new Favorite(guid, cooldown);
				}
				favorites.save();
				localStorage.removeItem('sbgcui_pointsSubscriptions');
				localStorage.removeItem('sbgcui_reminders');
			}
		}


		/* Звезда на карточке точки */
		{
			let star = document.createElement('button');
			let guid = pointPopup.dataset.guid;

			star.classList.add('sbgcui_button_reset', 'sbgcui_point_star', `fa-${favorites[guid]?.isActive ? 'solid' : 'regular'}`, 'fa-star');

			star.addEventListener('click', _ => {
				let guid = pointPopup.dataset.guid;
				let name = pointTitleSpan.innerText;

				if (star.classList.contains('fa-solid')) {
					favorites[guid].isActive = 0;
					star.classList.replace('fa-solid', 'fa-regular');
				} else {
					if (guid in favorites) {
						favorites[guid].isActive = 1;
					} else {
						let cooldowns = JSON.parse(localStorage.getItem('cooldowns')) || {};
						let cooldown = (cooldowns[guid]?.c == 0) ? cooldowns[guid].t : null;

						favorites[guid] = new Favorite(guid, cooldown, name);
					}

					star.classList.replace('fa-regular', 'fa-solid');

					if (!isMobile() && 'Notification' in window && Notification.permission == 'default') {
						Notification.requestPermission();
					}
				}

				favorites.save();
			});

			pointPopup.addEventListener('pointPopupOpened', _ => {
				let guid = pointPopup.dataset.guid;

				if (favorites[guid]?.isActive) {
					star.classList.replace('fa-regular', 'fa-solid');
				} else {
					star.classList.replace('fa-solid', 'fa-regular');
				}
			});

			pointImageBox.appendChild(star);
		}


		/* Список избранных */
		{
			let star = document.createElement('button');
			let favsList = document.createElement('div');
			let favsListHeader = document.createElement('h3');
			let favsListContent = document.createElement('ul');
			let isFavsListOpened = false;


			function fillFavsList() {
				let favs = [];

				favsListContent.innerHTML = '';

				if (Object.keys(favorites).length == 0) { return; }

				for (let guid in favorites) {
					if (favorites[guid].isActive) {
						let li = document.createElement('li');
						let pointLink = document.createElement('a');
						let pointName = document.createElement('span');
						let deleteButton = document.createElement('button');
						let pointData = document.createElement('div');

						pointName.innerText = favorites[guid].name;
						pointLink.appendChild(pointName);
						pointLink.setAttribute('href', `/?point=${guid}`);

						deleteButton.classList.add('sbgcui_button_reset', 'sbgcui_favs-li-delete', 'fa-solid', 'fa-circle-xmark');
						deleteButton.addEventListener('click', _ => {
							favorites[guid].isActive = 0;
							favorites.save();
							li.removeAttribute('sbgcui_active', '');
							li.classList.add('sbgcui_hidden');
						});

						pointData.classList.add('sbgcui_favs-li-data');

						li.classList.add('sbgcui_favs-li');
						li.setAttribute('sbgcui_active', '');

						let hasActiveCooldown = favorites[guid].isActive && favorites[guid].cooldown;
						let discoveriesLeft = favorites[guid].discoveriesLeft;

						if (hasActiveCooldown) {
							pointLink.setAttribute('sbgcui_cooldown', favorites[guid].timer);
							pointLink.sbgcuiCooldown = favorites[guid].cooldown;

							let intervalID = setInterval(() => {
								if (isFavsListOpened && favorites[guid].isActive && favorites[guid].cooldown) {
									pointLink.setAttribute('sbgcui_cooldown', favorites[guid].timer);
								} else {
									clearInterval(intervalID);
								}
							}, 1000);
						} else if (discoveriesLeft) {
							pointLink.setAttribute('sbgcui_discoveries', discoveriesLeft);
							pointLink.discoveriesLeft = discoveriesLeft;
						}

						li.append(deleteButton, pointLink, pointData);
						favs.push(li);

						getPointData(guid)
							.then(data => {
								if (!data) { return; }
								pointName.innerText = `[${data.l}] ${pointLink.innerText}`;
								pointLink.style.color = `var(--team-${data.te})`;
								pointData.innerHTML = `${Math.round(data.e)}% @ ${data.co}<br>${data.li.i}↓ ${data.li.o}↑`;
							});
					}
				}

				favs.sort((a, b) => {
					a = a.childNodes[1].sbgcuiCooldown || a.childNodes[1].discoveriesLeft;
					b = b.childNodes[1].sbgcuiCooldown || b.childNodes[1].discoveriesLeft;

					return (a == undefined) ? 1 : (b == undefined) ? -1 : (a - b);
				});
				favsListContent.append(...favs);
			}


			favsList.classList.add('sbgcui_favs', 'sbgcui_hidden');
			favsListHeader.classList.add('sbgcui_favs-header');
			favsListContent.classList.add('sbgcui_favs-content');

			favsListHeader.innerText = 'Избранные точки';

			favsList.append(favsListHeader, favsListContent);

			star.classList.add('sbgcui_button_reset', 'sbgcui_favs_star', 'fa-solid', 'fa-star');
			star.addEventListener('click', () => {
				fillFavsList();
				favsList.classList.toggle('sbgcui_hidden');
				isFavsListOpened = !isFavsListOpened;
			});

			document.body.addEventListener('click', event => {
				if (
					isFavsListOpened &&
					!event.target.closest('.sbgcui_favs') &&
					!event.target.closest('.sbgcui_favs_star')
				) {
					favsList.classList.add('sbgcui_hidden');
					isFavsListOpened = false;
				}
			});

			zoomContainer.prepend(star);
			document.body.appendChild(favsList);
		}
	}


	/* Ссылка на точку из списка ключей */
	{
		let inventoryContent = document.querySelector('.inventory__content');

		inventoryContent.addEventListener('click', event => {
			if (!event.target.classList.contains('inventory__ic-view')) { return; }

			let guid = event.target.closest('.inventory__item').dataset.ref;

			if (!guid) { return; }
			if (confirm('Открыть карточку точки?')) { location.href = `/?point=${guid}`; }
		});
	}


	/* Дискавер без рефа или предметов */
	{
		let noLootSpan = document.createElement('span');
		let noRefsSpan = document.createElement('span');

		noLootSpan.classList.add('sbgcui_no_loot', 'fa-solid', 'fa-droplet-slash');
		noRefsSpan.classList.add('sbgcui_no_refs', 'fa-solid', 'fa-link-slash');

		discoverButton.append(noLootSpan, noRefsSpan);

		discoverButton.addEventListener('click', event => {
			if (event.target == discoverButton) {
				discoverModifier = new DiscoverModifier(1, 1);
			} else {
				let isLoot = !event.target.classList.contains('sbgcui_no_loot');
				let isRefs = !event.target.classList.contains('sbgcui_no_refs');

				discoverModifier = new DiscoverModifier(isLoot, isRefs);
			}
		});
	}


	/* Сортировка рефов */
	{
		function isEveryRefLoaded(refsArr) {
			return refsArr.every(e => e.classList.contains('loaded'));
		}

		function getSortParam(ref, param) {
			let regex;

			switch (param) {
				case 'name':
					regex = new RegExp(/\(x[0-9]{1,}\)\s(?:"|«)?([\s\S]+)/i);
					return ref.querySelector('.inventory__item-title').innerText.match(regex)[1];
				case 'level':
					regex = new RegExp(/level-([0-9]{1,2})/);
					return +ref.querySelector('.inventory__item-descr > span').style.color.match(regex)?.[1] || 0;
				case 'team':
					regex = new RegExp(/team-([1-3])/);
					return +ref.querySelector('.inventory__item-title').style.color.match(regex)?.[1] || 0;
				case 'energy':
					return +ref.querySelector('.inventory__item-descr').childNodes[4].nodeValue.replace(',', '.');
				case 'distance':
					regex = new RegExp(`([0-9]+?(?:${thousandSeparator}[0-9]+)?(?:\\${decimalSeparator}[0-9]+)?)\\s(cm|m|km|см|м|км)`, 'i');
					let dist = ref.querySelector('.inventory__item-descr').lastChild.textContent;
					let [_, value, units] = dist.match(regex);

					value = value.replace(thousandSeparator, '').replace(decimalSeparator, '.');

					return parseFloat(value) / ((['cm', 'см'].includes(units)) ? 100000 : (['m', 'м'].includes(units)) ? 1000 : 1);
				case 'amount':
					regex = new RegExp(/^\(x([0-9]{1,})\)\s/i);
					return +ref.querySelector('.inventory__item-title').innerText.match(regex)[1];
			}
		}

		function sortRefsBy(array, param) {
			array.sort((a, b) => {
				let aParam = getSortParam(a, param);
				let bParam = getSortParam(b, param);

				if (param == 'name') {
					return aParam.localeCompare(bParam);
				} else if (aParam == bParam) {
					let aName = getSortParam(a, 'name');
					let bName = getSortParam(b, 'name');

					return aName.localeCompare(bName);
				} else {
					return aParam - bParam;
				}
			});
		}

		let invControls = document.querySelector('.inventory__controls');
		let invDelete = document.querySelector('#inventory-delete');
		let refsList = document.querySelector('.inventory__content');
		let select = document.createElement('select');
		let sortOrderButton = document.createElement('button');

		sortOrderButton.classList.add('fa-solid', 'fa-sort', 'sbgcui_button_reset', 'sbgcui_refs-sort-button');
		select.classList.add('sbgcui_refs-sort-select');

		[
			['Сортировка', 'none'],
			['По названию', 'name'],
			['По уровню', 'level'],
			['По команде', 'team'],
			['По заряду', 'energy'],
			['По дистанции', 'distance'],
			['По количеству', 'amount'],
		].forEach(e => {
			let option = document.createElement('option');

			option.innerText = e[0];
			option.value = e[1];

			select.appendChild(option);
		});

		select.addEventListener('change', event => {
			let refsArr = Array.from(refsList.children);
			let sortParam = event.target.value;

			if (sortParam == 'none') { return; }

			refsList.classList.remove('sbgcui_refs-reverse');

			select.setAttribute('disabled', '');

			if (!isEveryRefLoaded(refsArr)) {
				for (let i = 0; i <= refsList.scrollHeight; i += refsList.offsetHeight / 2) {
					refsList.scrollTop = i;
					refsList.dispatchEvent(new Event('scroll'));
				}
				refsList.scrollTop = 0;

				refsList.addEventListener('refsListLoaded', () => {
					sortRefsBy(refsArr, sortParam);
					refsList.replaceChildren(...refsArr);
					select.removeAttribute('disabled');
				}, { once: true });
			} else {
				sortRefsBy(refsArr, sortParam);
				refsList.replaceChildren(...refsArr);
				select.removeAttribute('disabled');
			}
		});

		document.querySelector('.inventory__tabs').addEventListener('click', event => {
			select.removeAttribute('disabled');
			select.value = 'none';
		});
		invCloseButton.addEventListener('click', () => { select.value = 'none'; });

		sortOrderButton.addEventListener('click', () => {
			refsList.classList.toggle('sbgcui_refs-reverse');
			refsList.scrollTop = -refsList.scrollHeight;
		});

		invControls.insertBefore(select, invDelete);
		invControls.appendChild(sortOrderButton);
	}


	/* Подсветка точек */
	{
		class OlFeature extends ol.Feature {
			constructor(arg) {
				super(arg);

				this.addEventListener('change', event => {
					if (!event.target.id_ || !event.target.style_ || event.target.style_[1]) { return; }
					
					let style = event.target.style_;
					let inventoryCache = JSON.parse(localStorage.getItem('inventory-cache')).filter(e => e.t == 3).map(e => e.l);
					
					if (
						(config.ui.pointsHighlighting == 'fav' && this.id_ in favorites) ||
						(config.ui.pointsHighlighting == 'ref' && inventoryCache.includes(this.id_))
					) {
						style[1] = Object.assign(Object.create(Object.getPrototypeOf(style[0])), style[0]);
						style[1].renderer_ = function (coords, state) {
							const ctx = state.context;
							const [[xc, yc], [xe, ye]] = coords;
							const radius = Math.sqrt((xe - xc) ** 2 + (ye - yc) ** 2) / 3;
	
							ctx.fillStyle = getComputedStyle(ctx.canvas).getPropertyValue('--selection');
							ctx.beginPath();
							ctx.arc(xc, yc, radius, 0, 360);
							ctx.fill();
						}
					}
				});
			}

			// Второй рабочий вариант добавления рендерера.
			// В отличии от варианта с эвентом, точка не перерисовывается при заходе в неё.
			/*setStyle(style) {
				let inventoryCache = JSON.parse(localStorage.getItem('inventory-cache')).filter(e => e.t == 3).map(e => e.l);

				if (
					(config.ui.pointsHighlighting == 'fav' && this.id_ in favorites) ||
					(config.ui.pointsHighlighting == 'ref' && inventoryCache.includes(this.id_))
				) {
					style[1] = Object.assign(Object.create(Object.getPrototypeOf(style[0])), style[0]);
					style[1].renderer_ = function (coords, state) {
						const ctx = state.context;
						const [[xc, yc], [xe, ye]] = coords;
						const radius = Math.sqrt((xe - xc) ** 2 + (ye - yc) ** 2) / 3;

						ctx.fillStyle = getComputedStyle(ctx.canvas).getPropertyValue('--selection');
						ctx.beginPath();
						ctx.arc(xc, yc, radius, 0, 360);
						ctx.fill();
					}
				}

				super.setStyle(style);
			}*/
		}

		ol.Feature = OlFeature;
	}
}