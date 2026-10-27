// ==UserScript==
// @name             WME Mapraid Overlays
// @namespace        https://greasyfork.org/en/users/166843-wazedev
// @version          2026.10.26.01
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
// @require          https://update.greasyfork.org/scripts/524747/1841293/GeoKMLer.js
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

    function bootstrap() {
        sdk = unsafeWindow.getWmeSdk({ scriptId: 'wme-mapraid-overlays', scriptName: 'WME Mapraid Overlays' });

        if (sdk.State.isReady())
            init();
        else
            sdk.Events.once({ eventName: 'wme-ready' }).then(init);
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

    //KML colors are aabbggrr - convert to #rrggbb & opacity
    function kmlColorToHex(kmlColor){
        let c = kmlColor.trim();
        let a = parseInt(c.substr(0, 2), 16) / 255;
        let b = c.substr(2, 2);
        let g = c.substr(4, 2);
        let r = c.substr(6, 2);
        return { color: `#${r}${g}${b}`, opacity: a };
    }

    //Reads the inline <Style> from a Placemark since GeoKMLer does not pass styles through
    function getPlacemarkStyle(placemark){
        let style = {
            fillColor: '#000000',
            fillOpacity: 0.3,
            strokeColor: '#000000',
            strokeOpacity: 0.4,
            strokeWidth: 5
        };

        let polyStyle = placemark.getElementsByTagName('PolyStyle')[0];
        if(polyStyle){
            let color = polyStyle.getElementsByTagName('color')[0];
            if(color){
                let c = kmlColorToHex(color.textContent);
                style.fillColor = c.color;
                style.fillOpacity = c.opacity;
            }
        }

        let lineStyle = placemark.getElementsByTagName('LineStyle')[0];
        if(lineStyle){
            let color = lineStyle.getElementsByTagName('color')[0];
            if(color){
                let c = kmlColorToHex(color.textContent);
                style.strokeColor = c.color;
                style.strokeOpacity = c.opacity;
            }
            let width = lineStyle.getElementsByTagName('width')[0];
            if(width)
                style.strokeWidth = parseFloat(width.textContent);
        }

        return style;
    }

    //Drops the elevation value so all coordinates are [lon, lat]
    function stripElevation(coordinates) {
        if (Array.isArray(coordinates[0]))
            return coordinates.map((coord) => stripElevation(coord));
        return coordinates.slice(0, 2);
    }

    function GetFeaturesFromKMLString(strKML) {
        let geoKMLer = new GeoKMLer();
        let kmlDoc = geoKMLer.read(strKML);
        let placemarks = kmlDoc.getElementsByTagName('Placemark');
        let features = [];

        //convert one placemark at a time so each feature gets its own placemark's style
        for(let i = 0; i < placemarks.length; i++){
            let style = getPlacemarkStyle(placemarks[i]);
            let pmFeatures = geoKMLer.handlePlacemark(placemarks[i]);
            for(let j = 0; j < pmFeatures.length; j++){
                let f = pmFeatures[j];
                f.properties = $.extend({}, f.properties, style);
                delete f.properties.Style; //GeoKMLer copies the inline Style text in as a property
                f.geometry.coordinates = stripElevation(f.geometry.coordinates);
                features.push(f);
            }
        }
        return features;
    }

    async function init(){
        loadSettings();

        sdk.Map.addLayer({
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

        sdk.Map.setLayerVisibility({ layerName: layerid, visibility: _settings.layerVisible });
        sdk.LayerSwitcher.addLayerCheckbox({ name: _layerName });
        sdk.LayerSwitcher.setLayerCheckboxChecked({ name: _layerName, isChecked: _settings.layerVisible });
        sdk.Events.on({
            eventName: 'wme-layer-checkbox-toggled',
            eventHandler: function(args){
                if(args.name !== _layerName)
                    return;
                _settings.layerVisible = args.checked;
                sdk.Map.setLayerVisibility({ layerName: layerid, visibility: args.checked });
                saveSettings();
            }
        });

        var $section = $("<div>", {style:"padding:8px 16px", id:"WMEMapraidOverlays"});
        $section.html([
            `<h4 style="margin-bottom:0px;"><b>WME Mapraid Overlays</b></h4>`,
            `<h6 style="margin-top:0px;">${GM_info.script.version}</h6>`,
            `<div><input type="checkbox" id="_cbMROHideCurrentArea" class="wmemroSettingsCheckbox" /><label for="_cbMROHideCurrentArea">Hide fill for current area</label></div>`,
            `<div id="divWMEMROAvailableOverlays"><label>Available overlays</label> <select id="mroOverlaySelect" style="min-width:125px;"></select><i class="fa fa-plus fa-lg" id="mroAddOverlay" aria-hidden="true" style="color:green; cursor:pointer;"></i></div>`,
            '<div id="currOverlays"></div>',
            '<div style="position:absolute; bottom:0;">Generate new mapraid overlays at <a href="http://wazedev.com/mapraidgenerator.html" target="_blank">http://wazedev.com/mapraidgenerator.html</a></div>',
            '</div>'
        ].join(' '));

        sdk.Sidebar.registerScriptTab().then(({ tabLabel, tabPane }) => {
            tabLabel.innerText = 'MRO';
            tabLabel.title = 'WME Mapraid Overlays';
            tabPane.innerHTML = $section.html();
            init2();
        });
    }

    async function getAvailableOverlays(){
        $('#mroOverlaySelect').innerHTML = "";
        let topCountry = sdk.DataModel.Countries.getTopCountry();
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

    function updatePolygons(newKML, mapraidName){
        var _newFeatures = GetFeaturesFromKMLString(newKML);
        let idPrefix = mapraidName.replace(/\s/g, "_");

        for(let i=0; i< _newFeatures.length; i++){
            _newFeatures[i].id = `${idPrefix}_${i}`;
            _newFeatures[i].properties.name = (_newFeatures[i].properties.name || '').replace('<at><openparen>', '').replace('<closeparen>','');
            _newFeatures[i].properties.mapraidName = mapraidName;
        }

        _features = _features.concat(_newFeatures);
        sdk.Map.addFeaturesToLayer({ layerName: layerid, features: _newFeatures });
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

        let $newRaidSection = $('<div>');
        $newRaidSection.html([
            `<fieldset style="border:1px solid silver; padding:8px; border-radius:4px; position:relative;"><legend style="margin-bottom:0px; borer-bottom-style:none; width:auto;"><h4>${mapraidName}</h4></legend>`,
            `<i class="fa fa-minus fa-lg" id="mroRemoveOverlay${mapraidName.replace(/\s/g, "_")}" aria-hidden="true" style="color:red; position:absolute; cursor:pointer; top:10px; right:5px;"></i>`,
            `<div><input type="checkbox" id="_cbMROFillRaidArea${mapraidName.replace(/\s/g, "_")}" ${_settings.EnabledOverlays[mapraidName].fillAreas ? 'checked' : ''} /><label for="_cbMROFillRaidArea${mapraidName.replace(/\s/g, "_")}">Fill raid area</label></div>`,
            `Jump to <select id="${mapraidName.replace(/\s/g, "_")}_Areas">${
            function(){
                let names = $(RaidAreas).find('name');
                let options = "";
                for(let i=0; i<names.length; i++)
                    options += `<option>${$(names[i]).text()}</option>`;
                return options;
            }()
            }</select>`,
            `<i class="fa fa-share" aria-hidden="true" style="color:green; cursor:pointer;" id="JumpTo${mapraidName.replace(/\s/g, "_")}"></i>`,
            '</fieldset>'
        ].join(''));

        $(`#mroOverlaySelect option[value="${mapraidName}"]`).remove(); //remove this option from the list
        $('#currOverlays').append($newRaidSection.html()); //add the mapraid section

        updatePolygons(kml, mapraidName);
    }

    function HandleMoveZoom(){
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

        let mapCenter = sdk.Map.getMapCenter();
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
        sdk.Map.redrawLayer({ layerName: layerid });
    }

    function init2(){
        getAvailableOverlays();

        $.each(_settings.EnabledOverlays, function(k, v){
            if(!_mapraidNameMap[k.replace(/\s/g, "_")])
                _mapraidNameMap[k.replace(/\s/g, "_")] = k;
            BuildEnabledOverlays(k);

        });

        $('#mroAddOverlay').click(async function(){
            if($('#mroOverlaySelect').val() !== null){
                let raid = $('#mroOverlaySelect').val();
                _settings.EnabledOverlays[raid] = {fillAreas: true};

                BuildEnabledOverlays(raid);
                if(!_mapraidNameMap[raid.replace(/\s/g, "_")])
                    _mapraidNameMap[raid.replace(/\s/g, "_")] = raid;

                saveSettings();
            }
        });

        //delegated handlers for the per-raid controls - bound once here so they don't stack as overlays are added
        $('#currOverlays').on('change', '[id^="_cbMROFillRaidArea"]', function(){
            let mapraid = this.id.replace("_cbMROFillRaidArea", "");
            _settings.EnabledOverlays[_mapraidNameMap[mapraid]].fillAreas = isChecked(this.id);
            saveSettings();
            //fill opacity is read from _settings in the layer's styleContext - just redraw
            sdk.Map.redrawLayer({ layerName: layerid });
        });

        $('#currOverlays').on('click', '[id^="mroRemoveOverlay"]', function(){
            let mapraid = this.id.replace("mroRemoveOverlay", "");
            $(this).parent().remove();

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
            sdk.Map.removeFeaturesFromLayer({ layerName: layerid, featureIds: deleteFeatureIds });
            getAvailableOverlays();
        });

        $('#currOverlays').on('click', '[id^="JumpTo"]', function(){
            //jump to the appropriate area - look up the area in the layer features and jump to the centroid.
            let raidArea = this.id.replace("JumpTo", "");
            for(let i=0; i<_features.length; i++){
                if(_features[i].properties.mapraidName.replace(/\s/g, "_") === raidArea){
                    let selectedArea = $(`#${raidArea.replace(/\s/g, "_")}_Areas`).val();
                    if(_features[i].properties.name === selectedArea){
                        let centroid = turf.centerOfMass(_features[i]).geometry.coordinates;
                        sdk.Map.setMapCenter({ lonLat: { lon: centroid[0], lat: centroid[1] }, zoomLevel: sdk.Map.getZoomLevel() });
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

        $('#_cbMROHideCurrentArea').change(function(){
            HandleMoveZoom();
        });

        sdk.Events.on({ eventName: 'wme-map-zoom-changed', eventHandler: HandleMoveZoom });
        sdk.Events.on({ eventName: 'wme-map-move-end', eventHandler: HandleMoveZoom });

        setChecked('_cbMROHideCurrentArea', _settings.HideCurrentArea);
        HandleMoveZoom();
    }

})();
