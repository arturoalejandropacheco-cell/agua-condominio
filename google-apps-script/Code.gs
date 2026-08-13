// ============================================================
// Google Apps Script — API para Agua Condominio
// Copiar este código en un proyecto de Google Apps Script
// asociado a la Google Sheet del condominio.
// ============================================================

const SHEET_REGISTROS = 'Registros';
const SHEET_MEDIDORES = 'Medidores';
const SHEET_DISTRIBUCION = 'Distribución';

// ── Web App entry points ──

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const action = (e.parameter && e.parameter.action) || 'read';
  let result;

  try {
    // Support data via GET param (for CORS workaround) or POST body
    function getPayload() {
      if (e.parameter && e.parameter.data) {
        return JSON.parse(e.parameter.data);
      }
      if (e.postData && e.postData.contents) {
        return JSON.parse(e.postData.contents);
      }
      return {};
    }

    switch (action) {
      case 'read':
        result = readAll();
        break;
      case 'save':
        result = saveRecord(getPayload());
        break;
      case 'delete':
        result = deleteRecord(getPayload().year, getPayload().month);
        break;
      case 'init':
        result = initSheets();
        break;
      default:
        result = { error: 'Acción no reconocida: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Initialize sheets with headers ──

const CAB_REGISTROS = [
  'Año', 'Mes', 'Lectura Soraya', 'Lectura Cristian',
  'Total Cuenta ($)', 'Consumo 3 Casas ($)', 'Trifásica ($)', 'Total m³', 'Pérdida ($)'
];
const CAB_MEDIDORES = [
  'Año', 'Mes', 'Lectura Soraya', 'Lectura Cristian',
  'Consumo Soraya (m³)', 'Consumo Cristian (m³)', 'Consumo Arturo (m³)'
];
const CAB_DISTRIBUCION = [
  'Año', 'Mes', 'Casa', 'Consumo (m³)', '% Consumo',
  'Costo Agua ($)', 'Costo Trifásica ($)', 'Costo Pérdida ($)', 'Total a Pagar ($)',
  'Consumo 3 Casas ($)', 'Total m³'
];

/**
 * ¿Esta hoja la administra la app?
 *
 * Una hoja inexistente o vacía se puede usar. Una con contenido solo es
 * nuestra si su fila 1 son nuestras cabeceras. Esto importa porque el script
 * limpia desde la fila 2 hacia abajo: si el usuario ya tenía una planilla
 * hecha a mano con una hoja del mismo nombre, sobrescribirla le borraría el
 * trabajo sin aviso.
 */
function esHojaDeLaApp(hoja, cabeceras) {
  if (!hoja || hoja.getLastRow() === 0) return true;
  const ancho = Math.min(cabeceras.length, hoja.getLastColumn()) || 1;
  const fila1 = hoja.getRange(1, 1, 1, ancho).getValues()[0];
  return String(fila1[0]).trim() === cabeceras[0] &&
         String(fila1[1] || '').trim() === cabeceras[1];
}

function exigirHojaPropia(ss, nombre, cabeceras) {
  const hoja = ss.getSheetByName(nombre);
  if (esHojaDeLaApp(hoja, cabeceras)) return hoja;
  const a1 = String(hoja.getRange(1, 1).getValue()).slice(0, 40);
  throw new Error(
    'La hoja "' + nombre + '" ya existe en esta planilla y tiene otro contenido ' +
    '(su celda A1 dice "' + a1 + '"). El script NO la va a sobrescribir para no ' +
    'borrar tus datos. Usa una planilla nueva y vacía para la app, o renombra esa hoja.'
  );
}

function prepararHoja(ss, nombre, cabeceras) {
  let hoja = exigirHojaPropia(ss, nombre, cabeceras);
  if (!hoja) hoja = ss.insertSheet(nombre);
  hoja.getRange(1, 1, 1, cabeceras.length).setValues([cabeceras]);
  hoja.getRange(1, 1, 1, cabeceras.length).setFontWeight('bold');
  hoja.setFrozenRows(1);
  return hoja;
}

function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Se validan las tres ANTES de escribir ninguna: si una colisiona, no hay
  // que dejar la planilla a medio modificar.
  exigirHojaPropia(ss, SHEET_REGISTROS, CAB_REGISTROS);
  exigirHojaPropia(ss, SHEET_MEDIDORES, CAB_MEDIDORES);
  exigirHojaPropia(ss, SHEET_DISTRIBUCION, CAB_DISTRIBUCION);

  prepararHoja(ss, SHEET_REGISTROS, CAB_REGISTROS);
  prepararHoja(ss, SHEET_MEDIDORES, CAB_MEDIDORES);
  prepararHoja(ss, SHEET_DISTRIBUCION, CAB_DISTRIBUCION);

  return { success: true, message: 'Hojas inicializadas' };
}

// ── Read all records ──

function readAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_REGISTROS);
  if (!sheet) return { records: [] };

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { records: [] };

  const records = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0] && !row[1]) continue;
    records.push({
      year: row[0],
      month: row[1],
      lecturaSoraya: row[2],
      lecturaCristian: row[3],
      totalCuenta: row[4],
      total3Casas: row[5],
      trifasica: row[6] || 0,
      totalM3: row[7],
      perdidaPesos: row[8] || 0,
      // El mes inicial es el que solo trae lecturas, sin boleta. Se detecta
      // por los m³, no por el total de la cuenta, que ahora es opcional.
      isInitial: !row[7]
    });
  }

  return { records: records };
}

// ── Save (upsert) a record ──

