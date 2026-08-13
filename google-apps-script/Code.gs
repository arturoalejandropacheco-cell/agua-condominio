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

function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Sheet: Registros (raw input data)
  let reg = ss.getSheetByName(SHEET_REGISTROS);
  if (!reg) {
    reg = ss.insertSheet(SHEET_REGISTROS);
  }
  reg.getRange('A1:I1').setValues([[
    'Año', 'Mes', 'Lectura Soraya', 'Lectura Cristian',
    'Total Cuenta ($)', 'Total 3 Casas ($)', 'Trifásica ($)', 'Total m³', 'Pérdida m³'
  ]]);
  reg.getRange('A1:I1').setFontWeight('bold');
  reg.setFrozenRows(1);

  // Sheet: Medidores (calculated)
  let med = ss.getSheetByName(SHEET_MEDIDORES);
  if (!med) {
    med = ss.insertSheet(SHEET_MEDIDORES);
  }
  med.getRange('A1:H1').setValues([[
    'Año', 'Mes', 'Lectura Soraya', 'Lectura Cristian',
    'Consumo Soraya (m³)', 'Consumo Cristian (m³)', 'Consumo Arturo (m³)', 'Pérdida (m³)'
  ]]);
  med.getRange('A1:H1').setFontWeight('bold');
  med.setFrozenRows(1);

  // Sheet: Distribución (calculated)
  let dist = ss.getSheetByName(SHEET_DISTRIBUCION);
  if (!dist) {
    dist = ss.insertSheet(SHEET_DISTRIBUCION);
  }
  dist.getRange('A1:J1').setValues([[
    'Año', 'Mes', 'Casa', 'Consumo (m³)', '% Consumo',
    'Costo Agua ($)', 'Costo Trifásica ($)', 'Total a Pagar ($)',
    'Total 3 Casas ($)', 'Total m³'
  ]]);
  dist.getRange('A1:J1').setFontWeight('bold');
  dist.setFrozenRows(1);

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
      perdidaM3: row[8] || 0,
      isInitial: row[4] === '' || row[4] === null || row[4] === 0
    });
  }

  return { records: records };
}

// ── Save (upsert) a record ──

function saveRecord(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_REGISTROS);
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
    data.perdidaM3 || 0
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

  const data = regSheet.getDataRange().getValues();
  if (data.length <= 1) return;

  // Clear old data
  if (medSheet.getLastRow() > 1) {
    medSheet.getRange(2, 1, medSheet.getLastRow() - 1, 8).clearContent();
  }

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const year = data[i][0];
    const month = data[i][1];
    const lecS = data[i][2];
    const lecC = data[i][3];
    const totalM3 = data[i][7];
    const perdida = data[i][8] || 0;

    if (i === 1) {
      // First row: may be initial
      rows.push([year, month, lecS, lecC, '', '', '', '']);
      continue;
    }

    const prevLecS = data[i-1][2];
    const prevLecC = data[i-1][3];
    const consumoS = lecS - prevLecS;
    const consumoC = lecC - prevLecC;
    const consumoA = totalM3 ? totalM3 - consumoS - consumoC - perdida : '';

    rows.push([year, month, lecS, lecC, consumoS, consumoC, consumoA, perdida]);
  }

  if (rows.length > 0) {
    medSheet.getRange(2, 1, rows.length, 8).setValues(rows);
  }
}

// ── Update Distribución sheet ──

function updateDistribucion(ss) {
  const regSheet = ss.getSheetByName(SHEET_REGISTROS);
  let distSheet = ss.getSheetByName(SHEET_DISTRIBUCION);
  if (!regSheet || !distSheet) return;

  const data = regSheet.getDataRange().getValues();
  if (data.length <= 2) return;

  // Clear old data
  if (distSheet.getLastRow() > 1) {
    distSheet.getRange(2, 1, distSheet.getLastRow() - 1, 10).clearContent();
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
    const consumoA = totalM3 - consumoS - consumoC - perdida;

    const pctS = consumoS / totalM3;
    const pctC = consumoC / totalM3;
    const pctA = consumoA / totalM3;

    const houses = [
      ['Soraya', consumoS, pctS],
      ['Cristian', consumoC, pctC],
      ['Arturo', consumoA, pctA]
    ];
    // La pérdida es una fila más: consume m³ y arrastra costo, y la asume Arturo.
    if (perdida > 0) {
      houses.push(['Pérdida (la asume Arturo)', perdida, perdida / totalM3]);
    }

    houses.forEach(([name, consumo, pct]) => {
      const costoAgua = total3Casas * pct;
      const costoTri = trifasica * pct;
      rows.push([year, month, name, consumo, pct, costoAgua, costoTri, costoAgua + costoTri, total3Casas, totalM3]);
    });
  }

  if (rows.length > 0) {
    distSheet.getRange(2, 1, rows.length, 10).setValues(rows);
    // Format percentages
    const pctRange = distSheet.getRange(2, 5, rows.length, 1);
    pctRange.setNumberFormat('0.0%');
    // Format currency
    distSheet.getRange(2, 6, rows.length, 3).setNumberFormat('#,##0');
  }
}
