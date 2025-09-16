const $ = sel => document.querySelector(sel);
const corsProxy = 'https://corsproxy.io/?';

let map, layer, currentGeoJSON = null;
let flexzoneLayer;
let countryList = [], rawCountries = [], brandList = [], availableBrands = [];
let selectedBrandDomain = null;
let allFlexzones = []; 

const nextbikeIcon = L.icon({
    iconUrl: 'pic/marker/marker_nbblue.png',
    iconSize:     [35, 35],
    iconAnchor:   [17, 35],
    popupAnchor:  [0, -35]
});

function initMap(){
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });
    const positron = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
    });
    const baseMaps = {
        "OSM Standard": osm,
        "Positron": positron,
        "Satellit (Esri)": satellite
    };

    map = L.map('map', { layers: [positron] });
    
    const overlays = {};

    layer = L.geoJSON(null, {
        pointToLayer: (feature, latlng) => L.marker(latlng, {icon: nextbikeIcon}),
        onEachFeature: (f, l) => {
            const p = f.properties || {};
            l.bindPopup(`<strong>${p.name||'Station'}</strong><br>`+
                        `Fahrräder: ${p.num_bikes_available ?? '–'}<br>`+
                        `Freie Plätze: ${p.num_docks_available ?? '–'}<br>`+
                        `ID: ${p.station_id}`);
        }
    });
    
    flexzoneLayer = L.geoJSON(null, {
        style: function(feature) {
            const category = feature.properties.category;
            if (category === 'free_return') {
                return { color: '#000000', weight: 1, opacity: 1, fillColor: '#000000', fillOpacity: 0.2 };
            }
            if (category === 'chargeable_return') {
                return { color: '#FFA500', weight: 1, opacity: 1, fillColor: '#FFFF00', fillOpacity: 0.25 };
            }
            return { color: "#0098FF", weight: 2, opacity: 0.8, fillColor: "#0098FF", fillOpacity: 0.2 };
        },
        onEachFeature: (f, l) => {
            if(f.properties.name) l.bindPopup(`<b>${f.properties.name}</b>`);
        }
    });

    layer.addTo(map);
    if ($('#flexzonesCheckbox').checked) {
        flexzoneLayer.addTo(map);
    }
    
    overlays["Stationen"] = layer;
    overlays["Flexzonen"] = flexzoneLayer;
    
    L.control.layers(baseMaps, overlays).addTo(map);
    map.setView([51.1657, 10.4515], 6);
}

function option(value, label){ const o = document.createElement('option'); o.value = value; o.textContent = label; return o; }

function dedupeCountries(countriesIn){
    const mapC = new Map();
    countriesIn.forEach(c => {
        const code = (c.country || c.country_code || '').toUpperCase();
        const name = c.country_name || '';
        if(name && code && !mapC.has(code)) mapC.set(code, { country_code: code, country_name: name });
    });
    let arr = Array.from(mapC.values());
    arr.sort((a,b) => (a.country_name==='Germany' ? -1 : b.country_name==='Germany' ? 1 : (a.country_name||'').localeCompare(b.country_name||'')));
    return arr;
}

