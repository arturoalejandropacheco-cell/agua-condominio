(function () {
    'use strict';

    const STORAGE_KEY = 'agua_condominio_data';
    const CONFIG_KEY = 'agua_condominio_config';
    const MONTHS_ORDER = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

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
    ];

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
        // For POST actions, Google Apps Script redirects 302 which causes CORS issues.
        // Workaround: encode data as URL param and use GET via a hidden form/redirect.
        return new Promise((resolve, reject) => {
            const data = encodeURIComponent(JSON.stringify(body || {}));
            const url = getApiUrl() + '?action=' + action + '&data=' + data;
            // Use an iframe to avoid CORS — fire-and-forget for writes
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = url;
            document.body.appendChild(iframe);
            // Give it time to complete, then clean up
            setTimeout(() => {
                document.body.removeChild(iframe);
                resolve({ success: true });
            }, 3000);
        });
    }

    async function syncToCloud(record) {
        if (!isOnline()) return;
        try {
            showSyncStatus('Sincronizando...', 'syncing');
            await apiCall('save', record);
            showSyncStatus('Sincronizado con Google Sheets', 'online');
        } catch (err) {
            showSyncStatus('Error al sincronizar: ' + err.message, 'error');
        }
    }

    async function deleteFromCloud(year, month) {
        if (!isOnline()) return;
        try {
            showSyncStatus('Eliminando...', 'syncing');
            await apiCall('delete', { year, month });
            showSyncStatus('Eliminado de Google Sheets', 'online');
        } catch (err) {
            showSyncStatus('Error al eliminar: ' + err.message, 'error');
        }
    }

    async function syncAllToCloud() {
        if (!isOnline()) return;
        try {
            showSyncStatus('Subiendo todos los datos...', 'syncing');
            // First init sheets
            await apiCall('init', {});
            // Then save each record
            for (const r of records) {
                await apiCall('save', r);
            }
            showSyncStatus('Todos los datos subidos a Google Sheets', 'online');
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
        populateYears();
        loadData();
        setupTabs();
        setupForm();
        setupEditCancel();
        setupConfig();
        updateHints();
        renderHistory();
        updateSyncIndicator();
    }

    function populateYears() {
        for (let y = 2026; y <= 2030; y++) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            yearSel.appendChild(opt);
        }
        yearSel.value = new Date().getFullYear();
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
        } else {
            records = SEED_DATA.slice();
            saveLocal();
        }
    }

    function saveLocal() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    }

    function saveData(changedRecord) {
        saveLocal();
        if (changedRecord) syncToCloud(changedRecord);
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

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            const data = {
                year: parseInt(yearSel.value),
                month: monthSel.value,
                lecturaSoraya: parseInt(document.getElementById('lectura-soraya').value),
                lecturaCristian: parseInt(document.getElementById('lectura-cristian').value),
                totalCuenta: parseInt(document.getElementById('total-cuenta').value),
                total3Casas: parseInt(document.getElementById('total-3casas').value),
                trifasica: parseInt(document.getElementById('trifasica').value) || 0,
                totalM3: parseInt(document.getElementById('total-m3').value),
            };

            const k = key(data);
            const existingIdx = records.findIndex(r => key(r) === k);

            if (editingKey) {
                const oldIdx = records.findIndex(r => key(r) === editingKey);
                if (oldIdx !== -1) records.splice(oldIdx, 1);
                records.push(data);
                editingKey = null;
                editInfo.classList.add('hidden');
                btnSubmit.textContent = 'Calcular y Guardar';
            } else if (existingIdx !== -1) {
                if (!confirm('Ya existen datos para ' + data.month + ' ' + data.year + '. ¿Deseas reemplazarlos?')) return;
                records[existingIdx] = data;
            } else {
                records.push(data);
            }

            sortRecords();
            saveData(data);

            const result = calculate(data);
            showResults(data, result);
            form.reset();
            yearSel.value = data.year;
            updateHints();
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

        const consumoSoraya = record.lecturaSoraya - prev.lecturaSoraya;
        const consumoCristian = record.lecturaCristian - prev.lecturaCristian;
        const consumoArturo = record.totalM3 - consumoSoraya - consumoCristian;

        const total = record.totalM3;
        const pctSoraya = total > 0 ? consumoSoraya / total : 0;
        const pctCristian = total > 0 ? consumoCristian / total : 0;
        const pctArturo = total > 0 ? consumoArturo / total : 0;

        const costoAguaSoraya = record.total3Casas * pctSoraya;
        const costoAguaCristian = record.total3Casas * pctCristian;
        const costoAguaArturo = record.total3Casas * pctArturo;

        const costoTriSoraya = record.trifasica * pctSoraya;
        const costoTriCristian = record.trifasica * pctCristian;
        const costoTriArturo = record.trifasica * pctArturo;

        return {
            consumo: { soraya: consumoSoraya, cristian: consumoCristian, arturo: consumoArturo },
            pct: { soraya: pctSoraya, cristian: pctCristian, arturo: pctArturo },
            costoAgua: { soraya: costoAguaSoraya, cristian: costoAguaCristian, arturo: costoAguaArturo },
            costoTri: { soraya: costoTriSoraya, cristian: costoTriCristian, arturo: costoTriArturo },
            total: {
                soraya: costoAguaSoraya + costoTriSoraya,
                cristian: costoAguaCristian + costoTriCristian,
                arturo: costoAguaArturo + costoTriArturo,
            },
        };
    }

    // ── Results display ──
    function showResults(record, result) {
        if (!result) {
            resultsContent.innerHTML = '<div class="validation-warning">No se encontró lectura anterior para calcular el consumo.</div>';
            resultsSection.classList.remove('hidden');
            return;
        }

        let warning = '';
        const sumConsumo = result.consumo.soraya + result.consumo.cristian + result.consumo.arturo;
        if (sumConsumo !== record.totalM3) {
            warning = `<div class="validation-warning">La suma de consumos (${sumConsumo} m³) no coincide con el total de boleta (${record.totalM3} m³).</div>`;
        }
        if (result.consumo.arturo < 0) {
            warning += '<div class="validation-warning">El consumo de Arturo resulta negativo. Revisa las lecturas.</div>';
        }

        const houses = ['soraya', 'cristian', 'arturo'];
        const names = { soraya: 'Soraya', cristian: 'Cristian', arturo: 'Arturo' };

        let html = warning;

        houses.forEach(h => {
            html += `
                <div class="result-card">
                    <div class="result-card-header ${h}">
                        <span><span class="dot ${h}"></span>${names[h]}</span>
                        <span class="result-total">${fmtCLP(result.total[h])}</span>
                    </div>
                    <div class="result-detail">
                        <span>Consumo <span class="value">${result.consumo[h]} m³</span></span>
                        <span>Porcentaje <span class="value">${fmtPct(result.pct[h])}</span></span>
                        <span>Agua <span class="value">${fmtCLP(result.costoAgua[h])}</span></span>
                        <span>Trifásica <span class="value">${fmtCLP(result.costoTri[h])}</span></span>
                    </div>
                </div>`;
        });

        html += `
            <div class="result-summary">
                <table>
                    <thead>
                        <tr>
                            <th>Casa</th>
                            <th class="text-right">m³</th>
                            <th class="text-right">%</th>
                            <th class="text-right">Agua</th>
                            <th class="text-right">Trifásica</th>
                            <th class="text-right">Total</th>
                        </tr>
                    </thead>
                    <tbody>`;

        houses.forEach(h => {
            html += `
                        <tr>
                            <td><span class="dot ${h}"></span>${names[h]}</td>
                            <td class="text-right">${result.consumo[h]}</td>
                            <td class="text-right">${fmtPct(result.pct[h])}</td>
                            <td class="text-right">${fmtCLP(result.costoAgua[h])}</td>
                            <td class="text-right">${fmtCLP(result.costoTri[h])}</td>
                            <td class="text-right">${fmtCLP(result.total[h])}</td>
                        </tr>`;
        });

        const grandTotal = result.total.soraya + result.total.cristian + result.total.arturo;
        html += `
                        <tr>
                            <td>TOTAL</td>
                            <td class="text-right">${record.totalM3}</td>
                            <td class="text-right">100%</td>
                            <td class="text-right">${fmtCLP(record.total3Casas)}</td>
                            <td class="text-right">${fmtCLP(record.trifasica)}</td>
                            <td class="text-right">${fmtCLP(grandTotal)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>`;

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
            const totalMes = result ? Math.round(result.total.soraya + result.total.cristian + result.total.arturo) : 0;
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
                const houses = ['soraya', 'cristian', 'arturo'];
                const names = { soraya: 'Soraya', cristian: 'Cristian', arturo: 'Arturo' };

                html += `<table>
                    <thead>
                        <tr><th>Casa</th><th class="text-right">m³</th><th class="text-right">%</th><th class="text-right">Agua</th><th class="text-right">Trifásica</th><th class="text-right">Total</th></tr>
                    </thead><tbody>`;

                houses.forEach(h => {
                    html += `<tr>
                        <td><span class="dot ${h}"></span>${names[h]}</td>
                        <td class="text-right">${result.consumo[h]}</td>
                        <td class="text-right">${fmtPct(result.pct[h])}</td>
                        <td class="text-right">${fmtCLP(result.costoAgua[h])}</td>
                        <td class="text-right">${fmtCLP(result.costoTri[h])}</td>
                        <td class="text-right">${fmtCLP(result.total[h])}</td>
                    </tr>`;
                });

                html += `<tr>
                    <td>TOTAL</td>
                    <td class="text-right">${record.totalM3}</td>
                    <td class="text-right">100%</td>
                    <td class="text-right">${fmtCLP(record.total3Casas)}</td>
                    <td class="text-right">${fmtCLP(record.trifasica)}</td>
                    <td class="text-right">${fmtCLP(totalMes)}</td>
                </tr></tbody></table>`;
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
        document.getElementById('lectura-soraya').value = record.lecturaSoraya;
        document.getElementById('lectura-cristian').value = record.lecturaCristian;
        document.getElementById('total-cuenta').value = record.totalCuenta || '';
        document.getElementById('total-3casas').value = record.total3Casas || '';
        document.getElementById('trifasica').value = record.trifasica || '';
        document.getElementById('total-m3').value = record.totalM3 || '';

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
