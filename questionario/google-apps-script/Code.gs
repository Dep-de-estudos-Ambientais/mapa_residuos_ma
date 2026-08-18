/**
 * Cadastro de Áreas de Descarte Inadequado de Resíduos Sólidos
 * Backend Google Apps Script para Google Sheets + Google Drive.
 *
 * INSTALAÇÃO
 * 1. Abra a planilha Google configurada para o projeto.
 * 2. Acesse Extensões > Apps Script.
 * 3. Substitua o conteúdo de Code.gs por este arquivo.
 * 4. Execute setupProject() uma vez e autorize o acesso.
 * 5. Implantar > Nova implantação > Aplicativo da Web.
 * 6. Executar como: você. Acesso: qualquer pessoa que deva utilizar o formulário.
 * 7. Copie a URL terminada em /exec para questionario/config.js.
 *
 * PLANILHA CONFIGURADA:
 * https://docs.google.com/spreadsheets/d/1cU20Pp0QiwWlq1qh5ooe0HhoKW88fOEvJzY-YrnTaSM/edit
 */

const TARGET_SPREADSHEET_ID = "1cU20Pp0QiwWlq1qh5ooe0HhoKW88fOEvJzY-YrnTaSM";
const SHEET_NAME = "Descarte_Inadequado";
const PHOTO_FOLDER_NAME = "Registros Fotográficos - Descarte Inadequado";
const PHOTO_FOLDER_PROPERTY = "DESCARTE_PHOTO_FOLDER_ID";
const SPREADSHEET_PROPERTY = "DESCARTE_SPREADSHEET_ID";

const HEADERS = [
  "Timestamp",
  "ID do registro",
  "Código do ponto",
  "Identificação do ponto",
  "Data da vistoria",
  "Município",
  "Agrupamento",
  "Próximo de",
  "Distância aproximada (km)",
  "Há pessoas na área?",
  "Como foi identificada a existência de pessoas?",
  "Recursos naturais próximos",
  "Áreas de plantio ou hortas próximas?",
  "Empreendimentos próximos?",
  "Situação aparente do ponto",
  "Condição de acesso",
  "Tipos de resíduos observados",
  "Observações",
  "Tipo de geometria",
  "Latitude de referência",
  "Longitude de referência",
  "Precisão do GPS (m)",
  "Geometria (GeoJSON)",
  "Fotografias",
  "Responsável ou equipe",
  "Declaração de veracidade",
  "Autorização de uso"
];

