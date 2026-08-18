(() => {
  "use strict";

  const config = window.APP_CONFIG || {};
  const DB_NAME = "descarteInadequadoDB";
  const DB_VERSION = 1;
  const STORE_NAME = "pendingRecords";
  const DRAFT_KEY = "descarteInadequadoDraftV2";
  const CONSENT_TEXT = "Li e concordo";

  const form = document.getElementById("wasteForm");
  const pointCodeInput = document.getElementById("pointCode");
  const surveyDateInput = document.getElementById("surveyDate");
  const municipalityInput = document.getElementById("municipality");
  const groupingInput = document.getElementById("grouping");
  const latitudeInput = document.getElementById("latitude");
  const longitudeInput = document.getElementById("longitude");
  const accuracyInput = document.getElementById("accuracy");
  const geometryTypeInput = document.getElementById("geometryType");
  const geometryGeoJSONInput = document.getElementById("geometryGeoJSON");
  const geometryStatus = document.getElementById("geometryStatus");
  const captureLocationButton = document.getElementById("captureLocation");
  const pointModeButton = document.getElementById("pointMode");
  const polygonModeButton = document.getElementById("polygonMode");
  const clearGeometryButton = document.getElementById("clearGeometry");
  const photoInput = document.getElementById("photos");
  const photoPreview = document.getElementById("photoPreview");
  const submitButton = document.getElementById("submitButton");
  const formMessage = document.getElementById("formMessage");
  const connectionStatus = document.getElementById("connectionStatus");
  const queueStatus = document.getElementById("queueStatus");
  const syncButton = document.getElementById("syncButton");
  const exportButton = document.getElementById("exportButton");
  const peopleEvidenceBox = document.getElementById("peopleEvidenceBox");
  const peopleEvidenceOtherWrap = document.getElementById("peopleEvidenceOtherWrap");
  const peopleEvidenceOther = document.getElementById("peopleEvidenceOther");

  let map;
  let marker = null;
  let polygonLayer = null;
  let polygonDrawer = null;
  let geometryMode = "Point";
  let locationAccuracy = null;
  let municipalityGeoJSON = null;
  let photoPayloads = [];

  function showMessage(text, type = "success") {
    formMessage.textContent = text;
    formMessage.className = `form-message ${type}`;
    formMessage.hidden = false;
    formMessage.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function hideMessage() {
    formMessage.hidden = true;
    formMessage.textContent = "";
    formMessage.className = "form-message";
  }

  function generatePointCode() {
    const d = new Date();
    const ymd = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("");
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    pointCodeInput.value = `ADI-${ymd}-${suffix}`;
    saveDraft();
  }

  function selectedRadio(name) {
    return form.querySelector(`input[name="${name}"]:checked`)?.value || "";
  }

  function selectedCheckboxes(name) {
    return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
  }

  function setGeometryMode(mode) {
    geometryMode = mode;
    pointModeButton.classList.toggle("active", mode === "Point");
    polygonModeButton.classList.toggle("active", mode === "Polygon");
    if (mode === "Polygon") {
      geometryStatus.textContent = polygonLayer ? "Polígono registrado. Você pode limpá-lo e redesenhar." : "Clique no mapa para desenhar os vértices do polígono.";
    } else {
      geometryStatus.textContent = marker ? "Ponto registrado. Arraste o marcador para ajustar." : "Toque no mapa ou capture sua localização.";
    }
  }

  function clearGeometry({ keepView = true } = {}) {
    if (marker) {
      map.removeLayer(marker);
      marker = null;
    }
    if (polygonLayer) {
      map.removeLayer(polygonLayer);
      polygonLayer = null;
    }
    geometryGeoJSONInput.value = "";
    latitudeInput.value = "";
    longitudeInput.value = "";
    accuracyInput.value = "";
    locationAccuracy = null;
    municipalityInput.value = "";
    groupingInput.value = "";
    geometryTypeInput.value = geometryMode;
    setGeometryMode(geometryMode);
    if (!keepView) map.setView(config.MAP_CENTER || [-5.05, -45.2], config.MAP_ZOOM || 6);
    saveDraft();
  }

  function makePointMarker(lat, lon) {
    if (polygonLayer) {
      map.removeLayer(polygonLayer);
      polygonLayer = null;
    }
    if (marker) map.removeLayer(marker);
    marker = L.marker([lat, lon], { draggable: true }).addTo(map);
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      updatePointGeometry(p.lat, p.lng, null, false);
    });
  }

  function updatePointGeometry(lat, lon, accuracy = null, recenter = true) {
    lat = Number(lat);
    lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    setGeometryMode("Point");
    geometryTypeInput.value = "Point";
    locationAccuracy = Number.isFinite(Number(accuracy)) ? Number(accuracy) : null;
    makePointMarker(lat, lon);
    latitudeInput.value = lat.toFixed(7);
    longitudeInput.value = lon.toFixed(7);
    accuracyInput.value = locationAccuracy ? `${Math.round(locationAccuracy)} m` : "";
    geometryGeoJSONInput.value = JSON.stringify({ type: "Point", coordinates: [lon, lat] });
    geometryStatus.textContent = locationAccuracy ? `Ponto registrado · precisão aproximada de ${Math.round(locationAccuracy)} m.` : "Ponto registrado. Arraste o marcador para ajustar.";
    if (recenter) map.setView([lat, lon], Math.max(map.getZoom(), 16));
    identifyMunicipality(lon, lat);
    saveDraft();
  }

  function polygonCentroidLatLng(layer) {
    const latlngs = layer.getLatLngs()?.[0] || [];
    if (latlngs.length < 3) return layer.getBounds().getCenter();
    let area2 = 0, cx = 0, cy = 0;
    for (let i = 0; i < latlngs.length; i++) {
      const a = latlngs[i];
      const b = latlngs[(i + 1) % latlngs.length];
      const cross = a.lng * b.lat - b.lng * a.lat;
      area2 += cross;
      cx += (a.lng + b.lng) * cross;
      cy += (a.lat + b.lat) * cross;
    }
    if (Math.abs(area2) < 1e-12) return layer.getBounds().getCenter();
    return L.latLng(cy / (3 * area2), cx / (3 * area2));
  }

  function updatePolygonGeometry(layer, recenter = true) {
    setGeometryMode("Polygon");
    if (marker) {
      map.removeLayer(marker);
      marker = null;
    }
    if (polygonLayer && polygonLayer !== layer) map.removeLayer(polygonLayer);
    polygonLayer = layer;
    if (!map.hasLayer(polygonLayer)) polygonLayer.addTo(map);
    geometryTypeInput.value = "Polygon";
    const geometry = polygonLayer.toGeoJSON().geometry;
    geometryGeoJSONInput.value = JSON.stringify(geometry);
    const center = polygonCentroidLatLng(polygonLayer);
    latitudeInput.value = center.lat.toFixed(7);
    longitudeInput.value = center.lng.toFixed(7);
    accuracyInput.value = "";
    locationAccuracy = null;
    const vertices = polygonLayer.getLatLngs()?.[0]?.length || 0;
    geometryStatus.textContent = `Polígono registrado com ${vertices} vértices.`;
    if (recenter) map.fitBounds(polygonLayer.getBounds().pad(0.15), { maxZoom: 16 });
    identifyMunicipality(center.lng, center.lat);
    saveDraft();
  }

  function captureLocation() {
    hideMessage();
    if (!navigator.geolocation) {
      showMessage("Este navegador não oferece suporte à geolocalização.", "error");
      return;
    }
    captureLocationButton.disabled = true;
    captureLocationButton.textContent = "Localizando…";
    navigator.geolocation.getCurrentPosition(
      pos => {
        updatePointGeometry(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, true);
        captureLocationButton.disabled = false;
        captureLocationButton.textContent = "📍 Capturar minha localização";
      },
      err => {
        captureLocationButton.disabled = false;
        captureLocationButton.textContent = "📍 Capturar minha localização";
        const msg = err.code === 1 ? "Permissão de localização negada." : "Não foi possível obter a localização do aparelho.";
        showMessage(`${msg} Você ainda pode marcar o ponto diretamente no mapa.`, "warning");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  }

  function initializeMap() {
    map = L.map("formMap", { preferCanvas: true }).setView(config.MAP_CENTER || [-5.05, -45.2], config.MAP_ZOOM || 6);

    const streetBase = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    });
    const satelliteBase = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
    });
    streetBase.addTo(map);

    const BasemapSwitch = L.Control.extend({
      options: { position: "topright" },
      onAdd() {
        const container = L.DomUtil.create("div", "basemap-switch leaflet-bar");
        const streetButton = L.DomUtil.create("button", "active", container);
        const satelliteButton = L.DomUtil.create("button", "", container);
        streetButton.type = satelliteButton.type = "button";
        streetButton.textContent = "Mapa";
        satelliteButton.textContent = "Satélite";
        streetButton.title = "Exibir mapa de ruas";
        satelliteButton.title = "Exibir imagem de satélite";
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        const activate = mode => {
          if (mode === "satellite") {
            if (map.hasLayer(streetBase)) map.removeLayer(streetBase);
            if (!map.hasLayer(satelliteBase)) satelliteBase.addTo(map);
            satelliteButton.classList.add("active");
            streetButton.classList.remove("active");
          } else {
            if (map.hasLayer(satelliteBase)) map.removeLayer(satelliteBase);
            if (!map.hasLayer(streetBase)) streetBase.addTo(map);
            streetButton.classList.add("active");
            satelliteButton.classList.remove("active");
          }
        };

        streetButton.addEventListener("click", () => activate("street"));
        satelliteButton.addEventListener("click", () => activate("satellite"));
        return container;
      }
    });
    map.addControl(new BasemapSwitch());
    L.control.scale({ imperial: false }).addTo(map);

    polygonDrawer = new L.Draw.Polygon(map, {
      allowIntersection: false,
      showArea: true,
      shapeOptions: { color: "#b3261e", weight: 3, fillColor: "#e05650", fillOpacity: 0.23 }
    });

    map.on(L.Draw.Event.CREATED, event => updatePolygonGeometry(event.layer, true));
    map.on("click", event => {
      if (geometryMode === "Point" && !(polygonDrawer && polygonDrawer._enabled)) {
        updatePointGeometry(event.latlng.lat, event.latlng.lng, null, false);
      }
    });
  }

  async function loadMunicipalityData() {
    try {
      const r = await fetch("../data/regionalizacao_municipios.geojson");
      if (!r.ok) throw new Error("Falha ao carregar a regionalização municipal.");
      municipalityGeoJSON = await r.json();
    } catch (error) {
      console.warn(error);
    }
  }

  function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersects = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / ((yj - yi) || Number.EPSILON) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function pointInPolygonCoordinates(lon, lat, rings) {
    if (!rings?.length || !pointInRing(lon, lat, rings[0])) return false;
    for (let i = 1; i < rings.length; i++) if (pointInRing(lon, lat, rings[i])) return false;
    return true;
  }

  function geometryContainsPoint(geometry, lon, lat) {
    if (!geometry) return false;
    if (geometry.type === "Polygon") return pointInPolygonCoordinates(lon, lat, geometry.coordinates);
    if (geometry.type === "MultiPolygon") return geometry.coordinates.some(poly => pointInPolygonCoordinates(lon, lat, poly));
    return false;
  }

  function identifyMunicipality(lon, lat) {
    if (!municipalityGeoJSON?.features) return;
    const match = municipalityGeoJSON.features.find(f => geometryContainsPoint(f.geometry, lon, lat));
    if (match) {
      municipalityInput.value = match.properties?.municipio || municipalityInput.value;
      const rawGroup = match.properties?.agrupamento || "";
      groupingInput.value = rawGroup === "Titara" ? "Rosário (Titara)" : rawGroup === "Nazária (PI)" ? "Nazária / Altos (PI)" : rawGroup;
    } else {
      groupingInput.value = "Fora da base municipal do projeto";
    }
  }

  function handleConditionalFields() {
    const people = selectedRadio("peoplePresent");
    peopleEvidenceBox.hidden = people !== "Sim";
    if (people !== "Sim") {
      form.querySelectorAll('input[name="peopleEvidence"]').forEach(el => { el.checked = false; });
      peopleEvidenceOther.value = "";
      peopleEvidenceOtherWrap.hidden = true;
    }
    const otherEvidence = form.querySelector('input[name="peopleEvidence"][value="Outro"]')?.checked;
    peopleEvidenceOtherWrap.hidden = !otherEvidence;

    const none = document.getElementById("noNaturalResources");
    if (none?.checked) {
      form.querySelectorAll('input[name="naturalResources"]').forEach(el => {
        if (el !== none) el.checked = false;
      });
    }
  }

  function validateCustomFields() {
    if (!geometryGeoJSONInput.value) {
      showMessage("Registre a localização como ponto ou polígono antes de enviar.", "error");
      return false;
    }
    const natural = selectedCheckboxes("naturalResources");
    if (!natural.length) {
      showMessage("Informe se há recursos naturais próximos. Caso nenhum tenha sido identificado, marque “Nenhum identificado”.", "error");
      return false;
    }
    if (selectedRadio("peoplePresent") === "Sim" && !selectedCheckboxes("peopleEvidence").length) {
      showMessage("Informe como foi identificada a existência de pessoas na área.", "error");
      return false;
    }
    return true;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function compressImage(file) {
    const raw = await fileToDataUrl(file);
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Não foi possível ler uma das fotografias."));
      image.src = raw;
    });
    const maxSide = config.MAX_IMAGE_SIDE || 1280;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", config.JPEG_QUALITY || 0.76);
  }

  function renderPhotoPreview() {
    photoPreview.innerHTML = "";
    photoPreview.hidden = photoPayloads.length === 0;
    photoPayloads.forEach((photo, index) => {
      const card = document.createElement("div");
      card.className = "photo-card";
      const img = document.createElement("img");
      img.src = photo.dataUrl;
      img.alt = `Pré-visualização da fotografia ${index + 1}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "photo-remove";
      remove.setAttribute("aria-label", `Remover fotografia ${index + 1}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        photoPayloads.splice(index, 1);
        renderPhotoPreview();
      });
      card.append(img, remove);
      photoPreview.appendChild(card);
    });
  }

  async function handlePhotos(files) {
    const maxPhotos = config.MAX_PHOTOS || 4;
    const available = Math.max(0, maxPhotos - photoPayloads.length);
    if (!available) {
      showMessage(`O limite de ${maxPhotos} fotografias já foi atingido.`, "warning");
      photoInput.value = "";
      return;
    }
    const list = [...files].slice(0, available);
    if (files.length > available) showMessage(`O formulário aceita até ${maxPhotos} fotografias. Foram adicionadas somente as que cabiam no limite.`, "warning");
    photoInput.disabled = true;
    try {
      for (const file of list) {
        if (!file.type.startsWith("image/")) continue;
        const dataUrl = await compressImage(file);
        photoPayloads.push({ dataUrl, originalName: file.name || "fotografia.jpg" });
      }
      renderPhotoPreview();
    } catch (error) {
      showMessage(error.message, "error");
      renderPhotoPreview();
    } finally {
      photoInput.disabled = false;
      photoInput.value = "";
    }
  }

  function makeLocalId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `descarte-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getPayload() {
    const evidence = selectedCheckboxes("peopleEvidence");
    if (evidence.includes("Outro") && peopleEvidenceOther.value.trim()) {
      evidence.push(`Outro: ${peopleEvidenceOther.value.trim()}`);
    }
    return {
      localId: makeLocalId(),
      timestamp: new Date().toISOString(),
      pointCode: pointCodeInput.value.trim(),
      pointName: document.getElementById("pointName").value.trim(),
      surveyDate: surveyDateInput.value,
      municipality: municipalityInput.value.trim(),
      grouping: groupingInput.value.trim(),
      registrar: document.getElementById("registrar").value.trim(),
      nearTo: selectedRadio("nearTo"),
      distanceKm: document.getElementById("distanceKm").value,
      peoplePresent: selectedRadio("peoplePresent"),
      peopleEvidence: evidence,
      naturalResources: selectedCheckboxes("naturalResources"),
      cropsNearby: selectedRadio("cropsNearby"),
      enterprisesNearby: selectedRadio("enterprisesNearby"),
      pointStatus: document.getElementById("pointStatus").value,
      accessType: document.getElementById("accessType").value,
      wasteTypes: selectedCheckboxes("wasteTypes"),
      observations: document.getElementById("observations").value.trim(),
      geometryType: geometryTypeInput.value,
      latitude: latitudeInput.value,
      longitude: longitudeInput.value,
      accuracy: locationAccuracy,
      geometryGeoJSON: geometryGeoJSONInput.value,
      photos: photoPayloads,
      truthConsent: document.getElementById("truthConsent").checked ? CONSENT_TEXT : "",
      useConsent: document.getElementById("useConsent").checked ? CONSENT_TEXT : ""
    };
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "localId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function savePending(record) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAllPending() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function deletePending(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function updateQueueStatus() {
    try {
      const records = await getAllPending();
      queueStatus.textContent = records.length ? `${records.length} registro(s) aguardando sincronização.` : "Nenhum registro pendente.";
      exportButton.disabled = records.length === 0;
    } catch {
      queueStatus.textContent = "Não foi possível consultar os registros locais.";
    }
  }

  function updateConnectionStatus() {
    connectionStatus.textContent = navigator.onLine ? "🟢 Conectado à internet" : "🟠 Modo offline";
    updateQueueStatus();
  }

  function verifyRemote(localId, timeoutMs = 10000) {
    return new Promise(resolve => {
      const baseUrl = config.GOOGLE_APPS_SCRIPT_URL;
      if (!baseUrl) return resolve(false);
      const callbackName = `verify_${localId.replace(/[^a-zA-Z0-9]/g, "")}_${Date.now()}`;
      const script = document.createElement("script");
      const timer = setTimeout(() => finish(false), timeoutMs);
      function finish(value) {
        clearTimeout(timer);
        try { delete window[callbackName]; } catch {}
        script.remove();
        resolve(value);
      }
      window[callbackName] = result => finish(Boolean(result && result.found));
      script.onerror = () => finish(false);
      script.src = `${baseUrl}?action=verify&id=${encodeURIComponent(localId)}&callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
      document.body.appendChild(script);
    });
  }

  async function sendToGoogleSheet(payload) {
    const endpoint = config.GOOGLE_APPS_SCRIPT_URL;
    if (!endpoint) throw new Error("A URL do Google Apps Script ainda não foi configurada.");
    if (!navigator.onLine) throw new Error("Sem conexão com a internet.");
    const body = new URLSearchParams({ payload: JSON.stringify(payload) });
    await fetch(endpoint, { method: "POST", mode: "no-cors", body });
    await new Promise(resolve => setTimeout(resolve, 1600));
    const confirmed = await verifyRemote(payload.localId);
    if (!confirmed) throw new Error("O envio ocorreu, mas ainda não foi possível confirmá-lo na planilha.");
    return true;
  }

  async function syncPending({ quiet = false } = {}) {
    if (!navigator.onLine) {
      if (!quiet) showMessage("Não há conexão. Os registros permanecem salvos no aparelho.", "warning");
      return;
    }
    const records = await getAllPending();
    if (!records.length) {
      if (!quiet) showMessage("Não existem registros pendentes.", "success");
      return;
    }
    syncButton.disabled = true;
    syncButton.textContent = "Sincronizando…";
    let sent = 0;
    for (const record of records) {
      try {
        await sendToGoogleSheet(record);
        await deletePending(record.localId);
        sent += 1;
      } catch (error) {
        console.warn("Falha na sincronização", error);
      }
    }
    syncButton.disabled = false;
    syncButton.textContent = "Sincronizar agora";
    await updateQueueStatus();
    if (!quiet) {
      const remaining = (await getAllPending()).length;
      if (!remaining) showMessage(`${sent} registro(s) sincronizado(s) com sucesso.`, "success");
      else showMessage(`${sent} registro(s) sincronizado(s); ${remaining} permanece(m) pendente(s).`, "warning");
    }
  }

  function saveDraft() {
    if (!form) return;
    const draft = {
      values: {},
      radios: {},
      checks: {},
      geometryMode,
      geometryGeoJSON: geometryGeoJSONInput.value,
      locationAccuracy
    };
    ["pointCode","surveyDate","pointName","municipality","grouping","registrar","distanceKm","pointStatus","accessType","observations","peopleEvidenceOther"].forEach(id => {
      const el = document.getElementById(id);
      if (el) draft.values[id] = el.value;
    });
    ["nearTo","peoplePresent","cropsNearby","enterprisesNearby"].forEach(name => draft.radios[name] = selectedRadio(name));
    ["peopleEvidence","naturalResources","wasteTypes"].forEach(name => draft.checks[name] = selectedCheckboxes(name));
    draft.truthConsent = document.getElementById("truthConsent").checked;
    draft.useConsent = document.getElementById("useConsent").checked;
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }

  function restoreGeometry(geometry, accuracy) {
    try {
      if (!geometry) return;
      const gj = typeof geometry === "string" ? JSON.parse(geometry) : geometry;
      if (gj.type === "Point") {
        updatePointGeometry(gj.coordinates[1], gj.coordinates[0], accuracy, false);
      } else if (gj.type === "Polygon") {
        const temp = L.geoJSON({ type: "Feature", properties: {}, geometry: gj }, { style: { color: "#b3261e", weight: 3, fillColor: "#e05650", fillOpacity: 0.23 } });
        let layer;
        temp.eachLayer(l => { layer = l; });
        if (layer) updatePolygonGeometry(layer, false);
      }
    } catch (error) {
      console.warn("Geometria do rascunho inválida", error);
    }
  }

  function restoreDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (!draft) return false;
      Object.entries(draft.values || {}).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el && value !== undefined) el.value = value;
      });
      Object.entries(draft.radios || {}).forEach(([name, value]) => {
        const el = form.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`);
        if (el) el.checked = true;
      });
      Object.entries(draft.checks || {}).forEach(([name, values]) => {
        (values || []).forEach(value => {
          const el = [...form.querySelectorAll(`input[name="${name}"]`)].find(x => x.value === value);
          if (el) el.checked = true;
        });
      });
      document.getElementById("truthConsent").checked = Boolean(draft.truthConsent);
      document.getElementById("useConsent").checked = Boolean(draft.useConsent);
      setGeometryMode(draft.geometryMode || "Point");
      restoreGeometry(draft.geometryGeoJSON, draft.locationAccuracy);
      handleConditionalFields();
      return true;
    } catch (error) {
      console.warn("Rascunho inválido", error);
      return false;
    }
  }

  function resetFormAfterSave() {
    form.reset();
    photoPayloads = [];
    renderPhotoPreview();
    geometryMode = "Point";
    clearGeometry({ keepView: false });
    surveyDateInput.valueAsDate = new Date();
    generatePointCode();
    localStorage.removeItem(DRAFT_KEY);
    handleConditionalFields();
  }

  async function exportPending() {
    const records = await getAllPending();
    if (!records.length) return;
    const clean = records.map(record => ({
      ...record,
      photos: undefined,
      quantidadeFotos: record.photos?.length || 0
    }));
    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `registros-descarte-pendentes-${new Date().toISOString().slice(0,10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  pointModeButton.addEventListener("click", () => setGeometryMode("Point"));
  polygonModeButton.addEventListener("click", () => {
    setGeometryMode("Polygon");
    polygonDrawer.enable();
  });
  clearGeometryButton.addEventListener("click", () => clearGeometry());
  captureLocationButton.addEventListener("click", captureLocation);
  document.getElementById("generateCode").addEventListener("click", generatePointCode);
  syncButton.addEventListener("click", () => syncPending());
  exportButton.addEventListener("click", exportPending);

  [latitudeInput, longitudeInput].forEach(input => {
    input.addEventListener("change", () => {
      if (latitudeInput.value && longitudeInput.value) updatePointGeometry(latitudeInput.value, longitudeInput.value, null, true);
    });
  });

  form.querySelectorAll('input[name="peoplePresent"], input[name="peopleEvidence"], input[name="naturalResources"]').forEach(el => {
    el.addEventListener("change", event => {
      if (event.target.name === "naturalResources" && event.target.value !== "Nenhum identificado" && event.target.checked) {
        document.getElementById("noNaturalResources").checked = false;
      }
      handleConditionalFields();
      saveDraft();
    });
  });

  photoInput.addEventListener("change", () => handlePhotos(photoInput.files));
  form.addEventListener("input", saveDraft);
  form.addEventListener("change", saveDraft);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    hideMessage();
    if (!form.reportValidity()) {
      showMessage("Revise os campos obrigatórios antes de enviar.", "error");
      return;
    }
    if (!validateCustomFields()) return;

    submitButton.disabled = true;
    submitButton.textContent = "Salvando…";
    const payload = getPayload();
    try {
      await savePending(payload);
      await updateQueueStatus();
      resetFormAfterSave();
      if (navigator.onLine && config.GOOGLE_APPS_SCRIPT_URL) {
        await syncPending({ quiet: true });
        const remaining = (await getAllPending()).some(item => item.localId === payload.localId);
        if (remaining) showMessage("Registro salvo no aparelho. A sincronização ainda não foi confirmada; utilize “Sincronizar agora”.", "warning");
        else showMessage("Registro enviado e confirmado na planilha com sucesso.", "success");
      } else if (!config.GOOGLE_APPS_SCRIPT_URL) {
        showMessage("Registro salvo no aparelho. Configure a URL do Google Apps Script em questionario/config.js para enviá-lo à planilha.", "warning");
      } else {
        showMessage("Registro salvo no aparelho e aguardando conexão para sincronizar.", "warning");
      }
    } catch (error) {
      showMessage(`Não foi possível salvar o registro: ${error.message}`, "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Enviar registro";
      await updateQueueStatus();
    }
  });

  window.addEventListener("online", () => {
    updateConnectionStatus();
    if (config.GOOGLE_APPS_SCRIPT_URL) syncPending({ quiet: true });
  });
  window.addEventListener("offline", updateConnectionStatus);

  document.addEventListener("DOMContentLoaded", async () => {
    initializeMap();
    await loadMunicipalityData();
    const restored = restoreDraft();
    if (!restored) {
      surveyDateInput.valueAsDate = new Date();
      generatePointCode();
    }
    handleConditionalFields();
    updateConnectionStatus();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
    if (navigator.onLine && config.GOOGLE_APPS_SCRIPT_URL) syncPending({ quiet: true });
  });
})();