function buildBrands(dataCountries) {
    const mapB = new Map();
    dataCountries.forEach(topLevelObject => {
        const geo_country_code = (topLevelObject.country || '').toUpperCase();
        const processEntity = (entity, nameFallback) => {
            const domain = (entity.domain || '').toLowerCase();
            if (!domain) return;
            const name = entity.name || entity.alias || nameFallback || `System ${domain}`;
            if (!mapB.has(domain)) {
                mapB.set(domain, { key: domain, domain, name, country_codes: new Set() });
            }
            if (geo_country_code) mapB.get(domain).country_codes.add(geo_country_code);
        };
        processEntity(topLevelObject);
        if (topLevelObject.cities) {
            topLevelObject.cities.forEach(city => processEntity(city, city.city));
        }
    });
    return Array.from(mapB.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function loadLists(){
    $('#load-status').style.visibility = 'visible';
    $('#load-status').textContent = 'Systeme werden geladen...';
    try{
        const url = `${corsProxy}https://maps.nextbike.net/maps/nextbike-official.json?list_cities=1&bikes=0`;
        const resp = await fetch(url, { cache: 'no-store' });
        if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data || !data.countries) throw new Error("API-Antwort ist ungültig.");

        rawCountries = data.countries;
        countryList = dedupeCountries(rawCountries);
        brandList = buildBrands(rawCountries);

        const cSel = $('#countrySelect'); cSel.innerHTML = '';
        cSel.appendChild(option('', 'Alle Länder'));
        countryList.forEach(c => cSel.appendChild(option(c.country_code, `${c.country_name} (${c.country_code})`)));
        
        updateAvailableBrands();
        $('#load-status').textContent = 'Bitte Auswahl treffen.';
        
        loadAllFlexzones();
    }catch(e){
        $('#load-status').textContent = 'Fehler beim Laden der System-Listen.';
        alert('Fehler beim Laden der System-Listen. Bitte prüfen Sie die Internetverbindung und laden Sie die Seite neu.');
    }
}

async function loadAllFlexzones() {
    try {
        const flexzoneResp = await fetch(`${corsProxy}https://api2.nextbike.net/api/v1.1/getFlexzones.json?api_key=zKeYbPSxKi4Xpf0c`);
        if (!flexzoneResp.ok) {
            const errorText = await flexzoneResp.text();
            console.error(`Flexzonen-API HTTP Fehler: ${flexzoneResp.status} - ${errorText}`);
            throw new Error(`Flexzonen-API HTTP ${flexzoneResp.status}`);
        }
        const flexzoneData = await flexzoneResp.json();
        if (flexzoneData.geojson && flexzoneData.geojson.nodeValue && flexzoneData.geojson.nodeValue.features) {
            allFlexzones = flexzoneData.geojson.nodeValue.features;
        } else if (flexzoneData.geojson && flexzoneData.geojson.features) {
            allFlexzones = flexzoneData.geojson.features;
        } else {
            console.warn("Flexzonen-API-Antwort enthielt kein erwartetes GeoJSON-Format.");
            allFlexzones = [];
        }
    } catch(e) {
        console.error("Fehler beim Laden der Flexzonen-Liste:", e);
        allFlexzones = [];
    }
}

function updateAvailableBrands(){
    const countryCode = ($('#countrySelect').value || '').toUpperCase();
    const brandInput = $('#brandInput');
    
    availableBrands = brandList.filter(b => !countryCode || b.country_codes.has(countryCode));
    
    brandInput.value = '';
    selectedBrandDomain = null;
    brandInput.disabled = false;
    brandInput.placeholder = `${availableBrands.length} Marken/Systeme verfügbar...`;
    
    $('#flexzone-toggle-container').classList.add('hidden');
    refreshCitySelect();
}

async function fetchCitiesForBrand(domain){
    const url = `${corsProxy}https://maps.nextbike.net/maps/nextbike-official.json?domains=${encodeURIComponent(domain)}&bikes=0`;
    const resp = await fetch(url, { cache: 'no-store' });
    if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const out = [];
    data.countries?.forEach(co => {
        const cc = (co.country || co.country_code || '').toUpperCase();
        co.cities?.forEach(city => out.push({ uid: city.uid, name: city.name || city.alias || city.city || `#${city.uid}`, country_code: cc }));
    });
    return [...new Map(out.map(item => [item.uid, item])).values()];
}

async function refreshCitySelect(){
    const brandKey = selectedBrandDomain;
    const citySel = $('#citySelect');
    const countryCode = ($('#countrySelect').value || '').toUpperCase();
    citySel.innerHTML = '<option value="">Alle Städte im System</option>';
    if(!brandKey){ citySel.disabled = true; return; }
    try{
        let items = await fetchCitiesForBrand(brandKey);
        if(countryCode) items = items.filter(c => (c.country_code||'') === countryCode);
        items.sort((a,b)=> (a.name||'').localeCompare(b.name||''));
        items.forEach(c => citySel.appendChild(option(String(c.uid), c.name)));
        citySel.disabled = false;
    }catch(e){ console.error(e); citySel.disabled = true; }
}

function fcFromNextbike(json){
    const features = [];
    json.countries?.forEach(country => {
        country.cities?.forEach(city => {
            const domain = city.domain || '';
            city.places?.forEach(place => {
                if(typeof place.lat !== 'number' || typeof place.lng !== 'number') return;
                features.push({ 
                    type:'Feature', 
                    geometry:{ type:'Point', coordinates:[place.lng, place.lat] }, 
                    properties: {
                        station_id: String(place.number ?? place.uid ?? ''), name: place.name || '', address: place.address || '',
                        capacity: place.bike_racks ?? null, num_bikes_available: place.bikes ?? null, num_docks_available: place.free_racks ?? null,
                        city_uid: city.uid ?? null, city_name: city.name || city.city || city.alias || '', domain, country_name: country.country_name || ''
                    }
                });
            });
        });
    });
    return { type:'FeatureCollection', features };
}

async function loadData(){
    const loadBtn = $('#loadBtn');
    loadBtn.disabled = true;
    $('#loadIcon').innerHTML = '<span class="spinner"></span>';
    $('#load-status').textContent = 'Lade Stationen...';
    
    try{
        const domain = selectedBrandDomain, cityUid = $('#citySelect').value;
        const countryCode = ($('#countrySelect').value || '').toUpperCase();
        let baseUrl = 'https://maps.nextbike.net/maps/nextbike-official.json?bikes=0';
        if(cityUid) baseUrl += `&city=${cityUid}`;
        else if(domain) baseUrl += `&domains=${domain}`;
        else if(countryCode) baseUrl += `&countries=${countryCode}`;

        const resp = await fetch(`${corsProxy}${baseUrl}`, { cache: 'no-store' });
        if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        let fc = fcFromNextbike(data);

        const filterTxt = ($('#quickFilter').value||'').trim().toLowerCase();
        if(filterTxt){
            fc.features = fc.features.filter(f => `${f.properties.name} ${f.properties.address}`.toLowerCase().includes(filterTxt));
        }

        currentGeoJSON = fc;
        const stationCount = fc.features.length;
        const timestamp = new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' });
        const statusDiv = $('#load-status');
        statusDiv.innerHTML = `<strong>${stationCount}</strong> Stationen geladen (${timestamp})`;
        statusDiv.style.visibility = 'visible';

        $('#geojson-output').value = JSON.stringify(fc, null, 2);
        layer.clearLayers().addData(fc);
        
        $('#geojsonBtn').disabled = stationCount === 0;
        $('#zipBtn').disabled = stationCount === 0;

        flexzoneLayer.clearLayers();
        if ($('#flexzonesCheckbox').checked && allFlexzones.length > 0 && selectedBrandDomain) {
            const relevantFeatures = allFlexzones.filter(f => f.properties?.domain === selectedBrandDomain);
            if (relevantFeatures.length > 0) {
                const flexzoneGeoJSON = {
                    type: "FeatureCollection",
                    features: relevantFeatures
                };
                flexzoneLayer.addData(flexzoneGeoJSON);
            }
        }
        
        const combinedLayer = L.featureGroup([...layer.getLayers(), ...flexzoneLayer.getLayers()]);
        if (combinedLayer.getLayers().length > 0) {
            const bounds = combinedLayer.getBounds();
            if (bounds.isValid()) {
                map.fitBounds(bounds, {padding: [50, 50]});
            }
        } else {
             map.setView([51.1657, 10.4515], 6);
        }

    }catch(e){ 
        $('#load-status').textContent = 'Fehler: '+e.message; 
        $('#geojsonBtn').disabled = true;
        $('#zipBtn').disabled = true;
    }
    finally{ 
        loadBtn.disabled = false; 
        $('#loadIcon').innerHTML = '';
    }
}

// NEUE FUNKTION: Generiert den Dateinamen
/**
 * Generiert einen Dateinamen basierend auf dem aktuellen Datum, der Uhrzeit und dem Nextbike city/alias.
 *
 * @param {string} cityAlias - Der 2-stellige Nextbike city/alias Parameter (z.B. "le", "dd").
 * @returns {string} Der generierte Dateiname (ohne Dateiendung).
 */
function generateFilename(cityAlias) {
    if (!cityAlias) {
        console.warn("City Alias ist nicht gesetzt, verwende Fallback für Dateinamen.");
        cityAlias = "nextbike"; // Fallback, falls kein Alias ausgewählt ist
    }
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0'); // Monate sind 0-indiziert
    const day = now.getDate().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().getSeconds().toString().padStart(2, '0');

    // Beispiel: "2023-10-27_14-35-00_le_stations"
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}_${cityAlias}_stations`;
}

// Der Rest deines Codes bleibt unverändert
async function downloadZip() {
    if (!currentGeoJSON) return;

    const zip = new JSZip();
    // Verwende die neue Funktion zur Namensgenerierung
    const baseFilename = generateFilename(selectedBrandDomain);
    
    // Stations-GeoJSON hinzufügen
    zip.file("stations.geojson", JSON.stringify(currentGeoJSON, null, 2));

    const flexzoneGeoJSON = flexzoneLayer.toGeoJSON();
    
    // Überprüfe, ob es Flexzonen-Features gibt
    if (flexzoneGeoJSON.features.length > 0) {
        // Die komplette Flexzonen-Datei hinzufügen
        zip.file("fullsystem_flexzones.geojson", JSON.stringify(flexzoneGeoJSON, null, 2));

        // Jedes Flexzonen-Feature als separate Datei hinzufügen
        flexzoneGeoJSON.features.forEach(feature => {
            const featureName = feature.properties.name;
            // Erstelle einen gültigen Dateinamen: Buchstaben, Zahlen und Unterstriche
            // Ersetze alles, was kein Wort-Zeichen, Zahl oder Unterstriche ist, durch einen Unterstrich.
            const sanitizedName = featureName ? featureName.replace(/[\W_]+/g, "_") : 'unbenannte_flexzone';
            
            // Erstelle ein GeoJSON FeatureCollection-Objekt nur für dieses eine Feature
            const singleFeatureGeoJSON = {
                type: "FeatureCollection",
                features: [feature]
            };

            // Füge die Datei zum ZIP-Archiv hinzu
            zip.file(`${sanitizedName}.geojson`, JSON.stringify(singleFeatureGeoJSON, null, 2));
        });
    }

    const zipBlob = await zip.generateAsync({type:"blob"});
    saveAs(zipBlob, baseFilename + ".zip");
}

function setupSidebars() {
    const wrap = $('#main-wrap');
    const toggleLeftBtn = $('#toggle-left-panel');
    const toggleRightBtn = $('#toggle-right-panel');

    toggleLeftBtn.addEventListener('click', () => {
        wrap.classList.toggle('left-collapsed');
        toggleLeftBtn.textContent = wrap.classList.contains('left-collapsed') ? '▶' : '◀';
        setTimeout(() => map.invalidateSize({debounceMoveend: true}), 350); 
    });

    if (toggleRightBtn) {
        toggleRightBtn.addEventListener('click', () => {
            wrap.classList.toggle('right-collapsed');
            toggleRightBtn.textContent = wrap.classList.contains('right-collapsed') ? '◀' : '▶';
            setTimeout(() => map.invalidateSize({debounceMoveend: true}), 350);
        });
    }
}

// NEUE FUNKTION: Setzt den initialen Zustand der Panels für Mobilgeräte
function setInitialMobilePanelState() {
    const wrap = $('#main-wrap');
    const toggleLeftBtn = $('#toggle-left-panel');
    const toggleRightBtn = $('#toggle-right-panel'); // Stelle sicher, dass dies existiert

    // Prüfe, ob wir uns auf einem mobilen Bildschirm befinden (basierend auf dem CSS Breakpoint)
    // Beachte: 'matches' spiegelt den aktuellen Zustand wider
    if (window.matchMedia('(max-width: 768px)').matches) {
        // Auf Mobilgeräten sollen beide Panels standardmäßig geschlossen sein
        wrap.classList.add('left-collapsed');
        toggleLeftBtn.textContent = '▶'; // Pfeil nach rechts, da Panel geschlossen ist
        
        if (toggleRightBtn) { // Überprüfe, ob der rechte Toggle-Button existiert
            wrap.classList.add('right-collapsed');
            toggleRightBtn.textContent = '◀'; // Pfeil nach links, da Panel geschlossen ist
        }
    } else {
        // Auf größeren Bildschirmen (Desktop/Tablet) sollen sie standardmäßig offen sein
        wrap.classList.remove('left-collapsed');
        toggleLeftBtn.textContent = '◀'; // Pfeil nach links, da Panel offen ist
        
        if (toggleRightBtn) {
            wrap.classList.remove('right-collapsed');
            toggleRightBtn.textContent = '▶'; // Pfeil nach rechts, da Panel offen ist
        }
    }
}


function setupBrandSearch() {
    const brandInput = $('#brandInput');
    const brandResults = $('#brandResults');
    const countrySelect = $('#countrySelect');
    const flexzoneToggle = $('#flexzone-toggle-container');

    function filterAndDisplay() {
        const query = brandInput.value.toLowerCase();
        selectedBrandDomain = null; // Setze Alias zurück, wenn Input geändert wird
        refreshCitySelect();
        flexzoneToggle.classList.add('hidden');
        
        if (!query) {
            brandResults.style.display = 'none';
            return;
        }
        
        let filtered = availableBrands;
        if (countrySelect.value) {
            filtered = filtered.filter(s => s.country_codes.has(countrySelect.value.toUpperCase()));
        }
        
        filtered = filtered.filter(s => s.name.toLowerCase().includes(query) || s.domain.toLowerCase().includes(query));
        
        brandResults.innerHTML = '';
        if (filtered.length > 0) {
            filtered.slice(0, 100).forEach(system => {
                const item = document.createElement('div');
                item.className = 'autocomplete-item';
                item.innerHTML = `${system.name} <small>(${system.domain})</small>`;
                item.addEventListener('click', () => {
                    brandInput.value = system.name;
                    selectedBrandDomain = system.key; // Hier wird der Alias gesetzt!
                    brandResults.style.display = 'none';
                    refreshCitySelect();
                    flexzoneToggle.classList.remove('hidden');
                });
                brandResults.appendChild(item);
            });
            brandResults.style.display = 'block';
        } else {
            brandResults.style.display = 'none';
        }
    }
    
    brandInput.addEventListener('input', filterAndDisplay);
    countrySelect.addEventListener('change', () => {
        brandInput.value = '';
        updateAvailableBrands();
    });

    document.addEventListener('click', (e) => {
        if (!$('.autocomplete-container').contains(e.target)) {
            brandResults.style.display = 'none';
        }
    });
}

window.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadLists();
    setupSidebars();
    setupBrandSearch();
    
    // HIER WIRD DIE NEUE FUNKTION AUFGERUFEN, nachdem die Sidebars eingerichtet sind
    setInitialMobilePanelState(); 
    
    $('#loadBtn').addEventListener('click', loadData);
    
    // ANPASSUNG 1: GeoJSON Download Button
    $('#geojsonBtn').addEventListener('click', () => {
        if(!currentGeoJSON) return; 
        const filename = generateFilename(selectedBrandDomain) + '.geojson';
        const blob = new Blob([$('#geojson-output').value], {type:'application/geo+json;charset=utf-8'}); 
        saveAs(blob, filename); 
    });
    
    // ANPASSUNG 2: Zip Download Button ruft die angepasste Funktion auf
    $('#zipBtn').addEventListener('click', downloadZip);
    
    $('#flexzonesCheckbox').addEventListener('change', (e) => {
        if (e.target.checked) {
            if (!map.hasLayer(flexzoneLayer)) {
                map.addLayer(flexzoneLayer);
            }
        } else {
            if (map.hasLayer(flexzoneLayer)) {
                map.removeLayer(flexzoneLayer);
            }
        }
    });
});
