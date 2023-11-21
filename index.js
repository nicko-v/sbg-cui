// ==UserScript==
// @name         SBG CUI
// @namespace    https://sbg-game.ru/app/
// @version      1.14.11
// @downloadURL  https://nicko-v.github.io/sbg-cui/index.min.js
// @updateURL    https://nicko-v.github.io/sbg-cui/index.min.js
// @description  SBG Custom UI
// @author       NV
// @match        https://sbg-game.ru/app/*
// @run-at       document-idle
// @grant        none
// @iconURL      https://nicko-v.github.io/sbg-cui/assets/img/tm_script_logo.png
// ==/UserScript==

(function () {
	'use strict';

	if (window.location.pathname.startsWith('/login')) { return; }
	if (document.querySelector('[src="intel.js"]')) { return; }

	window.cuiStatus = 'loading';
	window.stop();
	document.open();
	if (/firefox/i.test(window.navigator.userAgent) == false) {
		for (let i = 0; i <= 100; i += 1) { window.navigator.geolocation.clearWatch(i); }
	}


	const ACTIONS_REWARDS = { destroy: { region: 125, line: 45, core: 10 } };
	const CORES_ENERGY = [0, 500, 750, 1000, 1500, 2000, 2500, 3500, 4000, 5250, 6500];
	const CORES_LIMITS = [0, 6, 6, 4, 4, 3, 3, 2, 2, 1, 1];
	const DISCOVERY_COOLDOWN = 90;
	const HIGHLEVEL_MARKER = 9;
	const HIT_TOLERANCE = 15;
	const HOME_DIR = 'https://nicko-v.github.io/sbg-cui';
	const INVENTORY_LIMIT = 3000;
	const INVIEW_MARKERS_MAX_ZOOM = 16;
	const INVIEW_POINTS_DATA_TTL = 7000;
	const INVIEW_POINTS_LIMIT = 100;
	const ITEMS_TYPES = ['', 'cores', 'catalysers', 'references', 'brooms'];
	const LATEST_KNOWN_VERSION = '0.4.2-2';
	const LEVEL_TARGETS = [1500, 5000, 12500, 25000, 60000, 125000, 350000, 675000, 1000000, Infinity];
	const MAX_DISPLAYED_CLUSTER = 8;
	const MIN_FREE_SPACE = 100;
	const PLAYER_RANGE = 45;
	const TILE_CACHE_SIZE = 2048;
	const USERSCRIPT_VERSION = '1.14.11';
	const VIEW_PADDING = (window.innerHeight / 2) * 0.7;


	const config = {}, state = {}, favorites = {};
	const isCdbMap = JSON.parse(localStorage.getItem('settings'))?.base == 'cdb';
	const isDarkMode = matchMedia('(prefers-color-scheme: dark)').matches;
	const portrait = window.matchMedia('(orientation: portrait)');
	let isFollow = localStorage.getItem('follow') == 'true';
	let map, view, playerFeature, tempLinesSource;


	window.addEventListener('dbReady', loadPageSource);
	window.addEventListener('olReady', () => { olInjection(); loadMainScript(); });
	window.addEventListener('mapReady', main);


	let database;
	const openRequest = indexedDB.open('CUI', 4);

	openRequest.addEventListener('upgradeneeded', event => {
		function initializeDB() {
			database.createObjectStore('config');
			database.createObjectStore('state');
			database.createObjectStore('stats', { keyPath: 'name' });
			database.createObjectStore('favorites', { keyPath: 'guid' });

			const transaction = event.target.transaction;
			const configStore = transaction.objectStore('config');
			const stateStore = transaction.objectStore('state');

			const defaultConfig = {
				maxAmountInBag: {
					cores: { I: -1, II: -1, III: -1, IV: -1, V: -1, VI: -1, VII: -1, VIII: -1, IX: -1, X: -1 },
					catalysers: { I: -1, II: -1, III: -1, IV: -1, V: -1, VI: -1, VII: -1, VIII: -1, IX: -1, X: -1 },
					references: { allied: -1, hostile: -1 },
				},
				autoSelect: {
					deploy: 'max',  // min || max || off
					upgrade: 'min', // min || max || off
					attack: 'latest',  // max || latest
				},
				mapFilters: {
					invert: isDarkMode && !isCdbMap ? 1 : 0,
					hueRotate: isDarkMode ? 180 : 0,
					brightness: isDarkMode ? 0.75 : 1,
					grayscale: isDarkMode ? 1 : 0,
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
					minDistance: -1,
					maxDistance: -1,
				},
			};

			for (let key in defaultConfig) { configStore.add(defaultConfig[key], key); }

			stateStore.add(new Set(), 'excludedCores');
			stateStore.add(true, 'isMainToolbarOpened');
			stateStore.add(false, 'isRotationLocked');
			stateStore.add(false, 'isStarMode');
			stateStore.add(null, 'lastUsedCatalyser');
			stateStore.add(null, 'starModeTarget');
			stateStore.add(0, 'versionWarns');
		}

		function updateDB() {
			const updateToVersion = {
				2: () => {
					database.createObjectStore('logs', { keyPath: 'timestamp' });
				},
				3: () => {
					const logsStore = event.target.transaction.objectStore('logs');
					logsStore.clear();
					logsStore.createIndex('action_type', 'type');
				},
				4: () => {
					const { base, theme } = JSON.parse(localStorage.getItem('settings')) || {};
					const baselayer = `${base}_${theme}`;
					const stateStore = event.target.transaction.objectStore('state');

					stateStore.add(baselayer, 'baselayer');
					database.createObjectStore('tiles');
				},
			};

			for (let v in updateToVersion) {
				if (v > oldVersion && v <= newVersion) { updateToVersion[v](); }
			}
		}

		const { newVersion, oldVersion } = event;
		database = event.target.result;

		if (oldVersion == 0) { initializeDB(); }
		updateDB();
	});
	openRequest.addEventListener('success', event => {
		function getData(event) {
			const storeName = event.target.source.name;
			const cursor = event.target.result;
			let objectToPopulate;

			switch (storeName) {
				case 'config':
					objectToPopulate = config;
					break;
				case 'state':
					objectToPopulate = state;
					break;
				case 'favorites':
					objectToPopulate = favorites;
					break;
				default:
					return;
			}

			if (cursor != undefined) {
				objectToPopulate[cursor.key] = cursor.value;
				cursor.continue();
			}
		}

		if (database == undefined) { database = event.target.result; }

		database.addEventListener('versionchange', () => {
			database.close();
			window.location.reload();
		});
		database.addEventListener('error', event => {
			console.log('Ошибка при работе с БД.', event.target.error);
		});

		const transaction = database.transaction(['config', 'state', 'favorites'], 'readonly');
		transaction.addEventListener('complete', () => { window.dispatchEvent(new Event('dbReady')); });

		const configRequest = transaction.objectStore('config').openCursor();
		const stateRequest = transaction.objectStore('state').openCursor();
		const favoritesRequest = transaction.objectStore('favorites').openCursor();
		[configRequest, stateRequest, favoritesRequest].forEach(request => { request.addEventListener('success', getData); });
	});
	openRequest.addEventListener('error', () => {
		console.log('Ошибка открытия базы данных');
	});


	function loadPageSource() {
		fetch('/app')
			.then(r => r.text())
			.then(data => {
				data = data.replace(/<script class="mobile-check">.+?<\/script>/, '');
				data = data.replace(/(<script src="https:\/\/cdn.jsdelivr.net\/npm\/ol@.+?)(>)/, `$1 onload="window.dispatchEvent(new Event('olReady'))"$2`);

				document.write(data);
				document.close();
			});
	}

	function olInjection() {
		class Map extends ol.Map {
			constructor(options) {
				super(options);
				map = this;
				tempLinesSource = options.layers.filter(layer => layer.get('name') == 'lines')[1]?.getSource();
				window.dispatchEvent(new Event('mapReady'));
			}

			forEachFeatureAtPixel(pixel, callback, options = {}) {
				const isShowInfoCallback = callback.toString().includes('piv.push');

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
			setStyle(style) {
				if (style && playerFeature == undefined && style.length == 3 && style[0].image_?.iconImage_.src_.match(/\/assets\/player/)) {
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

			get blastRange() {
				return this == playerFeature ? this.getStyle()[3].getGeometry() : undefined;
			}
		}

		class View extends ol.View {
			constructor(options) {
				if (portrait.matches) { options.padding = [VIEW_PADDING, 0, 0, 0]; }
				super(options);
				view = this;
			}

			fitBlastRange(isCompleted) {
				const currentZoom = this.getZoom();
				const isZoomChanged = view.get('isZoomChanged');
				const maxZoom = isZoomChanged ? currentZoom : 17;

				if (isCompleted) { this.set('blastRangeZoom', currentZoom); return; }

				this.removePadding();
				this.fit(playerFeature.blastRange, {
					callback: this.fitBlastRange.bind(this),
					duration: 0, // Временно отключено
					maxZoom,
				});
			}

			fitTempLine(lineGeometry, padding) {
				this.removePadding();
				this.fit(lineGeometry, {
					duration: 0,
					maxZoom: 17,
					padding,
				});
			}

			setTopPadding() {
				if (!portrait.matches) { return; }
				this.padding = [VIEW_PADDING, 0, 0, 0];
			}

			setBottomPadding() {
				if (!portrait.matches) { return; }
				this.padding = [0, 0, VIEW_PADDING, 0];
			}

			removePadding() {
				this.padding = [0, 0, 0, 0];
			}
		}

		class Tile extends ol.layer.Tile {
			constructor(options) {
				options.preload = Infinity;
				super(options);
			}
		}

		class XYZ extends ol.source.XYZ {
			constructor(options) {
				super({ ...options, ...cachingOptions });
			}
		}

		class OSM extends ol.source.OSM {
			constructor(options) {
				super({ ...options, ...cachingOptions });
			}
		}

		class StadiaMaps extends ol.source.StadiaMaps {
			constructor(options) {
				super({ ...options, ...cachingOptions });
			}
		}


		function loadTile(tile, src) {
			const coords = tile.getTileCoord().join();
			const tilesStore = database.transaction('tiles', 'readonly').objectStore('tiles');
			const request = tilesStore.get(coords);

			request.addEventListener('success', event => {
				const cachedBlob = event.target.result;

				if (cachedBlob == undefined) {
					fetch(src)
						.then(response => {
							if (response.ok) {
								return response.blob()
							} else {
								throw new Error(`[${response.status}] Не удалось загрузить тайл ${coords}.`);
							}
						})
						.then(blob => {
							setTileSrc(tile, blob);
							database.transaction('tiles', 'readwrite').objectStore('tiles').put(blob, coords);
						})
						.catch(error => { console.log(error); });
				} else {
					setTileSrc(tile, cachedBlob);
				}
			});
		}

		function setTileSrc(tile, blob) {
			const image = tile.getImage();
			const objUrl = URL.createObjectURL(blob);
			image.addEventListener('load', () => { URL.revokeObjectURL(objUrl); });
			image.src = objUrl;
		}


		const cachingOptions = {
			cacheSize: TILE_CACHE_SIZE,
			tileLoadFunction: loadTile,
		};

		ol.Map = Map;
		ol.Feature = Feature;
		ol.View = View;
		ol.layer.Tile = Tile;
		ol.source.XYZ = XYZ;
		ol.source.OSM = OSM;
		ol.source.StadiaMaps = StadiaMaps;
	}

	function loadMainScript() {
		function replacer(match) {
			replacesMade += 1;
			switch (match) {
				case `const Catalysers`:
					return `window.Catalysers`;
				case `const TeamColors`:
					return `window.TeamColors`;
				case `if (zoom % 1 != 0)`:
					return `//${match}`;
				case `if (getSettings('plrhid') == true) $('.ol-layer__player').addClass('hidden')`:
					return `${match};}
									if (!document.querySelector('.info.popup').classList.contains('hidden')) {
										manageControls();
          					$('#i-stat__distance').text(distanceToString(getDistance(point_state.info.c)));
									}{`;
				case `const attack_slider`:
					return `window.attack_slider`;
				case `const deploy_slider`:
					return `window.deploy_slider`;
				case `const draw_slider`:
					return `window.draw_slider`;
				case `if ($('.attack-slider-wrp').hasClass('hidden')) {`:
					return `${match}return;`;
				case `$('[name="baselayer"]').on('change', e`:
					return `$('.layers-config__list').on('change', '[name="baselayer"]', e`;
				case `hour: '2-digit'`:
					return `${match}, hourCycle: 'h23', second: '2-digit'`;
				case `function initCompass() {`:
					return DeviceOrientationEvent ? `${match}return;` : match;
				case `testuser`:
					return `NickolayV`;
				case `timers.info_controls = setInterval(() => {`:
					return `timers.info_controls = setTimeout(() => {`;
				case `delete cooldowns[guid]`:
					return `${match}; manageControls();`;
				case `makeEntry(e, data)`:
					return `window.makeEntryDec(e, data, makeEntry)`;
				case `makeItemTitle(item)`:
					return `makeShortItemTitle(item)`;
				case `view.calculateExtent(map.getSize()`:
					return `view.calculateExtent([map.getSize()[0], map.getSize()[1] + ${VIEW_PADDING}]`;
				case `z: view.getZoom()`:
					return `z: Math.floor(view.getZoom())`;
				case `if (area < 1)`:
					return `if (area < 0)`;
				case `if (type == 'osm') {`:
					return `if (type.startsWith('stadia')) { source=new ol.source.StadiaMaps({ layer:'stamen_'+type.split('_')[1] })} else if (type == 'osm') {`;
				case `class Bitfield`:
					return `window.requestEntities = requestEntities; window.showInfo = showInfo; window.Bitfield = class Bitfield`;
				default:
					replacesMade -= 1;
					return match;
			}
		}

		const regexp = new RegExp([
			`(const Catalysers)`,
			`(const TeamColors)`,
			`(if \\(zoom % 1 != 0\\))`,
			`(if \\(getSettings\\('plrhid'\\) == true\\) \\$\\('\\.ol-layer__player'\\)\\.addClass\\('hidden'\\))`,
			`(const attack_slider)`,
			`(const deploy_slider)`,
			`(const draw_slider)`,
			`(if \\(\\$\\('\\.attack-slider-wrp'\\).hasClass\\('hidden'\\)\\) {)`,
			`(\\$\\('\\[name="baselayer"\\]'\\)\\.on\\('change', e)`,
			`(hour: '2-digit')`,
			`(function initCompass\\(\\) {)`,
			`(testuser)`,
			`(timers\\.info_controls = setInterval\\(\\(\\) => {)`,
			`(delete cooldowns\\[guid\\](?=\\s+?localStorage\\.setItem))`,
			`(makeEntry\\(e, data\\)(?!\\s{))`,
			`(makeItemTitle\\(item\\)(?!\\s{))`,
			`(view\\.calculateExtent\\(map\\.getSize\\(\\))`,
			`(z: view.getZoom\\(\\))`,
			`(if \\(area < 1\\))`,
			`(if \\(type == 'osm'\\) {)`,
			`(class Bitfield)`,
		].join('|'), 'g');

		const replacesShouldBe = 22;
		let replacesMade = 0;

		fetch('/app/script.js')
			.then(r => r.text())
			.then(data => {
				const script = document.createElement('script');
				script.textContent = data.replace(regexp, replacer);
				if (replacesMade != replacesShouldBe) { throw new Error(`SBG CUI: сделано замен: ${replacesMade} вместо ${replacesShouldBe}.`); }
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
				this.title = pointData.t;
				this.possibleLines = [];
				this.lines = {
					in: pointData.li.i,
					out: pointData.li.o,
				};
				this.regionsAmount = pointData.r;
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

			get energyFormatted() {
				return percent_format.format(this.energy);
			}

			get mostChargedCatalyserEnergy() {
				let energy = Math.max(...Object.values(this.cores).map(e => e.energy / CORES_ENERGY[e.level] * 100));
				return isFinite(energy) ? energy : null;
			}

			get dischargeTimeout() {
				const mostChargedCatalyserEnergy = this.mostChargedCatalyserEnergy;
				const rtf = new Intl.RelativeTimeFormat(i18next.language, { style: 'short' });

				if (mostChargedCatalyserEnergy == null) { return ''; }

				let timeout = mostChargedCatalyserEnergy / 0.6 * 60 * 60 * 1000; // Время до разрядки, мс.
				let dh1 = [24 * 60 * 60 * 1000, 60 * 60 * 1000];
				let dh2 = ['day', 'hour'];
				let result = '';

				dh1.forEach((e, i) => {
					const amount = Math.trunc(timeout / e);
					const parts = rtf.formatToParts(amount, dh2[i]);
					const formatted = `${parts[1].value}${parts[2].value}`;

					if (!amount) { return; }

					result += `${result.length ? ', ' : ''}${formatted}`;
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

				const event = new Event('pointRepaired');
				pointPopup.dispatchEvent(event);
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

			constructor(toolbarName) {
				const container = document.createElement('div');

				container.classList.add('ol-unselectable', 'ol-control', 'sbgcui_toolbar-control');
				super({ element: container });

				this.name = toolbarName;

				this.#expandButton.classList.add('fa', 'fa-solid-angle-up');
				this.#expandButton.addEventListener('click', this.handleExpand.bind(this));

				this.#toolbar.classList.add('sbgcui_toolbar');

				isMainToolbarOpened ? this.expand() : this.collapse();

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
				database.transaction('state', 'readwrite').objectStore('state').put(false, `is${this.name}Opened`);
			}

			expand() {
				this.#expandButton.classList.add('fa-rotate-180');
				this.#expandButton.style.opacity = 0.5;

				this.#toolbar.classList.remove('sbgcui_hidden');

				this.#isExpanded = true;
				database.transaction('state', 'readwrite').objectStore('state').put(true, `is${this.name}Opened`);
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

			#onTimeout() {
				this.#notify();
				this.cooldown = null;
			}

			#remindAt(timestamp) {
				let delay = timestamp - Date.now();

				clearTimeout(this.timeoutID);
				this.timeoutID = setTimeout(this.#onTimeout.bind(this), delay);
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


		let originalFetch = window.fetch;
		window.fetch = proxiedFetch;

		let html = document.documentElement;
		let attackButton = document.querySelector('#attack-menu');
		let attackSlider = document.querySelector('.attack-slider-wrp');
		let blContainer = document.querySelector('.bottom-container');
		let drawSlider = document.querySelector('.draw-slider-wrp');
		let deploySlider = document.querySelector('.deploy-slider-wrp');
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
		let pointEnergyValue = document.createElement('span');
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
		let tlContainer = document.querySelector('.topleft-container')
		let toggleFollow = document.querySelector('#toggle-follow');
		let viewportMeta = document.querySelector('meta[name="viewport"]');
		let xpDiffSpan = document.querySelector('.xp-diff');
		let zoomContainer = document.querySelector('.ol-zoom');

		let isInventoryPopupOpened = !inventoryPopup.classList.contains('hidden');
		let isPointPopupOpened = !pointPopup.classList.contains('hidden');
		let isProfilePopupOpened = !profilePopup.classList.contains('hidden');
		let isAttackSliderOpened = !attackSlider.classList.contains('hidden');
		let isDrawSliderOpened = !drawSlider.classList.contains('hidden');
		let isRefsViewerOpened = false;

		let lastOpenedPoint = {};
		let discoverModifier;
		let uniques = { c: new Set(), v: new Set() };
		let inview = {};
		let inviewRegionsVertexes = [];
		let { excludedCores, isMainToolbarOpened, isRotationLocked, isStarMode, lastUsedCatalyser, starModeTarget, versionWarns } = state;

		let percent_format = new Intl.NumberFormat(i18next.language, { maximumFractionDigits: 1 });


		let numbersConverter = {
			I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
			toDecimal(roman) { return this[roman]; },
			toRoman(decimal) { return Object.keys(this).find(key => this[key] == decimal); }
		};

		isStarMode = isStarMode && starModeTarget != null;


		async function proxiedFetch(pathNquery, options) {
			return new Promise((resolve, reject) => {
				const url = new URL(window.location.origin + pathNquery);
				let isBroom;

				switch (url.pathname) {
					case '/api/attack2':
						const guid = JSON.parse(options.body).guid;
						const invCache = JSON.parse(localStorage.getItem('inventory-cache'));
						const message = `Использовать "${i18next.t('items.brooms_one')}"?`;

						isBroom = invCache.find(e => e.t == 4 && e.g == guid) !== undefined;

						if (isBroom && !confirm(message)) {
							resolve();
							attackSlider.dispatchEvent(new Event('attackSliderOpened'));
							return;
						}

						break;
					case '/api/inview':
						if (isRefsViewerOpened) { resolve(); return; }

						let uniqsHighlighting = Object.values(config.pointHighlighting).find(e => e.match(/uniqc|uniqv/));

						if (uniqsHighlighting) {
							const hParam = uniqsHighlighting == 'uniqc' ? 4 : 2;
							url.searchParams.set('h', hParam);
						}

						const mapConfig = JSON.parse(localStorage.getItem('map-config'));
						const layers = Bitfield.from(mapConfig.l);

						layers.change(1, 1);
						layers.change(2, 1);
						url.searchParams.set('l', layers.toString());

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
										const actionType = parsedResponse.data.co.length == 1 ? 'capture' : 'deploy';
										lastOpenedPoint.update(parsedResponse.data.co, parsedResponse.data.l);
										lastOpenedPoint.selectCore(config.autoSelect.deploy);
										logAction({ type: actionType, coords: lastOpenedPoint.coords, point: lastOpenedPoint.guid, title: lastOpenedPoint.title });
									} else if ('c' in parsedResponse) { // Если апгрейд, то один объект с ядром.
										lastOpenedPoint.update([parsedResponse.c], parsedResponse.l);
										lastOpenedPoint.selectCore(config.autoSelect.upgrade, parsedResponse.c.l);
										logAction({ type: 'upgrade', coords: lastOpenedPoint.coords, point: lastOpenedPoint.guid, title: lastOpenedPoint.title });
									}
									break;
								case '/api/attack2':
									lastUsedCatalyser = JSON.parse(options.body).guid;
									database.transaction('state', 'readwrite').objectStore('state').put(lastUsedCatalyser, 'lastUsedCatalyser');

									if ('c' in parsedResponse) {
										const points = parsedResponse.c.filter(point => point.energy == 0).map(point => point.guid);

										if (points.length > 0) {
											const lines = parsedResponse.l.length;
											const regions = parsedResponse.r.length;
											logAction({ type: isBroom ? 'broom' : 'destroy', points, lines, regions });
										}
									}

									break;
								case '/api/discover':
									let toDelete = [];

									if ('loot' in parsedResponse) {
										logAction({ type: 'discover', point: lastOpenedPoint.guid, title: lastOpenedPoint.title });

										if (discoverModifier.isActive) {
											toDelete = parsedResponse.loot
												.filter(e => !discoverModifier.refs ? e.t == 3 : e.t != 3 && e.t != 4)
												.map(e => ({ guid: e.g, type: e.t, amount: e.a }));

											if (toDelete.length != 0) {
												parsedResponse.loot = parsedResponse.loot.filter(e => !discoverModifier.refs ? (e.t != 3) : (e.t == 3));
												const modifiedResponse = createResponse(parsedResponse, response);
												resolve(modifiedResponse);
											}
										}
									}

									clearInventory(false, toDelete);

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
									const inviewPoints = parsedResponse.p;
									const inviewRegions = parsedResponse.r;
									const zoom = +url.searchParams.get('z');

									const mapConfig = JSON.parse(localStorage.getItem('map-config'));
									const lParam = url.searchParams.get('l');

									inviewRegionsVertexes = inviewRegions.map(e => e.c[0].slice(0, 3));

									if (mapConfig.l == lParam) {
										resolve(response);
									} else {
										const layers = Bitfield.from(mapConfig.l);
										if (layers.get(1) == 0) { parsedResponse.l = []; }
										if (layers.get(2) == 0) { parsedResponse.r = []; }

										const modifiedResponse = createResponse(parsedResponse, response);
										resolve(modifiedResponse);
									}

									const hParam = url.searchParams.get('h');
									const isUniqueInRequest = hParam != null;
									const isHighlightCoresOrLevel = Object.values(config.pointHighlighting).find(e => e.match(/cores|highlevel|level/)) != undefined;

									if (!inviewPoints) { break; }

									if (isHighlightCoresOrLevel && zoom >= INVIEW_MARKERS_MAX_ZOOM) {
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
									if ('line' in parsedResponse) {
										const { from, to } = JSON.parse(options.body);
										const regions = parsedResponse.reg.map(region => region.a);
										const fromTitle = from == lastOpenedPoint.guid ? lastOpenedPoint.title : undefined;
										const toTitle = lastOpenedPoint.possibleLines.find(line => line.guid == to)?.title;
										const distance = lastOpenedPoint.possibleLines.find(line => line.guid == to)?.distance;

										logAction({ type: 'draw', from, to, fromTitle, toTitle, distance, regions });
									} else if ('data' in parsedResponse) {

										let { minDistance, maxDistance } = config.drawing;
										minDistance = minDistance == -1 ? -Infinity : +minDistance;
										maxDistance = maxDistance == -1 ? Infinity : +maxDistance;

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
											lastOpenedPoint.possibleLines = parsedResponse.data.map(point => ({ guid: point.p, title: point.t }));
											resolve(modifiedResponse);

											break;
										}

										if (isFinite(minDistance) || isFinite(maxDistance)) {
											const suitablePoints = parsedResponse.data.filter(point => point.d <= maxDistance && point.d >= minDistance);
											const hiddenPoints = parsedResponse.data.length - suitablePoints.length;

											if (hiddenPoints > 0) {
												const message = `Точк${hiddenPoints == 1 ? 'а' : 'и'} (${hiddenPoints}) скрыт${hiddenPoints == 1 ? 'а' : 'ы'}
																			из списка согласно настройкам ограничения дальности рисования
																			(${isFinite(minDistance) ? 'мин. ' + minDistance + ' м' : ''}${isFinite(minDistance + maxDistance) ? ', ' : ''}${isFinite(maxDistance) ? 'макс. ' + maxDistance + ' м' : ''}).`;
												const toast = createToast(message, 'top left');

												toast.options.className = 'sbgcui_toast-selection';
												toast.showToast();

												parsedResponse.data = suitablePoints;
											}

											const modifiedResponse = createResponse(parsedResponse, response);
											resolve(modifiedResponse);
										}

										lastOpenedPoint.possibleLines = parsedResponse.data.map(point => ({ guid: point.p, title: point.t, distance: point.d }));
									}
									break;
								case '/api/profile':
									if ('name' in parsedResponse) {
										regDateSpan.style.setProperty('--sbgcui-reg-date', calcPlayingTime(parsedResponse.created_at));
									}
									break;
								case '/api/repair':
									if ('data' in parsedResponse && isPointPopupOpened) {
										lastOpenedPoint.update(parsedResponse.data);
									}
									break;
								case '/api/score':
									if ('score' in parsedResponse) {
										const [points, regions] = parsedResponse.score;
										const pointsStatTds = document.querySelectorAll('.score__table > tbody td:first-of-type');
										const regionsStatTds = document.querySelectorAll('.score__table > tbody td:last-of-type');

										delete points.check;
										delete regions.check;

										const [pointsPlaces, regionsPlaces] = [points, regions].map(scores => Object.fromEntries(Object.entries(scores).sort((a, b) => b[1] - a[1]).map((e, i) => [e[0], i])));

										pointsStatTds.forEach((td, i) => { td.style.gridArea = `p${pointsPlaces[i == 0 ? 'r' : i == 1 ? 'g' : 'b']}`; });
										regionsStatTds.forEach((td, i) => { td.style.gridArea = `r${regionsPlaces[i == 0 ? 'r' : i == 1 ? 'g' : 'b']}`; });
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
				headers: {
					authorization: `Bearer ${localStorage.getItem('auth')}`,
					'accept-language': i18next.language
				},
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
				headers: {
					authorization: `Bearer ${localStorage.getItem('auth')}`,
					'accept-language': i18next.language
				},
				method: "GET",
			})
				.then(r => r.json())
				.catch(error => { console.log('SBG CUI: Ошибка при получении данных игрока.', error); });
		}

		async function getPointData(guid, isCompact = true) {
			return fetch(`/api/point?guid=${guid}${isCompact ? '&status=1' : ''}`, {
				headers: {
					authorization: `Bearer ${player.auth}`,
					'accept-language': i18next.language
				},
				method: 'GET'
			}).then(r => r.json()).then(r => r.data);
		}

		async function getInventory() {
			return fetch('/api/inventory', {
				headers: {
					authorization: `Bearer ${player.auth}`,
					'accept-language': i18next.language
				},
				method: 'GET',
				'accept-language': i18next.language
			}).then(r => r.json()).then(r => r.i);
		}

		async function clearInventory(forceClear = false, filteredLoot = []) {
			let maxAmount = config.maxAmountInBag;

			getInventory()
				.then(inventory => {
					const itemsAmount = inventory.reduce((total, e) => total + e.a, 0);
					const isEnoughSpace = INVENTORY_LIMIT - itemsAmount >= MIN_FREE_SPACE;
					const { allied, hostile } = maxAmount.references;

					if (isEnoughSpace && !forceClear && filteredLoot.length == 0) { throw { silent: true }; }

					if (!isEnoughSpace || forceClear) {
						// Если надо удалить все ключи или вообще никакие не надо удалять - не запрашиваем данные точек.
						if ((allied == -1 && hostile == -1) || (allied == 0 && hostile == 0)) { return [inventory, filteredLoot, []]; }

						// У обычных предметов в ключе l хранится уровень, у рефов - гуид точки. Логично.
						const pointsData = inventory.map(i => (i.t == 3) ? getPointData(i.l) : undefined).filter(e => e);

						return Promise.all([inventory, filteredLoot, ...pointsData]);
					} else {
						return [[], filteredLoot, []];
					}
				})
				.then(([inventory, filteredLoot, ...pointsDataArr]) => {
					let pointsData = {};

					pointsDataArr.forEach(e => {
						pointsData[e.g] = { team: e.te };
					});

					let toDelete = inventory.map(({ t: itemType, l: itemLevel, a: itemAmount, g: itemGuid }) => {
						if (itemType > ITEMS_TYPES.length - 1) { return; };

						let itemMaxAmount = -1;
						let amountToDelete = 0;
						let itemName = ITEMS_TYPES[itemType];

						if (itemName == 'references') {
							if (isStarMode && (itemLevel == starModeTarget?.guid)) {
								itemMaxAmount = -1;
							} else if (favorites[itemLevel]?.isActive) {
								itemMaxAmount = -1;
							} else if (maxAmount.references.allied == -1 && maxAmount.references.hostile == -1) {
								itemMaxAmount = -1;
							} else if (maxAmount.references.allied == 0 && maxAmount.references.hostile == 0) {
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

					filteredLoot.forEach(filteredLootItem => {
						const toDeleteItem = toDelete.find(item => item.guid == filteredLootItem.guid);
						if (toDeleteItem) {
							toDeleteItem.amount += filteredLootItem.amount;
							toDeleteItem.filtered = filteredLootItem.amount; // Эти предметы не будут добавлены в кэш основным скриптом, т.к. удаляются сразу же.
						} else {
							toDelete.push({ ...filteredLootItem, filtered: filteredLootItem.amount });
						}
					});

					return Promise.all([toDelete, deleteItems(toDelete)]);
				})
				.then(([deleted, responses]) => {
					if (!deleted.length) { return; }

					let invTotal = responses.reduce((total, e) => e.count.total < total ? e.count.total : total, Infinity);
					if (isFinite(invTotal)) {
						invTotalSpan.innerText = invTotal;
						if (inventoryButton.style.color.match('accent') && invTotal < INVENTORY_LIMIT) { inventoryButton.style.color = ''; }
					}

					/* Надо удалить предметы из кэша, т.к. при следующем хаке общее количество предметов возьмётся из кэша и счётчик будет некорректным */
					deleteFromCacheAndSliders(deleted);


					deleted = deleted.reduce((total, e) => {
						const amount = (e.amount - (e.filtered ?? 0));

						if (amount != 0) {
							if (!total.hasOwnProperty(e.type)) { total[e.type] = 0; }
							total[e.type] += amount;
						}

						return total;
					}, {});

					if (Object.entries(deleted).every(type => type[1] == 0)) { return; }

					let message = '';

					for (let key in deleted) {
						const itemName = i18next.t(`items.types.${ITEMS_TYPES[key].slice(0, -1)}`);
						message += `<br><span style="background: var(--sbgcui-branding-color); margin-right: 5px;" class="item-icon type-${key}"></span>x${deleted[key]} ${itemName}`;
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
						'accept-language': i18next.language,
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
					'accept-language': i18next.language,
					'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
				},
				body: `guid=${guid}&position%5B%5D=0.0&position%5B%5D=0.0`,
				method: 'POST',
			}).then(r => r.json());
		}

		async function fetchHTMLasset(filename) {
			return fetch(`${HOME_DIR}/assets/html/${filename}.html`)
				.then(r => {
					if (r.status != 200) { throw new Error(`Ошибка при загрузке ресурса "${filename}.html" (${r.status})`); }
					return r.text();
				})
				.then(html => {
					const parser = new DOMParser();
					const node = parser.parseFromString(html, 'text/html').body.firstChild;
					return node;
				});
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

		function deleteFromCacheAndSliders(items) {
			let cache = JSON.parse(localStorage.getItem('inventory-cache')) || [];

			items.forEach(e => {
				const cachedItem = cache.find(f => f.g == e.guid);
				const deletedAmount = e.amount - (e.filtered ?? 0);
				const slider = e.type == 1 ? deploySlider : e.type == 2 ? attackSlider : undefined;

				if (cachedItem) { cachedItem.a -= deletedAmount; }

				if (slider != undefined && deletedAmount > 0) {
					const slide = slider.querySelector(`li[data-guid="${e.guid}"]`);
					if (slide == null) { return; }

					const amountSpan = slide.querySelector(`li[data-guid="${e.guid}"] > .${e.type == 1 ? 'cores' : 'catalysers'}-list__amount`);
					const amountSpanText = +amountSpan.innerText.slice(1);

					if (amountSpanText - deletedAmount > 0) {
						amountSpan.innerText = `x${amountSpanText - deletedAmount}`;
					} else {
						slide.remove();
						window[`${slider == attackSlider ? 'attack' : 'deploy'}_slider`].refresh();
					}
				}
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

					if (result) { clearInventory(true); }
				});
				section.appendChild(forceClearButton);

				for (let key in maxAmountInBag) {
					let subSection = document.createElement('section');
					let subSectionTitle = document.createElement('h4');
					let subSectionSubTitle = document.createElement('h6');
					let maxAmounts = document.createElement('div');

					subSection.classList.add('sbgcui_settings-subsection');
					subSectionTitle.classList.add('sbgcui_settings-title');
					subSectionSubTitle.classList.add('sbgcui_settings-subtitle');
					maxAmounts.classList.add('sbgcui_settings-maxamounts');

					switch (key) {
						case 'cores':
							subSectionTitle.innerText = 'Ядра';
							break;
						case 'catalysers':
							subSectionTitle.innerText = 'Катализаторы';
							break;
						case 'references':
							subSectionTitle.innerText = 'Сноски';
							subSectionSubTitle.innerHTML = `Сноски от избранных точек удаляться не будут.<br>Для добавления в избранное нажмите звезду на карточке точки.`;
							break;
					}

					for (let type in maxAmountInBag[key]) {
						let wrapper = document.createElement('div');
						let label = document.createElement('label');
						let input = document.createElement('input');

						wrapper.classList.add('sbgcui_settings-amount_input_wrp');
						label.classList.add('sbgcui_settings-amount_label');
						input.classList.add('sbgcui_settings-amount_input');

						if (key == 'references') {
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

					subSection.append(subSectionTitle, subSectionSubTitle, maxAmounts);

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
				const minDistanceTextField = createTextField('Скрывать рефы ближе, чем (м):', 'drawing_minDistance', drawing.minDistance);
				const maxDistanceTextField = createTextField('Скрывать рефы дальше, чем (м):', 'drawing_maxDistance', drawing.maxDistance);

				subSection.classList.add('sbgcui_settings-subsection');

				subSection.append(minDistanceTextField, maxDistanceTextField);

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

					for (let key in config) {
						database.transaction('config', 'readwrite').objectStore('config').put(config[key], key);
					}

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

			doubleClickZoomInteraction.setActive(Boolean(ui.doubleClickZoom));

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
			if (!viewportMeta.content.match(yaRegexp)) {
				viewportMeta.content += `, ya-title=${color}, ya-dock=${color}`;
			} else {
				viewportMeta.content = viewportMeta.content.replace(yaRegexp, `ya-title=${color}, ya-dock=${color}`);
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

		function hideControls() {
			// Отключаются все кнопки и панели кроме зума и фоллоу.
			tlContainer.classList.add('sbgcui_hidden');
			blContainer.classList.add('sbgcui_hidden');
			zoomContainer.childNodes.forEach(e => { !e.matches('.ol-zoom-in, .ol-zoom-out, #toggle-follow') && e.classList.add('sbgcui_hidden'); });
			zoomContainer.style.bottom = '50%';
			map.removeControl(toolbar);
		}

		function showControls() {
			tlContainer.classList.remove('sbgcui_hidden');
			blContainer.classList.remove('sbgcui_hidden');
			zoomContainer.childNodes.forEach(e => { e.classList.remove('sbgcui_hidden'); });
			zoomContainer.style.bottom = '';
			map.addControl(toolbar);
		}

		function logAction(action) {
			const timestamp = Date.now();

			database.transaction('logs', 'readwrite').objectStore('logs').put({ timestamp, ...action });
		}


		/* Данные о себе и версии игры */
		{
			var selfData = await getSelfData();
			const stateStore = database.transaction('state', 'readwrite').objectStore('state');

			if (LATEST_KNOWN_VERSION != selfData.version) {
				if (versionWarns < 2) {
					const toast = createToast(`Текущая версия игры (${selfData.version}) не соответствует последней известной версии (${LATEST_KNOWN_VERSION}). Возможна некорректная работа.`);
					toast.options.className = 'error-toast';
					toast.showToast();

					stateStore.put(versionWarns + 1, 'versionWarns');
				}
			} else {
				stateStore.put(0, 'versionWarns');
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
			pointPopupObserver.observe(pointPopup, { attributes: true, attributeOldValue: true, attributeFilter: ['class'] });


			let profilePopupObserver = new MutationObserver(records => {
				isProfilePopupOpened = !records[0].target.classList.contains('hidden');
				let event = new Event(isProfilePopupOpened ? 'profilePopupOpened' : 'profilePopupClosed', { bubbles: true });
				records[0].target.dispatchEvent(event);
			});
			profilePopupObserver.observe(profilePopup, { attributes: true, attributeFilter: ['class'] });


			let inventoryPopupObserver = new MutationObserver(records => {
				isInventoryPopupOpened = !records[0].target.classList.contains('hidden');
				let event = new Event(isInventoryPopupOpened ? 'inventoryPopupOpened' : 'inventoryPopupClosed');
				records[0].target.dispatchEvent(event);
			});
			inventoryPopupObserver.observe(inventoryPopup, { attributes: true, attributeFilter: ['class'] });


			let attackSliderObserver = new MutationObserver(records => {
				isAttackSliderOpened = !records[0].target.classList.contains('hidden');
				let event = new Event(isAttackSliderOpened ? 'attackSliderOpened' : 'attackSliderClosed');
				records[0].target.dispatchEvent(event);
			});
			attackSliderObserver.observe(attackSlider, { attributes: true, attributeFilter: ['class'] });


			let drawSliderObserver = new MutationObserver(records => {
				isDrawSliderOpened = !records[0].target.classList.contains('hidden');
				let event = new Event(isDrawSliderOpened ? 'drawSliderOpened' : 'drawSliderClosed');
				records[0].target.dispatchEvent(event);
			});
			drawSliderObserver.observe(drawSlider, { attributes: true, attributeFilter: ['class'] });


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
				if (!isAttackSliderOpened) { return; }

				const attributesRecords = [...records].filter(r => r.type == 'attributes');
				const childListRecords = [...records].filter(r => r.type == 'childList');

				const isActiveSwitched = attributesRecords.some(r => r.oldValue.includes('is-active') && !r.target.classList.contains('is-active'));
				const isEverySlideAddedNow = childListRecords.length > 0 && childListRecords.every(r => r.addedNodes.length == 1 && r.removedNodes.length == 0);

				if (isActiveSwitched || isEverySlideAddedNow) {
					let event = new Event('activeSlideChanged');
					catalysersList.dispatchEvent(event);
				}
			});
			catalysersListObserver.observe(catalysersList, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });


			let coresListObserver = new MutationObserver(records => {
				let event = new Event('coresListUpdated');
				coresList.dispatchEvent(event);
			});
			coresListObserver.observe(coresList, { childList: true });


			let toggleFollowObserver = new MutationObserver(records => {
				isFollow = toggleFollow.dataset.active == 'true';
				dragPanInteraction.setActive(!isFollow);
			});
			toggleFollowObserver.observe(toggleFollow, { attributes: true, attributeFilter: ['data-active'] });
		}


		/* Прочие события */
		{
			attackButton.addEventListener('click', () => { attackButton.classList.toggle('sbgcui_attack-menu-rotate'); });

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

				pointEnergyValue.innerText = `${lastOpenedPoint.energyFormatted}% @ ${lastOpenedPoint.coresAmount}`;
			});

			pointPopup.addEventListener('pointRepaired', () => {
				pointEnergyValue.innerText = `${lastOpenedPoint.energyFormatted}% @ ${lastOpenedPoint.coresAmount}`;
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
				function resetView(isCompleted) {
					if (isCompleted) { return; }

					view.animate(
						{ center: player.feature.getGeometry().getCoordinates() },
						{ zoom: 17 },
						{ rotation: 0 },
						resetView
					);
				}

				let touchStartDate = Date.now();

				let timeoutID = setTimeout(resetView, 500);

				this.addEventListener('touchend', () => {
					let touchDuration = Date.now() - touchStartDate;
					if (touchDuration < 1000) { clearTimeout(timeoutID); } else { return; }
				}, { once: true });
			});

			drawSlider.addEventListener('drawSliderOpened', () => {
				view.setBottomPadding();
				view.set('beforeDrawZoom', view.getZoom());

				hideControls();

				// Маленький костылёчек, который позволяет правильно центрировать вью при первом открытии слайдера.
				// Иначе не успевает отработать MutationObserver, эмитящий эвент drawSliderOpened.
				window.draw_slider.emit('active', { slide: drawSlider.querySelector('.splide__slide.is-active') });
			});

			drawSlider.addEventListener('drawSliderClosed', () => {
				const center = playerFeature.getGeometry().getCoordinates();
				const zoom = view.get('beforeDrawZoom') || 17;

				view.setTopPadding();
				view.setCenter(center);
				view.setZoom(zoom);

				showControls();
			});

			portrait.addEventListener('change', () => {
				portrait.matches ? view.setTopPadding() : view.removePadding();
				view.setCenter(playerFeature.getGeometry().getCoordinates());
			});

			map.getAllLayers()[0].on('change', () => {
				const { base, theme } = JSON.parse(localStorage.getItem('settings')) || {};
				const baselayer = `${base}_${theme}`;

				if (state.baselayer != baselayer) {
					const transaction = database.transaction(['state', 'tiles'], 'readwrite');
					const stateStore = transaction.objectStore('state');
					const tilesStore = transaction.objectStore('tiles');

					stateStore.put(baselayer, 'baselayer');
					tilesStore.clear();

					state.baselayer = baselayer;
				}
			});
		}


		/* Удаление ненужного, переносы, переименования */
		{
			const ops = document.querySelector('#ops');
			const rotateArrow = document.querySelector('.ol-rotate');
			const layersButton = document.querySelector('#layers');
			const notifsButton = document.querySelector('#notifs-menu');
			const attackSliderClose = document.querySelector('#attack-slider-close');
			const pointEnergy = document.createElement('div');
			const pointEnergyLabel = document.createElement('span');
			const pointOwner = document.querySelector('#i-stat__owner').parentElement;
			const highlevelCatalyserWarn = document.querySelector('.attack-slider-highlevel');
			const popupCloseButtons = document.querySelectorAll('.popup-close, #inventory__close');

			attackSlider.prepend(highlevelCatalyserWarn);

			document.querySelectorAll('[data-i18n="self-info.name"], [data-i18n="self-info.xp"], [data-i18n="units.pts-xp"], [data-i18n="self-info.inventory"], [data-i18n="self-info.position"]').forEach(e => { e.remove(); });
			document.querySelectorAll('.self-info__entry').forEach(e => {
				let toDelete = [];

				e.childNodes.forEach(e => {
					if (e.nodeType == 3) { toDelete.push(e); }
				});

				toDelete.forEach(e => { e.remove(); });
			});
			document.querySelector('.i-stat__tools').remove();

			attackSliderClose.remove(); // Кнопка закрытия слайдера не нужна.
			attackButton.childNodes[0].remove(); // Надпись Attack.

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

			pointEnergy.classList.add('i-stat__entry');
			pointEnergyLabel.innerText = i18next.t('info.energy');
			pointEnergyValue.id = 'i-stat__energy';
			pointEnergy.append(pointEnergyLabel, ': ', pointEnergyValue);
			pointOwner.after(pointEnergy);

			popupCloseButtons.forEach(button => {
				if (button.closest('.info, .inventory, .leaderboard, .notifs, .profile, .settings')) {
					button.innerHTML = '';
					button.classList.add('sbgcui_button_reset', 'fa', 'fa-solid-xmark');
				}
			});

			i18next.addResources('ru', 'main', {
				'notifs.text': 'нейтрализована $1$',
				'sbgcui.point': 'Точка',
				'sbgcui.points': 'Точки',
				'sbgcui.line': 'Линия',
				'sbgcui.lines': 'Линии',
				'sbgcui.region': 'Регион',
				'sbgcui.regions': 'Регионы',
				'sbgcui.max': 'Макс.',
				'sbgcui.total': 'Всего',
				'sbgcui.area': 'Площадь',
				'sbgcui.distance': 'Расстояние',
			});
			i18next.addResources('en', 'main', {
				'notifs.text': 'нейтрализована $1$',
				'sbgcui.point': 'Point',
				'sbgcui.points': 'Points',
				'sbgcui.line': 'Line',
				'sbgcui.lines': 'Lines',
				'sbgcui.region': 'Region',
				'sbgcui.regions': 'Regions',
				'sbgcui.max': 'Max',
				'sbgcui.total': 'Total',
				'sbgcui.area': 'Area',
				'sbgcui.distance': 'Distance',
			});
			i18next.addResources(i18next.resolvedLanguage, 'main', {
				'items.catalyser-short': '{{level}}',
				'items.core-short': '{{level}}',
			});

			window.draw_slider.options = {
				height: '120px',
				pagination: true,
				//perPage: 2,
			};

			viewportMeta.setAttribute('content', viewportMeta.getAttribute('content') + ', shrink-to-fit=no');
		}


		/* Доработка карты */
		{
			let attributionControl, rotateControl;
			var dragPanInteraction, doubleClickZoomInteraction, pinchRotateInteraction;
			var toolbar = new Toolbar('MainToolbar');
			const controls = map.getControls();
			const interactions = map.getInteractions();

			interactions.forEach(interaction => {
				switch (interaction.constructor) {
					case ol.interaction.DragPan:
						dragPanInteraction = interaction;
						break;
					case ol.interaction.DoubleClickZoom:
						doubleClickZoomInteraction = interaction;
						break;
					case ol.interaction.PinchRotate:
						pinchRotateInteraction = interaction;
						break;
				}
			});

			dragPanInteraction.setActive(toggleFollow.dataset.active != 'true');
			doubleClickZoomInteraction.setActive(Boolean(config.ui.doubleClickZoom));


			controls.forEach(control => {
				switch (control.constructor) {
					case ol.control.Attribution:
						attributionControl = control;
						break;
					case ol.control.Rotate:
						rotateControl = control;
						break;
				}
			});

			map.removeControl(attributionControl);
			map.removeControl(rotateControl);
			map.addControl(toolbar);


			const stadiaWatercolorLabel = document.createElement('label');
			const stadiaTonerLabel = document.createElement('label');

			[stadiaWatercolorLabel, stadiaTonerLabel].forEach((label, index) => {
				const input = document.createElement('input');
				const span = document.createElement('span');
				const theme = index == 0 ? 'Watercolor' : 'Toner';
				const isSelected = JSON.parse(localStorage.getItem('settings')).base == `stadia_${theme.toLowerCase()}`;

				label.classList.add('layers-config__entry');

				input.type = 'radio';
				input.name = 'baselayer';
				input.value = `stadia_${theme.toLowerCase()}`;
				input.checked = isSelected;

				span.innerText = `Stadia ${theme}`

				label.append(input, ' ', span);
			});

			document.querySelector('input[value="osm"]').parentElement.after(stadiaWatercolorLabel, stadiaTonerLabel);
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
			attackSlider.addEventListener('attackSliderOpened', () => {
				click(chooseCatalyser(config.autoSelect.attack));
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
					database.transaction('state', 'readwrite').objectStore('state').put(excludedCores, 'excludedCores');
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
				lastOpenedPoint.selectCore(config.autoSelect.deploy);
			});
		}


		/* Зарядка из инвентаря */
		{
			function makeEntryDec(e, data, makeEntry) {
				if (data.te == player.team) {
					e.style.setProperty('--sbgcui-energy', `${data.e}%`);
					if (data.e < 100) {
						e.style.setProperty('--sbgcui-display-r-button', 'flex');
					}
				}

				return makeEntry(e, data);
			}

			function recursiveRepair(pointGuid, refEntry) {
				repairPoint(pointGuid)
					.then(r => {
						if (r.error) {
							throw new Error(r.error);
						} else if (r.data) {
							const [pointEnergy, maxEnergy] = r.data.reduce((result, core) => [result[0] + core.e, result[1] + CORES_ENERGY[core.l]], [0, 0]);
							const refInfoDiv = document.querySelector(`.inventory__item[data-ref="${pointGuid}"] .inventory__item-left`);
							const refInfoEnergy = refInfoDiv.querySelector('.inventory__item-descr').childNodes[4];
							const percentage = Math.floor(pointEnergy / maxEnergy * 100);
							const refsCache = JSON.parse(localStorage.getItem('refs-cache'));

							refEntry.style.setProperty('--sbgcui-energy', `${percentage}%`);

							if (refInfoEnergy) { refInfoEnergy.nodeValue = percentage; }

							updateExpBar(r.xp.cur);
							showXp(r.xp.diff);

							if (refsCache[pointGuid]) {
								refsCache[pointGuid].e = percentage;
								localStorage.setItem('refs-cache', JSON.stringify(refsCache));
							}

							if (percentage != 100) { recursiveRepair(...arguments); }
						}
					})
					.catch(error => {
						const toast = createToast(`Ошибка при зарядке. <br>${error.message}`);

						toast.options.className = 'error-toast';
						toast.showToast();

						console.log('SBG CUI: Ошибка при зарядке.', error);

						if (error.message.match(/полностью|вражеской|fully|enemy/)) {
							refEntry.style.setProperty('--sbgcui-display-r-button', 'none');
						} else {
							refEntry.style.setProperty('--sbgcui-display-r-button', 'flex');
						}
					});
			}

			window.makeEntryDec = makeEntryDec;

			inventoryContent.addEventListener('click', event => {
				if (!event.currentTarget.matches('.inventory__content[data-tab="3"]')) { return; }
				if (!event.target.closest('.inventory__item-controls')) { return; }
				if (!event.target.closest('.inventory__item.loaded')) { return; }

				// Ширина блока кнопок "V M" около 30 px.
				// Правее них находится кнопка-псевдоэлемент "R".
				// Если нажато дальше 30px (50 – с запасом на возможное изменение стиля), значит нажата псевдокнопка, если нет – одна из кнопок V/M.
				// Приходится указывать конкретное число (50), потому что кнопка V при нажатии получает display: none и не имеет offsetWidth.
				if (event.offsetX < 50) { return; }

				const pointGuid = event.target.closest('.inventory__item')?.dataset.ref;
				const refEntry = event.target.closest('.inventory__item');

				refEntry.style.setProperty('--sbgcui-display-r-button', 'none');

				recursiveRepair(pointGuid, refEntry);
			});
		}


		/* Меню настроек */
		{
			let isSettingsMenuOpened = false;

			let settingsMenu = createSettingsMenu();
			tlContainer.appendChild(settingsMenu);

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
						const timestamp = Date.now();
						const date = new Date(timestamp).toLocaleString();

						database.transaction('stats', 'readwrite').objectStore('stats').put({ ...stats, timestamp });
						timestampSpan.innerText = `Последнее сохранение: \n${date}`;
					});
				}
			}

			function compareStats() {
				const playerName = profileNameSpan.innerText;
				const isSelf = playerName == player.name;
				const request = database.transaction('stats', 'readonly').objectStore('stats').get(playerName);

				request.addEventListener('success', event => {
					const previousStats = event.target.result;

					if (previousStats == undefined) {
						const toast = createToast(`Вы ещё не сохраняли ${isSelf ? 'свою ' : ''}статистику${isSelf ? '' : ' этого игрока'}.`);

						toast.options.className = 'error-toast';
						toast.showToast();

						return;
					}

					getPlayerData(null, playerName).then(currentStats => {
						let ms = Date.now() - previousStats.timestamp;
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
							let diff = currentStats[key] - previousStats[key];

							if (diff) {
								let isPositive = diff > 0;
								let statName;

								switch (key) {
									case 'max_region':
									case 'regions_area':
										statName = i18next.t(`profile.stats.${key}`);
										diff = /*diff < 1 ? i18next.t('units.sqm', { count: diff * 1e6 }) : */i18next.t('units.sqkm', { count: diff });
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
							`${isSelf ? 'Ваша с' : 'С'}татистика ${isSelf ? '' : 'игрока '}с ${new Date(previousStats.timestamp).toLocaleString()}<br>(${since})<br>${diffs}` :
							'Ничего не изменилось с прошлого сохранения.';
						let toast = createToast(toastText, 'bottom center', -1, 'sbgcui_compare_stats-toast');

						toast.showToast();
						toast.toastElement.style.setProperty('--sbgcui-toast-color', `var(--team-${currentStats.team})`);
					});
				});
			}

			function updateTimestamp() {
				const playerName = profileNameSpan.innerText;
				const request = database.transaction('stats', 'readonly').objectStore('stats').get(playerName);

				request.addEventListener('success', event => {
					const previousStats = event.target.result;

					if (previousStats != undefined) {
						const date = new Date(previousStats.timestamp).toLocaleString();
						timestampSpan.innerText = `Последнее сохранение: \n${date}`;
					} else {
						timestampSpan.innerText = '';
					}
				});
			}

			let compareStatsWrp = document.createElement('div');
			let recordButton = document.createElement('button');
			let compareButton = document.createElement('button');
			let timestampSpan = document.createElement('span');
			let prStatsDiv = document.querySelector('.pr-stats');

			recordButton.innerText = 'Записать';
			compareButton.innerText = 'Сравнить';

			timestampSpan.classList.add('sbgcui_compare_stats-timestamp');

			compareStatsWrp.classList.add('sbgcui_compare_stats');
			compareStatsWrp.append(timestampSpan, recordButton, compareButton);

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
						let guid = pointPopup.dataset.guid;
						let guidSpan = document.createElement('span');

						guidSpan.innerText = `GUID: ${guid}`;

						guidSpan.addEventListener('click', _ => {
							window.navigator.clipboard.writeText(`${window.location.origin + window.location.pathname}?point=${guid}`).then(_ => {
								let toast = createToast('Ссылка на точку скопирована в буфер обмена.');
								toast.showToast();
							});
						});

						pointPopup.insertBefore(guidSpan, iStat);

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
			for (let guid in favorites) {
				favorites[guid] = new Favorite(guid, favorites[guid].cooldown);
			}
			Object.defineProperty(favorites, 'save', {
				value: function () {
					const favoritesStore = database.transaction('favorites', 'readwrite').objectStore('favorites');

					for (let guid in this) {
						if (this[guid].isActive) {
							const cooldown = this[guid].cooldown > Date.now() ? this[guid].cooldown : null;
							favoritesStore.put({ guid, cooldown });
						} else {
							favoritesStore.delete(guid);
						}
					}
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
				let favsListDescription = document.createElement('h6');
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
							pointLink.setAttribute('href', `/app/?point=${guid}`);

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
				favsListDescription.classList.add('sbgcui_favs-descr');
				favsListContent.classList.add('sbgcui_favs-content');

				favsListHeader.innerText = 'Избранные точки';
				favsListDescription.innerText = 'Быстрый доступ к важным точкам, уведомления об их остывании и защита от автоудаления сносок.';

				favsList.append(favsListHeader, favsListDescription, favsListContent);

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
				if (confirm('Открыть карточку точки? Либо нажмите "Отмена" для перехода к месту на карте.')) { window.location.href = `/app/?point=${guid}`; }
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
				const activeSlide = [...catalysersList.children].find(e => e.classList.contains('is-active'));
				const cache = JSON.parse(localStorage.getItem('inventory-cache')) || [];
				const item = cache.find(e => e.g == activeSlide.dataset.guid);
				const level = item.l;
				const range = item.t == 2 ? window.Catalysers[level].range : item.t == 4 ? PLAYER_RANGE : 0;

				playerFeature.getStyle()[3].getGeometry().setRadius(toOLMeters(range));
				playerFeature.getStyle()[3].getStroke().setColor(`${config.mapFilters.brandingColor}70`);
				playerFeature.changed();

				if (isFollow) { view.fitBlastRange(); }
			}

			function hideBlastRange() {
				const currentZoom = view.getZoom();
				const { beforeAttackZoom, blastRangeZoom } = view.getProperties();
				onCloseZoom = currentZoom == blastRangeZoom ? beforeAttackZoom : currentZoom;

				playerFeature.getStyle()[3].getGeometry().setRadius(0);
				playerFeature.changed();

				if (isFollow) { resetView(); }
			}

			function resetView(isCompleted) {
				if (isCompleted) { return; }
				view.setTopPadding();
				view.animate(
					{
						center: playerFeature.getGeometry().getCoordinates(),
						zoom: onCloseZoom,
						duration: 0, // Временно отключено
					},
					resetView
				);
			}

			function saveCurrentZoom() {
				view.setProperties({
					beforeAttackZoom: view.getZoom(),
					isZoomChanged: false
				});
			}

			function zoomContainerClickHandler(event) {
				const isZoomButtonClicked = event.target.matches('.ol-zoom-in, .ol-zoom-out');
				if (isAttackSliderOpened && isZoomButtonClicked) { view.set('isZoomChanged', true); }
			}

			let onCloseZoom;

			attackSlider.addEventListener('attackSliderOpened', saveCurrentZoom);
			catalysersList.addEventListener('activeSlideChanged', drawBlastRange);
			attackSlider.addEventListener('attackSliderClosed', hideBlastRange);
			zoomContainer.addEventListener('click', zoomContainerClickHandler);
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

			//button.addEventListener('click', redraw);
			button.addEventListener('click', () => { window.requestEntities(); });

			toolbar.addItem(button, 3);

			//redraw();
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
				database.transaction('state', 'readwrite').objectStore('state').put(isStarMode, 'isStarMode');

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
				database.transaction('state', 'readwrite').objectStore('state').put(starModeTarget, 'starModeTarget');

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
				}).filter(point => point.getId() != lastOpenedPoint.guid);

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

				if (
					pointsInRange.every(point => shownPoints.has(point.getId())) ||
					pointsInRange.every(point => !shownPoints.has(point.getId()))
				) {
					shownPoints.clear();
				}
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
				const formatter = new Intl.NumberFormat(i18next.language);

				if (/^guard_/.test(key)) {
					return i18next.t('units.n-days', { count: value });
				}

				switch (key) {
					case 'max_line':
						return value < 1000 ? i18next.t('units.m', { count: value }) : i18next.t('units.km', { count: value / 1000 });
					case 'max_region':
					case 'regions_area':
						return /*value < 1 ? i18next.t('units.sqm', { count: value * 1e6 }) : */i18next.t('units.sqkm', { count: value });
					case 'xp':
						return `${formatter.format(value)} ${i18next.t('units.pts-xp')}`;
					case 'created_at':
						return new Date(value).toLocaleDateString(i18next.language, { day: 'numeric', month: 'long', year: 'numeric' });
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


		/* Кнопки смены сортировки и вписывания линии при рисовании */
		{
			function fit() {
				const tempLine = tempLinesSource?.getFeatures()[0].getGeometry();
				const padding = [10, 0, window.innerHeight - drawSlider.getBoundingClientRect().y + 30, 0];

				if (tempLine == undefined) { return; }
				view.fitTempLine(tempLine, padding);
			}

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

			const fitButton = document.createElement('button');
			const flipButton = document.createElement('button');
			const sliderButtons = document.querySelector('.draw-slider-buttons');

			fitButton.classList.add('fa', 'fa-solid-up-right-and-down-left-from-center', 'sbgcui_drawslider_fit');
			flipButton.classList.add('fa', 'fa-solid-arrow-down-short-wide', 'fa-rotate-270', 'sbgcui_drawslider_sort');

			fitButton.addEventListener('click', fit);
			flipButton.addEventListener('click', flip);

			drawSlider.addEventListener('drawSliderOpened', resetIcon);

			sliderButtons.append(flipButton, fitButton);
		}


		/* Показ опыта за снос */
		{
			function openHandler() {
				destroyRewardDiv.innerText = `${rewardText}: ${formatter.format(lastOpenedPoint.destroyReward)} ${i18next.t('units.pts-xp')}`;
			}

			const pointControls = document.querySelector('.info.popup .i-buttons');
			const pointStat = document.querySelector('.info.popup .i-stat');
			const destroyRewardDiv = document.createElement('div');
			const rewardText = i18next.language.includes('ru') ? 'Награда' : 'Reward';
			const formatter = new Intl.NumberFormat(i18next.language);

			destroyRewardDiv.classList.add('i-stat__entry');

			pointStat.insertBefore(destroyRewardDiv, pointControls);

			pointPopup.addEventListener('pointPopupOpened', openHandler);
		}


		/* Точка в [0, 0] */
		{
			const customPointsSource = new ol.source.Vector();
			const customPointsLayer = new ol.layer.Vector({
				source: customPointsSource,
				name: 'sbgcui_points',
				minZoom: 15,
				className: 'ol-layer__sbgcui_points',
				zIndex: 9
			});

			try {
				const popup = await fetchHTMLasset('zero-point-info');
				const zeroPointFeature = new ol.Feature({
					geometry: new ol.geom.Point([0, 0])
				});

				popup.addEventListener('click', () => {
					popup.classList.add('sbgcui_hidden');
					setTimeout(() => { popup.style.zIndex = 0; }, 100);
				});
				document.body.appendChild(popup);

				zeroPointFeature.setId('sbgcui_zeroPoint');
				zeroPointFeature.setStyle(new ol.style.Style({
					geometry: new ol.geom.Circle([0, 0], 30),
					fill: new ol.style.Fill({ color: '#BB7100' }),
					stroke: new ol.style.Stroke({ color: window.TeamColors[3].stroke, width: 5 }),
					text: new ol.style.Text({
						font: '30px Manrope',
						text: '?',
						fill: new ol.style.Fill({ color: '#000' }),
						stroke: new ol.style.Stroke({ color: '#FFF', width: 3 })
					}),
				}));

				map.on('click', event => {
					const features = map.getFeaturesAtPixel(event.pixel, {
						layerFilter: layer => layer.get('name') == 'sbgcui_points',
					});

					if (features.includes(zeroPointFeature)) {
						popup.classList.remove('sbgcui_hidden');
						setTimeout(() => { popup.style.zIndex = 9; }, 100);
					}
				});
				customPointsSource.addFeature(zeroPointFeature);
			} catch (error) {
				console.log(error);
			}

			map.addLayer(customPointsLayer);
		}


		/* Количество регионов под кликом */
		{
			function buttonClickHandler() {
				const toast = createToast('Нажмите на регион чтобы узнать, сколько их в этом месте.');

				toast.options.className = 'sbgcui_toast-selection';
				toast.showToast();

				map.un('click', mapClickHandler);
				map.once('click', mapClickHandler);
			}

			function mapClickHandler(event) {
				const features = map.getFeaturesAtPixel(event.pixel, {
					layerFilter: layer => layer.get('name') == 'regions',
				});
				const areasM2 = features.map(feature => ol.sphere.getArea(feature.getGeometry()));
				const minAreaM2 = Math.min(...areasM2);
				const maxAreaM2 = Math.max(...areasM2);
				const minArea = /*minAreaM2 < 1e6 ? i18next.t('units.sqm', { count: minAreaM2 }) : */i18next.t('units.sqkm', { count: minAreaM2 / 1e6 });
				const maxArea = /*maxAreaM2 < 1e6 ? i18next.t('units.sqm', { count: maxAreaM2 }) : */i18next.t('units.sqkm', { count: maxAreaM2 / 1e6 });
				let message = `Количество регионов в точке: ${features.length}.`;

				if (features.length == 1) { message += `\n\nПлощадь региона: ${maxArea}.`; }
				if (features.length > 1) { message += `\n\nПлощадь самого большого региона: ${maxArea}.\nПлощадь самого маленького региона: ${minArea}.`; }

				alert(message);
			}

			const button = document.createElement('button');

			button.classList.add('fa', 'fa-brands-stack-overflow');
			button.addEventListener('click', buttonClickHandler);

			toolbar.addItem(button, 5);
		}


		/* Время до разрядки точки */
		{
			function updateTimeout() {
				if (config.ui.pointDischargeTimeout) {
					timeoutSpan.innerText = `(~${lastOpenedPoint.dischargeTimeout})`;
				}
			}

			const timeoutSpan = document.createElement('span');

			timeoutSpan.classList.add('sbgcui_discharge_timeout');
			pointEnergyValue.after(timeoutSpan);

			pointPopup.addEventListener('pointPopupOpened', updateTimeout);
			pointPopup.addEventListener('pointRepaired', updateTimeout);
		}


		/* Вращение карты */
		{
			let latestTouchPoint = null;
			let touches = [];
			const lockRotationButton = document.createElement('button');
			const mapDiv = document.getElementById('map');

			function rotateView(pointA, pointB) {
				const center = map.getPixelFromCoordinate(view.getCenter());
				const aAngle = Math.atan2((pointA[1] - center[1]), (pointA[0] - center[0]));
				const bAngle = Math.atan2((pointB[1] - center[1]), (pointB[0] - center[0]));
				const anchor = map.getCoordinateFromPixel(center);

				view.adjustRotation(bAngle - aAngle, anchor);
			}

			function resetView(isCompleted) {
				if (isCompleted) { return; }

				view.animate({ rotation: 0 }, resetView);
			}

			function toggleRotationLock(event) {
				// Если был эвент нажатия кнопки — переключаем.
				// Иначе функция вызвана при запуске скрипта и должна установить сохранённое ранее значение.
				if (event) { isRotationLocked = !isRotationLocked; }

				if (isRotationLocked) { resetView(); }
				pinchRotateInteraction.setActive(!isRotationLocked);
				lockRotationButton.setAttribute('sbgcui_locked', isRotationLocked);
				database.transaction('state', 'readwrite').objectStore('state').put(isRotationLocked, 'isRotationLocked');
			}

			function touchStartHandler(event) {
				if (isRotationLocked) { return; }
				if (!isFollow) { return; }
				if (event.target.nodeName != 'CANVAS') { return; }
				if (event.targetTouches.length > 1) { return; }

				latestTouchPoint = [event.targetTouches[0].clientX, event.targetTouches[0].clientY];
				touches = [];
			}

			function touchMoveHandler(event) {
				event.preventDefault();

				if (latestTouchPoint == null) { return; }

				const ongoingTouchPoint = [event.targetTouches[0].clientX, event.targetTouches[0].clientY];

				rotateView(latestTouchPoint, ongoingTouchPoint);
				latestTouchPoint = ongoingTouchPoint;
				touches.push(ongoingTouchPoint);
			}

			function touchEndHandler() {
				if (touches.length != 0) { window.requestEntities(); }
				latestTouchPoint = null;
			}

			function rotationChangeHandler() {
				const isAnimating = view.getAnimating();

				if (isFollow && !isAnimating) { view.setCenter(playerFeature.getGeometry().getCoordinates()); }
				lockRotationButton.style.setProperty('--sbgcui_angle', `${view.getRotation() * 180 / Math.PI}deg`);
			}

			const request = database.transaction('state', 'readwrite').objectStore('state').get('isRotationLocked');
			request.addEventListener('success', event => {
				isRotationLocked = event.target.result;
				toggleRotationLock();
			});

			lockRotationButton.classList.add('fa', 'fa-solid-compass', 'sbgcui_lock_rotation');
			lockRotationButton.addEventListener('click', toggleRotationLock);

			toggleFollow.before(lockRotationButton);

			mapDiv.addEventListener('touchstart', touchStartHandler);
			mapDiv.addEventListener('touchmove', touchMoveHandler);
			mapDiv.addEventListener('touchend', touchEndHandler);

			view.on('change:rotation', rotationChangeHandler);
		}


		/* Навигация и переход к точке */
		{
			function jumpTo() {
				if (isFollow) { click(toggleFollow); }
				pointPopup.classList.add('hidden');
				view.setCenter(ol.proj.fromLonLat(lastOpenedPoint.coords));
				view.adjustCenter([0, VIEW_PADDING / -2]);
			}

			try {
				if (window.navigator.userAgent.toLowerCase().includes('wv')) { throw new Error(); }

				function createURL(app, routeType) {
					const [lonA, latA] = ol.proj.toLonLat(playerFeature.getGeometry().getCoordinates());
					const [lonB, latB] = lastOpenedPoint.coords;
					let url;

					switch (app) {
						case 'yamaps':
							url = `yandexmaps://maps.yandex.ru/?rtext=${latA},${lonA}~${latB},${lonB}&rtt=${routeType}`;
							break;
						case 'yanavi':
							url = `yandexnavi://build_route_on_map?lat_from=${latA}&lon_from=${lonA}&lat_to=${latB}&lon_to=${lonB}`;
							break;
						case 'dgis':
							url = `dgis://2gis.ru/routeSearch/rsType/${routeType}/from/${lonA},${latA}/to/${lonB},${latB}`;
							break;
						case 'gmaps':
							url = `comgooglemaps://?saddr=${latA},${lonA}&daddr=${latB},${lonB}&directionsmode=${routeType}`;
							break;
					}

					return url;
				}

				function routeTypeClickHandler(event) {
					const app = event.currentTarget.dataset.app;
					const routeType = event.target.dataset.routetype;

					if (event.target.nodeName != 'LI') { return; }
					if (event.target.hasAttribute('data-selected')) {
						delete event.target.dataset.selected;
						delete submitButton.dataset.app;
						delete submitButton.dataset.routetype;
						return;
					}

					navPopup.querySelectorAll('li[data-selected]').forEach(e => { delete e.dataset.selected; })
					event.target.dataset.selected = '';
					submitButton.dataset.app = app;
					submitButton.dataset.routetype = routeType;
				}

				function closeNavPopup() {
					navPopup.classList.add('sbgcui_hidden');
				}

				function toggleNavPopup() {
					navPopup.classList.toggle('sbgcui_hidden');
				}

				const navPopup = await fetchHTMLasset('navigate');
				const coordsSpan = navPopup.querySelector('.sbgcui_navigate-coords');
				const form = navPopup.querySelector('form');
				const menus = navPopup.querySelectorAll('menu');
				const [cancelButton, submitButton] = navPopup.querySelectorAll('.sbgcui_navigate-form-buttons > button');
				const navButton = document.createElement('button');

				navButton.classList.add('fa', 'fa-solid-route', 'sbgcui_button_reset', 'sbgcui_navbutton');
				navButton.addEventListener('click', toggleNavPopup);
				pointPopup.appendChild(navButton);

				pointPopup.addEventListener('pointPopupOpened', () => {
					coordsSpan.innerText = lastOpenedPoint.coords.slice().reverse().join(', ');
				});
				coordsSpan.addEventListener('click', () => {
					window.navigator.clipboard.writeText(coordsSpan.innerText).then(() => {
						const toast = createToast('Координаты скопированы в буфер обмена.');
						toast.showToast();
					});
				});

				form.addEventListener('submit', event => { event.preventDefault(); })

				menus.forEach(menu => {
					menu.addEventListener('click', routeTypeClickHandler);
				});

				cancelButton.addEventListener('click', closeNavPopup);
				submitButton.addEventListener('click', () => {
					const url = createURL(submitButton.dataset.app, submitButton.dataset.routetype);
					if (url != undefined) {
						window.location.href = url;
						closeNavPopup();
					}
				});

				pointPopupCloseButton.addEventListener('click', closeNavPopup)

				document.body.appendChild(navPopup);
			} catch (error) {
				console.log(error);
			}

			const jumpToButton = document.createElement('button');

			jumpToButton.classList.add('fa', 'fa-solid-map-location-dot', 'sbgcui_button_reset', 'sbgcui_jumpToButton');
			jumpToButton.addEventListener('click', jumpTo);
			pointPopup.appendChild(jumpToButton);
		}


		/* Поворот стрелки игрока */
		{
			function rotateArrow(event) {
				const deviceRotationDeg = event.webkitCompassHeading;

				if (Math.abs(playerArrowRotationDeg - deviceRotationDeg) > 3) {
					const playerArrowRotationRad = deviceRotationDeg * Math.PI / 180;

					playerArrow.setRotation(playerArrowRotationRad + view.getRotation());
					playerFeature.changed();

					playerArrowRotationDeg = deviceRotationDeg;
				}
			}

			const playerArrow = playerFeature.getStyle()[0].getImage();
			let playerArrowRotationDeg = 0;

			if (DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
				document.body.addEventListener('click', () => { DeviceOrientationEvent.requestPermission(); }, { once: true });

				window.addEventListener('deviceorientation', rotateArrow);
			}
		}


		/* Показать рефы на карте */
		{
			function deleteRefs() {
				if (uniqueRefsToDelete == 0) { return; }

				const urtdSuffix = uniqueRefsToDelete % 10 == 1 ? 'ки' : 'ек';
				let ortdSuffix;

				switch (overallRefsToDelete % 10) {
					case 1:
						ortdSuffix = 'ку';
						break;
					case 2:
					case 3:
					case 4:
						ortdSuffix = 'ки';
						break;
					default:
						ortdSuffix = 'ок';
						break;
				}

				if (!confirm(`Удалить ${overallRefsToDelete} ссыл${ortdSuffix} от ${uniqueRefsToDelete} точ${urtdSuffix}?`)) { return; }

				const selectedFeatures = pointsWithRefsSource.getFeatures().filter(feature => feature.get('isSelected') == true);
				const refsToDelete = selectedFeatures.map(feature => ({ guid: feature.getId(), type: 3, amount: feature.get('amount') }));

				deleteItems(refsToDelete)
					.then(responses => {
						const response = responses[0];

						if ('error' in response) { throw response.error; }

						const invTotal = response.count.total;

						invTotalSpan.innerText = invTotal;
						if (inventoryButton.style.color.match('accent') && invTotal < INVENTORY_LIMIT) { inventoryButton.style.color = ''; }

						deleteFromCacheAndSliders(refsToDelete);

						uniqueRefsToDelete = 0;
						overallRefsToDelete = 0;
						selectedFeatures.forEach(feature => { pointsWithRefsSource.removeFeature(feature); });

						trashCanButton.style.setProperty('--sbgcui-overall-refs-to-del', `"0"`);
						trashCanButton.style.setProperty('--sbgcui-unique-refs-to-del', `"0"`);
					})
					.catch(error => {
						const toast = createToast(`Ошибка при удалении ссылок. <br>${error?.message || error}`);

						toast.options.className = 'error-toast';
						toast.showToast();

						console.log('SBG CUI: Ошибка при удалении ссылок.', error);
					});
			}

			function hideViewer() {
				pointsWithRefsSource.clear(true);

				hideViewerButton.classList.add('sbgcui_hidden');
				trashCanButton.classList.add('sbgcui_hidden');
				showControls();

				isRefsViewerOpened = false;
				overallRefsToDelete = 0;
				uniqueRefsToDelete = 0;

				map.un('click', mapClickHandler);

				view.setZoom(beforeOpenZoom);
				//view.setCenter(playerFeature.getGeometry().getCoordinates());

				window.requestEntities();
			}

			function mapClickHandler(event) {
				function toggleSelectState(feature) {
					const { amount, isSelected } = feature.getProperties();

					feature.set('isSelected', !isSelected);

					overallRefsToDelete += amount * (isSelected ? -1 : 1);
					uniqueRefsToDelete += isSelected ? -1 : 1;
					trashCanButton.style.setProperty('--sbgcui-overall-refs-to-del', `"${overallRefsToDelete}"`);
					trashCanButton.style.setProperty('--sbgcui-unique-refs-to-del', `"${uniqueRefsToDelete}"`);
				}

				const options = {
					hitTolerance: 0,
					layerFilter: layer => layer.get('name') == 'sbgcui_points_with_refs'
				};

				map.forEachFeatureAtPixel(event.pixel, toggleSelectState, options);
			}

			function showViewer() {
				getInventory()
					.then(inventory => {
						const refs = inventory.filter(item => item.t == 3);
						const layers = map.getAllLayers();

						beforeOpenZoom = view.getZoom();
						isRefsViewerOpened = true;
						hideViewerButton.classList.remove('sbgcui_hidden');
						trashCanButton.classList.remove('sbgcui_hidden');
						inventoryPopup.classList.add('hidden');
						if (!attackSlider.classList.contains('hidden')) { click(attackButton); }
						hideControls();

						trashCanButton.style.setProperty('--sbgcui-overall-refs-to-del', `"0"`);
						trashCanButton.style.setProperty('--sbgcui-unique-refs-to-del', `"0"`);

						layers.forEach(layer => {
							if (/^(lines|points|regions)/.test(layer.get('name'))) { layer.getSource().clear(); }
						});

						refs.forEach(ref => {
							const { a: amount, c: coords, g: refGuid, l: pointGuid, ti: title } = ref;
							const mapCoords = ol.proj.fromLonLat(coords);
							const feature = new ol.Feature({ geometry: new ol.geom.Point(mapCoords) });

							feature.setId(refGuid);
							feature.setProperties({ amount, mapCoords, pointGuid, title });

							pointsWithRefsSource.addFeature(feature);
						});

						map.on('click', mapClickHandler);
					})
					.catch(error => {
						console.log(error);
					});
			}

			const pointsWithRefsSource = new ol.source.Vector();
			const pointsWithRefsLayer = new ol.layer.Vector({
				className: 'ol-layer__sbgcui_points_with_refs',
				declutter: true,
				minZoom: 0,
				name: 'sbgcui_points_with_refs',
				source: pointsWithRefsSource,
				style: (feature, resolution) => {
					const { amount, isSelected, mapCoords, title } = feature.getProperties();
					const zoom = view.getZoom();
					const markerSize = zoom >= 16 ? 20 : 20 * resolution / 2.5;
					const markerStyle = new ol.style.Style({
						geometry: new ol.geom.Circle(mapCoords, isSelected ? markerSize * 1.4 : markerSize),
						fill: new ol.style.Fill({ color: isSelected ? '#BB7100' : '#CCC' }),
						stroke: new ol.style.Stroke({ color: window.TeamColors[3].stroke, width: 3 }),
						zIndex: isSelected ? 3 : 1,
					});
					const amountStyle = new ol.style.Style({
						text: new ol.style.Text({
							fill: new ol.style.Fill({ color: '#000' }),
							font: `${zoom >= 15 ? 16 : 12}px Manrope`,
							stroke: new ol.style.Stroke({ color: '#FFF', width: 3 }),
							text: zoom >= 15 ? String(amount) : null,
						}),
						zIndex: 2,
					});
					const titleStyle = new ol.style.Style({
						text: new ol.style.Text({
							fill: new ol.style.Fill({ color: '#000' }),
							font: `12px Manrope`,
							offsetY: 25 / resolution,
							stroke: new ol.style.Stroke({ color: '#FFF', width: 3 }),
							text: zoom >= 17 ? (title.length <= 12 ? title : title.slice(0, 10).trim() + '...') : null,
							textBaseline: 'top',
						}),
						zIndex: 2,
					});

					return [markerStyle, amountStyle, titleStyle];
				},
				zIndex: 8,
			});
			const hideViewerButton = document.createElement('button');
			const invControls = document.querySelector('.inventory__controls');
			const invDelete = document.querySelector('#inventory-delete');
			const showViewerButton = document.createElement('button');
			const trashCanButton = document.createElement('button');
			const buttonsWrapper = document.createElement('div');
			let overallRefsToDelete = 0;
			let uniqueRefsToDelete = 0;
			let beforeOpenZoom;

			hideViewerButton.id = 'sbgcui_hide_viewer';
			hideViewerButton.classList.add('sbgcui_button_reset', 'sbgcui_hidden', 'fa', 'fa-solid-xmark');

			showViewerButton.classList.add('sbgcui_show_viewer');
			showViewerButton.innerText = 'На карте';

			trashCanButton.classList.add('sbgcui_button_reset', 'sbgcui_hidden', 'fa', 'fa-solid-trash');
			trashCanButton.id = 'sbgcui_batch_remove';

			showViewerButton.addEventListener('click', showViewer);
			hideViewerButton.addEventListener('click', hideViewer);
			trashCanButton.addEventListener('click', deleteRefs);

			invControls.insertBefore(showViewerButton, invDelete);
			buttonsWrapper.append(hideViewerButton, trashCanButton);
			document.body.appendChild(buttonsWrapper);

			map.addLayer(pointsWithRefsLayer);
		}


		/* Показ логов */
		{
			try {
				function hidePopup() {
					popup.classList.add('sbgcui_hidden');
					logContent.innerHTML = '';
					log = undefined;
				}

				function showPopup() {
					const logsStore = database.transaction('logs', 'readonly').objectStore('logs');
					const request = logsStore.getAllKeys();

					request.addEventListener('success', event => {
						const offsetMs = new Date().getTimezoneOffset() * 60 * 1000;
						const timestamps = event.target.result;
						const firstEntryTimestamp = timestamps[0] || Date.now();
						const latestEntryTimestamp = timestamps[timestamps.length - 1] || Date.now();
						const firstEntryDate = new Date(firstEntryTimestamp - offsetMs).toISOString().slice(0, 10);
						const latestEntryDate = new Date(latestEntryTimestamp - offsetMs).toISOString().slice(0, 10);

						datePicker.setAttribute('min', firstEntryDate);
						datePicker.setAttribute('max', latestEntryDate);
						datePicker.setAttribute('value', latestEntryDate);
						datePicker.value = latestEntryDate;

						datePicker.dispatchEvent(new Event('change'));

						popup.classList.remove('sbgcui_hidden');
					});
				}

				function showLog() {
					const upperBound = new Date(datePicker.value).setHours(0, 0, 0, 0);
					const lowerBound = new Date(datePicker.value).setHours(23, 59, 59, 999);
					const keyRange = IDBKeyRange.bound(upperBound, lowerBound);
					const logsStore = database.transaction('logs', 'readonly').objectStore('logs');
					const request = logsStore.getAll(keyRange);

					logContent.innerHTML = '';

					request.addEventListener('success', event => {
						const logs = event.target.result;
						if (logs.length == 0) { return; }

						const guidsTitles = {};
						const pointsWithoutTitle = [];

						logs.reverse();
						logs.map(action => {
							switch (action.type) {
								case 'capture':
								case 'deploy':
								case 'upgrade':
								case 'discover':
									guidsTitles[action.point] = guidsTitles[action.point] || action.title;
									break;
								case 'draw':
									guidsTitles[action.from] = guidsTitles[action.fromTitle] || action.fromTitle;
									guidsTitles[action.to] = guidsTitles[action.toTitle] || action.toTitle;
									break;
								case 'destroy':
								case 'broom':
									action.points.forEach(guid => { guidsTitles[guid] = guidsTitles[guid] || undefined; });
									break;
							}
						});
						for (let guid in guidsTitles) {
							if (guidsTitles[guid] == undefined) { pointsWithoutTitle.push(guid); }
						}

						const promises = pointsWithoutTitle.map(guid => getPointData(guid));
						Promise.all(promises)
							.then(results => {
								results.forEach(point => { guidsTitles[point.g] = point.t; });
								logs.forEach(action => {
									const entry = document.createElement('p');
									const entryTime = document.createElement('span');
									const entryDescr = document.createElement('div');

									entry.classList.add('sbgcui_log-content-entry');
									entryTime.classList.add('sbgcui_log-content-entry-time');
									entryDescr.classList.add('sbgcui_log-content-entry-description');

									entry.style.setProperty('--action-type', `"${action.type}"`);
									entry.style.setProperty('--action-color', `var(--${action.type})`);
									entry.setAttribute('data-action', action.type);

									const format = { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
									entryTime.innerText = new Date(action.timestamp).toLocaleString(i18next.language, format);

									switch (action.type) {
										case 'capture':
										case 'deploy':
										case 'upgrade':
										case 'discover': {
											const link = document.createElement('a');

											link.innerText = guidsTitles[action.point] || action.point;
											link.setAttribute('data-guid', action.point);

											entryDescr.appendChild(link);

											break;
										}
										case 'draw': {
											const fromLink = document.createElement('a');
											const toLink = document.createElement('a');
											const fromToSpan = document.createElement('span');
											const distance = action.distance;
											const distanceString = i18next.t(`units.${distance >= 1000 ? 'km' : 'm'}`, { count: distance >= 1000 ? distance / 1000 : distance });
											const regionsAmount = action.regions instanceof Array ? action.regions.length : action.regions;
											// Сначала регионы хранились в виде массива объектов, затем в виде числа - количество регионов, сейчас в виде массива площадей.

											fromLink.innerText = guidsTitles[action.from];
											toLink.innerText = guidsTitles[action.to];

											fromLink.setAttribute('data-guid', action.from);
											toLink.setAttribute('data-guid', action.to);

											fromToSpan.classList.add('sbgcui_log-content-entry-description-fromto');

											fromToSpan.append(fromLink, '->', toLink);
											entryDescr.appendChild(fromToSpan);
											if (distance != undefined) { entryDescr.append(`${i18next.t('sbgcui.distance')}: ${distanceString}`, document.createElement('br')); }
											if (regionsAmount > 0) {
												entryDescr.append(`${i18next.t('sbgcui.region' + (regionsAmount > 1 ? 's' : ''))}: ${regionsAmount}`);

												if (typeof action.regions == 'number') { break; } // Временно регионы сохранялись просто количеством.

												const areas = action.regions.map(region => typeof region == 'number' ? region : region.a);
												const maxArea = i18next.t('units.sqkm', { count: Math.max(...areas) });
												const totalArea = i18next.t('units.sqkm', { count: areas.reduce((acc, current) => acc + current, 0) });

												if (regionsAmount == 1) {
													entryDescr.append(`. ${i18next.t('sbgcui.area')}: ${maxArea}`);
												} else {
													const br = document.createElement('br');
													entryDescr.append(br, `${i18next.t('sbgcui.max')}: ${maxArea}, ${i18next.t('sbgcui.total').toLowerCase()}: ${totalArea}`);
												}
											}

											break;
										}
										case 'destroy':
										case 'broom': {
											const points = action.points;
											const lines = action.lines instanceof Array ? action.lines.length : action.lines; // Раньше сохранялся массив.
											const regions = action.regions instanceof Array ? action.regions.length : action.regions;
											const linesString = `${i18next.t('sbgcui.line' + (lines > 1 ? 's' : ''))}: ${lines}`;
											const regionsString = `${i18next.t('sbgcui.region' + (regions > 1 ? 's' : ''))}: ${regions}`;

											entryDescr.innerText = i18next.t('sbgcui.point' + (points.length > 1 ? 's' : '')) + ': ';
											points.forEach((guid, index) => {
												const link = document.createElement('a');

												link.innerText = guidsTitles[guid] || guid;
												link.setAttribute('data-guid', guid);

												entryDescr.appendChild(link);
												if (index < points.length - 1) { entryDescr.append(', '); }
											});
											if (lines > 0) { entryDescr.append(document.createElement('br'), linesString); }
											if (regions > 0) { entryDescr.append(', ', regionsString.toLowerCase()); }

											break;
										}
									}

									entry.append(entryTime, entryDescr);
									logContent.appendChild(entry);
								});
							})
							.catch(error => { console.log('SBG CUI: ошибка при получении данных точек (логи).', error); });
					});
				}

				function showPointInfo(event) {
					const guid = event.target.dataset.guid;
					if (guid != undefined) { window.showInfo(guid); }
				}

				function toggleTag(event) {
					if (!event.target.dataset.hasOwnProperty('action')) { return; }
					const tag = event.target;
					const action = tag.dataset.action;
					const isHidden = tag.hasAttribute('data-hidden');

					if (isHidden) {
						state.hiddenLogs.delete(action);
						tag.removeAttribute('data-hidden');
					} else {
						state.hiddenLogs.add(action);
						tag.setAttribute('data-hidden', '');
					}

					const stateStore = database.transaction('state', 'readwrite').objectStore('state');
					stateStore.put(state.hiddenLogs, 'hiddenLogs');
				}

				const popup = await fetchHTMLasset('log');
				const closeButton = popup.querySelector('.sbgcui_log-close');
				const datePicker = popup.querySelector('input[type="date"]');
				const logContent = popup.querySelector('.sbgcui_log-content');
				const tagsWrapper = popup.querySelector('.sbgcui_log-tags');
				const jumpToButton = document.querySelector('.info > .sbgcui_jumpToButton');
				const toolbarButton = document.createElement('button');
				let log;

				state.hiddenLogs = state.hiddenLogs || new Set();

				toolbarButton.classList.add('fa', 'fa-solid-table-list');

				[...tagsWrapper.children].forEach(tag => {
					const action = tag.dataset.action;
					if (state.hiddenLogs.has(action)) { tag.setAttribute('data-hidden', ''); }
				});

				toolbarButton.addEventListener('click', showPopup);
				closeButton.addEventListener('click', hidePopup);
				jumpToButton.addEventListener('click', hidePopup);
				tagsWrapper.addEventListener('click', toggleTag);
				logContent.addEventListener('click', showPointInfo);
				datePicker.addEventListener('keydown', event => { event.preventDefault(); });
				datePicker.addEventListener('change', showLog);

				toolbar.addItem(toolbarButton, 6);

				document.body.appendChild(popup);
			} catch (error) {
				console.log(error);
			}
		}


		window.cuiStatus = 'loaded';
	}

})();