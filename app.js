(function () {
    'use strict';

    const STORAGE_KEY = 'agua_condominio_data';
    const CONFIG_KEY = 'agua_condominio_config';
    const SEED_VERSION_KEY = 'agua_condominio_seed_version';
    const MONTHS_ORDER = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

    // Todo se reparte entre estas tres según su % de consumo: el agua, la
    // trifásica y también la pérdida.
    const CASAS = ['soraya', 'cristian', 'arturo'];
    const NOMBRES = { soraya: 'Soraya', cristian: 'Cristian', arturo: 'Arturo' };

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
        { year: 2026, month: 'Abril', lecturaSoraya: 1016, lecturaCristian: 8733, totalCuenta: 637540, total3Casas: 215526, trifasica: 85569, totalM3: 145, perdidaPesos: 0 },
    ];

    // Abril: totales de boleta completos y sin pérdida este mes. Las lecturas
    // salen del registro de medidores del usuario (Soraya 999→1016,
    // Cristian 8722→8733).
    const CORRECCIONES = [
        { year: 2026, month: 'Abril', lecturaSoraya: 1016, lecturaCristian: 8733, totalCuenta: 637540, total3Casas: 215526, trifasica: 85569, totalM3: 145, perdidaPesos: 0 },
    ];
    // Subir este número agrega los meses nuevos de SEED_DATA a los datos ya
    // guardados, sin pisar nada de lo que el usuario haya editado.
    const SEED_VERSION = 2;
    // Y este convierte registros del modelo viejo (pérdida en m³, absorbida
    // por Arturo) al nuevo (pérdida en $, repartida entre las 3 casas), y
    // aplica las correcciones de datos que el usuario haya confirmado.
    const DATA_VERSION = 4;
    const DATA_VERSION_KEY = 'agua_condominio_data_version';

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

    // Una URL inválida es lo mismo que no tener conexión: así la app trabaja
    // en modo local en vez de intentar (y fallar) una sincronización por cada
    // mes que se guarde.
    function isOnline() {
        return !!config.appsScriptUrl && !validarUrlAppsScript(config.appsScriptUrl);
    }

    let timerSyncStatus = null;

    function showSyncStatus(msg, type, persistente) {
        clearTimeout(timerSyncStatus);
        syncStatusBar.textContent = msg;
        syncStatusBar.className = 'sync-status ' + type;
        syncStatusBar.classList.remove('hidden');
        // Los errores se quedan hasta que el usuario los cierre: si se ocultan
        // solos, un fallo de sincronización pasa desapercibido.
        const queda = persistente === undefined ? type === 'error' : persistente;
        if (queda) {
            syncStatusBar.title = 'Toca para cerrar';
            syncStatusBar.classList.add('clickable');
        } else if (type !== 'syncing') {
            syncStatusBar.classList.remove('clickable');
            timerSyncStatus = setTimeout(() => syncStatusBar.classList.add('hidden'), 4000);
        }
    }

    // Guarda el detalle del último fallo para poder mostrarlo en Config.
    let ultimoError = null;

    // Acepta despliegues normales y de Workspace (/a/macros/dominio/), en /exec o /dev.
    const URL_APPS_SCRIPT = /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/[^/]+\/(exec|dev)\/?$/;

    // Una URL de planilla o del editor no es un error de tipeo: es otra cosa
    // completamente, y no hay nada que corregir en ella. Esas se descartan
    // solas. Una malformada sí se conserva, por si fue un pegado incompleto.
    function esUrlIrrecuperable(url) {
        return /docs\.google\.com\/spreadsheets/.test(url) ||
               /script\.google\.com\/.*\/edit/.test(url) ||
               /script\.google\.com\/home/.test(url);
    }

    // Pegar la URL de la planilla en vez de la del despliegue es el error fácil
    // de cometer: las dos vienen de Google y ninguna se ve "mala".
    function validarUrlAppsScript(url) {
        if (!url) return 'Ingresa una URL primero.';
        if (/docs\.google\.com\/spreadsheets/.test(url)) {
            return 'Esa es la URL de la planilla, no del Apps Script. La que necesitas sale de ' +
                'Apps Script → Implementar → Gestionar implementaciones, y termina en /exec.';
        }
        if (/script\.google\.com\/.*\/edit/.test(url) || /script\.google\.com\/home/.test(url)) {
            return 'Esa es la URL del editor de Apps Script, no la del despliegue. ' +
                'Ve a Implementar → Gestionar implementaciones y copia la URL que termina en /exec.';
        }
        if (!URL_APPS_SCRIPT.test(url)) {
            return 'La URL debe verse así: https://script.google.com/macros/s/XXXXX/exec';
        }
        return null;
    }

    function describirRespuesta(status, texto) {
        const crudo = texto || '';
        // El dominio del login viene en un href, así que se busca antes de
        // limpiar las etiquetas; el texto visible se usa para el resto.
        const limpio = crudo.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (/accounts\.google|ServiceLogin/i.test(crudo) || /inicia\w* sesión|sign in|log in/i.test(limpio)) {
            return 'HTTP ' + status + ': Google pidió iniciar sesión. La implementación debe tener ' +
                'acceso "Cualquier persona", no "Solo yo".';
        }
        if (/autoriza|authorization|permission|denied|no tienes acceso/i.test(limpio)) {
            return 'HTTP ' + status + ': el script no está autorizado. Ábrelo en Apps Script y ' +
                'ejecútalo una vez para dar permisos.';
        }
        return 'HTTP ' + status + ': el servidor no devolvió JSON. Respuesta: ' + limpio.slice(0, 160);
    }

    async function apiCall(action, body) {
        if (!isOnline()) return null;

        if (action === 'read') {
            const resp = await fetch(getApiUrl() + '?action=read', { redirect: 'follow' });
            const texto = await resp.text();
            try {
                return JSON.parse(texto);
            } catch (err) {
                throw new Error(describirRespuesta(resp.status, texto));
            }
        }

        // Escrituras por POST con Content-Type text/plain: es una petición
        // "simple" (sin preflight CORS) y Apps Script la responde tras el 302,
        // así que sí podemos leer si guardó o falló.
        let resp;
        try {
            resp = await fetch(getApiUrl() + '?action=' + action, {
                method: 'POST',
                redirect: 'follow',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(body || {}),
            });
        } catch (err) {
            // Solo aquí corresponde el iframe: la petición ni siquiera salió
            // (CORS, sin red, despliegue que no acepta POST).
            ultimoError = 'La petición no llegó (' + err.message + '). Se envió a ciegas por iframe.';
            return apiCallViaIframe(action, body);
        }

        // Sí hubo respuesta: si no es JSON es un error real del servidor y hay
        // que mostrarlo, no disimularlo con un "enviado sin confirmar".
        const texto = await resp.text();
        try {
            return JSON.parse(texto);
        } catch (err) {
            throw new Error(describirRespuesta(resp.status, texto));
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

    function registrarError(contexto, err) {
        ultimoError = contexto + ' — ' + err.message;
        renderDiagnostico();
    }

    // El último fallo queda visible en Config: si la hoja no se actualiza,
    // el motivo tiene que estar escrito en alguna parte, no adivinarse.
    function renderDiagnostico() {
        const caja = document.getElementById('diagnostico');
        if (!caja) return;
        if (!ultimoError) {
            caja.classList.add('hidden');
            caja.textContent = '';
            return;
        }
        caja.innerHTML = '<strong>Último error de sincronización</strong><br>' +
            ultimoError.replace(/</g, '&lt;');
        caja.classList.remove('hidden');
    }

    async function syncToCloud(record) {
        if (!isOnline()) return;
        try {
            showSyncStatus('Sincronizando...', 'syncing');
            const resp = checkResponse(await apiCall('save', record));
            showSyncStatus(resp && resp.sinConfirmar
                ? 'Enviado a Google Sheets (sin confirmación del servidor)'
                : 'Sincronizado con Google Sheets', 'online');
            renderDiagnostico();
        } catch (err) {
            registrarError('Guardar ' + record.month + ' ' + record.year, err);
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
            registrarError('Eliminar ' + month + ' ' + year, err);
            showSyncStatus('Error al eliminar: ' + err.message, 'error');
        }
    }

    async function syncAllToCloud() {
        if (!isOnline()) return;
        let n = 0;
        try {
            showSyncStatus('Subiendo todos los datos...', 'syncing');
            checkResponse(await apiCall('init', {}));
            for (const r of records) {
                checkResponse(await apiCall('save', r));
                n++;
                showSyncStatus('Subiendo ' + n + ' de ' + records.length + '...', 'syncing');
            }
            ultimoError = null;
            showSyncStatus(n + ' registros subidos a Google Sheets', 'online');
            renderDiagnostico();
        } catch (err) {
            // Decir cuántos alcanzaron a subir: "falló" sin más deja la hoja
            // a medias sin que se note.
            registrarError('Subida masiva (se alcanzaron a subir ' + n + ' de ' + records.length + ')', err);
            showSyncStatus('Error tras subir ' + n + ' de ' + records.length + ': ' + err.message, 'error');
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
                ultimoError = null;
                renderDiagnostico();
                showSyncStatus('Datos descargados de Google Sheets (' + records.length + ' registros)', 'online');
            } else {
                showSyncStatus('No se encontraron datos en Google Sheets', 'offline');
            }
        } catch (err) {
            registrarError('Descarga', err);
            showSyncStatus('Error: ' + err.message, 'error');
        }
    }

    // ── Init ──
    function init() {
        syncStatusBar.addEventListener('click', () => {
            if (syncStatusBar.classList.contains('clickable')) {
                syncStatusBar.classList.add('hidden');
            }
        });
        loadConfig();
        loadData();
        populateYears();
        setupTabs();
        setupForm();
        setupEditCancel();
        setupConfig();
        setupBackup();
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
        if (urlDescartada) {
            // Se avisa una vez, en tono informativo: no hay nada que arreglar.
            showSyncStatus('Se quitó una URL de Google Sheets que no servía (era la de la planilla). ' +
                'Los datos se guardan en la app.', 'online', true);
            return;
        }
        if (!config.appsScriptUrl) return;   // modo local: sin barra, todo normal
        // Una URL guardada que no sirve no es un error de la app: se avisa una
        // vez, en tono de advertencia, y se puede cerrar. La app funciona igual.
        const problema = validarUrlAppsScript(config.appsScriptUrl);
        if (problema) {
            ultimoError = 'URL configurada inválida — ' + problema;
            renderDiagnostico();
            showSyncStatus('Sin conexión a Google Sheets (la URL guardada no sirve). ' +
                'La app funciona igual. Puedes quitarla en Config.', 'offline', true);
        } else {
            showSyncStatus('Conectado a Google Sheets', 'online');
        }
    }

    // ── Config ──
    let urlDescartada = null;

    function loadConfig() {
        const stored = localStorage.getItem(CONFIG_KEY);
        if (stored) config = JSON.parse(stored);

        if (config.appsScriptUrl && esUrlIrrecuperable(config.appsScriptUrl)) {
            urlDescartada = config.appsScriptUrl;
            config.appsScriptUrl = '';
            saveConfig();
        }
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
            configStatus.classList.remove('hidden');

            if (url) {
                const problema = validarUrlAppsScript(url);
                if (problema) {
                    configStatus.textContent = problema;
                    configStatus.className = 'config-status error';
                    return;
                }
            }

            config.appsScriptUrl = url;
            saveConfig();
            configStatus.textContent = url ? 'Conexión guardada' : 'Conexión eliminada (modo local)';
            configStatus.className = 'config-status ' + (url ? 'success' : 'error');
            updateSyncIndicator();
        });

        document.getElementById('btn-clear-config').addEventListener('click', () => {
            config.appsScriptUrl = '';
            saveConfig();
            urlInput.value = '';
            ultimoError = null;
            renderDiagnostico();
            syncStatusBar.classList.add('hidden');
            configStatus.textContent = 'Conexión quitada. La app guarda los datos localmente.';
            configStatus.className = 'config-status success';
            configStatus.classList.remove('hidden');
        });

        btnTest.addEventListener('click', async () => {
            const url = urlInput.value.trim();
            const problema = validarUrlAppsScript(url);
            if (problema) {
                configStatus.textContent = problema;
                configStatus.className = 'config-status error';
                configStatus.classList.remove('hidden');
                return;
            }
            configStatus.textContent = 'Probando conexión...';
            configStatus.className = 'config-status';
            configStatus.classList.remove('hidden');

            // Probar solo la lectura da falsa confianza: lo que falla al
            // actualizar la hoja es la escritura, así que se prueban las dos.
            const urlPrevia = config.appsScriptUrl;
            config.appsScriptUrl = url;
            ultimoError = null;

            let lectura;
            try {
                lectura = await apiCall('read');
                if (lectura.error) throw new Error(lectura.error);
                if (lectura.records === undefined) throw new Error('Respuesta sin campo "records"');
            } catch (err) {
                config.appsScriptUrl = urlPrevia;
                configStatus.textContent = 'Falla la LECTURA: ' + err.message;
                configStatus.className = 'config-status error';
                registrarError('Probar conexión (lectura)', err);
                return;
            }

            try {
                const escritura = await apiCall('init', {});
                if (escritura.error) throw new Error(escritura.error);
                if (escritura.sinConfirmar) throw new Error(
                    'la petición no llegó al servidor (bloqueo CORS o la implementación no acepta POST). ' +
                    'Vuelve a crear la implementación como "Aplicación web" con acceso "Cualquier persona".');
            } catch (err) {
                config.appsScriptUrl = urlPrevia;
                configStatus.textContent = 'La lectura funciona (' + lectura.records.length +
                    ' registros) pero falla la ESCRITURA: ' + err.message;
                configStatus.className = 'config-status error';
                registrarError('Probar conexión (escritura)', err);
                return;
            }

            config.appsScriptUrl = url;
            configStatus.textContent = 'Lectura y escritura OK. ' + lectura.records.length +
                ' registros en la hoja.';
            configStatus.className = 'config-status success';
            renderDiagnostico();
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

    // ── Respaldo local (sin depender de Google) ──
    const BACKUP_KEY = 'agua_condominio_ultimo_respaldo';

    function descargarArchivo(contenido, nombre, tipo) {
        // El BOM hace que Excel abra el CSV con los acentos correctos.
        const bom = tipo === 'text/csv' ? '﻿' : '';
        const blob = new Blob([bom + contenido], { type: tipo + ';charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function hoyISO() {
        const d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    function mostrarBackupStatus(msg, tipo) {
        const caja = document.getElementById('backup-status');
        caja.textContent = msg;
        caja.className = 'config-status ' + (tipo || '');
        caja.classList.remove('hidden');
    }

    function actualizarInfoRespaldo() {
        const caja = document.getElementById('backup-info');
        if (!caja) return;
        const ultimo = localStorage.getItem(BACKUP_KEY);
        const meses = records.filter(r => !r.isInitial).length;
        caja.innerHTML = '<p>' + meses + ' meses guardados en este navegador.</p>' +
            '<p>' + (ultimo
                ? 'Último respaldo descargado: <strong>' + ultimo + '</strong>'
                : '<strong>Nunca has descargado un respaldo.</strong>') + '</p>';
    }

    function exportarRespaldo() {
        const payload = {
            app: 'agua-condominio',
            version: 1,
            exportado: new Date().toISOString(),
            records: records,
        };
        descargarArchivo(JSON.stringify(payload, null, 2),
            'respaldo-agua-condominio-' + hoyISO() + '.json', 'application/json');
        localStorage.setItem(BACKUP_KEY, hoyISO());
        actualizarInfoRespaldo();
        mostrarBackupStatus('Respaldo descargado. Guárdalo en un lugar seguro.', 'success');
    }

    function importarRespaldo(file) {
        const lector = new FileReader();
        lector.onload = () => {
            let entrantes;
            try {
                const data = JSON.parse(lector.result);
                entrantes = Array.isArray(data) ? data : data.records;
                if (!Array.isArray(entrantes)) throw new Error('no contiene una lista de registros');
                // Validar antes de pisar nada: un archivo equivocado no puede
                // dejar al usuario sin sus datos.
                const validos = entrantes.filter(r =>
                    r && !isNaN(parseInt(r.year)) && MONTHS_ORDER.indexOf(r.month) !== -1);
                if (validos.length === 0) throw new Error('no tiene ningún mes válido');
                entrantes = validos;
            } catch (err) {
                mostrarBackupStatus('El archivo no sirve como respaldo: ' + err.message, 'error');
                return;
            }

            if (!confirm('El respaldo tiene ' + entrantes.length + ' registros.\n' +
                'Esto reemplazará los ' + records.length + ' que tienes ahora. ¿Continuar?')) return;

            records = entrantes;
            sortRecords();
            saveLocal();
            populateYears();
            renderHistory();
            updateHints();
            actualizarInfoRespaldo();
            mostrarBackupStatus('Restaurados ' + records.length + ' registros.', 'success');
        };
        lector.onerror = () => mostrarBackupStatus('No se pudo leer el archivo.', 'error');
        lector.readAsText(file);
    }

    function exportarCSV() {
        // Punto y coma: en Chile Excel usa la coma como separador decimal.
        const filas = [['Año', 'Mes', 'Casa', 'm3', 'Porcentaje', 'Agua', 'Trifasica', 'Perdida', 'Total']];
        records.filter(r => !r.isInitial).forEach(record => {
            const result = calculate(record);
            if (!result) return;
            CASAS.forEach(h => {
                filas.push([record.year, record.month, NOMBRES[h], result.consumo[h],
                    (result.pct[h] * 100).toFixed(1) + '%',
                    Math.round(result.costoAgua[h]), Math.round(result.costoTri[h]),
                    Math.round(result.costoPerdida[h]), Math.round(result.total[h])]);
            });
        });

        if (filas.length === 1) {
            mostrarBackupStatus('No hay meses calculados para exportar.', 'error');
            return;
        }
        const csv = filas.map(f => f.join(';')).join('\n');
        descargarArchivo(csv, 'distribucion-agua-condominio-' + hoyISO() + '.csv', 'text/csv');
        mostrarBackupStatus('CSV descargado (' + (filas.length - 1) + ' filas).', 'success');
    }

    function setupBackup() {
        const inputFile = document.getElementById('file-import');
        document.getElementById('btn-export').addEventListener('click', exportarRespaldo);
        document.getElementById('btn-export-csv').addEventListener('click', exportarCSV);
        document.getElementById('btn-import').addEventListener('click', () => inputFile.click());
        inputFile.addEventListener('change', e => {
            if (e.target.files && e.target.files[0]) importarRespaldo(e.target.files[0]);
            e.target.value = '';
        });
        actualizarInfoRespaldo();
    }

    // ── Persistence ──
    function loadData() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            records = JSON.parse(stored);
            migrarPerdidaAPesos();
            aplicarCorrecciones();
            mergeSeed();
        } else {
            records = SEED_DATA.slice();
            saveLocal();
            localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION));
        }
        localStorage.setItem(DATA_VERSION_KEY, String(DATA_VERSION));
    }

    // Reemplaza los meses que el usuario corrigió. Corre una sola vez por
    // versión, así que si después vuelve a editarlos a mano, no se le pisan.
    function aplicarCorrecciones() {
        const vista = parseInt(localStorage.getItem(DATA_VERSION_KEY)) || 1;
        if (vista >= DATA_VERSION) return;

        let cambios = 0;
        CORRECCIONES.forEach(corregido => {
            const i = records.findIndex(r => key(r) === key(corregido));
            if (i !== -1) {
                records[i] = { ...corregido };
                cambios++;
            }
        });
        if (cambios > 0) saveLocal();
    }

    /**
     * Modelo viejo: la pérdida se ingresaba en m³, iba incluida dentro de
     * totalM3/total3Casas/trifasica, y la pagaba entera Arturo.
     * Modelo nuevo: la pérdida es un monto en $ aparte, y los totales traen
     * solo lo consumido.
     *
     * La conversión es exacta: se calcula qué parte del agua y de la trifásica
     * correspondía a la fuga y se saca de los totales para pasarla a $.
     */
    function migrarPerdidaAPesos() {
        const vista = parseInt(localStorage.getItem(DATA_VERSION_KEY)) || 1;
        if (vista >= DATA_VERSION) return;

        records = records.map(r => {
            const perdidaM3 = Number(r.perdidaM3) || 0;
            if (!perdidaM3 || !(Number(r.totalM3) > 0)) {
                const { perdidaM3: _, ...resto } = r;
                return resto;
            }
            const pct = perdidaM3 / r.totalM3;
            const aguaPerdida = (Number(r.total3Casas) || 0) * pct;
            const triPerdida = (Number(r.trifasica) || 0) * pct;
            const { perdidaM3: _, ...resto } = r;
            return {
                ...resto,
                totalM3: r.totalM3 - perdidaM3,
                total3Casas: Math.round((Number(r.total3Casas) || 0) - aguaPerdida),
                trifasica: Math.round((Number(r.trifasica) || 0) - triPerdida),
                perdidaPesos: Math.round(aguaPerdida + triPerdida),
            };
        });
        saveLocal();
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
        actualizarInfoRespaldo();
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
                // Opcional y solo de referencia: null cuando se deja vacío,
                // para que al editar el campo vuelva a salir en blanco.
                totalCuenta: isNaN(num('total-cuenta')) ? null : num('total-cuenta'),
                total3Casas: num('total-3casas'),
                trifasica: num('trifasica'),
                totalM3: num('total-m3'),
                perdidaPesos: num('perdida-pesos'),
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
            if (isNaN(data.perdidaPesos)) {
                alert('La pérdida es obligatoria. Si este mes no hubo fuga, ingresa 0.');
                document.getElementById('perdida-pesos').focus();
                return;
            }
            const OBLIGATORIOS = [
                ['lecturaSoraya', 'Medidor Soraya', 'lectura-soraya'],
                ['lecturaCristian', 'Medidor Cristian', 'lectura-cristian'],
                ['total3Casas', 'Consumo 3 Casas ($)', 'total-3casas'],
                ['totalM3', 'Total m³ (3 casas)', 'total-m3'],
            ];
            const faltantes = OBLIGATORIOS.filter(c => isNaN(data[c[0]]));
            if (faltantes.length > 0) {
                alert('Falta completar: ' + faltantes.map(c => c[1]).join(', ') + '.');
                document.getElementById(faltantes[0][2]).focus();
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
        const montoPerdida = Number(record.perdidaPesos) || 0;

        const consumo = {
            soraya: record.lecturaSoraya - prev.lecturaSoraya,
            cristian: record.lecturaCristian - prev.lecturaCristian,
        };
        // Arturo es el residuo: los m³ ingresados ya vienen sin la fuga.
        consumo.arturo = total - consumo.soraya - consumo.cristian;

        // Un solo porcentaje por casa reparte las tres cosas.
        const pct = {}, costoAgua = {}, costoTri = {}, costoPerdida = {}, costoTotal = {};
        CASAS.forEach(h => {
            pct[h] = total > 0 ? consumo[h] / total : 0;
            costoAgua[h] = montoAgua * pct[h];
            costoTri[h] = montoTri * pct[h];
            costoPerdida[h] = montoPerdida * pct[h];
            costoTotal[h] = costoAgua[h] + costoTri[h] + costoPerdida[h];
        });

        return {
            consumo: consumo,
            pct: pct,
            costoAgua: costoAgua,
            costoTri: costoTri,
            costoPerdida: costoPerdida,
            total: costoTotal,
            hayPerdida: montoPerdida > 0,
            montoPerdida: montoPerdida,
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
            w.push(box('El consumo de Arturo resulta negativo: Soraya + Cristian (' +
                (result.consumo.soraya + result.consumo.cristian) +
                ' m³) supera el total ingresado (' + record.totalM3 + ' m³). ' +
                'Recuerda que los m³ van sin los de la fuga. Revisa las lecturas o el total.'));
        }
        if (result.hayPerdida) {
            const totalMes = CASAS.reduce((s, h) => s + result.total[h], 0);
            w.push(box('Este mes tiene ' + fmtCLP(result.montoPerdida) + ' de pérdida (' +
                fmtPct(totalMes > 0 ? result.montoPerdida / totalMes : 0) +
                ' del total), repartida entre las 3 casas según su consumo.'));
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
        // Con fuga se muestran las dos vistas del mismo mes: la que separa la
        // pérdida y la que la deja sumada dentro del agua.
        if (!result.hayPerdida) return tablaDesglose(record, result, false, '');
        return tablaDesglose(record, result, true, 'Pérdida separada') +
               tablaPerdidaEnAgua(record, result);
    }

    // Vista 1: la pérdida como columna propia.
    function tablaDesglose(record, result, colPerdida, titulo) {
        const filas = CASAS.map(h => `
                    <tr>
                        <td><span class="dot ${h}"></span>${NOMBRES[h]}</td>
                        <td class="text-right">${result.consumo[h]}</td>
                        <td class="text-right col-pct">${fmtPct(result.pct[h])}</td>
                        <td class="text-right">${fmtCLP(result.costoAgua[h])}</td>
                        <td class="text-right">${fmtCLP(result.costoTri[h])}</td>
                        ${colPerdida ? `<td class="text-right">${fmtCLP(result.costoPerdida[h])}</td>` : ''}
                        <td class="text-right">${fmtCLP(result.total[h])}</td>
                    </tr>`).join('');

        const granTotal = CASAS.reduce((s, h) => s + result.total[h], 0);
        return `<div class="result-summary">
            ${titulo ? `<p class="tabla-titulo">${titulo}</p>` : ''}
            <div class="tabla-scroll">
            <table>
                <thead>
                    <tr>
                        <th>Casa</th>
                        <th class="text-right">m³</th>
                        <th class="text-right col-pct">%</th>
                        <th class="text-right">Agua</th>
                        <th class="text-right">Trifásica</th>
                        ${colPerdida ? '<th class="text-right">Pérdida</th>' : ''}
                        <th class="text-right">Total</th>
                    </tr>
                </thead>
                <tbody>${filas}
                    <tr>
                        <td>TOTAL</td>
                        <td class="text-right">${record.totalM3}</td>
                        <td class="text-right col-pct">100%</td>
                        <td class="text-right">${fmtCLP(record.total3Casas)}</td>
                        <td class="text-right">${fmtCLP(record.trifasica)}</td>
                        ${colPerdida ? `<td class="text-right">${fmtCLP(result.montoPerdida)}</td>` : ''}
                        <td class="text-right">${fmtCLP(granTotal)}</td>
                    </tr>
                </tbody>
            </table>
            </div>
        </div>`;
    }

    // Vista 2: mismos totales, pero la pérdida va sumada dentro del agua.
    function tablaPerdidaEnAgua(record, result) {
        const filas = CASAS.map(h => `
                    <tr>
                        <td><span class="dot ${h}"></span>${NOMBRES[h]}</td>
                        <td class="text-right">${result.consumo[h]}</td>
                        <td class="text-right col-pct">${fmtPct(result.pct[h])}</td>
                        <td class="text-right">${fmtCLP(result.costoAgua[h] + result.costoPerdida[h])}</td>
                        <td class="text-right">${fmtCLP(result.costoTri[h])}</td>
                        <td class="text-right">${fmtCLP(result.total[h])}</td>
                    </tr>`).join('');

        const granTotal = CASAS.reduce((s, h) => s + result.total[h], 0);
        return `<div class="result-summary">
            <p class="tabla-titulo">Pérdida incluida en el agua</p>
            <div class="tabla-scroll">
            <table>
                <thead>
                    <tr>
                        <th>Casa</th>
                        <th class="text-right">m³</th>
                        <th class="text-right col-pct">%</th>
                        <th class="text-right">Agua + pérdida</th>
                        <th class="text-right">Trifásica</th>
                        <th class="text-right">Total</th>
                    </tr>
                </thead>
                <tbody>${filas}
                    <tr>
                        <td>TOTAL</td>
                        <td class="text-right">${record.totalM3}</td>
                        <td class="text-right col-pct">100%</td>
                        <td class="text-right">${fmtCLP(Number(record.total3Casas) + result.montoPerdida)}</td>
                        <td class="text-right">${fmtCLP(record.trifasica)}</td>
                        <td class="text-right">${fmtCLP(granTotal)}</td>
                    </tr>
                </tbody>
            </table>
            </div>
        </div>`;
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
            html += `
                <div class="result-card">
                    <div class="result-card-header ${h}">
                        <span><span class="dot ${h}"></span>${NOMBRES[h]}</span>
                        <span class="result-total">${fmtCLP(result.total[h])}</span>
                    </div>
                    <div class="result-detail">
                        <span>Consumo <span class="value">${result.consumo[h]} m³</span></span>
                        <span>Porcentaje <span class="value">${fmtPct(result.pct[h])}</span></span>
                    </div>
                    <!-- Los tres costos van en su propio bloque: si la pérdida
                         cuelga bajo "Agua" parece parte de ella, y no lo es. -->
                    <div class="result-costos${result.hayPerdida ? ' con-perdida' : ''}">
                        <span>Agua <span class="value">${fmtCLP(result.costoAgua[h])}</span></span>
                        <span>Trifásica <span class="value">${fmtCLP(result.costoTri[h])}</span></span>
                        ${result.hayPerdida
                            ? `<span>Pérdida <span class="value">${fmtCLP(result.costoPerdida[h])}</span></span>`
                            : ''}
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
                ? Math.round(CASAS.reduce((s, h) => s + result.total[h], 0))
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
        document.getElementById('perdida-pesos').value = inputValue(record.perdidaPesos);

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