function setupProject() {
  const target = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  if (!target) throw new Error("Não foi possível acessar a planilha configurada para o projeto.");
  PropertiesService.getScriptProperties().setProperty(SPREADSHEET_PROPERTY, TARGET_SPREADSHEET_ID);
  const sheet = getSheet_();
  ensureHeaders_(sheet);
  const folder = getOrCreatePhotoFolder_();

  sheet.setFrozenRows(1);
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange
    .setFontWeight("bold")
    .setBackground("#155d3b")
    .setFontColor("#ffffff")
    .setWrap(true);
  sheet.autoResizeColumns(1, HEADERS.length);

  return {
    ok: true,
    sheet: sheet.getName(),
    spreadsheetId: sheet.getParent().getId(),
    photoFolderId: folder.getId(),
    photoFolderUrl: folder.getUrl()
  };
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const payload = parsePayload_(e);
    validatePayload_(payload);
    const sheet = getSheet_();
    ensureHeaders_(sheet);

    const existingRow = findByLocalId_(sheet, payload.localId);
    if (existingRow) {
      return json_({ ok: true, duplicate: true, row: existingRow, id: payload.localId });
    }

    const photoUrls = savePhotos_(payload);
    const row = [
      new Date(),
      payload.localId,
      clean_(payload.pointCode),
      clean_(payload.pointName),
      parseDate_(payload.surveyDate),
      clean_(payload.municipality),
      clean_(payload.grouping),
      clean_(payload.nearTo),
      numberOrBlank_(payload.distanceKm),
      clean_(payload.peoplePresent),
      joinList_(payload.peopleEvidence),
      joinList_(payload.naturalResources),
      clean_(payload.cropsNearby),
      clean_(payload.enterprisesNearby),
      clean_(payload.pointStatus),
      clean_(payload.accessType),
      joinList_(payload.wasteTypes),
      clean_(payload.observations),
      clean_(payload.geometryType),
      numberOrBlank_(payload.latitude),
      numberOrBlank_(payload.longitude),
      numberOrBlank_(payload.accuracy),
      clean_(payload.geometryGeoJSON),
      photoUrls.join("\n"),
      clean_(payload.registrar),
      clean_(payload.truthConsent),
      clean_(payload.useConsent)
    ];

    sheet.appendRow(row);
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss");
    sheet.getRange(lastRow, 5).setNumberFormat("dd/MM/yyyy");
    sheet.getRange(lastRow, 9).setNumberFormat("0.0");
    sheet.getRange(lastRow, 20, 1, 2).setNumberFormat("0.0000000");
    sheet.getRange(lastRow, 1, 1, HEADERS.length).setWrap(true);
    SpreadsheetApp.flush();

    return json_({ ok: true, row: lastRow, id: payload.localId, photos: photoUrls.length });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return json_({ ok: false, error: error.message || String(error) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function doGet(e) {
  const callback = sanitizeCallback_(e && e.parameter && e.parameter.callback);
  const action = e && e.parameter && e.parameter.action;
  let result = { ok: true, service: "cadastro-descarte-inadequado" };

  if (action === "verify") {
    const id = String((e.parameter && e.parameter.id) || "");
    const sheet = getSheet_();
    ensureHeaders_(sheet);
    const row = findByLocalId_(sheet, id);
    result = { ok: true, found: Boolean(row), row: row || null, id: id };
  }

  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + JSON.stringify(result) + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(result);
}

function parsePayload_(e) {
  if (!e) throw new Error("Requisição vazia.");
  if (e.parameter && e.parameter.payload) return JSON.parse(e.parameter.payload);
  if (e.postData && e.postData.contents) return JSON.parse(e.postData.contents);
  throw new Error("Conteúdo do formulário não encontrado.");
}

function validatePayload_(payload) {
  const required = [
    "localId", "pointCode", "pointName", "surveyDate", "nearTo", "distanceKm",
    "peoplePresent", "cropsNearby", "enterprisesNearby", "geometryType",
    "latitude", "longitude", "geometryGeoJSON", "truthConsent", "useConsent"
  ];
  required.forEach(function(field) {
    const value = payload[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      throw new Error("Campo obrigatório ausente: " + field);
    }
  });

  if (!Array.isArray(payload.naturalResources) || payload.naturalResources.length === 0) {
    throw new Error("Informe os recursos naturais próximos ou marque 'Nenhum identificado'.");
  }
  if (payload.peoplePresent === "Sim" && (!Array.isArray(payload.peopleEvidence) || payload.peopleEvidence.length === 0)) {
    throw new Error("Informe como foi identificada a existência de pessoas.");
  }

  const lat = Number(payload.latitude);
  const lon = Number(payload.longitude);
  if (!isFinite(lat) || lat < -90 || lat > 90) throw new Error("Latitude inválida.");
  if (!isFinite(lon) || lon < -180 || lon > 180) throw new Error("Longitude inválida.");
  if (["Point", "Polygon"].indexOf(payload.geometryType) < 0) throw new Error("Tipo de geometria inválido.");

  let geometry;
  try { geometry = JSON.parse(payload.geometryGeoJSON); }
  catch (_) { throw new Error("Geometria GeoJSON inválida."); }
  if (!geometry || geometry.type !== payload.geometryType) throw new Error("A geometria não corresponde ao tipo informado.");

  if (payload.photos !== undefined && !Array.isArray(payload.photos)) throw new Error("Lista de fotografias inválida.");
  if (Array.isArray(payload.photos) && payload.photos.length > 4) throw new Error("O máximo permitido é de quatro fotografias por registro.");
}

function getSheet_() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheet = null;

  try {
    spreadsheet = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
    props.setProperty(SPREADSHEET_PROPERTY, TARGET_SPREADSHEET_ID);
  } catch (err) {
    throw new Error("Não foi possível acessar a planilha configurada. Verifique o ID e as permissões da conta que executa o Apps Script.");
  }

  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);
  return sheet;
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    return;
  }
  const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADERS.length)).getDisplayValues()[0];
  HEADERS.forEach(function(header, index) {
    if (current[index] !== header) sheet.getRange(1, index + 1).setValue(header);
  });
}

function findByLocalId_(sheet, id) {
  if (!id || sheet.getLastRow() < 2) return null;
  const idColumn = HEADERS.indexOf("ID do registro") + 1;
  const values = sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1).getDisplayValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === id) return i + 2;
  }
  return null;
}

function savePhotos_(payload) {
  const photos = Array.isArray(payload.photos) ? payload.photos : [];
  if (!photos.length) return [];
  const folder = getOrCreatePhotoFolder_();
  const urls = [];

  photos.forEach(function(photo, index) {
    const dataUrl = String(photo && photo.dataUrl || "");
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) throw new Error("Formato inválido na fotografia " + (index + 1) + ".");

    const mimeType = match[1];
    const bytes = Utilities.base64Decode(match[2]);
    const extension = mimeType.indexOf("png") >= 0 ? "png" : mimeType.indexOf("webp") >= 0 ? "webp" : "jpg";
    const safeCode = clean_(payload.pointCode).replace(/[^a-zA-Z0-9À-ÿ_-]+/g, "-").slice(0, 55) || "ponto";
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
    const name = timestamp + "_" + safeCode + "_foto-" + (index + 1) + "_" + payload.localId.slice(0, 8) + "." + extension;
    const blob = Utilities.newBlob(bytes, mimeType, name);
    urls.push(folder.createFile(blob).getUrl());
  });
  return urls;
}

function getOrCreatePhotoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty(PHOTO_FOLDER_PROPERTY);
  if (savedId) {
    try { return DriveApp.getFolderById(savedId); }
    catch (_) { props.deleteProperty(PHOTO_FOLDER_PROPERTY); }
  }
  const folders = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty(PHOTO_FOLDER_PROPERTY, folder.getId());
  return folder;
}

function parseDate_(isoDate) {
  const parts = String(isoDate || "").split("-");
  if (parts.length !== 3) return isoDate;
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function joinList_(value) {
  return Array.isArray(value) ? value.map(clean_).filter(Boolean).join("; ") : clean_(value);
}

function clean_(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function numberOrBlank_(value) {
  if (value === "" || value === undefined || value === null) return "";
  const number = Number(value);
  return isFinite(number) ? number : "";
}

function sanitizeCallback_(callback) {
  const value = String(callback || "");
  return /^[a-zA-Z_$][0-9a-zA-Z_$\.]*$/.test(value) ? value : "";
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
