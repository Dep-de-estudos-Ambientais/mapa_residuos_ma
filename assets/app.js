const DATA_FILES = {
  regional: "data/regionalizacao_municipios.geojson",
  boundaries: "data/limites_agrupamentos.geojson",
  seats: "data/sedes_municipais.geojson",
  facilities: "data/proposta_localizacao.geojson",
  irregular: "data/descarte_irregular.geojson",
  flows: "data/fluxos_residuos.geojson",
  info: "data/group_info.json"
};

const GROUP_PALETTES = {
  "Titara": {dark:"#2e7d32", light:"#c8e6c9"},
  "Imperatriz": {dark:"#c45b12", light:"#f7d7bf"},
  "Codó": {dark:"#6941a5", light:"#dfd2f3"},
  "Colinas": {dark:"#657a16", light:"#dce7ad"},
  "Pinheiro": {dark:"#087f8c", light:"#b9e6ea"},
  "Santa Inês": {dark:"#2769b3", light:"#c5dbf3"},
  "Balsas": {dark:"#925c2b", light:"#ead3bd"},
  "Buriti dos Lopes (PI)": {dark:"#0b7285", light:"#bfe6ec"},
  "Nazária (PI)": {dark:"#a03c68", light:"#f0cadb"}
};

const map = L.map("map", {
  preferCanvas: true,
  zoomControl: true,
  minZoom: 5,
  maxZoom: 18
}).setView([-5.25, -45.25], 6);

const streetBase = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
});

const satelliteBase = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
});

streetBase.addTo(map);

function addBasemapSwitch(targetMap) {
  const Switch = L.Control.extend({
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
          if (targetMap.hasLayer(streetBase)) targetMap.removeLayer(streetBase);
          if (!targetMap.hasLayer(satelliteBase)) satelliteBase.addTo(targetMap);
          satelliteButton.classList.add("active");
          streetButton.classList.remove("active");
        } else {
          if (targetMap.hasLayer(satelliteBase)) targetMap.removeLayer(satelliteBase);
          if (!targetMap.hasLayer(streetBase)) streetBase.addTo(targetMap);
          streetButton.classList.add("active");
          satelliteButton.classList.remove("active");
        }
      };

      streetButton.addEventListener("click", () => activate("street"));
      satelliteButton.addEventListener("click", () => activate("satellite"));
      return container;
    }
  });
  targetMap.addControl(new Switch());
}

addBasemapSwitch(map);
L.control.scale({imperial:false, position:"bottomleft"}).addTo(map);

const state = {
  data: {},
  info: {},
  activeGroup: "",
  layerEnabled: {
    regional:true,
    boundaries:true,
    seats:true,
    facilities:true,
    irregular:true,
    flows:true
  },
  layers: {},
  labelMarkers: [],
  facilityLabelMarkers: [],
  decorators: []
};

const displayGroup = g => state.info[g]?.display || g || "Sem agrupamento";
const palette = g => GROUP_PALETTES[g] || {dark:"#55705e", light:"#d9e2dc"};
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const fmtInt = n => new Intl.NumberFormat("pt-BR", {maximumFractionDigits:0}).format(Number(n || 0));

function matchesGroup(feature){
  if(!state.activeGroup) return true;
  return feature?.properties?.agrupamento === state.activeGroup;
}

