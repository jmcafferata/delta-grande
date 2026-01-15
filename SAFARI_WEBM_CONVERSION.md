# Safari/iOS WebM Conversion List

> **Problema:** WebM con transparencia (alpha channel) no funciona bien en Safari/iOS
> **Solución:** Convertir a formatos soportados por Safari (MOV con HEVC/H.265 con alpha, o MP4)

---

## 🎯 CATEGORIZACIÓN Y RECOMENDACIONES

### **CATEGORÍA 1: LANDING PAGE (CRÍTICO - VISIBLE EN HOME)**
Estos videos son visibles inmediatamente en el sitio y son lo primero que ve el usuario.

| Archivo | Ruta Actual | Tipo | Recomendación | Formato Destino | Prioridad |
|---------|-----------|------|---|---|---|
| D+ Loader | `assets/D+_loader04.webm` | Overlay/loader con alpha | Convertir a MOV HEVC (tiene alpha) | `.mov` | 🔴 CRÍTICO |
| Birds | `assets/birds.webm` | Video con alpha (pájaros volando) | Convertir a MOV HEVC | `.mov` | 🔴 CRÍTICO |
| Logo Naranja | `assets/logo_naranja_alpha.webm` | Logo con transparencia | Convertir a MOV HEVC | `.mov` | 🔴 CRÍTICO |
| Mapa Gigante | `assets/mapa_gigante.webm` | Mapa con alpha | Convertir a MP4 o MOV | `.mov` o `.mp4` | 🟠 ALTO |

**Estado Actual:** El HTML ya tiene fallbacks `.mov` listos:
```html
<source src="assets/D+_loader04.mov" type="video/quicktime">
<source src="assets/birds.mov" type="video/quicktime">
<source src="assets/logo_naranja_alpha.mov" type="video/quicktime">
<source src="assets/logo_naranja_alpha.mp4" type='video/mp4; codecs="hvc1"'>
```

✅ **ACCIÓN:** Convertir estos 4 videos a MOV

---

### **CATEGORÍA 2: GAME MENU & UI (MUY IMPORTANTE)**
Se cargan cuando entra al juego, usuario los ve en los primeros segundos.

| Archivo | Ruta Actual | Tipo | Recomendación |
|---------|-----------|------|---|
| Loader Yellow | `game-assets/menu/loader_yellow.webm` | Spinner de carga con alpha | MOV HEVC |
| Logo Naranja (Menu) | `game-assets/menu/logo_naranja_alpha.webm` | Logo menú con alpha | MOV HEVC |
| Pantalla Recorrido | `game-assets/menu/pantallas/pantalla_recorrido.webm` | Preview pantalla | MOV HEVC |
| Pantalla Simulador | `game-assets/menu/pantallas/pantalla_simulador.webm` | Preview pantalla | MOV HEVC |
| Pantalla Subacua | `game-assets/menu/pantallas/pantalla_subacua.webm` | Preview pantalla | MOV HEVC |

✅ **ACCIÓN:** Convertir los 5 a MOV

---

### **CATEGORÍA 3: RECORRIDO - INTERFAZ & OVERLAYS (IMPORTANTE)**
Elementos UI del recorrido interactivo.

| Archivo | Ruta Actual | Tipo | Recomendación |
|---------|-----------|------|---|
| Loading Text Box | `game-assets/recorrido/interfaz/loading-text-box-animation.webm` | Animación UI | MOV HEVC |
| Logo Naranja (Recorrido) | `game-assets/recorrido/interfaz/logo_naranja_alpha.webm` | Logo overlay | MOV HEVC |
| Panel Metadata | `game-assets/recorrido/paneles/panel metadata.webm` | Panel información | MOV HEVC |

✅ **ACCIÓN:** Convertir los 3 a MOV

---

### **CATEGORÍA 4: ESPECIES (DATOS) - GLITCH & DATA VIDEOS (ALTO VOLUMEN)**
Estos son los videos de cada criatura/planta. Hay 30+ especies × 2 videos cada una.

**Ubicación:** `game-assets/recorrido/criaturas/{especie}/*_data.webm` y `*_glitch.webm`

**Especies (30):**
- aguara, banderita, camalote, carancho, cardenal, carpintero, ceibo, chaja, clavel, culebra, efedra, espinillo, guazuncho, helecho, malvavisco, martin, mburucuya, murcielago, ombu, paloma, rana, salvia, tembetari, tortuga, viraro, yacare, yaguarundi, yarara, yatei, yesquero

**Recomendación:**
- **_data.webm** (gráficos con datos) → Convertir a **MOV HEVC** (tienen alpha para overlay)
- **_glitch.webm** (efecto glitch) → Convertir a **MOV HEVC** (overlay effect)

**Total: 60 videos** (~2 por especie)

✅ **ACCIÓN:** Script batch para convertir todos

---

### **CATEGORÍA 5: SUB (ACUÁTICO) - DATA VIDEOS (MEDIO)**