function saveRecord(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = exigirHojaPropia(ss, SHEET_REGISTROS, CAB_REGISTROS);
  if (!sheet) {
    initSheets();
    sheet = ss.getSheetByName(SHEET_REGISTROS);
  }

  const rows = sheet.getDataRange().getValues();
  let existingRow = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == data.year && rows[i][1] == data.month) {
      existingRow = i + 1; // 1-indexed
      break;
    }
  }

  const rowData = [
    data.year, data.month, data.lecturaSoraya, data.lecturaCristian,
    data.totalCuenta || '', data.total3Casas || '', data.trifasica || 0, data.totalM3 || '',
    data.perdidaPesos || 0
  ];

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, 9).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
    sortRegistros(sheet);
  }

  // Update calculated sheets
  updateMedidores(ss);
  updateDistribucion(ss);

  return { success: true };
}

// ── Delete a record ──

function deleteRecord(year, month) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_REGISTROS);
  if (!sheet) return { success: false, error: 'Hoja no encontrada' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] == year && rows[i][1] == month) {
      sheet.deleteRow(i + 1);
      break;
    }
  }

  updateMedidores(ss);
  updateDistribucion(ss);
  return { success: true };
}

// ── Sort Registros by year/month ──

function sortRegistros(sheet) {
  const monthOrder = {
    'Enero':1,'Febrero':2,'Marzo':3,'Abril':4,'Mayo':5,'Junio':6,
    'Julio':7,'Agosto':8,'Septiembre':9,'Octubre':10,'Noviembre':11,'Diciembre':12
  };
  const data = sheet.getDataRange().getValues();
  if (data.length <= 2) return;

  const header = data[0];
  const rows = data.slice(1);
  rows.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] - b[0];
    return (monthOrder[a[1]] || 0) - (monthOrder[b[1]] || 0);
  });

  sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
}

// ── Update Medidores sheet ──

function updateMedidores(ss) {
  const regSheet = ss.getSheetByName(SHEET_REGISTROS);
  let medSheet = ss.getSheetByName(SHEET_MEDIDORES);
  if (!regSheet || !medSheet) return;
  // Segunda barrera: esta función limpia desde la fila 2, así que no puede
  // tocar una hoja que no sea de la app aunque se llame igual.
  if (!esHojaDeLaApp(medSheet, CAB_MEDIDORES)) return;

  const data = regSheet.getDataRange().getValues();
  if (data.length <= 1) return;

  // Clear old data
  if (medSheet.getLastRow() > 1) {
    medSheet.getRange(2, 1, medSheet.getLastRow() - 1, 7).clearContent();
  }

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const year = data[i][0];
    const month = data[i][1];
    const lecS = data[i][2];
    const lecC = data[i][3];
    const totalM3 = data[i][7];

    if (i === 1) {
      // First row: may be initial
      rows.push([year, month, lecS, lecC, '', '', '']);
      continue;
    }

    const prevLecS = data[i-1][2];
    const prevLecC = data[i-1][3];
    const consumoS = lecS - prevLecS;
    const consumoC = lecC - prevLecC;
    // Los m³ registrados ya vienen sin la fuga, así que Arturo es el residuo.
    const consumoA = totalM3 ? totalM3 - consumoS - consumoC : '';

    rows.push([year, month, lecS, lecC, consumoS, consumoC, consumoA]);
  }

  if (rows.length > 0) {
    medSheet.getRange(2, 1, rows.length, 7).setValues(rows);
  }
}

// ── Update Distribución sheet ──

function updateDistribucion(ss) {
  const regSheet = ss.getSheetByName(SHEET_REGISTROS);
  let distSheet = ss.getSheetByName(SHEET_DISTRIBUCION);
  if (!regSheet || !distSheet) return;
  if (!esHojaDeLaApp(distSheet, CAB_DISTRIBUCION)) return;

  const data = regSheet.getDataRange().getValues();
  if (data.length <= 2) return;

  // Clear old data
  if (distSheet.getLastRow() > 1) {
    distSheet.getRange(2, 1, distSheet.getLastRow() - 1, 11).clearContent();
  }

  const rows = [];
  for (let i = 2; i < data.length; i++) {
    const year = data[i][0];
    const month = data[i][1];
    const lecS = data[i][2];
    const lecC = data[i][3];
    const total3Casas = data[i][5];
    const trifasica = data[i][6] || 0;
    const totalM3 = data[i][7];
    const perdida = data[i][8] || 0;

    if (!totalM3 || !total3Casas) continue;

    const prevLecS = data[i-1][2];
    const prevLecC = data[i-1][3];
    const consumoS = lecS - prevLecS;
    const consumoC = lecC - prevLecC;
    const consumoA = totalM3 - consumoS - consumoC;

    const houses = [
      ['Soraya', consumoS, consumoS / totalM3],
      ['Cristian', consumoC, consumoC / totalM3],
      ['Arturo', consumoA, consumoA / totalM3]
    ];

    // El mismo porcentaje reparte agua, trifásica y pérdida.
    houses.forEach(function (h) {
      const pct = h[2];
      const costoAgua = total3Casas * pct;
      const costoTri = trifasica * pct;
      const costoPerdida = perdida * pct;
      rows.push([year, month, h[0], h[1], pct, costoAgua, costoTri, costoPerdida,
        costoAgua + costoTri + costoPerdida, total3Casas, totalM3]);
    });
  }

  if (rows.length > 0) {
    distSheet.getRange(2, 1, rows.length, 11).setValues(rows);
    distSheet.getRange(2, 5, rows.length, 1).setNumberFormat('0.0%');
    distSheet.getRange(2, 6, rows.length, 4).setNumberFormat('#,##0');
  }
}
