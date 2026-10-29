// ==UserScript==
// @name             WME Mapraid Overlays
// @namespace        https://greasyfork.org/en/users/166843-wazedev
// @version          2026.10.29.01
// @description      Mapraid overlays
// @author           JustinS83
// @include          https://www.waze.com/editor*
// @include          https://www.waze.com/*/editor*
// @include          https://beta.waze.com/editor*
// @include          https://beta.waze.com/*/editor*
// @exclude          https://www.waze.com/*user/editor*
// @grant            GM_xmlhttpRequest
// @grant            unsafeWindow
// @connect          api.github.com
// @connect          raw.githubusercontent.com
// @require          https://cdn.jsdelivr.net/npm/@turf/turf@7/turf.min.js
// @require          https://greasyfork.org/scripts/524747-geokmler/code/GeoKMLer.js
// @contributionURL  https://github.com/WazeDev/Thank-The-Authors
// ==/UserScript==

/* ecmaVersion 2017 */
/* global $ */
/* global _ */
/* global turf */
/* global GeoKMLer */
/* global unsafeWindow */
/* eslint curly: ["warn", "multi-or-nest"] */

(function() {
    'use strict';

    var _settings;
    var _settingsStoreName = '_wme_mapraid_overlays';
    var _kml;
    var _layerName = 'Mapraid Overlays';
    var layerid = 'wme_mapraid_overlays';
    var _features = []; //GeoJSON features currently on the layer
    var _currAreaIds = []; //ids of the features under the map center
    var countryAbbr;
    var _mapraidNameMap = {};
    var sdk;

    if (unsafeWindow.SDK_INITIALIZED)
        unsafeWindow.SDK_INITIALIZED.then(bootstrap).catch(function(err){ console.error('WME Mapraid Overlays: SDK initialization failed', err); });
    else
        console.error('WME Mapraid Overlays: SDK_INITIALIZED is undefined');

    async function bootstrap() {
        sdk = unsafeWindow.getWmeSdk({ scriptId: 'wme-mapraid-overlays', scriptName: 'WME Mapraid Overlays', mode: 'async' });

        if (await sdk.State.isReady())
            await init();
        else
            sdk.Events.once({ eventName: 'wme-ready' }).then(init).catch(function(err){ console.error('WME Mapraid Overlays: init failed', err); });
    }

    function isChecked(checkboxId) {
        return $('#' + checkboxId).is(':checked');
    }

    function setChecked(checkboxId, checked) {
        $('#' + checkboxId).prop('checked', checked);
    }

    function loadSettings() {
        _settings = $.parseJSON(localStorage.getItem(_settingsStoreName));
        let _defaultsettings = {
            layerVisible: true,
            EnabledOverlays: {},
            HideCurrentArea: false
        };
        _settings = $.extend({}, _defaultsettings, _settings);
    }

    function saveSettings() {
        if (localStorage) {
            var settings = {
                layerVisible: _settings.layerVisible,
                EnabledOverlays: _settings.EnabledOverlays,
                HideCurrentArea: _settings.HideCurrentArea
            };
            localStorage.setItem(_settingsStoreName, JSON.stringify(settings));
        }
    }

    async function getKML(url){
        return await wrapGMXMLHTTP(url); //$.get(url);
    }

    async function wrapGMXMLHTTP(url){
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                url,
                method: 'GET',
                onload(res) {
                    if (res.status < 400) {
                        resolve(res.responseText);
                    } else {
                        console.log("error");
                        console.log(res.status);
                        reject(res);
                    }
                },
                onerror(res) {
                    console.log("Error:");
                    console.log(res.text);
                    reject(res);
                }
            });
        });
    }

    //Used for any feature whose Placemark has no Style GeoKMLer can read
    const DEFAULT_STYLE = { fillColor: '#000000', fillOpacity: 0.3, strokeColor: '#000000', strokeOpacity: 0.4, strokeWidth: 5 };

    function GetFeaturesFromKMLString(strKML) {
        let geoKMLer = new GeoKMLer();
        //dropElevation=true gives [lon, lat] positions; 'openlayers' writes strokeColor, fillColor, etc. onto each feature
        let geoJson = geoKMLer.toGeoJSON(geoKMLer.read(strKML), false, true, 'openlayers', false, false);
        return geoJson.features.map((f) => { f.properties = $.extend({}, DEFAULT_STYLE, f.properties); return f; });
    }

    async function init(){
        loadSettings();

        await sdk.Map.addLayer({
            layerName: layerid,
            styleRules: [
                {
                    predicate: () => true,
                    style: {
                        strokeColor: '${getStrokeColor}',
                        strokeOpacity: '${getStrokeOpacity}',
                        strokeWidth: '${getStrokeWidth}',
                        fillColor: '${getFillColor}',
                        fillOpacity: '${getFillOpacity}',
                        label: '${getLabel}',
                        labelOutlineColor: '#000000',
                        labelOutlineWidth: 4,
                        labelAlign: 'cm',
                        fontSize: '16px',
                        fontColor: '${getFillColor}'
                    }
                }
            ],
            styleContext: {
                getStrokeColor: ({ feature }) => feature.properties.strokeColor,
                getStrokeOpacity: ({ feature }) => feature.properties.strokeOpacity,
                getStrokeWidth: ({ feature }) => feature.properties.strokeWidth,
                getFillColor: ({ feature }) => feature.properties.fillColor,
                getFillOpacity: ({ feature }) => {
                    let overlay = _settings.EnabledOverlays[feature.properties.mapraidName];
                    if(!overlay || !overlay.fillAreas)
                        return 0;
                    if(_settings.HideCurrentArea && _currAreaIds.includes(feature.id))
                        return 0;
                    return feature.properties.fillOpacity;
                },
                getLabel: ({ feature }) => feature.properties.name || ''
            },
            zIndexing: true
        });

        await sdk.Map.setLayerVisibility({ layerName: layerid, visibility: _settings.layerVisible });
        await sdk.LayerSwitcher.addLayerCheckbox({ name: _layerName });
        await sdk.LayerSwitcher.setLayerCheckboxChecked({ name: _layerName, isChecked: _settings.layerVisible });
        sdk.Events.on({
            eventName: 'wme-layer-checkbox-toggled',
            eventHandler: async function(args){
                if(args.name !== _layerName)
                    return;
                _settings.layerVisible = args.checked;
                await sdk.Map.setLayerVisibility({ layerName: layerid, visibility: args.checked });
                saveSettings();
            }
        });

        injectStyles();
        let panelHTML = [
            '<div class="mro-header"><span class="mro-title">Mapraid Overlays</span><span class="mro-version">v' + GM_info.script.version + '</span></div>',
            '<div class="mro-card">',
            '  <div class="mro-card-title">Display</div>',
            '  <div class="mro-row"><span class="mro-label">Hide fill for current area</span>' + mroToggle('_cbMROHideCurrentArea', false, 'wmemroSettingsCheckbox') + '</div>',
            '</div>',
            '<div class="mro-card" id="divWMEMROAvailableOverlays">',
            '  <div class="mro-card-title">Overlays</div>',
            '  <div class="mro-row"><span class="mro-label">Available</span><select id="mroOverlaySelect" class="mro-select"></select><button type="button" class="mro-icon-btn mro-add" id="mroAddOverlay" title="Add overlay"><i class="fa fa-plus" aria-hidden="true"></i></button></div>',
            '</div>',
            '<div id="currOverlays"></div>',
            '<div class="mro-footer">Generate new mapraid overlays at <a href="http://wazedev.com/mapraidgenerator.html" target="_blank">wazedev.com/mapraidgenerator.html</a></div>',
        ].join('');

        sdk.Sidebar.registerScriptTab().then(async ({ tabLabel, tabPane }) => {
            tabLabel.innerText = 'MRO';
            tabLabel.title = 'WME Mapraid Overlays';
            tabPane.classList.add('wme-mapraid-panel');
            tabPane.innerHTML = panelHTML;
            await init2();
        }).catch(err => console.error('WME Mapraid Overlays: sidebar setup failed', err));
    }

    //Scoped styles for the sidebar panel - mirrors the card/toggle look used by WME Cities Overlay
    function injectStyles(){
        if(document.getElementById('wme-mapraid-styles'))
            return;
        let style = document.createElement('style');
        style.id = 'wme-mapraid-styles';
        style.textContent = `
.wme-mapraid-panel { font-family: inherit; font-size: 12px; line-height: 1.4; color: var(--content_default); padding: 4px 12px 8px; box-sizing: border-box; }
.wme-mapraid-panel .mro-header { background: linear-gradient(135deg, #0066cc, #0052a3); padding: 8px 10px; border-radius: 8px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; color: white; }
.wme-mapraid-panel .mro-title { font-size: 13px; font-weight: 700; letter-spacing: 0.3px; }
.wme-mapraid-panel .mro-version { font-size: 10px; opacity: 0.8; }
.wme-mapraid-panel .mro-card { background: var(--background_default); border: 1px solid var(--hairline); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
.wme-mapraid-panel .mro-card-title { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: var(--primary); margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--hairline); }
.wme-mapraid-panel .mro-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.wme-mapraid-panel .mro-row:last-child { margin-bottom: 0; }
.wme-mapraid-panel .mro-label { font-size: 11px; font-weight: 500; color: var(--content_p1); flex: 1; }
.wme-mapraid-panel .mro-toggle { position: relative; display: inline-block; width: 32px; height: 16px; cursor: pointer; flex-shrink: 0; }
.wme-mapraid-panel .mro-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.wme-mapraid-panel .mro-toggle-slider { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: var(--hairline); border-radius: 8px; transition: background 0.25s; }
.wme-mapraid-panel .mro-toggle-slider::before { position: absolute; content: ''; height: 12px; width: 12px; left: 2px; bottom: 2px; background: white; border-radius: 50%; transition: transform 0.25s; box-shadow: 0 1px 2px rgba(0,0,0,0.3); }
.wme-mapraid-panel .mro-toggle input:checked + .mro-toggle-slider { background: var(--primary, #4a90e2); }
.wme-mapraid-panel .mro-toggle input:checked + .mro-toggle-slider::before { transform: translateX(16px); }
.wme-mapraid-panel .mro-select { flex: 1; min-width: 0; padding: 2px 5px; border: 1px solid var(--hairline); border-radius: 4px; font-size: 11px; background: var(--surface_default); color: var(--content_default); }
.wme-mapraid-panel .mro-icon-btn { width: 22px; height: 22px; padding: 0; border: 1px solid var(--hairline); border-radius: 4px; background: var(--background_default); color: var(--content_p1); cursor: pointer; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; transition: all 0.15s; }
.wme-mapraid-panel .mro-icon-btn:hover { background: var(--primary, #4a90e2); color: white; border-color: var(--primary, #4a90e2); }
.wme-mapraid-panel .mro-icon-btn.mro-add { color: #00bd00; }
.wme-mapraid-panel .mro-icon-btn.mro-remove { color: #e53935; }
.wme-mapraid-panel .mro-icon-btn.mro-remove:hover { background: #e53935; border-color: #e53935; color: white; }
.wme-mapraid-panel .mro-footer { font-size: 10px; color: var(--content_p2); margin-top: 8px; }
.wme-mapraid-panel .mro-footer a { color: var(--primary, #4a90e2); }
        `;
        document.head.appendChild(style);
    }

    //Builds a toggle switch (checkbox + slider) - the checkbox keeps its id/class so existing handlers still work
    function mroToggle(id, checked, cls){
        return `<label class="mro-toggle"><input type="checkbox" id="${id}" class="${cls || ''}"${checked ? ' checked' : ''} /><span class="mro-toggle-slider"></span></label>`;
    }

    async function getAvailableOverlays(){
        $('#mroOverlaySelect').innerHTML = "";
        let topCountry = await sdk.DataModel.Countries.getTopCountry();
        if(!topCountry)
            return;
        countryAbbr = topCountry.abbr;
        let KMLinfoArr = $.parseJSON(await wrapGMXMLHTTP(`https://api.github.com/repos/WazeDev/WME-Mapraid-Overlays/contents/KMLs/${countryAbbr}`));
        let overlaysSelect = $('<div>');

        overlaysSelect.html([
            '<option selected disabled hidden style="display: none" value=""></option>',
            `${KMLinfoArr.map(function(obj){
                let fileName = obj.name.replace(".kml", "");
                if(!_settings.EnabledOverlays[fileName])
                    return `<option value="${fileName}">${fileName}</option>`;
            })}`,
            '</select>'
        ].join(''));
        $('#mroOverlaySelect')[0].innerHTML = overlaysSelect.html();
    }

    async function updatePolygons(newKML, mapraidName){
        var _newFeatures = GetFeaturesFromKMLString(newKML);
        let idPrefix = mapraidName.replace(/\s/g, "_");

        for(let i=0; i< _newFeatures.length; i++){
            _newFeatures[i].id = `${idPrefix}_${i}`;
            _newFeatures[i].properties.name = (_newFeatures[i].properties.name || '').replace('<at><openparen>', '').replace('<closeparen>','');
            _newFeatures[i].properties.mapraidName = mapraidName;
        }

        _features = _features.concat(_newFeatures);
        await sdk.Map.addFeaturesToLayer({ layerName: layerid, features: _newFeatures });
    }

    function hex_is_light(color) {
        const hex = color.replace('#', '');
        const c_r = parseInt(hex.substr(0, 2), 16);
        const c_g = parseInt(hex.substr(2, 2), 16);
        const c_b = parseInt(hex.substr(4, 2), 16);
        const brightness = ((c_r * 299) + (c_g * 587) + (c_b * 114)) / 1000;
        return brightness > 70;
    }

    async function BuildEnabledOverlays(mapraidName){
        let kml;
        try{
            kml = await getKML(encodeURI(`https://raw.githubusercontent.com/WazeDev/WME-Mapraid-Overlays/master/KMLs/${countryAbbr}/${mapraidName}.kml`));
        }
        catch(err){
            console.error(err);
            return;
        }
        let kmlObj = $($.parseXML(kml));
        let RaidAreas = $(kmlObj).find('Placemark');

        let safeId = mapraidName.replace(/\s/g, "_");
        let $newRaidSection = $('<div>');
        $newRaidSection.html([
            `<div class="mro-card mro-raid">`,
            `  <div class="mro-card-title"><span>${mapraidName}</span><button type="button" class="mro-icon-btn mro-remove" id="mroRemoveOverlay${safeId}" title="Remove overlay"><i class="fa fa-minus" aria-hidden="true"></i></button></div>`,
            `  <div class="mro-row"><span class="mro-label">Fill raid area</span>${mroToggle(`_cbMROFillRaidArea${safeId}`, _settings.EnabledOverlays[mapraidName].fillAreas)}</div>`,
            `  <div class="mro-row"><span class="mro-label">Jump to</span><select id="${safeId}_Areas" class="mro-select">${
            function(){
                let names = $(RaidAreas).find('name');
                let options = "";
                for(let i=0; i<names.length; i++)
                    options += `<option>${$(names[i]).text()}</option>`;
                return options;
            }()
            }</select><button type="button" class="mro-icon-btn" id="JumpTo${safeId}" title="Jump to area"><i class="fa fa-share" aria-hidden="true"></i></button></div>`,
            `</div>`
        ].join('\n'));

        $(`#mroOverlaySelect option[value="${mapraidName}"]`).remove(); //remove this option from the list
        $('#currOverlays').append($newRaidSection.html()); //add the mapraid section

        await updatePolygons(kml, mapraidName);
    }

    async function HandleMoveZoom(){
        //display the current MR area in the title bar
        //hide the current MR area fill (if setting is enabled)

        if($('#mrodivCurrMapraidArea').length === 0){
            var $section = $("<div>");
            $section.html([
                '<div id="mrodivCurrMapraidArea" style="font-size: 16px; font-weight:bold; margin-left:10px; float:left;">',
                '<span id="mroCurrAreaTopbar"></span>',
                '</div>'
            ].join(' '));

            $('.topbar').append($section.html());
        }

        let mapCenter = await sdk.Map.getMapCenter();
        let center = turf.point([mapCenter.lon, mapCenter.lat]);
        $('#mroCurrAreaTopbar').text("");
        _currAreaIds = [];
        for (var i=0;i<_features.length;i++){
            var feature = _features[i];
            if(turf.booleanPointInPolygon(center, feature)){
                $('#mroCurrAreaTopbar').text(feature.properties.name);
                $('#mroCurrAreaTopbar').css('color', feature.properties.fillColor);

                if(!hex_is_light(feature.properties.fillColor))
                    $('#mroCurrAreaTopbar').css('text-shadow', '-1px 0 #efefef, 0 1px #efefef, 1px 0 #efefef, 0 -1px #efefef');
                else
                    $('#mroCurrAreaTopbar').css('text-shadow', '-1px 0 black, 0 1px black, 1px 0 black, 0 -1px black');

                _currAreaIds.push(feature.id); //fill is hidden in the styleContext when HideCurrentArea is on
            }
        }
        await sdk.Map.redrawLayer({ layerName: layerid });
    }

    async function init2(){
        await getAvailableOverlays();

        for(const k of Object.keys(_settings.EnabledOverlays)){
            if(!_mapraidNameMap[k.replace(/\s/g, "_")])
                _mapraidNameMap[k.replace(/\s/g, "_")] = k;
            await BuildEnabledOverlays(k);
        }

        $('#mroAddOverlay').click(async function(){
            if($('#mroOverlaySelect').val() !== null){
                let raid = $('#mroOverlaySelect').val();
                _settings.EnabledOverlays[raid] = {fillAreas: true};

                await BuildEnabledOverlays(raid);
                if(!_mapraidNameMap[raid.replace(/\s/g, "_")])
                    _mapraidNameMap[raid.replace(/\s/g, "_")] = raid;

                saveSettings();
            }
        });

        //delegated handlers for the per-raid controls - bound once here so they don't stack as overlays are added
        $('#currOverlays').on('change', '[id^="_cbMROFillRaidArea"]', async function(){
            let mapraid = this.id.replace("_cbMROFillRaidArea", "");
            _settings.EnabledOverlays[_mapraidNameMap[mapraid]].fillAreas = isChecked(this.id);
            saveSettings();
            //fill opacity is read from _settings in the layer's styleContext - just redraw
            await sdk.Map.redrawLayer({ layerName: layerid });
        });

        $('#currOverlays').on('click', '[id^="mroRemoveOverlay"]', async function(){
            let mapraid = this.id.replace("mroRemoveOverlay", "");
            $(this).closest('.mro-raid').remove();

            delete _settings.EnabledOverlays[_mapraidNameMap[mapraid]];
            saveSettings();

            let deleteFeatureIds = [];
            let keepFeatures = [];
            for(let i=0; i < _features.length; i++){ //delete the features from the layer
                if(_features[i].properties.mapraidName === _mapraidNameMap[mapraid])
                    deleteFeatureIds.push(_features[i].id);
                else
                    keepFeatures.push(_features[i]);
            }
            _features = keepFeatures;
            await sdk.Map.removeFeaturesFromLayer({ layerName: layerid, featureIds: deleteFeatureIds });
            await getAvailableOverlays();
        });

        $('#currOverlays').on('click', '[id^="JumpTo"]', async function(){
            //jump to the appropriate area - look up the area in the layer features and jump to the centroid.
            let raidArea = this.id.replace("JumpTo", "");
            for(let i=0; i<_features.length; i++){
                if(_features[i].properties.mapraidName.replace(/\s/g, "_") === raidArea){
                    let selectedArea = $(`#${raidArea.replace(/\s/g, "_")}_Areas`).val();
                    if(_features[i].properties.name === selectedArea){
                        let centroid = turf.centerOfMass(_features[i]).geometry.coordinates;
                        let zoomLevel = await sdk.Map.getZoomLevel();
                        await sdk.Map.setMapCenter({ lonLat: { lon: centroid[0], lat: centroid[1] }, zoomLevel });
                        break;
                    }
                }
            }
        });

        $('.wmemroSettingsCheckbox').change(function(){
            var settingName = $(this)[0].id.substr(6);
            _settings[settingName] = this.checked;
            saveSettings();
        });

        $('#_cbMROHideCurrentArea').change(async function(){
            await HandleMoveZoom();
        });

        sdk.Events.on({ eventName: 'wme-map-zoom-changed', eventHandler: () => HandleMoveZoom().catch(err => console.error('WME Mapraid Overlays: HandleMoveZoom failed', err)) });
        sdk.Events.on({ eventName: 'wme-map-move-end', eventHandler: () => HandleMoveZoom().catch(err => console.error('WME Mapraid Overlays: HandleMoveZoom failed', err)) });

        setChecked('_cbMROHideCurrentArea', _settings.HideCurrentArea);
        await HandleMoveZoom();
    }

})();