| Archivo | Ruta Actual | Tipo | Recomendación |
|---------|-----------|------|---|
| armado_chancho_data | `game-assets/sub/data_videos/armado_chancho_data.webm` | Datos especie | MOV HEVC |
| dorado_data | `game-assets/sub/data_videos/dorado_data.webm` | Datos especie | MOV HEVC |
| pacu_data | `game-assets/sub/data_videos/pacu_data.webm` | Datos especie | MOV HEVC |
| palometa_brava_data | `game-assets/sub/data_videos/palometa_brava_data.webm` | Datos especie | MOV HEVC |
| raya_negra_data | `game-assets/sub/data_videos/raya_negra_data.webm` | Datos especie | MOV HEVC |
| surubi_pintado_data | `game-assets/sub/data_videos/surubi_pintado_data.webm` | Datos especie | MOV HEVC |
| vieja_del_agua_data | `game-assets/sub/data_videos/vieja_del_agua_data.webm` | Datos especie | MOV HEVC |
| surface | `game-assets/sub/others/surface.webm` | Agua/superficie | MOV HEVC |

**Total: 8 videos**

✅ **ACCIÓN:** Convertir todos a MOV HEVC

---

### **CATEGORÍA 6: TRANSICIONES (BAJO VOLUMEN)**

| Archivo | Ruta Actual | Tipo | Recomendación |
|---------|-----------|------|---|
| lab-a-subacua | `game-assets/transiciones/lab-a-subacua.webm` | Transición escenas | MOV HEVC |
| secuencia_inicio_recorrido1/2 | `game-assets/transiciones/secuencia_inicio_recorrido{1,2}.webm` | Intro animación | MOV HEVC |
| (versiones HD) | `game-assets/transiciones/hd/...` | Mismo (HD) | MOV HEVC |

**Plus antiguos en `old/`:** `transicion01-05.webm` (probablemente no usados)

**Total: 5 principales + 5 HD + 5 old**

✅ **ACCIÓN:** Convertir los 10 principales a MOV HEVC (ignorar old/)

---

### **CATEGORÍA 7: CINEMÁTICAS (BAJO VOLUMEN)**

| Archivo | Ruta Actual | Tipo | Recomendación |
|---------|-----------|------|---|
| carpa_flota | `game-assets/recorrido/cinematicas/carpa_flota.webm` | Cinemática | MP4 (sin alpha probablemente) o MOV |
| logo_naranja | `game-assets/menu/cinematicas/logo_naranja.webm` | Cinemática logo | MOV HEVC |

**Total: 2**

✅ **ACCIÓN:** Convertir a MOV (carpa_flota puede ser MP4 si no tiene alpha)

---

### **CATEGORÍA 8: LABORATORIO (BAJO VOLUMEN)**

| Archivo | Ruta Actual | Tipo | Recomendación |
|---------|-----------|------|---|
| screen-recorrido | `game-assets/laboratorio/screen-recorrido.webm` | Screen preview | MOV HEVC o MP4 |
| screen-subacua | `game-assets/laboratorio/screen-subacua.webm` | Screen preview | MOV HEVC o MP4 |

**Total: 2**

✅ **ACCIÓN:** Convertir a MOV HEVC

---

### **CATEGORÍA 9: ZÓCALOS (BAJO VOLUMEN)**

| Archivo | Ruta Actual | Tipo | Recomendación |
|---------|-----------|------|---|
| escena01_zocalo_espinal | `game-assets/recorrido/zocalos/escena01_zocalo_espinal.webm` | Fondo escena | MP4 o MOV |
| escena02_zocalo_monte | ... | Fondo escena | MP4 o MOV |
| escena03_zocalo_bosque en galeria | ... | Fondo escena | MP4 o MOV |
| escena04_zocalo_bosque de barrancas | ... | Fondo escena | MP4 o MOV |
| escena05_zocalo_humedal | ... | Fondo escena | MP4 o MOV |
| escena06_zocalo_costa | ... | Fondo escena | MP4 o MOV |

**Total: 6**

✅ **ACCIÓN:** Convertir a MP4 (probablemente sin alpha, fondos simples)

---

## 📊 RESUMEN DE ACCIONES

### **Prioridad CRÍTICA (CONVERSIONES INMEDIATAS)**
```
✓ assets/ (4 archivos) → MOV HEVC
✓ game-assets/menu/ (5 archivos) → MOV HEVC
✓ game-assets/recorrido/interfaz + paneles (3 archivos) → MOV HEVC
```
**Subtotal: 12 videos** - **HACER ESTO PRIMERO**

### **Prioridad ALTA (Volumen grande)**
```
✓ game-assets/recorrido/criaturas/ (60 archivos: 30 especies × 2) → MOV HEVC
✓ game-assets/sub/data_videos/ (8 archivos) → MOV HEVC
```
**Subtotal: 68 videos** - **Usar script batch**

### **Prioridad MEDIA**
```
✓ game-assets/transiciones/ (10 archivos) → MOV HEVC
✓ game-assets/menu/cinematicas/ (1-2 archivos) → MOV HEVC
```
**Subtotal: ~12 videos**