function svgFacilityIcon(type){
  const landfill = String(type).toLowerCase().includes("aterro");
  const bg = landfill ? "#1d6a3b" : "#e08a13";
  const inner = landfill
    ? `<path d="M9 10h14l-1.5 12H10.5L9 10Zm2-4h10l1 3H10l1-3Zm3 7v6m4-6v6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`
    : `<path d="M8 11h12l-3-3m3 3-3 3M24 21H12l3 3m-3-3 3-3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  return L.divIcon({
    className:"facility-marker",
    html:`<svg width="34" height="42" viewBox="0 0 34 42" aria-hidden="true">
      <path d="M17 1.5c-8.2 0-14.8 6.4-14.8 14.3C2.2 27.2 17 40.5 17 40.5S31.8 27.2 31.8 15.8C31.8 7.9 25.2 1.5 17 1.5Z" fill="${bg}" stroke="#fff" stroke-width="2"/>
      ${inner}
    </svg>`,
    iconSize:[34,42], iconAnchor:[17,40]
  });
}

function svgWarningIcon(){
  return L.divIcon({
    className:"facility-marker",
    html:`<svg width="31" height="31" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2 30 28H2L16 2Z" fill="#c62828" stroke="#fff" stroke-width="2"/>
      <path d="M16 10v9" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
      <circle cx="16" cy="24" r="1.7" fill="#fff"/>
    </svg>`,
    iconSize:[31,31],iconAnchor:[15,15]
  });
}

function createLabelMarker(latlng, text, className, group){
  const marker = L.marker(latlng, {
    interactive:false,
    icon:L.divIcon({
      className,
      html:`<span class="label-box">${escapeHtml(text)}</span>`,
      iconAnchor:[-7, 10]
    })
  });
  marker.__group = group;
  marker.__labelText = text;
  return marker;
}

function regionalStyle(feature){
  const g = feature.properties.agrupamento;
  const p = palette(g);
  const selected = matchesGroup(feature);
  const direct = feature.properties.modalidade === "direto";
  if(!selected) return {color:"transparent", weight:0, fillOpacity:0, opacity:0};
  return {
    color:p.dark,
    weight:.8,
    opacity:.72,
    fillColor:direct ? p.dark : p.light,
    fillOpacity:direct ? .64 : .43
  };
}

function boundaryStyle(feature){
  if(!matchesGroup(feature)) return {color:"transparent",weight:0,opacity:0,fillOpacity:0};
  return {color:"#202c25",weight:2.4,opacity:.88,fillOpacity:0};
}

function municipalPopup(p){
  const mode = p.modalidade === "direto" ? "Transporte direto" : "Transbordo municipal";
  return `<div class="popup-title">${escapeHtml(p.municipio)}</div>
    <div class="popup-grid">
      <b>Agrupamento</b><span>${escapeHtml(displayGroup(p.agrupamento))}</span>
      <b>Modalidade</b><span>${mode}</span>
      <b>Destino</b><span>${escapeHtml(p.destino)}</span>
      <b>População</b><span>${fmtInt(p.populacao_beneficiada_2025)}</span>
    </div>`;
}

function facilityPopup(p){
  return `<div class="popup-title">${escapeHtml(p.descricao)}</div>
    <div class="popup-grid">
      <b>Tipologia</b><span>${escapeHtml(p.tipologia)}</span>
      <b>Município</b><span>${escapeHtml(p.municipio)}</span>
      <b>Agrupamento</b><span>${escapeHtml(displayGroup(p.agrupamento))}</span>
    </div>`;
}

function irregularPopup(p){
  const rows = [
    ["Município", p.municipio],
    ["Tipo de destinação", p.tipo_destinacao || "Destinação irregular"],
    ["Próximo à cidade", p.proximo_cidade],
    ["Distância informada", p.distancia_cidade_km ? `${p.distancia_cidade_km} km` : ""],
    ["Pessoas próximas", p.pessoas_proximas],
    ["Pessoas trabalhando", p.pessoas_trabalhando],
    ["Atividade observada", p.descricao_atividade],
    ["Recursos naturais próximos", p.recursos_naturais_proximos],
    ["Outros elementos próximos", p.outros_elementos_proximos]
  ].filter(([,v]) => v);
  return `<div class="popup-title popup-warning">Área de descarte irregular</div>
    <div class="popup-grid">${rows.map(([k,v])=>`<b>${escapeHtml(k)}</b><span>${escapeHtml(v)}</span>`).join("")}</div>
    <span class="group-badge">${escapeHtml(displayGroup(p.agrupamento))}</span>`;
}

async function loadData(){
  const keys = Object.keys(DATA_FILES);
  const results = await Promise.all(keys.map(async key => {
    const r = await fetch(DATA_FILES[key]);
    if(!r.ok) throw new Error(`Falha ao carregar ${DATA_FILES[key]}`);
    return [key, await r.json()];
  }));
  results.forEach(([k,v]) => {
    if(k === "info") state.info = v;
    else state.data[k] = v;
  });
}

function buildLayers(){
  // Municipal regionalization polygons
  state.layers.regional = L.geoJSON(state.data.regional, {
    style:regionalStyle,
    onEachFeature:(f,layer)=>{
      layer.bindPopup(municipalPopup(f.properties), {maxWidth:340});
    }
  }).addTo(map);

  // Group boundaries: thick borders, no fill
  state.layers.boundaries = L.geoJSON(state.data.boundaries, {
    style:boundaryStyle,
    interactive:false
  }).addTo(map);

  // Flows
  state.layers.flows = L.layerGroup().addTo(map);
  state.data.flows.features.forEach(f=>{
    const line = L.geoJSON(f, {
      style:{color:"#2679cf",weight:2.1,opacity:.62}
    });
    line.__feature = f;
    line.addTo(state.layers.flows);
    line.eachLayer(poly=>{
      poly.__group = f.properties.agrupamento;
      if(window.L.polylineDecorator){
        const decorator = L.polylineDecorator(poly, {
          patterns:[{
            offset:"72%",
            repeat:0,
            symbol:L.Symbol.arrowHead({
              pixelSize:8,
              polygon:true,
              pathOptions:{stroke:true,weight:1,color:"#1768b8",fillColor:"#1768b8",fillOpacity:.8}
            })
          }]
        }).addTo(state.layers.flows);
        decorator.__group = f.properties.agrupamento;
        state.decorators.push(decorator);
      }
    });
  });

  // Municipal seats and labels
  state.layers.seats = L.layerGroup().addTo(map);
  state.data.seats.features.forEach(f=>{
    const [lon,lat] = f.geometry.coordinates;
    const p = f.properties;
    const dot = L.circleMarker([lat,lon], {
      radius:2.7,color:"#fff",weight:1,fillColor:"#262d29",fillOpacity:.96
    }).bindTooltip(escapeHtml(p.municipio), {direction:"top",offset:[0,-3]});
    dot.__group = p.agrupamento;
    dot.addTo(state.layers.seats);
    const label = createLabelMarker([lat,lon], p.municipio, "municipal-label", p.agrupamento);
    label.addTo(state.layers.seats);
    state.labelMarkers.push(label);
  });

  // Proposed facilities
  state.layers.facilities = L.layerGroup().addTo(map);
  state.data.facilities.features.forEach((f,i)=>{
    const [lon,lat] = f.geometry.coordinates;
    const p = f.properties;
    const marker = L.marker([lat,lon], {icon:svgFacilityIcon(p.tipologia), zIndexOffset:900})
      .bindPopup(facilityPopup(p), {maxWidth:340});
    marker.__group = p.agrupamento;
    marker.addTo(state.layers.facilities);
    const label = createLabelMarker([lat,lon], p.descricao, "facility-label", p.agrupamento);
    // Small deterministic offsets to reduce facility-to-facility collisions.
    label.setZIndexOffset(1000 + i);
    label.addTo(state.layers.facilities);
    state.facilityLabelMarkers.push(label);
  });

  // Irregular disposal areas
  state.layers.irregular = L.layerGroup().addTo(map);
  state.data.irregular.features.forEach(f=>{
    const [lon,lat] = f.geometry.coordinates;
    const p = f.properties;
    const marker = L.marker([lat,lon], {icon:svgWarningIcon(), zIndexOffset:800})
      .bindPopup(irregularPopup(p), {maxWidth:360});
    marker.__group = p.agrupamento;
    marker.addTo(state.layers.irregular);
  });
}

function updateVisibility(){
  // Polygon styles
  state.layers.regional?.setStyle(regionalStyle);
  state.layers.boundaries?.setStyle(boundaryStyle);

  // Points and labels
  ["seats","facilities","irregular"].forEach(key=>{
    const groupLayer = state.layers[key];
    if(!groupLayer) return;
    groupLayer.eachLayer(layer=>{
      const visible = !state.activeGroup || layer.__group === state.activeGroup;
      if(layer.setOpacity) layer.setOpacity(visible ? 1 : 0);
      if(layer.setStyle) layer.setStyle({opacity:visible?1:0,fillOpacity:visible?.95:0});
      const el = layer.getElement?.();
      if(el) el.style.display = visible ? "" : "none";
    });
  });

  // Flows and arrows
  state.layers.flows?.eachLayer(layer=>{
    if(layer.eachLayer){
      layer.eachLayer(child=>{
        const visible = !state.activeGroup || child.__group === state.activeGroup;
        if(child.setStyle) child.setStyle({opacity:visible ? .62 : 0});
      });
    }else{
      const visible = !state.activeGroup || layer.__group === state.activeGroup;
      if(layer.setStyle) layer.setStyle({opacity:visible ? .62 : 0});
    }
    if(layer._patterns){
      const visible = !state.activeGroup || layer.__group === state.activeGroup;
      const el = layer._container;
      if(el) el.style.display = visible ? "" : "none";
    }
  });

  state.decorators.forEach(d=>{
    const visible = !state.activeGroup || d.__group === state.activeGroup;
    if(d._patterns){
      d._patterns.forEach(p=>{ if(p._path) p._path.style.display = visible ? "" : "none"; });
    }
  });

  updateLabelCollisions();
}

function setLayerEnabled(key, enabled){
  state.layerEnabled[key] = enabled;
  const layer = state.layers[key];
  if(!layer) return;
  if(enabled && !map.hasLayer(layer)) map.addLayer(layer);
  if(!enabled && map.hasLayer(layer)) map.removeLayer(layer);
  setTimeout(updateLabelCollisions, 50);
}

function rectanglesOverlap(a,b,pad=2){
  return !(a.right+pad < b.left || a.left-pad > b.right || a.bottom+pad < b.top || a.top-pad > b.bottom);
}

function updateLabelCollisions(){
  requestAnimationFrame(()=>{
    const occupied = [];
    // Facility labels have priority.
    state.facilityLabelMarkers.forEach(marker=>{
      const el = marker.getElement?.();
      if(!el) return;
      const groupVisible = !state.activeGroup || marker.__group === state.activeGroup;
      const layerVisible = state.layerEnabled.facilities && map.hasLayer(state.layers.facilities);
      if(!groupVisible || !layerVisible){ el.style.display="none"; return; }
      el.style.display="";
      const rect = el.getBoundingClientRect();
      if(occupied.some(r=>rectanglesOverlap(rect,r,1))){
        el.style.display="none";
      } else {
        occupied.push(rect);
      }
    });

    // Municipal labels are secondary and may be hidden at overview scales.
    const zoom = map.getZoom();
    state.labelMarkers.forEach(marker=>{
      const el = marker.getElement?.();
      if(!el) return;
      const groupVisible = !state.activeGroup || marker.__group === state.activeGroup;
      const layerVisible = state.layerEnabled.seats && map.hasLayer(state.layers.seats);
      if(!groupVisible || !layerVisible || zoom < 6){ el.style.display="none"; return; }
      el.style.display="";
      const rect = el.getBoundingClientRect();
      const pad = zoom <= 6 ? 8 : zoom === 7 ? 4 : 1;
      if(occupied.some(r=>rectanglesOverlap(rect,r,pad))){
        el.style.display="none";
      } else {
        occupied.push(rect);
      }
    });
  });
}

function populateFilter(){
  const select = document.getElementById("groupFilter");
  Object.keys(state.info)
    .sort((a,b)=>displayGroup(a).localeCompare(displayGroup(b),"pt-BR"))
    .forEach(group=>{
      const o = document.createElement("option");
      o.value = group;
      o.textContent = displayGroup(group);
      select.appendChild(o);
    });
}

function updateGroupInfo(){
  const box = document.getElementById("groupInfo");
  if(!state.activeGroup){
    box.innerHTML = `<h3>Visão geral</h3>
      <p>Selecione um agrupamento para destacar sua área, seus fluxos e as informações correspondentes.</p>`;
    return;
  }
  const info = state.info[state.activeGroup] || {};
  const g = info.geojson || {};
  box.innerHTML = `
    <h3>Informações do agrupamento</h3>
    <p class="group-title">${escapeHtml(info.titulo || displayGroup(state.activeGroup))}</p>
    <p>${escapeHtml(info.resumo || "")}</p>
    <div class="metrics">
      <div class="metric"><strong>${fmtInt(g.municipios)}</strong><span>municípios no GeoJSON</span></div>
      <div class="metric"><strong>${fmtInt(g.populacao)}</strong><span>população beneficiada</span></div>
      <div class="metric"><strong>${fmtInt(g.direto)}</strong><span>transporte direto</span></div>
      <div class="metric"><strong>${fmtInt(g.transbordo)}</strong><span>via transbordo</span></div>
    </div>
    ${info.observacao ? `<p class="note">${escapeHtml(info.observacao)}</p>` : ""}
    <span class="source-tag">${escapeHtml(info.fonte_secao || "Texto técnico")}</span>`;
}

function renderLegend(){
  const box = document.getElementById("legendContent");
  let regionalRows = "";
  if(state.activeGroup){
    const p = palette(state.activeGroup);
    regionalRows = `
      <div class="legend-row"><span class="legend-swatch" style="background:${p.dark}"></span> Transporte direto ao aterro</div>
      <div class="legend-row"><span class="legend-swatch" style="background:${p.light}"></span> Transporte via transbordo</div>`;
  } else {
    regionalRows = `<div class="legend-row"><span class="legend-swatch" style="background:linear-gradient(90deg,#2e7d32,#2769b3,#c45b12,#6941a5)"></span> Agrupamentos (tons por região)</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#6a7c70"></span> Tom forte = direto; tom claro = transbordo</div>`;
  }
  box.innerHTML = regionalRows + `
    <div class="legend-row"><span class="legend-dot"></span> Sede municipal</div>
    <div class="legend-row"><span class="legend-icon" style="background:#1d6a3b">A</span> Aterro sanitário</div>
    <div class="legend-row"><span class="legend-icon" style="background:#e08a13">T</span> Estação de transbordo</div>
    <div class="legend-row"><span class="legend-icon" style="background:#c62828">!</span> Descarte irregular</div>
    <div class="legend-row"><span class="legend-line"></span> Fluxo de resíduos sólidos</div>
    <div class="legend-row"><span class="legend-swatch" style="background:transparent;border:2px solid #202c25"></span> Limite do agrupamento</div>`;
}

