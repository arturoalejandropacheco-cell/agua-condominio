# Setup — Agua Condominio Web App

## Paso 1: Crear la Google Sheet

1. Ve a [Google Sheets](https://sheets.google.com) y crea una hoja nueva
2. Nómbrala **"Agua Condominio"** (o como prefieras)
3. No necesitas crear hojas manualmente — el script las crea automáticamente

## Paso 2: Agregar el Google Apps Script

1. En tu Google Sheet, ve a **Extensiones → Apps Script**
2. Se abre el editor de Apps Script
3. Borra todo el código que aparece por defecto
4. Copia y pega todo el contenido del archivo `google-apps-script/Code.gs`
5. Haz clic en **Guardar** (ícono de disco o Ctrl+S)

## Paso 3: Desplegar como Web App

1. En el editor de Apps Script, haz clic en **Implementar → Nueva implementación**
2. En tipo, selecciona **Aplicación web**
3. Configura:
   - **Descripción**: "API Agua Condominio"
   - **Ejecutar como**: Tu cuenta (tu email)
   - **Quién tiene acceso**: **Cualquier persona**
4. Haz clic en **Implementar**
5. Google te pedirá autorizar — haz clic en **Autorizar acceso**
   - Si aparece "Esta app no está verificada", haz clic en **Avanzado** → **Ir a (nombre del proyecto)**
6. **Copia la URL** que aparece (algo como `https://script.google.com/macros/s/AKf.../exec`)

> **IMPORTANTE**: Cada vez que modifiques el código del Apps Script, debes crear una **nueva implementación** o actualizar la existente para que los cambios tomen efecto.

## Paso 4: Conectar la Web App

1. Abre la web app (index.html)
2. Ve a la pestaña **Config**
3. Pega la URL del Apps Script
4. Haz clic en **Guardar Conexión**
5. Haz clic en **Probar Conexión** para verificar
6. Haz clic en **Subir datos a Google Sheets** para enviar los datos históricos

## Paso 5: Publicar en GitHub Pages (gratis)

1. Crea un repositorio en GitHub (puede ser privado)
2. Sube los archivos: `index.html`, `styles.css`, `app.js`
3. Ve a **Settings → Pages**
4. En **Source**, selecciona la rama `main` y carpeta `/ (root)`
5. GitHub te dará una URL tipo `https://tuusuario.github.io/agua-condominio/`

### Comandos para subir a GitHub:

```bash
cd "/Users/capertaap/APPs/Gastos Agua Electricidad condominio"
git init
git add index.html styles.css app.js
git commit -m "Web app agua condominio"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/agua-condominio.git
git push -u origin main
```

## Uso diario

1. Abre la app desde tu celular o computador
2. Ingresa las lecturas y datos de boleta
3. Presiona "Calcular y Guardar"
4. Los datos se guardan localmente Y se sincronizan automáticamente a Google Sheets
5. Puedes abrir la Google Sheet para ver los datos en formato planilla

## Estructura de la Google Sheet

El script crea automáticamente 3 hojas:

- **Registros**: Datos crudos (lo que ingresas en el formulario)
- **Medidores**: Lecturas y consumos calculados por diferencia
- **Distribución**: Desglose por casa con porcentajes y costos

## Modelo de cálculo

Los datos que se ingresan cada mes:

| Campo | Qué es | |
|---|---|---|
| Total Cuenta Condominio ($) | La boleta completa del condominio | opcional, solo referencia |
| Consumo 3 Casas ($) | El agua de las 3 casas, **sin** la pérdida | obligatorio |
| Trifásica ($) | La trifásica de las 3 casas, **sin** la pérdida | obligatorio, 0 si no hubo |
| Pérdida ($) | El costo de la fuga (agua + trifásica) | obligatorio, 0 si no hubo |
| Total m³ (3 casas) | Solo lo consumido, **sin** los m³ de la fuga | obligatorio |
| Lecturas de Soraya y Cristian | Lectura acumulada del medidor | obligatorio |

De ahí sale el porcentaje de cada casa:

- Consumo Soraya = lectura actual − lectura anterior
- Consumo Cristian = lectura actual − lectura anterior
- Consumo Arturo = Total m³ − Soraya − Cristian
- % de cada casa = su consumo ÷ Total m³

Y ese **mismo porcentaje** reparte las tres cosas: agua, trifásica y pérdida.
El total de cada casa es la suma de las tres.

> La pérdida se reparte entre las 3 casas según su consumo, no la asume nadie
> en particular.

## Notas

- Si no configuras Google Sheets, la app funciona igual en **modo local** (localStorage)
- Los datos locales sirven como respaldo si hay problemas de conexión
- Puedes sincronizar manualmente desde la pestaña Config