### **Prioridad BAJA**
```
✓ game-assets/laboratorio/ (2 archivos) → MOV HEVC
✓ game-assets/recorrido/zocalos/ (6 archivos) → MP4
✓ game-assets/recorrido/cinematicas/ (1 archivo) → MP4
```
**Subtotal: 9 videos**

---

## 🛠️ ESTRATEGIA DE CONVERSIÓN

### **Opción A: Usar ffmpeg directamente**
```bash
# MOV con HEVC + alpha (mejor para Safari)
ffmpeg -i input.webm -c:v hevc_nvenc -crf 23 -c:a aac output.mov

# MOV simple (fallback)
ffmpeg -i input.webm -c:v libx265 -preset medium -crf 23 output.mov

# MP4 (si no hay alpha)
ffmpeg -i input.webm -c:v libx265 -preset medium -crf 23 output.mp4
```

### **Opción B: Usar script Python existente**
Tu script `convert_webm_to_hevc.py` ya tiene la lógica. Necesita:
1. Verificar que tiene todos los archivos listados
2. Ejecutar batch
3. Colocar los archivos generados en su lugar

### **Opción C: Usar Adobe Media Encoder o similar**
Si prefieres interfaz gráfica con vista previa.

---

## 📋 CHECKLIST DE IMPLEMENTACIÓN

### Paso 1: Conversión
- [ ] Convertir 12 videos críticos (assets/ + menu/)
- [ ] Verificar que lucen bien en Safari
- [ ] Convertir 68 videos de especies
- [ ] Convertir 12 transiciones
- [ ] Convertir 9 videos restantes

### Paso 2: Colocación
- [ ] Guardar `.mov` en misma ubicación que `.webm`
- [ ] Mantener `.webm` como fallback para navegadores modernos

### Paso 3: Actualizar HTML/JS
- [ ] Verificar que `landing-ui.js` ya tiene `getVideoSource()` configurado
- [ ] Revisar que `.mov` está como fuente principal en `<source>` tags
- [ ] Testing en Safari/iOS real

### Paso 4: Build & Deploy
- [ ] Correr build (asegurarse que incluye los `.mov`)
- [ ] Verificar que dist/ tiene los archivos
- [ ] Deploy y test en iPhone/iPad real

---

## 🎬 ESTADO DE SOPORTE YA IMPLEMENTADO

Veo que ya tienes fallbacks en el código:

**landing-ui.js:**
```javascript
const getVideoSource = (webmPath, options = {}) => {
    const { fallback = null, hideIfUnsupported = false } = options;
    
    if (browserInfo.supportsWebMAlpha) {
        return webmPath;
    }
    
    // Safari: try .mov version (HEVC with alpha)
    if (fallback) {
        return fallback;
    }
    
    const movPath = webmPath.replace(/\.webm$/i, '.mov');
    return hideIfUnsupported ? null : movPath;
};
```

✅ **El código ya está preparado** para servir `.mov` a Safari. Solo necesitas generar los archivos.

---

## 📁 ESTRUCTURA FINAL ESPERADA

```
assets/
├── D+_loader04.webm (original)
├── D+_loader04.mov  ← GENERAR
├── birds.webm (original)
├── birds.mov        ← GENERAR
├── logo_naranja_alpha.webm (original)
└── logo_naranja_alpha.mov   ← GENERAR

game-assets/menu/
├── loader_yellow.webm
├── loader_yellow.mov        ← GENERAR
├── logo_naranja_alpha.webm
├── logo_naranja_alpha.mov   ← GENERAR
└── ... (resto similar)

game-assets/recorrido/criaturas/{ESPECIE}/
├── {especie}_data.webm
├── {especie}_data.mov       ← GENERAR
├── {especie}_glitch.webm
└── {especie}_glitch.mov     ← GENERAR
```

---

## ⚠️ NOTAS IMPORTANTES

1. **MOV vs MP4:**
   - MOV: Mejor compatibilidad Safari con alpha channel
   - MP4: Más compatible universalmente, pero menos soporte de alpha
   - Recomendación: **Usa MOV para todos los videos con transparencia**

2. **Tamaño de archivo:**
   - HEVC es más eficiente que VP9 (WebM)
   - Espera ~30-50% reducción de tamaño con HEVC

3. **Codec HEVC en Safari:**
   - Safari 11+ soporta HEVC en MOV y MP4
   - iOS 9+ soporta HEVC en videos

4. **Fallback strategy:**
   - Landing page: `<source src=".mov"> <source src=".webm">`
   - Game: Usar `getVideoSource()` que ya está implementado

5. **Testing:**
   - Prueba en iPhone 12+
   - Prueba en iPad (últimos 2 años)
   - Verifica que la transparencia se ve correctamente

---

## 🚀 PRÓXIMOS PASOS

1. **Decidir:** ¿Qué videos convertirás primero? (sugiero los 12 críticos)
2. **Ejecutar:** Conversión con ffmpeg o el script Python
3. **Verificar:** Que los MOV se ven correctamente en Safari local
4. **Subir:** Los archivos a su ubicación final
5. **Test:** En dispositivo real iOS

¿Por dónde empezamos? ¿Quieres que actualice el script Python para hacer todas las conversiones?