function fitActiveGroup(){
  if(!state.activeGroup){
    const b = state.layers.boundaries.getBounds();
    if(b.isValid()) map.fitBounds(b.pad(.04));
    return;
  }
  const bounds = L.latLngBounds([]);
  state.data.boundaries.features.forEach(f=>{
    if(f.properties.agrupamento === state.activeGroup){
      const temp = L.geoJSON(f);
      bounds.extend(temp.getBounds());
    }
  });
  // Include relevant flow destinations, especially interstate proposals.
  state.data.flows.features.forEach(f=>{
    if(f.properties.agrupamento === state.activeGroup){
      const temp = L.geoJSON(f);
      bounds.extend(temp.getBounds());
    }
  });
  if(bounds.isValid()) map.fitBounds(bounds.pad(.08), {maxZoom:8});
}

function setGroup(group, fit=true){
  state.activeGroup = group || "";
  document.getElementById("groupFilter").value = state.activeGroup;
  updateVisibility();
  updateGroupInfo();
  renderLegend();
  if(fit) fitActiveGroup();
}

function bindUI(){
  const sidebar = document.getElementById("sidebar");
  const open = document.getElementById("openPanel");
  const close = document.getElementById("closePanel");
  const setPanel = visible=>{
    sidebar.classList.toggle("open",visible);
    sidebar.setAttribute("aria-hidden", String(!visible));
    open.setAttribute("aria-expanded", String(visible));
  };
  open.addEventListener("click",()=>setPanel(!sidebar.classList.contains("open")));
  close.addEventListener("click",()=>setPanel(false));
  document.getElementById("groupFilter").addEventListener("change",e=>setGroup(e.target.value,true));
  document.getElementById("resetView").addEventListener("click",()=>setGroup("",true));
  document.querySelectorAll("[data-layer]").forEach(cb=>{
    cb.addEventListener("change",()=>setLayerEnabled(cb.dataset.layer, cb.checked));
  });
  map.on("zoomend moveend",updateLabelCollisions);
}

function showToast(text){
  const t = document.getElementById("toast");
  t.textContent = text;
  t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"),3200);
}

async function init(){
  try{
    await loadData();
    buildLayers();
    populateFilter();
    renderLegend();
    bindUI();
    fitActiveGroup();
    setTimeout(updateLabelCollisions, 250);
    document.getElementById("loading").classList.add("hidden");
  }catch(err){
    console.error(err);
    document.getElementById("loading").classList.add("hidden");
    showToast("Não foi possível carregar os dados do mapa.");
  }
}
init();
