// ==UserScript==
// @name         SBG CUI
// @namespace    https://3d.sytes.net/
// @version      1.9.4
// @downloadURL  https://nicko-v.github.io/sbg-cui/index.min.js
// @updateURL    https://nicko-v.github.io/sbg-cui/index.min.js
// @description  SBG Custom UI
// @author       NV
// @match        https://3d.sytes.net/*
// @exclude      https://3d.sytes.net/login/
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
	'use strict';

	const USERSCRIPT_VERSION = '1.9.4';
	const LATEST_KNOWN_VERSION = '0.4.1';
	const HOME_DIR = 'https://nicko-v.github.io/sbg-cui';
	const INVENTORY_LIMIT = 3000;
	const MIN_FREE_SPACE = 100;
	const DISCOVERY_COOLDOWN = 90;
	const PLAYER_RANGE = 45;
	const HIT_TOLERANCE = 15;
	const MAX_DISPLAYED_CLUSTER = 8;
	const INVIEW_POINTS_DATA_TTL = 7000;
	const INVIEW_POINTS_LIMIT = 100;
	const HIGHLEVEL_MARKER = 8;
	const IS_DARK = matchMedia('(prefers-color-scheme: dark)').matches;
	const CORES_ENERGY = { 0: 0, 1: 500, 2: 750, 3: 1000, 4: 1500, 5: 2000, 6: 2500, 7: 3500, 8: 4000, 9: 5250, 10: 6500 };
	const CORES_LIMITS = { 0: 0, 1: 6, 2: 6, 3: 6, 4: 3, 5: 3, 6: 2, 7: 2, 8: 1, 9: 1, 10: 1 };
	const LEVEL_TARGETS = [1500, 5000, 12500, 25000, 60000, 125000, 350000, 675000, 1000000, Infinity];
	const ITEMS_TYPES = {
		1: { eng: 'cores', rus: 'ядра' },
		2: { eng: 'catalysers', rus: 'катализаторы' },
		3: { eng: 'refs', rus: 'рефы' },
		4: { eng: 'brooms', rus: 'веники' },
	};
	const ACTIONS_REWARDS = {
		build: {},
		destroy: {
			region: 125,
			line: 45,
			core: 10,
		},
	};
	const DEFAULT_CONFIG = {
		maxAmountInBag: {
			cores: { I: -1, II: -1, III: -1, IV: -1, V: -1, VI: -1, VII: -1, VIII: -1, IX: -1, X: -1 },
			catalysers: { I: -1, II: -1, III: -1, IV: -1, V: -1, VI: -1, VII: -1, VIII: -1, IX: -1, X: -1 },
			refs: { allied: -1, hostile: -1 },
		},
		autoSelect: {
			deploy: 'max',  // min || max || off
			upgrade: 'min', // min || max || off
			attack: 'latest',  // max || latest
		},
		mapFilters: {
			invert: IS_DARK ? 1 : 0,
			hueRotate: IS_DARK ? 180 : 0,
			brightness: IS_DARK ? 0.75 : 1,
			grayscale: IS_DARK ? 1 : 0,
			sepia: 1,
			blur: 0,
			branding: 'default', // default || custom
			brandingColor: '#CCCCCC',
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
			doubleClickZoom: 0,
			pointBgImage: 1,
			pointBtnsRtl: 0,
			pointBgImageBlur: 1,
			pointDischargeTimeout: 1,
			speedometer: 1,
		},
		pointHighlighting: {
			inner: 'uniqc', // fav || ref || uniqc || uniqv || cores || highlevel || off
			outer: 'off',
			outerTop: 'cores',
			outerBottom: 'highlevel',
			text: 'refsAmount', // energy || level || lines || refsAmount || off
			innerColor: '#E87100',
			outerColor: '#E87100',
			outerTopColor: '#EB4DBF',
			outerBottomColor: '#28C4F4',
		},
		drawing: {
			maxDistance: -1,
		},
	};

	let map, playerFeature;


	if (window.location.pathname.startsWith('/login')) { return; }
	if (document.querySelector('script[src="/intel.js"]')) { return; }

	window.stop();

	fetch('/')
		.then(r => r.text())
		.then(data => {
			data = data.replace(/<script class="mobile-check">.+?<\/script>/, '');
			data = data.replace(/(<script src="https:\/\/cdn.jsdelivr.net\/npm\/ol@.+?)(>)/, `$1 onload="window.dispatchEvent(new Event('olReady'))"$2`);

			document.open();

			window.addEventListener('olReady', () => { olInjection(); loadMainScript(); });
			window.addEventListener('mapReady', main);

			document.write(data);
			document.close();
		});


	function olInjection() {
		class Map extends ol.Map {
			constructor(options) {
				super(options);
				map = this;
				window.dispatchEvent(new Event('mapReady'));
			}

			forEachFeatureAtPixel(pixel, callback, options = {}) {
				const isShowInfoCallback = callback.toString().includes('showInfo(');

				options.hitTolerance = isFinite(options.hitTolerance) ? options.hitTolerance : HIT_TOLERANCE;

				if (isShowInfoCallback) {
					const proxiedCallback = (feature, layer) => {
						if (feature.get('sbgcui_chosenFeature')) {
							callback(feature, layer);
							feature.unset('sbgcui_chosenFeature', true);
						}
					};
					super.forEachFeatureAtPixel(pixel, proxiedCallback, options);
				} else {
					super.forEachFeatureAtPixel(pixel, callback, options);
				}
			}
		}

		class Feature extends ol.Feature {
			constructor(geometryOrProperties) {
				super(geometryOrProperties);
			}

			setStyle(style) {
				if (style && playerFeature == undefined && style.length == 3 && style[0].image_?.iconImage_.src_.match(/\/icons\/player/)) {
					let setCenter = style[1].getGeometry().setCenter;

					style[1].getGeometry().setCenter = pos => {
						setCenter.call(style[1].getGeometry(), pos);
						style[3].getGeometry().setCenter(pos);
					};

					style[3] = new ol.style.Style({
						geometry: new ol.geom.Circle(ol.proj.fromLonLat([0, 0]), 0),
						stroke: new ol.style.Stroke({ color: '#CCCCCC33', width: 4 }),
					});

					playerFeature = this;
				}

				super.setStyle(style);
			}
		}

		ol.Map = Map;
		ol.Feature = Feature;
	}

	function loadMainScript() {
		fetch('/script.js')
			.then(r => r.text())
			.then(data => {
				let script = document.createElement('script');

				data = data.replace('const Catalysers = [', 'window.Catalysers = [');
				data = data.replace('const TeamColors = [', 'window.TeamColors = [');
				data = data.replace('const persist = [', 'const persist = [/^sbgcui_/, ');
				data = data.replace('const draw_slider =', 'window.draw_slider =');

				script.textContent = data;

				document.head.appendChild(script);
			})
			.catch(error => {
				alert(`Произошла ошибка при загрузке основного скрипта. ${error.message}`);
				console.log(error);
			});
	}

	async function main() {
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
				this.coords = pointData.c;
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

			get energy() {
				if (Object.keys(this.cores).length == 0) { return 0; }

				let maxPointEnergy = 0;
				let pointEnergy = 0;

				for (let guid in this.cores) {
					maxPointEnergy += CORES_ENERGY[this.cores[guid].level];
					pointEnergy += this.cores[guid].energy;
				}

				return pointEnergy / maxPointEnergy * 100;
			}

			get mostChargedCatalyserEnergy() {
				let energy = Math.max(...Object.values(this.cores).map(e => e.energy / CORES_ENERGY[e.level] * 100));
				return isFinite(energy) ? energy : null;
			}

			get dischargeTimeout() {
				let mostChargedCatalyserEnergy = this.mostChargedCatalyserEnergy;

				if (mostChargedCatalyserEnergy == null) { return ''; }

				let timeout = mostChargedCatalyserEnergy / 0.6 * 60 * 60 * 1000; // Время до разрядки, мс.
				let dh1 = [24 * 60 * 60 * 1000, 60 * 60 * 1000];
				let dh2 = ['d', 'hr'];
				let result = '';

				dh1.forEach((e, i) => {
					let amount = Math.trunc(timeout / e);

					if (!amount) { return; }

					result += `${result.length ? ', ' : '~'}${amount}${dh2[i]}`;
					timeout -= amount * e;
				});

				return result;
			}

			get coresAmount() {
				return Object.keys(this.cores).length;
			}

			get linesAmount() {
				return this.lines.in + this.lines.out;
			}

			get regionsAmount() {
				return inviewRegionsVertexes.filter(e => {
					return e.find(e => e[0] == this.coords[0] && e[1] == this.coords[1]) != undefined;
				}).length;
			}

			get destroyReward() {
				return (
					ACTIONS_REWARDS.destroy.core * this.coresAmount +
					ACTIONS_REWARDS.destroy.line * this.linesAmount +
					ACTIONS_REWARDS.destroy.region * this.regionsAmount
				);
			}

			update(cores) {
				cores.forEach(core => {
					this.cores[core.g] = {
						energy: core.e,
						level: core.l,
						owner: core.o,
					}
				});
			}

			selectCore(type, currentLevel) {
				let cachedCores = JSON.parse(localStorage.getItem('inventory-cache')).filter(e => e.t == 1 && !excludedCores.has(e.g)).sort((a, b) => a.l - b.l);
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

		class Toolbar extends ol.control.Control {
			#expandButton = document.createElement('button');
			#isExpanded = false;
			#toolbar = document.createElement('div');

			constructor() {
				let container = document.createElement('div');
				container.classList.add('ol-unselectable', 'ol-control', 'sbgcui_toolbar-control');
				super({ element: container });

				this.#expandButton.classList.add('fa', 'fa-solid-angle-up');
				this.#expandButton.addEventListener('click', this.handleExpand.bind(this));

				this.#toolbar.classList.add('sbgcui_toolbar');

				this.collapse();

				container.append(this.#toolbar, this.#expandButton);
			}

			addItem(item, order) {
				item.style.order = order;
				this.#toolbar.appendChild(item);
			}

			collapse() {
				this.#expandButton.classList.remove('fa-rotate-180');
				this.#expandButton.style.opacity = 1;

				this.#toolbar.classList.add('sbgcui_hidden');

				this.#isExpanded = false;
			}

			expand() {
				this.#expandButton.classList.add('fa-rotate-180');
				this.#expandButton.style.opacity = 0.5;

				this.#toolbar.classList.remove('sbgcui_hidden');

				this.#isExpanded = true;
			}

			handleExpand() {
				this.#isExpanded ? this.collapse() : this.expand();
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
		let drawSlider = document.querySelector('.draw-slider-wrp');
		let catalysersList = document.querySelector('#catalysers-list');
		let coresList = document.querySelector('#cores-list');
		let refsList = document.querySelector('#refs-list');
		let discoverButton = document.querySelector('#discover');
		let inventoryButton = document.querySelector('#ops');
		let invCloseButton = document.querySelector('#inventory__close');
		let inventoryContent = document.querySelector('.inventory__content');
		let inventoryPopup = document.querySelector('.inventory.popup');
		let invTotalSpan = document.querySelector('#self-info__inv');
		let pointCores = document.querySelector('.i-stat__cores');
		let pointImage = document.querySelector('#i-image');
		let pointImageBox = document.querySelector('.i-image-box');
		let pointEnergySpan = document.querySelector('#i-stat__energy');
		let pointLevelSpan = document.querySelector('#i-level');
		let pointOwnerSpan = document.querySelector('#i-stat__owner');
		let pointTitleSpan = document.querySelector('#i-title');
		let pointPopup = document.querySelector('.info.popup');
		let pointPopupCloseButton = document.querySelector('.info.popup > .popup-close');
		let profileNameSpan = document.querySelector('#pr-name');
		let profilePopup = document.querySelector('.profile.popup');
		let profilePopupCloseButton = document.querySelector('.profile.popup > .popup-close');
		let regDateSpan = document.querySelector('.pr-stat__age > .pr-stat-val');
		let selfExpSpan = document.querySelector('#self-info__exp');
		let selfLvlSpan = document.querySelector('#self-info__explv');
		let selfNameSpan = document.querySelector('#self-info__name');
		let toggleFollow = document.querySelector('#toggle-follow');
		let xpDiffSpan = document.querySelector('.xp-diff');

		let isInventoryPopupOpened = !inventoryPopup.classList.contains('hidden');
		let isPointPopupOpened = !pointPopup.classList.contains('hidden');
		let isProfilePopupOpened = !profilePopup.classList.contains('hidden');

		let starModeTarget = JSON.parse(localStorage.getItem('sbgcui_starModeTarget'));
		let isStarMode = localStorage.getItem('sbgcui_isStarMode') == 1 && starModeTarget != null;

		let lastOpenedPoint = {};
		let lastUsedCatalyser = localStorage.getItem('sbgcui_lastUsedCatalyser');

		let excludedCores = new Set(JSON.parse(localStorage.getItem('sbgcui_excludedCores')));

		let discoverModifier;

		let uniques = { c: new Set(), v: new Set() };
		let inview = {};
		let inviewRegionsVertexes = [];

		let view = map.getView();


		let numbersConverter = {
			I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
			toDecimal(roman) { return this[roman]; },
			toRoman(decimal) { return Object.keys(this).find(key => this[key] == decimal); }
		};


		async function proxiedFetch(pathNquery, options) {
			return new Promise((resolve, reject) => {
				const url = new URL(window.location.origin + pathNquery);

				switch (url.pathname) {
					case '/api/attack2':
						const guid = JSON.parse(options.body).guid;
						const invCache = JSON.parse(localStorage.getItem('inventory-cache'));
						const isBroom = invCache.find(e => e.t == 4 && e.g == guid) !== undefined;
						const message = `Использовать "${i18next.t('items.brooms_one')}"?`;

						if (isBroom && !confirm(message)) {
							resolve();
							attackSlider.dispatchEvent(new Event('attackSliderOpened'));
							return;
						}

						break;
					case '/api/inview':
						let uniqsHighlighting = Object.values(config.pointHighlighting).find(e => e.match(/uniqc|uniqv/));

						if (uniqsHighlighting) {
							const hParam = uniqsHighlighting == 'uniqc' ? 4 : 2;
							url.searchParams.set('h', hParam);
						}

						break;
				}

				originalFetch(url.pathname + url.search, options)
					.then(async response => {
						if (!url.pathname.match(/^\/api\//)) {
							resolve(response);
							return;
						}

						let clonedResponse = response.clone();

						clonedResponse.json().then(async parsedResponse => {
							switch (url.pathname) {
								case '/api/point':
									if ('data' in parsedResponse && url.searchParams.get('status') == null) { // Если есть параметр status=1, то инфа о точке запрашивается в сокращённом виде для рефа.
										lastOpenedPoint = new Point(parsedResponse.data);
									}
									break;
								case '/api/deploy':
									if ('data' in parsedResponse) { // Есди деплой, то массив объектов с ядрами.
										lastOpenedPoint.update(parsedResponse.data.co, parsedResponse.data.l);
										lastOpenedPoint.selectCore(config.autoSelect.deploy);
									} else if ('c' in parsedResponse) { // Если апгрейд, то один объект с ядром.
										lastOpenedPoint.update([parsedResponse.c], parsedResponse.l);
										lastOpenedPoint.selectCore(config.autoSelect.upgrade, parsedResponse.c.l);
									}
									break;
								case '/api/attack2':
									lastUsedCatalyser = JSON.parse(options.body).guid;
									localStorage.setItem('sbgcui_lastUsedCatalyser', lastUsedCatalyser);
									break;
								case '/api/discover':
									if ('loot' in parsedResponse && discoverModifier.isActive) {
										let toDelete = parsedResponse.loot
											.filter(e => !discoverModifier.refs ? e.t == 3 : e.t != 3 && e.t != 4)
											.map(e => ({ guid: e.g, type: e.t, amount: e.a }));

										if (toDelete.length == 0) { return; }

										try {
											const responses = await deleteItems(toDelete);

											responses.forEach(response => { if ('error' in response) { throw response.error; } });
											parsedResponse.loot = parsedResponse.loot.filter(e => !discoverModifier.refs ? (e.t != 3) : (e.t == 3));

											const modifiedResponse = createResponse(parsedResponse, response);

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
								case '/api/inview':
									resolve(response);

									const hParam = url.searchParams.get('h');
									const isUniqueInRequest = hParam != null;
									const isHighlightCoresOrLevel = Object.values(config.pointHighlighting).find(e => e.match(/cores|highlevel|level/)) != undefined;
									const inviewPoints = parsedResponse.p;
									const inviewRegions = parsedResponse.r;

									inviewRegionsVertexes = inviewRegions.map(e => e.c[0].slice(0, 3));

									if (!inviewPoints) { break; }

									if (isHighlightCoresOrLevel) {
										let capturedPoints = inviewPoints.filter(e => { !e.t && delete inview[e.g]; return e.t != 0; }); // Временная заплатка что бы на снесённых точках исчезали маркеры.

										if (capturedPoints.length <= INVIEW_POINTS_LIMIT) {
											let guids = capturedPoints.map(e => e.g) || [];

											guids.forEach(guid => {
												if (Date.now() - inview[guid]?.timestamp < INVIEW_POINTS_DATA_TTL) { return; }

												getPointData(guid)
													.then(data => {
														inview[guid] = {
															cores: data.co,
															lines: {
																in: data.li.i,
																out: data.li.o,
																get sum() { return this.in + this.out; },
															},
															energy: data.e,
															level: data.l,
															timestamp: Date.now()
														};
													})
													.catch(() => { inview[guid] = { timestamp: Date.now() }; });
											});
										}
									}

									if (isUniqueInRequest) {
										inviewPoints?.forEach(point => {
											const type = hParam == 4 ? 'c' : 'v';
											if (point.h) {
												uniques[type].add(point.g);
											} else {
												uniques[type].delete(point.g);
											}
										});
									}

									break;
								case '/api/draw':
									const maxDistance = config.drawing.maxDistance;
									if (!'data' in parsedResponse) { break; }

									if (isStarMode && starModeTarget && starModeTarget.guid != pointPopup.dataset.guid && options.method == 'get') {
										const targetPoint = parsedResponse.data.find(point => point.p == starModeTarget.guid);
										const hiddenPoints = parsedResponse.data.length - (targetPoint ? 1 : 0);

										parsedResponse.data = targetPoint ? [targetPoint] : [];

										if (hiddenPoints > 0) {
											const message = `Точк${hiddenPoints == 1 ? 'а' : 'и'} (${hiddenPoints}) скрыт${hiddenPoints == 1 ? 'а' : 'ы'}
																			из списка, так как вы находитесь в режиме рисования "Звезда".`;
											const toast = createToast(message, 'top left');

											toast.options.className = 'sbgcui_toast-selection';
											toast.showToast();
										}

										const modifiedResponse = createResponse(parsedResponse, response);
										resolve(modifiedResponse);

										break;
									}

									if (maxDistance != -1) {
										const suitablePoints = parsedResponse.data.filter(point => point.d <= maxDistance);
										const hiddenPoints = parsedResponse.data.length - suitablePoints.length;

										if (hiddenPoints > 0) {
											const message = `Точк${hiddenPoints == 1 ? 'а' : 'и'} (${hiddenPoints}) скрыт${hiddenPoints == 1 ? 'а' : 'ы'}
																			из списка согласно настройкам максимальной длины линии (${config.drawing.maxDistance} м).`;
											const toast = createToast(message, 'top left');

											toast.options.className = 'sbgcui_toast-selection';
											toast.showToast();

											parsedResponse.data = suitablePoints;
										}

										const modifiedResponse = createResponse(parsedResponse, response);
										resolve(modifiedResponse);
									}

									break;
								case '/api/profile':
									if ('data' in parsedResponse) {
										regDateSpan.style.setProperty('--sbgcui-reg-date', calcPlayingTime(parsedResponse.data.created_at));
									}
									break;
								default:
									resolve(response);
									return;
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

		async function getPlayerData(guid, name) {
			return fetch(`/api/profile?${guid ? ('guid=' + guid) : ('name=' + name)}`, {
				headers: { authorization: `Bearer ${localStorage.getItem('auth')}`, },
				method: "GET",
			})
				.then(r => r.json())
				.then(r => r.data)
				.catch(error => { console.log('SBG CUI: Ошибка при получении данных игрока.', error); });
		}

		async function getPointData(guid, isCompact = true) {
			return fetch(`/api/point?guid=${guid}${isCompact ? '&status=1' : ''}`, {
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
							if (isStarMode && (itemLevel == starModeTarget?.guid)) {
								itemMaxAmount = -1;
							} else if (maxAmount.refs.allied == -1 && maxAmount.refs.hostile == -1) {
								itemMaxAmount = -1;
							} else if (maxAmount.refs.allied == 0 && maxAmount.refs.hostile == 0) {
								itemMaxAmount = 0;
							} else if (Object.keys(pointsData).length) {
								let pointSide = pointsData[itemLevel].team == player.team ? 'allied' : 'hostile';
								itemMaxAmount = maxAmount[itemName][pointSide];
							}
						} else {
							itemMaxAmount = maxAmount[itemName]?.[numbersConverter.toRoman(itemLevel)];
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
						message += `<br><span style="background: var(--sbgcui-branding-color); margin-right: 5px;" class="item-icon type-${key}"></span>x${deleted[key]} ${ITEMS_TYPES[key].eng}`;
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

		function createResponse(obj, originalResponse) {
			const body = JSON.stringify(obj);
			const options = {
				status: originalResponse.status,
				statusText: originalResponse.statusText,
				headers: originalResponse.headers,
			};
			const response = new Response(body, options);

			Object.defineProperty(response, 'url', { value: originalResponse.url, enumerable: true, });

			return response;
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

			function createColorPicker(name, value) {
				let colorPicker = document.createElement('input');

				colorPicker.type = 'color';
				colorPicker.name = name;
				colorPicker.value = value;

				return colorPicker;
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

			function createDropdown(title, options = [], name, value) {
				let header = document.createElement('h5');
				let select = document.createElement('select');
				let selectWrapper = document.createElement('div');

				header.classList.add('sbgcui_settings-dropdown-title');
				header.innerText = title;

				options.forEach(e => {
					let option = document.createElement('option');

					option.innerText = e[0];
					option.value = e[1];

					select.appendChild(option);
				});

				select.name = name;
				select.value = value;

				selectWrapper.classList.add('sbgcui_settings-dropdown_wrapper');
				selectWrapper.append(header, select);

				return selectWrapper;
			}

			function createTextField(title, name, value) {
				let header = document.createElement('h5');
				let input = document.createElement('input');
				let wrapper = document.createElement('div');

				header.classList.add('sbgcui_settings-textfield-title');
				header.innerText = title;

				input.name = name;
				input.type = 'number';
				input.min = -1;
				input.value = value;

				wrapper.classList.add('sbgcui_settings-textfield_wrapper');
				wrapper.append(header, input);

				return wrapper;
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
					'Можно автоматически выбирать самый мощный катализатор при атаке, самое маленькое ядро при деплое или следующий уровень ядра при каждом апгрейде. Вы можете исключить конкретное ядро из автовыбора: нажмите на него в карусели и удерживайте 1 секунду до появления уведомления.'
				);
				let subSection = document.createElement('section');

				let attackDropdown = createDropdown(
					'Катализатор при атаке:',
					[
						['Самый мощный', 'max'],
						['Последний использованный', 'latest'],
					],
					'autoSelect_attack',
					autoSelect.attack
				);
				let deployDropdown = createDropdown(
					'Ядро при деплое:',
					[
						['Наименьшее', 'min'],
						['Наибольшее', 'max'],
						['Вручную', 'off'],
					],
					'autoSelect_deploy',
					autoSelect.deploy
				);
				let upgradeDropdown = createDropdown(
					'Ядро при апгрейде:',
					[
						['Наименьшее', 'min'],
						['Наибольшее', 'max'],
						['Вручную', 'off'],
					],
					'autoSelect_upgrade',
					autoSelect.upgrade
				);

				subSection.classList.add('sbgcui_settings-subsection');

				subSection.append(attackDropdown, deployDropdown, upgradeDropdown);

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
					'Настройте цвет своей команды и оттенок карты.'
				);
				let subSection = document.createElement('section');

				let invert = createInput('range', 'mapFilters_invert', 0, 1, 0.01, +mapFilters.invert, 'Инверсия');
				let hueRotate = createInput('range', 'mapFilters_hueRotate', 0, 360, 1, +mapFilters.hueRotate, 'Цветность');
				let brightness = createInput('range', 'mapFilters_brightness', 0, 5, 0.01, +mapFilters.brightness, 'Яркость');
				let grayscale = createInput('range', 'mapFilters_grayscale', 0, 1, 0.01, +mapFilters.grayscale, 'Оттенок серого');
				let sepia = createInput('range', 'mapFilters_sepia', 0, 1, 0.01, +mapFilters.sepia, 'Сепия');
				let blur = createInput('range', 'mapFilters_blur', 0, 4, 0.1, +mapFilters.blur, 'Размытие');
				let branding = createDropdown('Цвет вашей команды:', [['Стандартный', 'default'], ['Собственный', 'custom']], 'mapFilters_branding', mapFilters.branding);
				let brandingColorPicker = createColorPicker('mapFilters_brandingColor', mapFilters.branding == 'custom' ? mapFilters.brandingColor : hex326(player.teamColor));

				let brandingSelect = branding.querySelector('select');

				brandingSelect.addEventListener('change', event => {
					if (event.target.value == 'default') {
						brandingColorPicker.value = hex326(player.teamColor);
						html.style.setProperty(`--sbgcui-branding-color`, player.teamColor);
					} else {
						brandingColorPicker.value = mapFilters.brandingColor;
						html.style.setProperty(`--sbgcui-branding-color`, mapFilters.brandingColor);
					}
				});

				brandingColorPicker.addEventListener('input', event => {
					if (brandingSelect.value == 'default') { brandingSelect.value = 'custom' }
					html.style.setProperty(`--sbgcui-branding-color`, hex623(event.target.value));
				});
				brandingColorPicker.addEventListener('change', () => {
					// Приводим цвет к виду #RRGGBB, т.к. основной скрипт для линий использует четырёхзначную нотацию (RGB + альфа).
					brandingColorPicker.value = hex623(brandingColorPicker.value, false);
				});

				branding.appendChild(brandingColorPicker);

				subSection.classList.add('sbgcui_settings-subsection');

				subSection.append(branding, invert, hueRotate, brightness, grayscale, sepia, blur);

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

				mapTinting.addEventListener('change', e => {
					if (e.target.checked) {
						addTinting('map');
					} else {
						addTinting('');
					}
				});

				let pointTintingDropdown = createDropdown(
					'При просмотре точки:',
					[
						['Цвет уровня', 'level'],
						['Цвет команды', 'team'],
						['Нет', 'off'],
					],
					'tinting_point',
					tinting.point
				);

				subSection.classList.add('sbgcui_settings-subsection');

				subSection.append(mapTinting, profileTinting, pointTintingDropdown);

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

				let doubleClickZoom = createInput('checkbox', 'ui_doubleClickZoom', +ui.doubleClickZoom, 'Зум карты по двойному нажатию');
				let pointBgImage = createInput('checkbox', 'ui_pointBgImage', +ui.pointBgImage, 'Фото точки вместо фона');
				let pointBgImageBlur = createInput('checkbox', 'ui_pointBgImageBlur', +ui.pointBgImageBlur, 'Размытие фонового фото');
				let pointBtnsRtl = createInput('checkbox', 'ui_pointBtnsRtl', +ui.pointBtnsRtl, 'Отразить кнопки в карточке точки');
				let pointDischargeTimeout = createInput('checkbox', 'ui_pointDischargeTimeout', +ui.pointDischargeTimeout, 'Показывать примерное время разрядки точки');
				let speedometer = createInput('checkbox', 'ui_speedometer', +ui.speedometer, 'Показывать скорость движения');

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

				subSection.append(doubleClickZoom, pointBgImage, pointBgImageBlur, pointBtnsRtl, pointDischargeTimeout, speedometer);

				section.appendChild(subSection);

				return section;
			}

			function createPointHighlightingSection(pointHighlighting) {
				function switchOff(selects, option) {
					selects.forEach(select => {
						switch (option) {
							case 'uniqc':
								if (select.value == 'uniqv') { select.value = 'off' }
								break;
							case 'uniqv':
								if (select.value == 'uniqc') { select.value = 'off' }
								break;
							default: select.value = 'off';
						}
					});
				}

				let section = createSection(
					'Подсветка точек',
					'Точки на карте могут отображать несколько маркеров, например кольцо снаружи точки, кружок внутри неё или текст рядом. Выберите, что будет обозначать каждый из них.'
				);
				let subSection = document.createElement('section');
				let innerMarkerColorPicker = createColorPicker('pointHighlighting_innerColor', pointHighlighting.innerColor);
				let outerMarkerColorPicker = createColorPicker('pointHighlighting_outerColor', pointHighlighting.outerColor);
				let outerTopMarkerColorPicker = createColorPicker('pointHighlighting_outerTopColor', pointHighlighting.outerTopColor);
				let outerBottomMarkerColorPicker = createColorPicker('pointHighlighting_outerBottomColor', pointHighlighting.outerBottomColor);

				let markerOptions = [
					['Нет', 'off'],
					[`Уровень ${HIGHLEVEL_MARKER}+`, 'highlevel'],
					['Избранная', 'fav'],
					['Имеется реф', 'ref'],
					['Не захвачена', 'uniqc'],
					['Не исследована', 'uniqv'],
					['Полностью проставлена', 'cores'],
				];

				let innerMarker = createDropdown('Внутренний маркер (точка):', markerOptions, 'pointHighlighting_inner', pointHighlighting.inner);
				let outerMarker = createDropdown('Наружный маркер (кольцо):', markerOptions, 'pointHighlighting_outer', pointHighlighting.outer);
				let outerTopMarker = createDropdown('Наружный маркер (верхнее полукольцо):', markerOptions, 'pointHighlighting_outerTop', pointHighlighting.outerTop);
				let outerBottomMarker = createDropdown('Наружный маркер (нижнее полукольцо):', markerOptions, 'pointHighlighting_outerBottom', pointHighlighting.outerBottom);
				let textMarker = createDropdown(
					'Текстовый маркер:',
					[
						['Нет', 'off'],
						['Уровень', 'level'],
						['Энергия', 'energy'],
						['Линии вх. + исх.', 'lines'],
						['Количество рефов', 'refsAmount'],
					],
					'pointHighlighting_text',
					pointHighlighting.text
				);

				let innerMarkerSelect = innerMarker.querySelector('select');
				let outerMarkerSelect = outerMarker.querySelector('select');
				let outerTopMarkerSelect = outerTopMarker.querySelector('select');
				let outerBottomMarkerSelect = outerBottomMarker.querySelector('select');

				let selects = [innerMarkerSelect, outerMarkerSelect, outerTopMarkerSelect, outerBottomMarkerSelect];

				selects.forEach(select => {
					select.addEventListener('change', event => {
						switch (event.target) {
							case outerMarkerSelect:
								switchOff([outerTopMarkerSelect, outerBottomMarkerSelect]);
								break;
							case outerTopMarkerSelect:
							case outerBottomMarkerSelect:
								switchOff([outerMarkerSelect]);
								break;
						}

						if (['uniqc', 'uniqv'].includes(event.target.value)) {
							let selectsToOff = selects.filter(e => e != select);
							switchOff(selectsToOff, event.target.value);
						}
					});
				});

				innerMarker.appendChild(innerMarkerColorPicker);
				outerMarker.appendChild(outerMarkerColorPicker);
				outerTopMarker.appendChild(outerTopMarkerColorPicker);
				outerBottomMarker.appendChild(outerBottomMarkerColorPicker);

				subSection.classList.add('sbgcui_settings-subsection');

				subSection.append(innerMarker, outerMarker, outerTopMarker, outerBottomMarker, textMarker);

				section.appendChild(subSection);

				return section;
			}

			function createDrawingSection(drawing) {
				const section = createSection(
					'Рисование',
					`Настройки, касающиеся рисования линий. Значение "-1" в текстовом поле отключает ограничение.`
				);
				const subSection = document.createElement('section');
				const maxDistanceTextField = createTextField('Скрывать рефы дальше, чем (м):', 'drawing_maxDistance', drawing.maxDistance);

				subSection.classList.add('sbgcui_settings-subsection');

				subSection.append(maxDistanceTextField);

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
				createPointHighlightingSection(config.pointHighlighting),
				createDrawingSection(config.drawing)
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
						} else if (path[0].match(/autoSelect|mapFilters|tinting|vibration|ui|pointHighlighting|drawing/)) {
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
			html.style.setProperty('--sbgcui-show-speedometer', ui.speedometer);
			html.style.setProperty('--sbgcui-branding-color', mapFilters.branding == 'custom' ? mapFilters.brandingColor : player.teamColor);
			window.TeamColors[player.team].fill = `${mapFilters.branding == 'custom' ? mapFilters.brandingColor : hex326(player.teamColor)}80`;
			window.TeamColors[player.team].stroke = mapFilters.branding == 'custom' ? hex623(mapFilters.brandingColor) : player.teamColor;

			doubleClickZoomInteraction?.setActive(Boolean(ui.doubleClickZoom));

			if (+config.tinting.map && !isPointPopupOpened && !isProfilePopupOpened) { addTinting('map'); }

			document.querySelector('.sbgcui_settings').classList.add('sbgcui_hidden');
			document.querySelectorAll('.sbgcui_settings > details').forEach(e => { e.open = false; });

			document.querySelectorAll('.sbgcui_settings input:not([type="hidden"]), .sbgcui_settings select').forEach(e => {
				let path = e.name.split('_');
				let value = path.reduce((obj, prop) => obj[prop], config);

				switch (e.type) {
					case 'number':
					case 'range':
						e.value = +value;
						break;
					case 'color':
						e.value = value;
						break;
					case 'checkbox':
						e.checked = +value;
						break;
					case 'radio':
						e.checked = e.value == value;
						break;
					case 'select-one':
						e.value = value;
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

		function createToast(text = '', position = 'top left', duration = 3000, className = 'interaction-toast') {
			let parts = position.split(/\s+/);
			let toast = Toastify({
				text,
				duration,
				gravity: parts[0],
				position: parts[1],
				escapeMarkup: false,
				className,
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
			if (amount == 0) { return; }

			let xpSpan = document.createElement('span');
			xpSpan.classList.add('sbgcui_xpdiff');

			xpSpan.innerText = `+${amount}xp`;
			xpContainer.appendChild(xpSpan);

			setTimeout(_ => { xpSpan.classList.add('sbgcui_xpdiff-out'); }, 100);
			setTimeout(_ => { xpContainer.removeChild(xpSpan); }, 3000);
		}

		function hex623(hex, isShort = true) {
			return isShort ?
				`#${[...hex].filter((e, i) => i % 2).join('')}` :
				`#${[...hex].map((e, i, a) => i % 2 ? e : a[i - 1]).join('')}`;
		}

		function hex326(hex) {
			return [...hex].map(e => e == '#' ? e : e + e).join('');
		}

		function toOLMeters(meters, rate) {
			rate = rate || 1 / ol.proj.getPointResolution('EPSG:3857', 1, view.getCenter(), 'm');
			return meters * rate;
		}

		function calcPlayingTime(regDateString) {
			const regDate = Date.parse(regDateString);
			const dateNow = Date.now();
			const days = Math.trunc((dateNow - regDate) / 1000 / 60 / 60 / 24);

			return days;
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
				feature: playerFeature,
				teamColor: getComputedStyle(html).getPropertyValue(`--team-${selfData.team}`),
				get level() { return this._level; },
				set level(str) { this._level = +str.split('').filter(e => e.match(/[0-9]/)).join(''); },
				_level: selfData.lvl,
			};

			if (player.name == 'NickolayV' && config == DEFAULT_CONFIG) {
				config.maxAmountInBag = {
					cores: { I: 0, II: 0, III: 0, IV: 0, V: 0, VI: 150, VII: 150, VIII: 120, IX: -1, X: -1 },
					catalysers: { I: 0, II: 0, III: 0, IV: 0, V: 0, VI: 0, VII: 0, VIII: 1000, IX: -1, X: -1 },
					refs: { allied: 20, hostile: 10 },
				};
				config.autoSelect.upgrade = 'max';
				config.mapFilters.branding = 'custom';
				config.mapFilters.brandingColor = '#4433DD';
				localStorage.setItem('sbgcui_config', JSON.stringify(config));
			}
		}


		/* Стили */
		{
			let { mapFilters, ui } = config;
			let cssVars = document.createElement('style');
			let styles = document.createElement('link');
			let fa = document.createElement('link');
			let faSvg = document.createElement('link');

			cssVars.innerHTML = (`
      :root {
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
				--sbgcui-show-speedometer: ${ui.speedometer};
				--sbgcui-branding-color: ${mapFilters.branding == 'custom' ? mapFilters.brandingColor : player.teamColor};
				--team-${player.team}: var(--sbgcui-branding-color);
      }
  	`);

			if (mapFilters.branding == 'custom') {
				window.TeamColors[player.team].fill = mapFilters.brandingColor + '80';
				window.TeamColors[player.team].stroke = hex623(mapFilters.brandingColor);
			}

			[styles, fa, faSvg].forEach(e => e.setAttribute('rel', 'stylesheet'));

			styles.setAttribute('href', `${HOME_DIR}/styles.min.css`);
			fa.setAttribute('href', `${HOME_DIR}/assets/fontawesome/css/fa.min.css`);
			faSvg.setAttribute('href', `${HOME_DIR}/assets/fontawesome/css/fa-svg.min.css`);

			document.head.append(cssVars, fa, faSvg, styles);
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


			let inventoryPopupObserver = new MutationObserver(records => {
				isInventoryPopupOpened = !records[0].target.classList.contains('hidden');
				let event = new Event(isInventoryPopupOpened ? 'inventoryPopupOpened' : 'inventoryPopupClosed');
				records[0].target.dispatchEvent(event);
			});
			inventoryPopupObserver.observe(inventoryPopup, { attributes: true, attributeFilter: ["class"] });


			let attackSliderObserver = new MutationObserver(records => {
				let isHidden = records[0].target.classList.contains('hidden');
				let event = new Event(isHidden ? 'attackSliderClosed' : 'attackSliderOpened', { bubbles: true });
				records[0].target.dispatchEvent(event);
			});
			attackSliderObserver.observe(attackSlider, { attributes: true, attributeFilter: ["class"] });


			let drawSliderObserver = new MutationObserver(records => {
				let isHidden = records[0].target.classList.contains('hidden');
				let event = new Event(isHidden ? 'drawSliderClosed' : 'drawSliderOpened', { bubbles: true });
				records[0].target.dispatchEvent(event);
			});
			drawSliderObserver.observe(drawSlider, { attributes: true, attributeFilter: ["class"] });


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
				let refs = Array.from(document.querySelectorAll('.inventory__content[data-tab="3"] > .inventory__item'));

				if (refs.every(e => e.classList.contains('loaded'))) {
					let event = new Event('refsListLoaded');
					inventoryContent.dispatchEvent(event);
				}
			});
			refsListObserver.observe(inventoryContent, { subtree: true, attributes: true, attributeFilter: ['class'] });


			let catalysersListObserver = new MutationObserver(records => {
				if ([...records].filter(e => e.oldValue.includes('is-active') && !e.target.classList.contains('is-active')).length) {
					let event = new Event('activeSlideChanged');
					catalysersList.dispatchEvent(event);
				}
			});
			catalysersListObserver.observe(catalysersList, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });


			let coresListObserver = new MutationObserver(records => {
				let event = new Event('coresListUpdated');
				coresList.dispatchEvent(event);
			});
			coresListObserver.observe(coresList, { childList: true });
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

				if (config.ui.pointDischargeTimeout) {
					let timeout = lastOpenedPoint.dischargeTimeout;
					if (timeout.length != 0) {
						let span = document.createElement('span');

						span.style.color = 'var(--text-disabled)';
						span.innerText = ` (${timeout})`;
						pointEnergySpan.appendChild(span);
					}
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

			document.querySelector('.inventory__tab[data-tab="3"]').addEventListener('click', event => {
				let counter = document.querySelector('.inventory__tab[data-tab="3"] > .inventory__tab-counter');
				let refsAmount = JSON.parse(localStorage.getItem('inventory-cache')).reduce((acc, item) => item.t == 3 ? acc + item.a : acc, 0);
				let uniqueRefsAmount = inventoryContent.childNodes.length;

				counter.innerText = uniqueRefsAmount;
				setTimeout(() => { counter.innerText = refsAmount; }, 1000);
			});

			toggleFollow.addEventListener('touchstart', () => {
				let touchStartDate = Date.now();

				let timeoutID = setTimeout(() => {
					view.animate(
						{ center: player.feature.getGeometry().getCoordinates() },
						{ zoom: 17 });
				}, 500);

				this.addEventListener('touchend', () => {
					let touchDuration = Date.now() - touchStartDate;
					if (touchDuration < 1000) { clearTimeout(timeoutID); } else { return; }
				}, { once: true });
			});

			toggleFollow.addEventListener('click', () => {
				dragPanInteraction?.setActive(toggleFollow.dataset.active == 'false');
			})
		}


		/* Удаление ненужного, переносы, переименования */
		{
			let ops = document.querySelector('#ops');
			let blContainer = document.querySelector('.bottom-container');
			let rotateArrow = document.querySelector('.ol-rotate');
			let layersButton = document.querySelector('#layers');
			let notifsButton = document.querySelector('#notifs-menu');
			let attackSliderClose = document.querySelector('#attack-slider-close');
			let zoomContainer = document.querySelector('.ol-zoom');

			document.querySelectorAll('[data-i18n="self-info.name"], [data-i18n="self-info.xp"], [data-i18n="units.pts-xp"], [data-i18n="self-info.inventory"], [data-i18n="self-info.position"]').forEach(e => { e.remove(); });
			document.querySelectorAll('.self-info__entry').forEach(e => {
				let toDelete = [];

				e.childNodes.forEach(e => {
					if (e.nodeType == 3) { toDelete.push(e); }
				});

				toDelete.forEach(e => { e.remove(); });
			});

			attackSliderClose.remove(); // Кнопка закрытия слайдера не нужна.
			attackButton.childNodes[0].remove(); // Надпись Attack.

			invCloseButton.innerText = '[x]';

			layersButton.innerText = '';
			layersButton.classList.add('fa', 'fa-solid-layer-group');

			notifsButton.innerText = '';
			notifsButton.classList.add('fa', 'fa-solid-envelope');

			zoomContainer.append(rotateArrow, toggleFollow, notifsButton, layersButton);

			toggleFollow.innerText = '';
			toggleFollow.classList.add('fa', 'fa-solid-location-crosschairs');

			blContainer.appendChild(ops);

			ops.replaceChildren('INVENTORY', invTotalSpan);

			selfLvlSpan.innerText = (player.level <= 9 ? '0' : '') + player.level;
		}


		/* Доработка карты */
		{
			var dragPanInteraction;
			var doubleClickZoomInteraction;
			var toolbar = new Toolbar();

			map.getInteractions().forEach(interaction => {
				switch (interaction.constructor) {
					case ol.interaction.DragPan:
						dragPanInteraction = interaction;
						break;
					case ol.interaction.DoubleClickZoom:
						doubleClickZoomInteraction = interaction;
						break;
				}
			});
			dragPanInteraction?.setActive(localStorage.getItem('follow') == 'false');
			doubleClickZoomInteraction?.setActive(Boolean(config.ui.doubleClickZoom));

			map.addControl(toolbar);
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

			coresList.addEventListener('touchstart', event => {
				let coreSlide = event.target.closest('.is-active.splide__slide');
				if (coreSlide == null) { return; }

				let touchStartDate = Date.now();
				let guid = coreSlide.dataset.guid;

				let timeoutID = setTimeout(() => {
					let toast;

					if (excludedCores.has(guid)) {
						excludedCores.delete(guid);
						coreSlide.removeAttribute('sbgcui-excluded-core');
						toast = createToast('Теперь ядро доступно для автовыбора.');
					} else {
						excludedCores.add(guid);
						coreSlide.setAttribute('sbgcui-excluded-core', '');
						toast = createToast('Ядро больше не участвует в автовыборе.');
					}

					toast.showToast();
					localStorage.setItem('sbgcui_excludedCores', JSON.stringify([...excludedCores]));
				}, 1000);

				coreSlide.addEventListener('touchend', () => {
					let touchDuration = Date.now() - touchStartDate;
					if (touchDuration < 1000) { clearTimeout(timeoutID); } else { return; }
				}, { once: true });
			});

			coresList.addEventListener('coresListUpdated', () => {
				coresList.childNodes.forEach(coreSlide => {
					if (excludedCores.has(coreSlide.dataset.guid)) {
						coreSlide.setAttribute('sbgcui-excluded-core', '');
					}
				});
			});
		}


		/* Зарядка из инвентаря */
		{
			inventoryContent.addEventListener('click', event => {
				if (!event.currentTarget.matches('.inventory__content[data-tab="3"]')) { return; }
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

							if (refsCache[pointGuid]) {
								refsCache[pointGuid].e = percentage;
								localStorage.setItem('refs-cache', JSON.stringify(refsCache));
							}
						}
					})
					.catch(error => {
						if (error.message.match(/полностью|fully/)) { return; }

						let toast = createToast(`Ошибка при зарядке. <br>${error.message}`);

						toast.options.className = 'error-toast';
						toast.showToast();

						console.log('SBG CUI: Ошибка при зарядке.', error);
					});
			});
		}


		/* Меню настроек */
		{
			let isSettingsMenuOpened = false;

			let settingsMenu = createSettingsMenu();
			document.querySelector('.topleft-container').appendChild(settingsMenu);

			let settingsButton = document.createElement('button');
			settingsButton.classList.add('fa', 'fa-solid-gears');
			settingsButton.addEventListener('click', () => {
				settingsMenu.classList.toggle('sbgcui_hidden');
				isSettingsMenuOpened = !isSettingsMenuOpened;
			});
			toolbar.addItem(settingsButton, 1);

			document.body.addEventListener('click', event => {
				if (
					isSettingsMenuOpened &&
					event.target != settingsButton &&
					!event.target.closest('.sbgcui_settings')
				) {
					closeSettingsMenu();
					isSettingsMenuOpened = false;
				}
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
			function recordStats() {
				const playerName = profileNameSpan.innerText;
				const isSelf = playerName == player.name;
				const confirmMsg = `Сохранить ${isSelf ? 'вашу ' : ''}статистику ${isSelf ? '' : 'игрока '}на текущий момент? \nЭто действие перезапишет сохранённую ранее статистику.`;

				if (confirm(confirmMsg)) {
					getPlayerData(null, playerName).then(stats => {
						const date = new Date();
						localStorage.setItem(`sbgcui_stats_${playerName}`, JSON.stringify({ date, stats }));
						timestamp.innerText = `Последнее сохранение: \n${date.toLocaleString()}`;
					});
				}
			}

			function compareStats() {
				const playerName = profileNameSpan.innerText;
				const isSelf = playerName == player.name;
				const previousStats = JSON.parse(localStorage.getItem(`sbgcui_stats_${playerName}`), (key, value) => key == 'date' ? new Date(value) : value);

				if (!previousStats) {
					const toast = createToast(`Вы ещё не сохраняли ${isSelf ? 'свою ' : ''}статистику${isSelf ? '' : ' этого игрока'}.`);

					toast.options.className = 'error-toast';
					toast.showToast();

					return;
				}

				getPlayerData(null, playerName).then(currentStats => {
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
								case 'max_region':
								case 'regions_area':
									statName = i18next.t(`profile.stats.${key}`);
									diff = diff < 1 ? i18next.t('units.sqm', { count: diff * 1e6 }) : i18next.t('units.sqkm', { count: diff });
									break;
								case 'xp':
									statName = i18next.t(`profile.stats.total-xp`);
									break;
								case 'level':
									statName = i18next.t('profile.level');
									break;
								default:
									statName = i18next.t(`profile.stats.${key}`);
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

					let toastText = diffs.length ?
						`${isSelf ? 'Ваша с' : 'С'}татистика ${isSelf ? '' : 'игрока '}с ${previousStats.date.toLocaleString()}<br>(${since})<br>${diffs}` :
						'Ничего не изменилось с прошлого сохранения.';
					let toast = createToast(toastText, 'bottom center', -1, 'sbgcui_compare_stats-toast');

					toast.showToast();
					toast.toastElement.style.setProperty('--sbgcui-toast-color', `var(--team-${currentStats.team})`);
				});
			}

			function updateTimestamp() {
				const playerName = profileNameSpan.innerText;
				const previousStats = JSON.parse(localStorage.getItem(`sbgcui_stats_${playerName}`), (key, value) => key == 'date' ? new Date(value) : value);
				timestamp.innerText = previousStats ? `Последнее сохранение: \n${previousStats.date.toLocaleString()}` : '';
			}

			let compareStatsWrp = document.createElement('div');
			let recordButton = document.createElement('button');
			let compareButton = document.createElement('button');
			let timestamp = document.createElement('span');
			let prStatsDiv = document.querySelector('.pr-stats');

			recordButton.innerText = 'Записать';
			compareButton.innerText = 'Сравнить';

			timestamp.classList.add('sbgcui_compare_stats-timestamp');

			compareStatsWrp.classList.add('sbgcui_compare_stats');
			compareStatsWrp.append(timestamp, recordButton, compareButton);

			profilePopup.insertBefore(compareStatsWrp, prStatsDiv);

			recordButton.addEventListener('click', recordStats);
			compareButton.addEventListener('click', compareStats);
			profilePopup.addEventListener('profilePopupOpened', updateTimestamp);
		}


		/* Кнопка обновления страницы */
		{
			if (window.navigator.userAgent.toLowerCase().includes('wv')) {
				let gameMenu = document.querySelector('.game-menu');
				let reloadButton = document.createElement('button');

				reloadButton.classList.add('fa', 'fa-solid-rotate');
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
							window.navigator.clipboard.writeText(`${window.location.origin}/?point=${guid}`).then(_ => {
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


			/* Звезда на карточке точки */
			{
				let star = document.createElement('button');
				let guid = pointPopup.dataset.guid;

				star.classList.add('sbgcui_button_reset', 'sbgcui_point_star', 'fa', `fa-${favorites[guid]?.isActive ? 'solid' : 'regular'}-star`);

				star.addEventListener('click', _ => {
					let guid = pointPopup.dataset.guid;
					let name = pointTitleSpan.innerText;

					if (star.classList.contains('fa-solid-star')) {
						favorites[guid].isActive = 0;
						star.classList.replace('fa-solid-star', 'fa-regular-star');
					} else {
						if (guid in favorites) {
							favorites[guid].isActive = 1;
						} else {
							let cooldowns = JSON.parse(localStorage.getItem('cooldowns')) || {};
							let cooldown = (cooldowns[guid]?.c == 0) ? cooldowns[guid].t : null;

							favorites[guid] = new Favorite(guid, cooldown, name);
						}

						star.classList.replace('fa-regular-star', 'fa-solid-star');

						if (!isMobile() && 'Notification' in window && Notification.permission == 'default') {
							Notification.requestPermission();
						}
					}

					favorites.save();
				});

				pointPopup.addEventListener('pointPopupOpened', _ => {
					let guid = pointPopup.dataset.guid;

					if (favorites[guid]?.isActive) {
						star.classList.replace('fa-regular-star', 'fa-solid-star');
					} else {
						star.classList.replace('fa-solid-star', 'fa-regular-star');
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

							deleteButton.classList.add('sbgcui_button_reset', 'sbgcui_favs-li-delete', 'fa', 'fa-solid-circle-xmark');
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
									pointLink.style.color = data.te == player.team ? 'var(--sbgcui-branding-color)' : `var(--team-${data.te})`;
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

				star.classList.add('fa', 'fa-solid-star', 'sbgcui_favs_star');
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

				toolbar.addItem(star, 2);
				document.body.appendChild(favsList);
			}
		}


		/* Ссылка на точку из списка ключей */
		{
			inventoryContent.addEventListener('click', event => {
				if (!event.target.classList.contains('inventory__ic-view')) { return; }

				let guid = event.target.closest('.inventory__item').dataset.ref;

				if (!guid) { return; }
				if (confirm('Открыть карточку точки? Нажмите "Отмена" для перехода к месту на карте.')) { window.location.href = `/?point=${guid}`; }
			});
		}


		/* Дискавер без рефа или предметов */
		{
			let noLootSpan = document.createElement('span');
			let noRefsSpan = document.createElement('span');

			noLootSpan.classList.add('sbgcui_no_loot', 'fa', 'fa-solid-droplet-slash');
			noRefsSpan.classList.add('sbgcui_no_refs', 'fa', 'fa-solid-link-slash');

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

			function isEveryRefCached(refsArr) {
				let cache = JSON.parse(localStorage.getItem('refs-cache')) || {};

				return refsArr.every(e => cache[e.dataset.ref]?.t > Date.now());
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

			function compareNames(a, b) {
				let aName = getSortParam(a, 'name');
				let bName = getSortParam(b, 'name');

				return aName.localeCompare(bName);
			}

			function sortRefsBy(array, param) {
				array.sort((a, b) => {
					let aParam = getSortParam(a, param);
					let bParam = getSortParam(b, param);

					switch (param) {
						case 'name':
							return aParam.localeCompare(bParam);
						case 'team':
							if (aParam == bParam) {
								return compareNames(a, b);
							} else {
								return (aParam == player.team) ? -1 : (bParam == player.team) ? 1 : aParam - bParam;
							}
						case 'energy':
							let aTeam = getSortParam(a, 'team');
							let bTeam = getSortParam(b, 'team');

							if (aTeam == bTeam) {
								return (aParam == bParam) ? compareNames(a, b) : aParam - bParam;
							} else {
								return (aTeam == player.team) ? -1 : (bTeam == player.team) ? 1 : (aParam == bParam) ? compareNames(a, b) : aParam - bParam;
							}
						default:
							return aParam - bParam;
					}
				});
			}

			function onRefsListLoaded() {
				sortRefsBy(refsArr, sortParam);
				inventoryContent.replaceChildren(...refsArr);
				select.removeAttribute('disabled');
				inventoryContent.classList.remove('sbgcui_refs_list-blur');

				if (isInMeasurementMode) {
					performance.mark(perfMarkB);
					console.log(`Загрузка и сортировка рефов закончены: ${new Date().toLocaleTimeString()}`);

					let measure = performance.measure(perfMeasure, perfMarkA, perfMarkB);
					let duration = +(measure.duration / 1000).toFixed(1);
					let uniqueRefsAmount = inventoryContent.childNodes.length;
					let toast;

					toast = createToast(`Загрузка и сортировка заняли ${duration} сек. <br><br>Уникальных рефов: ${uniqueRefsAmount}.`, 'top left', -1);
					toast.options.className = 'sbgcui_toast-selection';
					toast.showToast();

					clearMeasurements();
				}
			}

			function onRefsTabClose(event) {
				if (!event.isTrusted) { return; }

				clearInterval(intervalID);
				inventoryContent.removeEventListener('refsListLoaded', onRefsListLoaded);

				select.value = 'none';
				select.removeAttribute('disabled');

				inventoryContent.classList.remove('sbgcui_refs_list-blur');
			}

			function clearMeasurements() {
				isInMeasurementMode = false;
				performance.clearMarks(perfMarkA);
				performance.clearMarks(perfMarkB);
				performance.clearMeasures(perfMeasure);
				invCloseButton.removeAttribute('sbgcui_measurement_mode');
			}

			let invControls = document.querySelector('.inventory__controls');
			let invDelete = document.querySelector('#inventory-delete');
			let select = document.createElement('select');
			let sortOrderButton = document.createElement('button');
			let perfMarkA = 'sbgcui_refs_sort_begin';
			let perfMarkB = 'sbgcui_refs_sort_end';
			let perfMeasure = 'sbgcui_refs_sort_measure';
			let isInMeasurementMode = false;
			let intervalID;
			let refsArr;
			let sortParam;

			sortOrderButton.classList.add('fa', 'fa-solid-sort', 'sbgcui_button_reset', 'sbgcui_refs-sort-button');
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
				let scrollEvent = new Event('scroll');

				Object.defineProperty(scrollEvent, 'target', {
					value: {
						scrollTop: 0,
						clientHeight: inventoryContent.clientHeight,
					}
				});

				refsArr = Array.from(inventoryContent.children);
				sortParam = event.target.value;

				if (sortParam == 'none') { return; }

				inventoryContent.scrollTop = 0;
				inventoryContent.classList.remove('sbgcui_refs-reverse');
				select.setAttribute('disabled', '');

				if ((sortParam.match(/name|amount/) || isEveryRefLoaded(refsArr)) && !isInMeasurementMode) {
					sortRefsBy(refsArr, sortParam);
					inventoryContent.replaceChildren(...refsArr);
					select.removeAttribute('disabled');
				} else {
					let scrollStep = inventoryContent.offsetHeight * 0.9;

					inventoryContent.classList.add('sbgcui_refs_list-blur');

					if (isInMeasurementMode) {
						// Если все рефы уже подгружены, надо сбросить их – для этого обновляем вкладку:
						if (isEveryRefLoaded(refsArr)) { document.querySelector('.inventory__tab[data-tab="3"]')?.click(); }

						localStorage.removeItem('refs-cache');
						performance.mark(perfMarkA);
						console.log(`Загрузка и сортировка рефов начаты: ${new Date().toLocaleTimeString()}`);
					}

					if (isEveryRefCached(refsArr)) {
						for (let i = 0; i <= inventoryContent.scrollHeight; i += inventoryContent.offsetHeight / 2) {
							scrollEvent.target.scrollTop = i;
							inventoryContent.dispatchEvent(scrollEvent);
						}
					} else {
						intervalID = setInterval(() => {
							if (scrollEvent.target.scrollTop <= inventoryContent.scrollHeight) {
								scrollEvent.target.scrollTop += scrollStep;
								inventoryContent.dispatchEvent(scrollEvent);
							} else {
								clearInterval(intervalID);
								scrollEvent.target.scrollTop = inventoryContent.scrollHeight;
								inventoryContent.dispatchEvent(scrollEvent);
							}
						}, 10);
					}

					inventoryContent.addEventListener('refsListLoaded', onRefsListLoaded, { once: true });
				}
			});

			document.querySelector('.inventory__tabs').addEventListener('click', onRefsTabClose);
			invCloseButton.addEventListener('click', onRefsTabClose);
			inventoryPopup.addEventListener('inventoryPopupOpened', clearMeasurements);
			invCloseButton.addEventListener('touchstart', () => {
				let touchStartDate = Date.now();

				let timeoutID = setTimeout(() => {
					let toast;
					let message = `Режим измерения производительности. <br><br>
						Выберите тип сортировки для измерения скорости загрузки данных. <br><br>
						Кэш рефов будет очищен. <br><br>
						Для отмены операции закройте инвентарь.`;

					toast = createToast(message, 'bottom center', -1);
					toast.options.className = 'sbgcui_toast-selection';
					toast.showToast();

					isInMeasurementMode = true;
					invCloseButton.setAttribute('sbgcui_measurement_mode', '');
				}, 2000);

				invCloseButton.addEventListener('touchend', () => {
					let touchDuration = Date.now() - touchStartDate;
					if (touchDuration < 1000) { clearTimeout(timeoutID); } else { return; }
				}, { once: true });
			});

			sortOrderButton.addEventListener('click', () => {
				inventoryContent.classList.toggle('sbgcui_refs-reverse');
				inventoryContent.scrollTop = -inventoryContent.scrollHeight;
			});

			invControls.insertBefore(select, invDelete);
			invControls.appendChild(sortOrderButton);
		}


		/* Подсветка точек */
		{
			class OlFeature extends ol.Feature {
				constructor(arg) {
					super(arg);

					this.addEventListener('change', () => {
						if (!this.id_ || !this.style_) { return; }

						let { inner, outer, outerTop, outerBottom, text } = config.pointHighlighting;
						let style = this.style_;

						this.addStyle(style, 'inner', 1, this.isMarkerNeeded(inner));
						this.addStyle(style, 'outer', 2, this.isMarkerNeeded(outer));
						this.addStyle(style, 'outerTop', 3, this.isMarkerNeeded(outerTop));
						this.addStyle(style, 'outerBottom', 4, this.isMarkerNeeded(outerBottom));
						this.addStyle(style, null, 5, false, this.textToRender(text));
					});
				}

				isMarkerNeeded(marker) {
					switch (marker) {
						case 'fav': return this.id_ in favorites;
						case 'ref': return this.cachedRefsGuids.includes(this.id_);
						case 'uniqc': return uniques.c.has(this.id_);
						case 'uniqv': return uniques.v.has(this.id_);
						case 'cores': return inview[this.id_]?.cores == 6;
						case 'highlevel': return inview[this.id_]?.level >= HIGHLEVEL_MARKER;
						default: return false;
					}
				}

				textToRender(type) {
					switch (type) {
						case 'energy':
							let energy = inview[this.id_]?.energy;
							return energy > 0 ? String(Math.round(energy * 10) / 10) : null;
						case 'level':
							let level = inview[this.id_]?.level;
							return typeof level == 'number' ? String(level) : null;
						case 'lines':
							let lines = inview[this.id_]?.lines.sum;
							return lines > 0 ? String(lines) : null;
						case 'refsAmount':
							let amount = this.cachedRefsAmounts[this.id_];
							return amount > 0 ? String(amount) : null;
						default: return null;
					}
				}

				addStyle(style, type, index, isMarkerNeeded, text) {
					// style[0] – стиль, который вешает игра.
					// style[1] – стиль внутреннего маркера: точка.
					// style[2] – стиль внешнего маркера: кольцо.
					// style[3] – стиль внешнего маркера: верхнее полукольцо.
					// style[4] – стиль внешнего маркера: нижнее полукольцо.
					// style[5] – стиль текстового маркера.

					if (isMarkerNeeded == true) {
						style[index] = style[0].clone();
						style[index].renderer_ = this[`${type}MarkerRenderer`];
					} else {
						style[index] = new ol.style.Style({});
						style[index].text_ = text ? new ol.style.Text({
							font: '14px Manrope',
							offsetY: style[1].renderer_ ? -20 : 0,
							text,
							fill: new ol.style.Fill({ color: '#000' }),
							stroke: new ol.style.Stroke({ color: '#FFF', width: 3 }),
						}) : undefined;
					}
				}

				innerMarkerRenderer(coords, state) {
					const ctx = state.context;
					const [[xc, yc], [xe, ye]] = coords;
					const radius = Math.sqrt((xe - xc) ** 2 + (ye - yc) ** 2) / 3;

					ctx.fillStyle = config.pointHighlighting.innerColor;
					ctx.beginPath();
					ctx.arc(xc, yc, radius, 0, 2 * Math.PI);
					ctx.fill();
				}

				outerMarkerRenderer(coords, state) {
					const ctx = state.context;
					const [[xc, yc], [xe, ye]] = coords;
					const radius = Math.sqrt((xe - xc) ** 2 + (ye - yc) ** 2) * 1.3;

					ctx.lineWidth = 4;
					ctx.strokeStyle = config.pointHighlighting.outerColor;
					ctx.beginPath();
					ctx.arc(xc, yc, radius, 0, 2 * Math.PI);
					ctx.stroke();
				}

				outerTopMarkerRenderer(coords, state) {
					const ctx = state.context;
					const [[xc, yc], [xe, ye]] = coords;
					const radius = Math.sqrt((xe - xc) ** 2 + (ye - yc) ** 2) * 1.3;

					ctx.lineWidth = 4;
					ctx.strokeStyle = config.pointHighlighting.outerTopColor;
					ctx.beginPath();
					ctx.arc(xc, yc, radius, 195 * (Math.PI / 180), 345 * (Math.PI / 180));
					ctx.stroke();
				}

				outerBottomMarkerRenderer(coords, state) {
					const ctx = state.context;
					const [[xc, yc], [xe, ye]] = coords;
					const radius = Math.sqrt((xe - xc) ** 2 + (ye - yc) ** 2) * 1.3;

					ctx.lineWidth = 4;
					ctx.strokeStyle = config.pointHighlighting.outerBottomColor;
					ctx.beginPath();
					ctx.arc(xc, yc, radius, 15 * (Math.PI / 180), 165 * (Math.PI / 180));
					ctx.stroke();
				}

				get cachedRefsGuids() {
					return JSON.parse(localStorage.getItem('inventory-cache')).filter(e => e.t == 3).map(e => e.l);
				}

				get cachedRefsAmounts() {
					return Object.fromEntries(JSON.parse(localStorage.getItem('inventory-cache')).filter(e => e.t == 3).map(e => [e.l, e.a]));
				}
			}

			ol.Feature = OlFeature;
		}


		/* Показ радиуса катализатора */
		{
			function drawBlastRange() {
				let activeSlide = [...catalysersList.children].find(e => e.classList.contains('is-active'));
				let cache = JSON.parse(localStorage.getItem('inventory-cache')) || [];
				let item = cache.find(e => e.g == activeSlide.dataset.guid);
				let level = item.l;
				let range = item.t == 2 ? window.Catalysers[level].range : item.t == 4 ? PLAYER_RANGE : 0;

				playerFeature.getStyle()[3].getGeometry().setRadius(toOLMeters(range));
				playerFeature.getStyle()[3].getStroke().setColor(`${config.mapFilters.brandingColor}70`);
				playerFeature.changed();
			}

			function hideBlastRange() {
				playerFeature.getStyle()[3].getGeometry().setRadius(0);
				playerFeature.changed();
			}

			catalysersList.addEventListener('activeSlideChanged', drawBlastRange);
			attackSlider.addEventListener('attackSliderOpened', drawBlastRange);
			attackSlider.addEventListener('attackSliderClosed', hideBlastRange);
		}


		/* Перезапрос инвью */
		{
			function redraw() {
				view.setCenter([0, 0]);
				setTimeout(() => {
					view.setCenter(playerFeature.getGeometry().getCoordinates());
				}, 1);
			}

			let button = document.createElement('button');

			button.classList.add('fa', 'fa-solid-rotate');

			button.addEventListener('click', redraw);

			toolbar.addItem(button, 3);

			redraw();
		}


		/* Показ скорости */
		{
			const geolocation = new ol.Geolocation({
				projection: view.getProjection(),
				tracking: true,
				trackingOptions: { enableHighAccuracy: true },
			});
			const speedSpan = document.createElement('span');

			speedSpan.classList.add('sbgcui_speed');
			document.querySelector('.self-info').appendChild(speedSpan);

			geolocation.on('change:speed', () => {
				const speed_mps = geolocation.getSpeed() || 0;
				speedSpan.innerText = (speed_mps * 3.6).toFixed(2) + ' km/h';
			});
		}


		/* Выбор точки из кластера */
		{
			const closeButton = document.createElement('button');
			const cooldownGradient = `conic-gradient(
			#0000 var(--sbgcui-cluster-cooldown, 100%),
			var(--sbgcui-cluster-team, #000) var(--sbgcui-cluster-cooldown, 100%) calc(var(--sbgcui-cluster-cooldown, 100%) + 1%),
			#0007 var(--sbgcui-cluster-cooldown, 100%) 100%
			)`;
			const origin = document.createElement('div');
			const overlay = document.createElement('div');
			const originalOnClick = map.getListeners('click')[0];
			const overlayTransitionsTime = 200;
			let featuresAtPixel;
			let isOverlayActive = false;
			let lastShownCluster = [];
			let mapClickEvent;
			let cooldownProgressBarIntervals = [];

			function featureClickHandler(event) {
				if (!isOverlayActive) { return; }

				const chosenFeatureGuid = event.target.getAttribute('sbgcui_guid');
				const chosenFeature = featuresAtPixel.find(feature => feature.getId() == chosenFeatureGuid);

				chosenFeature.set('sbgcui_chosenFeature', true, true);

				hideOverlay();
				setTimeout(() => {
					mapClickEvent.pixel = map.getPixelFromCoordinate(chosenFeature.getGeometry().getCoordinates());
					originalOnClick(mapClickEvent);
				}, overlayTransitionsTime);
			}

			function hideOverlay() {
				origin.childNodes.forEach(node => { node.classList.remove('sbgcui_cluster-iconWrapper-fullWidth'); });
				overlay.classList.remove('sbgcui_cluster-overlay-blur');
				setTimeout(() => {
					overlay.classList.add('sbgcui_hidden');
					cooldownProgressBarIntervals.forEach(intervalID => { clearInterval(intervalID); });
					isOverlayActive = false;
				}, overlayTransitionsTime);
			}

			function mapClickHandler(event) {
				mapClickEvent = event;
				featuresAtPixel = map.getFeaturesAtPixel(mapClickEvent.pixel, {
					hitTolerance: HIT_TOLERANCE,
					layerFilter: layer => layer.get('name') == 'points',
				});
				let featuresToDisplay = featuresAtPixel.slice();

				if (featuresToDisplay.length <= 1 || mapClickEvent.isSilent) { // isSilent: такой эвент генерируется при свайпе между карточками точек.
					featuresToDisplay[0]?.set('sbgcui_chosenFeature', true, true);
					originalOnClick(mapClickEvent);
				} else {
					sortFeaturesByAngle(featuresToDisplay);
					if (featuresToDisplay.length > MAX_DISPLAYED_CLUSTER) { // Показываем ограниченное кол-во, чтобы выглядело аккуратно.
						featuresToDisplay = featuresToDisplay.reduceRight(reduceFeatures, []); // Не выводим показанные в прошлый раз точки если их больше ограничения.
					}

					spreadFeatures(featuresToDisplay);
					showOverlay();
					lastShownCluster = featuresToDisplay;
				}
			}

			function reduceFeatures(acc, feature, index) {
				const isExtraFeatures = MAX_DISPLAYED_CLUSTER - acc.length <= index;
				const isFreeSlots = acc.length < MAX_DISPLAYED_CLUSTER;
				const isShownLastTime = lastShownCluster.includes(feature);

				if (!isFreeSlots) { return acc; }

				if (isShownLastTime) {
					if (!isExtraFeatures) { acc.push(feature); }
				} else {
					acc.push(feature);
				}

				return acc;
			}

			function showOverlay() {
				overlay.classList.remove('sbgcui_hidden');
				setTimeout(() => {
					overlay.classList.add('sbgcui_cluster-overlay-blur');
					isOverlayActive = true;
				}, 10);
				cooldownProgressBarIntervals = [];
			}

			function sortFeaturesByAngle(features) {
				function angleComparator(a, b) {
					const aCoords = a.getGeometry().getCoordinates();
					const bCoords = b.getGeometry().getCoordinates();
					let aAngle = Math.atan2((aCoords[1] - center[1]), (aCoords[0] - center[0]));
					let bAngle = Math.atan2((bCoords[1] - center[1]), (bCoords[0] - center[0]));

					if (aAngle < 0) { aAngle += 2 * Math.PI; }
					if (bAngle < 0) { bAngle += 2 * Math.PI; }

					// Math.PI * 2.5 - это целый круг + сектор 90 гр., т.к. точки в ромашке выводятся по часовой стрелке начиная с 12 часов.
					aAngle = (Math.PI * 2.5 - aAngle) % (Math.PI * 2);
					bAngle = (Math.PI * 2.5 - bAngle) % (Math.PI * 2);

					return aAngle - bAngle;
				}

				const featuresCoords = features.map(f => f.getGeometry().getCoordinates());
				const avgX = featuresCoords.reduce((acc, coords) => acc + coords[0], 0) / featuresCoords.length;
				const avgY = featuresCoords.reduce((acc, coords) => acc + coords[1], 0) / featuresCoords.length;
				const center = [avgX, avgY];

				features.sort(angleComparator);
			}

			function spreadFeatures(features) {
				const angle = 360 / features.length;

				origin.innerHTML = '';

				features.forEach((feature, index) => {
					const guid = feature.getId();
					const icon = document.createElement('div');
					const line = document.createElement('div');
					const wrapper = document.createElement('div');

					const cooldownTimestamp = JSON.parse(localStorage.getItem('cooldowns'))?.[guid]?.t;
					if (cooldownTimestamp) {
						updateCooldown(icon, cooldownTimestamp)
						const intervalID = setInterval(() => { updateCooldown(icon, cooldownTimestamp, intervalID); }, 1000);
						cooldownProgressBarIntervals.push(intervalID);
						icon.style.backgroundImage = cooldownGradient;
					}

					getPointData(guid, false)
						.then(data => {
							const bgImage = `url("https://lh3.googleusercontent.com/${data.i}=s60")`;
							icon.style.backgroundImage += icon.style.backgroundImage.length ? ', ' : '';
							icon.style.backgroundImage += bgImage;
							icon.style.borderColor = `var(--team-${data.te || 0})`;
							icon.style.boxShadow = `0 0 20px 3px var(--team-${data.te || 0}), 0 0 5px 2px black`;
							icon.style.setProperty('--sbgcui-point-title', `"${data.t.replaceAll('"', '\\22 ')}"`);
							icon.style.setProperty('--sbgcui-point-level', `"${data.l}"`);
							icon.style.setProperty('--sbgcui-cluster-team', `var(--team-${data.te})`);
						});

					wrapper.classList.add('sbgcui_cluster-iconWrapper');
					icon.classList.add('sbgcui_cluster-icon');
					line.classList.add('sbgcui_cluster-line');

					wrapper.style.transform = `rotate(${angle * index}deg)`;
					icon.style.transform = `rotate(${-angle * index}deg)`;

					wrapper.append(icon, line);
					origin.appendChild(wrapper);

					setTimeout(() => { wrapper.classList.add('sbgcui_cluster-iconWrapper-fullWidth'); }, 10);

					icon.setAttribute('sbgcui_guid', guid);

					icon.addEventListener('click', featureClickHandler);
				});
			}

			function updateCooldown(icon, cooldownTimestamp, intervalID) {
				const cooldownSec = (cooldownTimestamp - Date.now()) / 1000;
				const gradientPercentage = Math.trunc(100 - cooldownSec / DISCOVERY_COOLDOWN * 100);

				if (cooldownSec <= DISCOVERY_COOLDOWN && cooldownSec >= 0) {
					icon.style.setProperty('--sbgcui-cluster-cooldown', `${gradientPercentage}%`);
				} else {
					clearInterval(intervalID);
					icon.style.removeProperty('--sbgcui-cluster-cooldown');
				}
			}

			closeButton.classList.add('sbgcui_button_reset', 'sbgcui_cluster-close', 'fa', 'fa-solid-circle-xmark');
			origin.classList.add('sbgcui_cluster-center');
			overlay.classList.add('sbgcui_cluster-overlay', 'sbgcui_hidden');

			overlay.append(origin, closeButton);
			document.body.appendChild(overlay);

			closeButton.addEventListener('click', hideOverlay);

			map.un('click', originalOnClick);
			map.on('click', mapClickHandler);
		}


		/* Режим рисования звезды */
		{
			const starModeButton = document.createElement('button');

			function toggleStarMode() {
				const confirmMessage = `Использовать предыдущую сохранённую точку "${starModeTarget?.name}" в качестве центра звезды?`;
				let toastMessage;

				isStarMode = !isStarMode;
				localStorage.setItem('sbgcui_isStarMode', +isStarMode);

				if (isStarMode) {
					starModeButton.style.opacity = 1;
					starModeButton.classList.add('fa-fade');

					if (starModeTarget && confirm(confirmMessage)) {
						starModeButton.classList.remove('fa-fade');
						toastMessage = `Включён режим рисования "Звезда". <br /><br />
										Точка "<span style="color: var(--selection)">${starModeTarget.name}</span>" будет считаться центром звезды. <br /><br />
										Рефы от прочих точек будут скрыты в списке рисования.`;
					} else {
						pointPopup.addEventListener('pointPopupOpened', onPointPopupOpened, { once: true });
						toastMessage = `Включён режим рисования "Звезда". <br /><br />
									Следующая открытая точка будет считаться центром звезды. <br /><br />
									Рефы от прочих точек будут скрыты в списке рисования.`;
					}
				} else {
					starModeButton.style.opacity = 0.5;
					starModeButton.classList.remove('fa-fade');

					pointPopup.removeEventListener('pointPopupOpened', onPointPopupOpened);

					toastMessage = 'Режим рисования "Звезда" отключён.';
				}

				const toast = createToast(toastMessage, 'top left', isStarMode ? 6000 : undefined);

				toast.options.className = 'sbgcui_toast-selection';
				toast.showToast();
			}

			function onPointPopupOpened() {
				starModeTarget = {
					guid: pointPopup.dataset.guid,
					name: pointTitleSpan.innerText
				};
				localStorage.setItem('sbgcui_starModeTarget', JSON.stringify(starModeTarget));

				starModeButton.classList.remove('fa-fade');

				const message = `Точка "<span style="color: var(--selection)">${pointTitleSpan.innerText}</span>" выбрана центром для рисования звезды.`;
				const toast = createToast(message, 'top left');

				toast.options.className = 'sbgcui_toast-selection';
				toast.showToast();
			}

			starModeButton.classList.add('fa', 'fa-solid-asterisk');
			starModeButton.style.opacity = isStarMode ? 1 : 0.5;
			starModeButton.addEventListener('click', toggleStarMode);

			toolbar.addItem(starModeButton, 4);
		}


		/* Переключение между точками */
		{
			const arrow = document.createElement('i');
			const shownPoints = new Set();
			let touchMoveCoords = [];

			function isPointInRange(point) {
				const playerCoords = playerFeature.getGeometry().getCoordinates();
				const pointCoords = point.getGeometry().getCoordinates();
				const distanceToPlayer = Math.sqrt(Math.pow(pointCoords[0] - playerCoords[0], 2) + Math.pow(pointCoords[1] - playerCoords[1], 2));

				return distanceToPlayer < toOLMeters(PLAYER_RANGE);
			}

			function getPointsInRange() {
				const playerCoords = playerFeature.getGeometry().getCoordinates();
				const playerPixel = map.getPixelFromCoordinate(playerCoords);
				const resolution = view.getResolution();
				const hitTolerance = toOLMeters(PLAYER_RANGE) / resolution;

				const pointsHit = map.getFeaturesAtPixel(playerPixel, {
					hitTolerance,
					layerFilter: layer => layer.get('name') == 'points',
				});

				const pointsInRange = pointsHit.filter(isPointInRange);

				return pointsInRange;
			}

			function pointPopupCloseHandler() {
				playerFeature.un('change', toggleArrowVisibility);
			}

			function pointPopupOpenHandler() {
				toggleArrowVisibility();
				playerFeature.on('change', toggleArrowVisibility);
			}

			function toggleArrowVisibility() {
				if (getPointsInRange().length > 1) {
					arrow.classList.remove('sbgcui_hidden');
				} else {
					arrow.classList.add('sbgcui_hidden');
				}
			}

			function touchEndHandler() {
				if (Object.isSealed(touchMoveCoords) || touchMoveCoords.length == 0) { return; }

				const isRtlSwipe = touchMoveCoords.every((coords, i, arr) => coords.x <= arr[i - 1]?.x || i == 0);
				if (!isRtlSwipe) { return; }

				const xCoords = touchMoveCoords.map(coords => coords.x);
				const yCoords = touchMoveCoords.map(coords => coords.y);
				const minX = Math.min(...xCoords);
				const maxX = Math.max(...xCoords);
				const minY = Math.min(...yCoords);
				const maxY = Math.max(...yCoords);
				if (maxY - minY > 70) { return; }
				if (maxX - minX < 50) { return; }


				const pointsInRange = getPointsInRange();

				if (pointsInRange.every(point => shownPoints.has(point.getId()))) { shownPoints.clear(); }
				if (pointsInRange.every(point => !shownPoints.has(point.getId()))) { shownPoints.clear(); }

				const nextPoint = pointsInRange.find(point => (point.getId() !== lastOpenedPoint.guid) && !shownPoints.has(point.getId()));

				if (nextPoint == undefined) { return; }

				shownPoints.add(nextPoint.getId());


				const fakeEvent = {};

				fakeEvent.type = 'click';
				fakeEvent.pixel = map.getPixelFromCoordinate(nextPoint.getGeometry().getCoordinates());
				fakeEvent.originalEvent = {};
				fakeEvent.isSilent = true; // Такой эвент будет проигнорирован функцией показа ромашки для кластера.

				nextPoint.set('sbgcui_chosenFeature', true, true);
				pointPopup.classList.add('hidden');
				map.dispatchEvent(fakeEvent);
			}

			function touchMoveHandler(event) {
				if (Object.isSealed(touchMoveCoords)) { return; }

				const { clientX: x, clientY: y } = event.touches.item(0);

				touchMoveCoords.push({ x, y });
			}

			function touchStartHandler(event) {
				touchMoveCoords = [];
				if (event.touches.length > 1 || event.touches.item(0).target.closest('.deploy-slider-wrp') !== null) {
					Object.seal(touchMoveCoords);
				}
			}

			arrow.classList.add('sbgcui_swipe-cards-arrow', 'fa', 'fa-solid-angles-left');
			document.querySelector('.i-stat').appendChild(arrow);

			pointPopup.addEventListener('pointPopupOpened', pointPopupOpenHandler);
			pointPopup.addEventListener('pointPopupClosed', pointPopupCloseHandler);


			pointPopup.addEventListener('touchstart', touchStartHandler);
			pointPopup.addEventListener('touchmove', touchMoveHandler);
			pointPopup.addEventListener('touchend', touchEndHandler);
		}


		/* Сравнение статы со своей */
		{
			const bottomButtons = document.querySelector('.pr-buttons');
			const compareButton = document.createElement('button');

			async function toggleValues() {
				const playerStats = await getPlayerData(null, profileNameSpan.innerText);
				const selfStats = await getPlayerData(null, player.name);
				const i18nextStats = i18next.getResourceBundle(i18next.resolvedLanguage).profile.stats;
				const statTitles = document.querySelectorAll('.pr-stat-title');

				compareButton.toggleAttribute('sbgcui_self_stats');
				compareButton.classList.toggle('fa-solid-scale-unbalanced');
				compareButton.classList.toggle('fa-solid-scale-unbalanced-flip');

				statTitles.forEach(span => {
					const title = span.innerText;
					let key = Object.entries(i18nextStats).find(e => e[1] == title)[0];

					key = key.replace('total-xp', 'xp').replace('playing-since', 'created_at');

					if (compareButton.hasAttribute('sbgcui_self_stats')) {
						const diff = key == 'created_at' ? (Date.parse(selfStats[key]) - Date.parse(playerStats[key])) : (playerStats[key] - selfStats[key]);
						const diffColor = diff > 0 ? 'red' : diff < 0 ? 'green' : '';

						span.nextSibling.innerText = formatStatValue(key, selfStats[key]);
						span.nextSibling.style.setProperty('--sbgcui-diff-color', diffColor);
					} else {
						span.nextSibling.innerText = formatStatValue(key, playerStats[key]);
						span.nextSibling.style.removeProperty('--sbgcui-diff-color');
					}
				});

				regDateSpan.style.setProperty('--sbgcui-reg-date', calcPlayingTime(compareButton.hasAttribute('sbgcui_self_stats') ? selfStats.created_at : playerStats.created_at));
			}

			function formatStatValue(key, value) {
				const lang = i18next.resolvedLanguage;
				const formatter = new Intl.NumberFormat(lang);

				if (/^guard_/.test(key)) {
					return i18next.t('units.n-days', { count: value });
				}

				switch (key) {
					case 'max_line':
						return value < 1000 ? i18next.t('units.m', { count: value }) : i18next.t('units.km', { count: value / 1000 });
					case 'max_region':
					case 'regions_area':
						return value < 1 ? i18next.t('units.sqm', { count: value * 1e6 }) : i18next.t('units.sqkm', { count: value });
					case 'xp':
						return `${formatter.format(value)} ${i18next.t('units.pts-xp')}`;
					case 'created_at':
						return new Date(value).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' });
					default:
						return formatter.format(value);
				}
			}

			function profileOpenHandler() {
				if (player.name == profileNameSpan.innerText) {
					compareButton.classList.add('sbgcui_hidden');
				} else {
					compareButton.classList.remove('sbgcui_hidden');
				}

				compareButton.removeAttribute('sbgcui_self_stats');
			}

			function reset() {
				const statValues = document.querySelectorAll('.pr-stat-val');
				compareButton.removeAttribute('sbgcui_self_stats');
				compareButton.classList.replace('fa-solid-scale-unbalanced-flip', 'fa-solid-scale-unbalanced');
				statValues.forEach(span => {
					span.style.removeProperty('--sbgcui-diff-color');
				});
			}

			compareButton.classList.add('fa', 'fa-solid-scale-unbalanced', 'sbgcui_profile-compare');

			compareButton.addEventListener('click', toggleValues);
			profilePopup.addEventListener('profilePopupOpened', profileOpenHandler);
			profilePopup.addEventListener('profilePopupClosed', reset);

			bottomButtons.appendChild(compareButton);
		}


		/* Кнопка смены сортировки при рисовании */
		{
			function flip() {
				const refs = refsList.childNodes;
				const refsReversed = [...refs].reverse();

				refsList.replaceChildren(...refsReversed);
				window.draw_slider.refresh();

				flipButton.classList.toggle('fa-solid-arrow-down-short-wide');
				flipButton.classList.toggle('fa-solid-arrow-down-wide-short');
			}

			function resetIcon() {
				flipButton.classList.replace('fa-solid-arrow-down-wide-short', 'fa-solid-arrow-down-short-wide');
			}

			const flipButton = document.createElement('button');
			const sliderButtons = document.querySelector('.draw-slider-buttons');
			const cancelButton = document.querySelector('#draw-slider-close');

			flipButton.classList.add('fa', 'fa-solid-arrow-down-short-wide', 'fa-rotate-270', 'sbgcui_drawslider_sort');
			flipButton.addEventListener('click', flip);
			drawSlider.addEventListener('drawSliderOpened', resetIcon);

			sliderButtons.insertBefore(flipButton, cancelButton);
		}


		/* Показ количества регионов и опыта за снос */
		{
			function openHandler() {
				regionsAmountDiv.innerText = `${regionsText}: ${formatter.format(lastOpenedPoint.regionsAmount)}`;
				destroyRewardDiv.innerText = `${rewardText}: ${formatter.format(lastOpenedPoint.destroyReward)} ${i18next.t('units.pts-xp')}`;
			}

			const pointControls = document.querySelector('.info.popup .i-buttons');
			const pointStat = document.querySelector('.info.popup .i-stat');
			const regionsAmountDiv = document.createElement('div');
			const destroyRewardDiv = document.createElement('div');
			const regionsText = i18next.language == 'ru' ? 'Регионы' : 'Regions';
			const rewardText = i18next.language == 'ru' ? 'За уничтожение' : 'Reward';
			const formatter = new Intl.NumberFormat(i18next.language);

			regionsAmountDiv.classList.add('i-stat__entry');
			destroyRewardDiv.classList.add('i-stat__entry', 'sbgcui_destroy_reward');

			pointStat.insertBefore(regionsAmountDiv, pointControls);
			pointStat.insertBefore(destroyRewardDiv, pointControls);

			pointPopup.addEventListener('pointPopupOpened', openHandler);
		}
	}

})();