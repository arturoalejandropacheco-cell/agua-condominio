(function () {
    'use strict';

    const STORAGE_KEY = 'agua_condominio_data';
    const CONFIG_KEY = 'agua_condominio_config';
    const SEED_VERSION_KEY = 'agua_condominio_seed_version';
    const MONTHS_ORDER = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

    // Las casas que pagan, y todo lo que se reparte (la pérdida también consume
    // m³ y por lo tanto arrastra costo, aunque no sea una casa).
    const CASAS = ['soraya', 'cristian', 'arturo'];
    const REPARTO = ['soraya', 'cristian', 'arturo', 'perdida'];
    const NOMBRES = { soraya: 'Soraya', cristian: 'Cristian', arturo: 'Arturo', perdida: 'Pérdida' };

    // ── Historical seed data ──
    const SEED_DATA = [
        { year: 2025, month: 'Julio', lecturaSoraya: 608, lecturaCristian: 8626, isInitial: true },
        { year: 2025, month: 'Agosto', lecturaSoraya: 652, lecturaCristian: 8637, totalCuenta: 119550, total3Casas: 119550, trifasica: 0, totalM3: 83 },
        { year: 2025, month: 'Septiembre', lecturaSoraya: 724, lecturaCristian: 8646, totalCuenta: 164534, total3Casas: 164534, trifasica: 0, totalM3: 108 },
        { year: 2025, month: 'Octubre', lecturaSoraya: 768, lecturaCristian: 8651, totalCuenta: 243634, total3Casas: 98881, trifasica: 0, totalM3: 97 },
        { year: 2025, month: 'Noviembre', lecturaSoraya: 800, lecturaCristian: 8663, totalCuenta: 252027, total3Casas: 55199, trifasica: 0, totalM3: 76 },
        { year: 2025, month: 'Diciembre', lecturaSoraya: 846, lecturaCristian: 8679, totalCuenta: 518420, total3Casas: 91267, trifasica: 58854, totalM3: 75 },
        { year: 2026, month: 'Enero', lecturaSoraya: 906, lecturaCristian: 8701, totalCuenta: 518740, total3Casas: 120445, trifasica: 87663, totalM3: 106 },
        { year: 2026, month: 'Febrero', lecturaSoraya: 981, lecturaCristian: 8710, totalCuenta: 624170, total3Casas: 245712, trifasica: 114158, totalM3: 150 },
        { year: 2026, month: 'Marzo', lecturaSoraya: 999, lecturaCristian: 8722, totalCuenta: 475140, total3Casas: 138415, trifasica: 96161, totalM3: 73 },
        { year: 2026, month: 'Abril', lecturaSoraya: 1016, lecturaCristian: 8733, totalCuenta: 637540, total3Casas: 215527, trifasica: 85569, totalM3: 145, perdidaM3: 69 },
    ];
    // Subir este número agrega los meses nuevos de SEED_DATA a los datos ya
    // guardados, sin pisar nada de lo que el usuario haya editado.
    const SEED_VERSION = 2;

    // ── State ──
    let records = [];
    let editingKey = null;
    let config = { appsScriptUrl: '' };

    // ── DOM refs ──
    const form = document.getElementById('monthly-form');
    const yearSel = document.getElementById('year');
    const monthSel = document.getElementById('month');
    const btnSubmit = document.getElementById('btn-submit');
    const resultsSection = document.getElementById('results');
    const resultsContent = document.getElementById('results-content');
    const historyList = document.getElementById('history-list');
    const editInfo = document.getElementById('edit-info');
    const editPeriod = document.getElementById('edit-period');
    const cancelEditBtn = document.getElementById('cancel-edit');
    const hintSoraya = document.getElementById('hint-soraya');
    const hintCristian = document.getElementById('hint-cristian');
    const syncStatusBar = document.getElementById('sync-status');

    // ── Google Sheets API ──
    function getApiUrl() { return config.appsScriptUrl; }
    function isOnline() { return !!config.appsScriptUrl; }

    function showSyncStatus(msg, type) {
        syncStatusBar.textContent = msg;
        syncStatusBar.className = 'sync-status ' + type;
        syncStatusBar.classList.remove('hidden');
        if (type !== 'syncing') {
            setTimeout(() => syncStatusBar.classList.add('hidden'), 4000);
        }
    }

    async function apiCall(action, body) {
        if (!isOnline()) return null;
        if (action === 'read') {
            const resp = await fetch(getApiUrl() + '?action=read', { redirect: 'follow' });
            return resp.json();
        }

        // Escrituras por POST con Content-Type text/plain: es una petición
        // "simple" (sin preflight CORS) y Apps Script la responde tras el 302,
        // así que sí podemos leer si guardó o falló.
        try {
            const resp = await fetch(getApiUrl() + '?action=' + action, {
                method: 'POST',
                redirect: 'follow',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(body || {}),
            });
            return await resp.json();
        } catch (err) {
            // Despliegues antiguos o red bloqueada: enviamos a ciegas por iframe.
            return apiCallViaIframe(action, body);
        }
    }

    function apiCallViaIframe(action, body) {
        return new Promise(resolve => {
            const data = encodeURIComponent(JSON.stringify(body || {}));
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = getApiUrl() + '?action=' + action + '&data=' + data;
            document.body.appendChild(iframe);
            setTimeout(() => {
                if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                resolve({ success: true, sinConfirmar: true });
            }, 3000);
        });
    }

    function checkResponse(resp) {
        if (resp && resp.error) throw new Error(resp.error);
        return resp;
    }

    async function syncToCloud(record) {
        if (!isOnline()) return;
        try {
            showSyncStatus('Sincronizando...', 'syncing');
            const resp = checkResponse(await apiCall('save', record));
            showSyncStatus(resp && resp.sinConfirmar
                ? 'Enviado a Google Sheets (sin confirmación del servidor)'
                : 'Sincronizado con Google Sheets', 'online');
        } catch (err) {
            showSyncStatus('Error al sincronizar: ' + err.message, 'error');
        }
    }

    async function deleteFromCloud(year, month) {
        if (!isOnline()) return;
        try {
            showSyncStatus('Eliminando...', 'syncing');
            checkResponse(await apiCall('delete', { year, month }));
            showSyncStatus('Eliminado de Google Sheets', 'online');
        } catch (err) {
            showSyncStatus('Error al eliminar: ' + err.message, 'error');
        }
    }

    async function syncAllToCloud() {
        if (!isOnline()) return;
        try {
            showSyncStatus('Subiendo todos los datos...', 'syncing');
            checkResponse(await apiCall('init', {}));
            let n = 0;
            for (const r of records) {
                checkResponse(await apiCall('save', r));
                n++;
                showSyncStatus('Subiendo ' + n + ' de ' + records.length + '...', 'syncing');
            }
            showSyncStatus(n + ' registros subidos a Google Sheets', 'online');
        } catch (err) {
            showSyncStatus('Error: ' + err.message, 'error');
        }
    }

    async function syncAllFromCloud() {
        if (!isOnline()) { alert('No hay conexión configurada'); return; }
        try {
            showSyncStatus('Descargando datos...', 'syncing');
            const resp = await apiCall('read');
            if (resp && resp.records && resp.records.length > 0) {
                records = resp.records;
                sortRecords();
                saveLocal();
                populateYears();
                renderHistory();
                updateHints();
                showSyncStatus('Datos descargados de Google Sheets (' + records.length + ' registros)', 'online');
            } else {
                showSyncStatus('No se encontraron datos en Google Sheets', 'offline');
            }
        } catch (err) {
            showSyncStatus('Error: ' + err.message, 'error');
        }
    }

    // ── Init ──
    function init() {
        loadConfig();
        loadData();
        populateYears();
        setupTabs();
        setupForm();
        setupEditCancel();
        setupConfig();
        updateHints();
        renderHistory();
        updateSyncIndicator();
    }

    // El rango debe cubrir todos los años con datos: si falta el año de un
    // registro, al editarlo el <select> queda vacío y se guarda con año NaN.
    function populateYears() {
        const current = new Date().getFullYear();
        const years = records.map(r => parseInt(r.year)).filter(y => !isNaN(y));
        const from = Math.min(2025, current, ...years);
        const to = Math.max(current + 4, ...years);

        yearSel.innerHTML = '';
        for (let y = from; y <= to; y++) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            yearSel.appendChild(opt);
        }
        yearSel.value = current;
    }

    function updateSyncIndicator() {
        if (isOnline()) {
            showSyncStatus('Conectado a Google Sheets', 'online');
        }
    }

    // ── Config ──
    function loadConfig() {
        const stored = localStorage.getItem(CONFIG_KEY);
        if (stored) config = JSON.parse(stored);
    }

    function saveConfig() {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    }

    function setupConfig() {
        const urlInput = document.getElementById('apps-script-url');
        const btnSave = document.getElementById('btn-save-config');
        const btnTest = document.getElementById('btn-test-config');
        const btnSyncUp = document.getElementById('btn-sync-up');
        const btnSyncDown = document.getElementById('btn-sync-down');
        const configStatus = document.getElementById('config-status');

        if (config.appsScriptUrl) {
            urlInput.value = config.appsScriptUrl;
        }

        btnSave.addEventListener('click', () => {
            const url = urlInput.value.trim();
            config.appsScriptUrl = url;
            saveConfig();
            configStatus.textContent = url ? 'Conexión guardada' : 'Conexión eliminada (modo local)';
            configStatus.className = 'config-status ' + (url ? 'success' : 'error');
            configStatus.classList.remove('hidden');
            updateSyncIndicator();
        });

        btnTest.addEventListener('click', async () => {
            const url = urlInput.value.trim();
            if (!url) {
                configStatus.textContent = 'Ingresa una URL primero';
                configStatus.className = 'config-status error';
                configStatus.classList.remove('hidden');
                return;
            }
            configStatus.textContent = 'Probando conexión...';
            configStatus.className = 'config-status';
            configStatus.classList.remove('hidden');

            try {
                const resp = await fetch(url + '?action=read', { redirect: 'follow' });
                const data = await resp.json();
                if (data.records !== undefined) {
                    configStatus.textContent = 'Conexión exitosa. ' + data.records.length + ' registros encontrados.';
                    configStatus.className = 'config-status success';
                } else if (data.error) {
                    configStatus.textContent = 'Error: ' + data.error;
                    configStatus.className = 'config-status error';
                } else {
                    configStatus.textContent = 'Respuesta inesperada del servidor';
                    configStatus.className = 'config-status error';
                }
            } catch (err) {
                configStatus.textContent = 'Error de conexión: ' + err.message;
                configStatus.className = 'config-status error';
            }
        });

        btnSyncUp.addEventListener('click', () => {
            if (!isOnline()) { alert('Configura la URL primero'); return; }
            if (confirm('¿Subir todos los datos locales a Google Sheets? Esto reemplazará los datos existentes.')) {
                syncAllToCloud();
            }
        });

        btnSyncDown.addEventListener('click', () => {
            if (!isOnline()) { alert('Configura la URL primero'); return; }
            if (confirm('¿Descargar datos de Google Sheets? Esto reemplazará los datos locales.')) {
                syncAllFromCloud();
            }
        });
    }

    // ── Persistence ──
    function loadData() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            records = JSON.parse(stored);
            mergeSeed();
        } else {
            records = SEED_DATA.slice();
            saveLocal();
            localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION));
        }
    }

    // Agrega los meses de SEED_DATA que falten. Corre una sola vez por versión
    // y nunca reemplaza un registro existente.
    function mergeSeed() {
        const vista = parseInt(localStorage.getItem(SEED_VERSION_KEY)) || 0;
        if (vista >= SEED_VERSION) return;

        const existentes = new Set(records.map(key));
        const nuevos = SEED_DATA.filter(r => !existentes.has(key(r)));
        if (nuevos.length > 0) {
            records = records.concat(nuevos);
            sortRecords();
            saveLocal();
        }
        localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION));
    }

    function saveLocal() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    }

    // ── Tabs ──
    function setupTabs() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
                if (btn.dataset.tab === 'history') renderHistory();
            });
        });
    }

    // ── Helpers ──
    function key(r) { return r.year + '-' + r.month; }
    function monthIdx(m) { return MONTHS_ORDER.indexOf(m); }

    // parseFloat, no parseInt: los medidores y las boletas pueden traer decimales.
    function num(id) {
        const raw = document.getElementById(id).value.trim();
        if (raw === '') return NaN;
        return parseFloat(raw);
    }

    // Devuelve '' solo cuando el valor no existe; 0 es un valor válido.
    function inputValue(v) {
        return (v === null || v === undefined || v === '') ? '' : v;
    }

    function sortRecords() {
        records.sort((a, b) => a.year !== b.year ? a.year - b.year : monthIdx(a.month) - monthIdx(b.month));
    }

    function getPrevRecord(year, month) {
        sortRecords();
        const target = year * 100 + monthIdx(month);
        let prev = null;
        for (const r of records) {
            const val = r.year * 100 + monthIdx(r.month);
            if (val < target) prev = r;
        }
        return prev;
    }

    function fmtCLP(n) {
        return '$' + Math.round(n).toLocaleString('es-CL');
    }

    function fmtPct(n) {
        return (n * 100).toFixed(1) + '%';
    }

    // ── Hints: show previous meter reading ──
    function updateHints() {
        const year = parseInt(yearSel.value);
        const month = monthSel.value;
        const prev = getPrevRecord(year, month);
        if (prev) {
            hintSoraya.textContent = 'Anterior: ' + prev.lecturaSoraya + ' m³';
            hintCristian.textContent = 'Anterior: ' + prev.lecturaCristian + ' m³';
        } else {
            hintSoraya.textContent = 'Sin lectura anterior';
            hintCristian.textContent = 'Sin lectura anterior';
        }
    }

    // ── Form ──
    function setupForm() {
        yearSel.addEventListener('change', updateHints);
        monthSel.addEventListener('change', updateHints);

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            const data = {
                year: parseInt(yearSel.value),
                month: monthSel.value,
                lecturaSoraya: num('lectura-soraya'),
                lecturaCristian: num('lectura-cristian'),
                totalCuenta: num('total-cuenta'),
                total3Casas: num('total-3casas'),
                trifasica: num('trifasica'),
                totalM3: num('total-m3'),
                perdidaM3: isNaN(num('perdida-m3')) ? 0 : num('perdida-m3'),
            };

            if (isNaN(data.year)) {
                alert('Selecciona un año válido.');
                return;
            }
            if (isNaN(data.trifasica)) {
                alert('La trifásica es obligatoria. Si este mes no hubo cobro, ingresa 0.');
                document.getElementById('trifasica').focus();
                return;
            }
            const faltantes = ['lecturaSoraya','lecturaCristian','totalCuenta','total3Casas','totalM3']
                .filter(f => isNaN(data[f]));
            if (faltantes.length > 0) {
                alert('Faltan datos numéricos en el formulario.');
                return;
            }

            const k = key(data);
            const original = editingKey ? records.find(r => key(r) === editingKey) : null;
            const movedPeriod = !!(editingKey && editingKey !== k);

            // Al editar puede cambiar el período: hay que quitar el registro
            // original Y cualquier registro que ya ocupe el período destino,
            // si no quedan dos filas con la misma clave.
            if (movedPeriod && records.some(r => key(r) === k)) {
                if (!confirm('Ya existen datos para ' + data.month + ' ' + data.year + '. ¿Deseas reemplazarlos?')) return;
            }

            if (editingKey) {
                records = records.filter(r => key(r) !== editingKey && key(r) !== k);
                records.push(data);
                editingKey = null;
                editInfo.classList.add('hidden');
                btnSubmit.textContent = 'Calcular y Guardar';
            } else if (records.some(r => key(r) === k)) {
                if (!confirm('Ya existen datos para ' + data.month + ' ' + data.year + '. ¿Deseas reemplazarlos?')) return;
                records = records.filter(r => key(r) !== k);
                records.push(data);
            } else {
                records.push(data);
            }

            sortRecords();
            saveLocal();

            const result = calculate(data);
            showResults(data, result);
            form.reset();
            yearSel.value = data.year;
            monthSel.value = data.month;
            updateHints();
            renderHistory();

            // Nube al final y en orden: primero se borra el período viejo,
            // recién después se guarda el nuevo.
            if (movedPeriod && original) await deleteFromCloud(original.year, original.month);
            syncToCloud(data);
        });
    }

    function setupEditCancel() {
        cancelEditBtn.addEventListener('click', () => {
            editingKey = null;
            editInfo.classList.add('hidden');
            btnSubmit.textContent = 'Calcular y Guardar';
            form.reset();
            yearSel.value = new Date().getFullYear();
            updateHints();
        });
    }

    // ── Calculation ──
    function calculate(record) {
        const prev = getPrevRecord(record.year, record.month);
        if (!prev) return null;

        const total = record.totalM3;
        // Registros antiguos (o bajados de la hoja) pueden no traer el campo.
        const montoAgua = Number(record.total3Casas) || 0;
        const montoTri = Number(record.trifasica) || 0;
        const perdida = Number(record.perdidaM3) || 0;

        const consumo = {
            soraya: record.lecturaSoraya - prev.lecturaSoraya,
            cristian: record.lecturaCristian - prev.lecturaCristian,
        };
        // Arturo sigue siendo el residuo, pero descontando la pérdida declarada.
        consumo.arturo = total - consumo.soraya - consumo.cristian - perdida;
        consumo.perdida = perdida;

        const pct = {}, costoAgua = {}, costoTri = {}, costoTotal = {};
        REPARTO.forEach(h => {
            pct[h] = total > 0 ? consumo[h] / total : 0;
            costoAgua[h] = montoAgua * pct[h];
            costoTri[h] = montoTri * pct[h];
            costoTotal[h] = costoAgua[h] + costoTri[h];
        });

        return {
            consumo: consumo,
            pct: pct,
            costoAgua: costoAgua,
            costoTri: costoTri,
            total: costoTotal,
            hayPerdida: perdida > 0,
            // Arturo asume la pérdida: esto es lo que efectivamente paga cada casa.
            pagar: {
                soraya: costoTotal.soraya,
                cristian: costoTotal.cristian,
                arturo: costoTotal.arturo + costoTotal.perdida,
            },
            prev: prev,
            mesesSalto: (record.year * 12 + monthIdx(record.month)) - (prev.year * 12 + monthIdx(prev.month)),
        };
    }

    // ── Validaciones ──
    // El consumo de Arturo se obtiene por diferencia, así que cualquier error
    // de lectura o de m³ de boleta se le carga entero a él: hay que avisarlo.
    function warnings(record, result) {
        const w = [];
        const box = m => `<div class="validation-warning">${m}</div>`;

        if (result.consumo.soraya < 0) {
            w.push(box('La lectura de Soraya es menor que la del período anterior (' + result.prev.lecturaSoraya + ' m³). Revisa el medidor.'));
        }
        if (result.consumo.cristian < 0) {
            w.push(box('La lectura de Cristian es menor que la del período anterior (' + result.prev.lecturaCristian + ' m³). Revisa el medidor.'));
        }
        if (result.consumo.arturo < 0) {
            w.push(box('El consumo de Arturo resulta negativo: Soraya + Cristian' +
                (result.hayPerdida ? ' + pérdida' : '') + ' (' +
                (result.consumo.soraya + result.consumo.cristian + result.consumo.perdida) +
                ' m³) supera el total de boleta (' + record.totalM3 + ' m³). Revisa las lecturas' +
                (result.hayPerdida ? ', la pérdida' : '') + ' o el total.'));
        }
        if (result.hayPerdida) {
            w.push(box('Este mes tiene ' + result.consumo.perdida + ' m³ de pérdida (' +
                fmtPct(result.pct.perdida) + ' de la boleta, ' + fmtCLP(result.total.perdida) +
                '), que asume Arturo.'));
        }
        if (result.mesesSalto > 1) {
            w.push(box('El período anterior con datos es ' + result.prev.month + ' ' + result.prev.year +
                ' (' + result.mesesSalto + ' meses atrás). El consumo calculado abarca todo ese lapso, ' +
                'pero el total de boleta es de un solo mes.'));
        }
        if (!(Number(record.total3Casas) > 0)) {
            w.push(box('El total de las 3 casas es 0: no se puede repartir el costo del agua.'));
        }
        return w.join('');
    }

    // ── Tabla de desglose (compartida por resultados e historial) ──
    // Las filas suman exactamente el total de boleta: la pérdida es una fila
    // más, no un monto suelto fuera del cuadro.
    function renderTable(record, result) {
        const filas = result.hayPerdida ? REPARTO : CASAS;

        let html = `<div class="result-summary">
            <div class="tabla-scroll">
            <table>
                <thead>
                    <tr>
                        <th>Casa</th>
                        <th class="text-right">m³</th>
                        <th class="text-right col-pct">%</th>
                        <th class="text-right">Agua</th>
                        <th class="text-right">Trifásica</th>
                        <th class="text-right">Total</th>
                    </tr>
                </thead>
                <tbody>`;

        filas.forEach(h => {
            html += `
                    <tr>
                        <td><span class="dot ${h}"></span>${NOMBRES[h]}</td>
                        <td class="text-right">${result.consumo[h]}</td>
                        <td class="text-right col-pct">${fmtPct(result.pct[h])}</td>
                        <td class="text-right">${fmtCLP(result.costoAgua[h])}</td>
                        <td class="text-right">${fmtCLP(result.costoTri[h])}</td>
                        <td class="text-right">${fmtCLP(result.total[h])}</td>
                    </tr>`;
        });

        const granTotal = filas.reduce((s, h) => s + result.total[h], 0);
        html += `
                    <tr>
                        <td>TOTAL</td>
                        <td class="text-right">${record.totalM3}</td>
                        <td class="text-right col-pct">100%</td>
                        <td class="text-right">${fmtCLP(record.total3Casas)}</td>
                        <td class="text-right">${fmtCLP(record.trifasica)}</td>
                        <td class="text-right">${fmtCLP(granTotal)}</td>
                    </tr>
                </tbody>
            </table>
            </div>`;

        if (result.hayPerdida) {
            html += `<p class="nota-perdida">Arturo asume la pérdida:
                ${fmtCLP(result.total.arturo)} de consumo propio + ${fmtCLP(result.total.perdida)} de pérdida =
                <strong>${fmtCLP(result.pagar.arturo)}</strong></p>`;
        }

        return html + '</div>';
    }

    // ── Results display ──
    function showResults(record, result) {
        if (!result) {
            resultsContent.innerHTML = '<div class="validation-warning">No se encontró lectura anterior para calcular el consumo.</div>';
            resultsSection.classList.remove('hidden');
            return;
        }

        let html = warnings(record, result);

        CASAS.forEach(h => {
            const asumePerdida = h === 'arturo' && result.hayPerdida;
            html += `
                <div class="result-card">
                    <div class="result-card-header ${h}">
                        <span><span class="dot ${h}"></span>${NOMBRES[h]}</span>
                        <span class="result-total">${fmtCLP(result.pagar[h])}</span>
                    </div>
                    <div class="result-detail">
                        <span>Consumo <span class="value">${result.consumo[h]} m³</span></span>
                        <span>Porcentaje <span class="value">${fmtPct(result.pct[h])}</span></span>
                        <span>Agua <span class="value">${fmtCLP(result.costoAgua[h])}</span></span>
                        <span>Trifásica <span class="value">${fmtCLP(result.costoTri[h])}</span></span>
                        ${asumePerdida ? `<span>Consumo propio <span class="value">${fmtCLP(result.total[h])}</span></span>
                        <span>Pérdida asumida <span class="value">${fmtCLP(result.total.perdida)}</span></span>` : ''}
                    </div>
                </div>`;
        });

        html += renderTable(record, result);
        resultsContent.innerHTML = html;
        resultsSection.classList.remove('hidden');
        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    // ── History ──
    function renderHistory() {
        sortRecords();
        const billRecords = records.filter(r => !r.isInitial);

        if (billRecords.length === 0) {
            historyList.innerHTML = '<div class="empty-state"><p>No hay registros aún.<br>Agrega el primer mes.</p></div>';
            return;
        }

        let html = '';
        [...billRecords].reverse().forEach(record => {
            const result = calculate(record);
            const totalMes = result
                ? Math.round(result.pagar.soraya + result.pagar.cristian + result.pagar.arturo)
                : 0;
            const k = key(record);

            html += `<div class="history-card" data-key="${k}">
                <div class="history-header" onclick="this.parentElement.classList.toggle('open')">
                    <div>
                        <div class="history-period">${record.month} ${record.year}</div>
                        <div class="history-total">${fmtCLP(totalMes)} — ${record.totalM3} m³</div>
                    </div>
                    <span class="history-chevron">▼</span>
                </div>
                <div class="history-body">`;

            if (result) {
                html += renderTable(record, result);
            } else {
                html += '<p style="color:var(--text-light);font-size:0.85rem;">Sin lectura anterior para calcular.</p>';
            }

            html += `<div class="history-actions">
                <button class="btn-edit" onclick="window.appEditRecord('${k}')">Editar</button>
                <button class="btn-delete" onclick="window.appDeleteRecord('${k}')">Eliminar</button>
            </div></div></div>`;
        });

        historyList.innerHTML = html;
    }

    // ── Edit / Delete (exposed globally) ──
    window.appEditRecord = function (k) {
        const record = records.find(r => key(r) === k);
        if (!record) return;

        editingKey = k;
        editPeriod.textContent = record.month + ' ' + record.year;
        editInfo.classList.remove('hidden');
        btnSubmit.textContent = 'Actualizar';

        yearSel.value = record.year;
        monthSel.value = record.month;
        document.getElementById('lectura-soraya').value = inputValue(record.lecturaSoraya);
        document.getElementById('lectura-cristian').value = inputValue(record.lecturaCristian);
        document.getElementById('total-cuenta').value = inputValue(record.totalCuenta);
        document.getElementById('total-3casas').value = inputValue(record.total3Casas);
        document.getElementById('trifasica').value = inputValue(record.trifasica);
        document.getElementById('total-m3').value = inputValue(record.totalM3);
        document.getElementById('perdida-m3').value = inputValue(record.perdidaM3);

        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-tab="form"]').classList.add('active');
        document.getElementById('tab-form').classList.add('active');

        updateHints();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.appDeleteRecord = function (k) {
        const record = records.find(r => key(r) === k);
        if (!record) return;
        if (!confirm('¿Eliminar datos de ' + record.month + ' ' + record.year + '?')) return;

        records = records.filter(r => key(r) !== k);
        saveLocal();
        deleteFromCloud(record.year, record.month);
        renderHistory();
    };

    // ── Start ──
    init();
})();
