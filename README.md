# Hoja de Seguimiento Semanal — Hewser

**Arquitectura serverless:** GitHub Pages → Apps Script → Google Sheets. Sin servidor propio, sin base de datos externa, sin costos.

## 🗂️ Estructura

```
hoja-seguimiento/
├── index.html        ← Frontend, súbelo a GitHub Pages
├── apps-script.gs    ← Backend, pega en script.google.com
└── README.md         ← Esto
```

---

## 🚀 Instalación (15 minutos)

### Parte 1 — Backend (Apps Script)

**1. Crea la Google Sheet**

- Ve a sheets.google.com → nueva hoja en blanco → nómbrala "Hoja Seguimiento Hewser".
- Copia el **ID** de la URL: `https://docs.google.com/spreadsheets/d/`**`AQUI_VA_EL_ID`**`/edit`

**2. Crea el script**

- Ve a script.google.com → **Nuevo proyecto** → nómbralo "Hoja Seguimiento Backend".
- Borra el código de muestra y pega el contenido completo de `apps-script.gs`.
- Edita las constantes al inicio:
  ```javascript
  const SHEET_ID = 'TU_ID_AQUI';
  const DEFAULT_COACH_EMAIL = 'joaquinpardave@actioncoach.com';
  ```
- Guarda (`Ctrl+S`).

**3. Setup inicial**

- En el editor, selecciona la función `setup` en el dropdown de arriba.
- Click en **Ejecutar** (▶).
- Te pedirá permisos → "Revisar permisos" → escoge tu cuenta → "Avanzado" → "Ir a Hoja Seguimiento Backend (no seguro)" → Permitir.
- Verifica en la Sheet: deben aparecer dos pestañas, `Hojas` y `Config`.

**4. Publicar como Web App**

- En el editor → botón azul **Implementar** (arriba a la derecha) → **Nueva implementación**.
- Ícono de engrane → **Aplicación web**.
- Descripción: `v1`
- Ejecutar como: **Yo**
- Quién tiene acceso: **Cualquier persona**
- **Implementar** → autoriza si te lo pide.
- **COPIA la URL** que termina en `/exec`. Esa es tu `BACKEND_URL`.

### Parte 2 — Frontend (GitHub Pages)

**5. Sube `index.html` a tu repo**

Igual que con tus otras apps:

```bash
mkdir hoja-seguimiento && cd hoja-seguimiento
git init
# pega index.html aquí
git add index.html
git commit -m "Initial hoja de seguimiento"
gh repo create hoja-seguimiento --public --source=. --push
```

En GitHub: **Settings → Pages → Source: main branch / root → Save**. En 1-2 minutos tu URL será:
`https://[tu-usuario].github.io/hoja-seguimiento/`

**6. Conecta frontend ↔ backend**

- Abre tu URL de GitHub Pages.
- Te aparecerá la pantalla de "Conecta tu backend".
- Pega la URL del Apps Script (la que termina en `/exec`).
- Click "Conectar".

**7. Configura los correos**

- Pestaña **⚙️ Configuración**.
- Llena: email empresario, email coach, nombre coach.
- **Guardar configuración**.

Listo. Todo funciona end-to-end.

---

## ⚡ Cómo funciona el recordatorio de 24h

Es **completamente automático**, no necesitas configurar triggers manualmente.

1. El coach entra a la app, pone fecha y hora de la próxima sesión.
2. Auto-save dispara → llama al backend → backend ejecuta `scheduleReminder()`.
3. `scheduleReminder` crea un **trigger único** programado para `fecha_sesion - 24h`.
4. Si el coach cambia la fecha más tarde, el trigger anterior se cancela y se crea uno nuevo.
5. Cuando llega el momento exacto (no las 9 a.m., sino 24h justo antes de la sesión):
   - Si la hoja ya fue enviada → el trigger no hace nada y se autodestruye.
   - Si NO fue enviada → manda correo al empresario + alerta al coach.
6. Cuando el empresario envía la hoja, el trigger se cancela inmediatamente.

**Resultado:** un solo correo, en el momento exacto, sin desperdicio de cuota.

---

## 📊 Cuánto consume de cuota

Con 1 empresario + 1 coach, 1 sesión por semana:

| Operación | Frecuencia | Tiempo | Emails |
|---|---|---|---|
| Auto-save al llenar | ~20-30 / semana | ~200ms cada uno | 0 |
| Lectura inicial (load) | ~5 / semana | ~500ms | 0 |
| Envío de hoja | 1 / semana | ~2s | 2 |
| Recordatorio 24h (si aplica) | 0-1 / semana | ~1s | 2 |

**Consumo semanal:** ~40 ejecuciones, ~10 segundos totales, 2-4 emails.

**Límite consumer:** 100 emails/día, 90 min de scripts/día. Usas <5% de la cuota.

Puedes escalar tranquilamente a 10-15 empresarios con la misma cuenta sin tocar los límites.

---

## 🎭 Modelo de roles

Toggle arriba a la derecha (👤 Empresario / 🎯 Coach). La preferencia se guarda en `localStorage` del navegador, así que cada quien abre la app en su modo.

| Acción | Empresario | Coach |
|---|---|---|
| Definir/borrar metas | ❌ | ✅ |
| Marcar metas como cumplidas | ✅ | ✅ |
| Observaciones | ✅ | ✅ |
| Reflexiones (Sección 3) | ✅ | ✅ |
| Resumen del negocio (Sección 4) | ✅ | ✅ |
| Frase de la semana | ❌ | ✅ |
| Enviar al coach | ✅ | ❌ |

⚠️ El switch es UI-only. No hay autenticación real. Si lo necesitas, en una iteración futura podemos agregar OAuth con Google.

---

## 🔧 Diagnóstico y mantenimiento

### Ver triggers agendados

En el editor de Apps Script, ejecuta `listarRecordatoriosAgendados`. Te lista en Logger todos los recordatorios pendientes.

### Limpiar todos los recordatorios

Si algo se descuadra (raro), ejecuta `limpiarRecordatorios`. Borra todos los triggers y sus metadatos. Los recordatorios se vuelven a agendar la próxima vez que cualquiera guarde una hoja con fecha.

### Ver la data cruda

Abre la Google Sheet. Pestaña `Hojas` = todas las hojas semanales (una fila por empresario × semana). Pestaña `Config` = correos y configuración.

### Si actualizas el código de Apps Script

Cada vez que cambies `apps-script.gs`:

- **Implementar → Gestionar implementaciones** → editar la que tienes → cambiar versión → "Implementar".
- La URL `/exec` se mantiene igual, no tienes que reconfigurar el frontend.

### Si quieres versión propia para otro empresario

Duplica la Google Sheet, crea otro proyecto Apps Script con el nuevo `SHEET_ID`, despliega como web app, y dale la nueva URL al otro empresario.

---

## 🎯 Mejoras pendientes (cuando quieras)

- Autenticación real del rol coach (OAuth Google).
- Vista de coach con **múltiples empresarios** en un dashboard (hoy es 1 a 1).
- Exportar hoja a PDF con un click.
- Integración con Google Calendar para autocompletar fecha/hora de sesión.
- Notificaciones push del navegador además del correo.

Avísame por cuál seguimos.
