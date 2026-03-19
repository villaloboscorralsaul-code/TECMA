# MVP TECMA - Política Social T-MEC

Prototipo frontend estático con flujo completo:

1. Ingreso por QR (simulado)
2. Captura de foto del colaborador (cámara móvil o galería)
3. Landing institucional
4. Lectura de política social con control de lectura
5. Aceptación formal (`Acepto y Me Comprometo`)
6. Quiz de 5 preguntas con feedback inmediato
7. Generación de certificado oficial con folio, QR visual y foto del colaborador
8. Descarga vía impresión (`window.print()`)

## Archivos

- `index.html`: estructura de pantallas y componentes
- `styles.css`: diseño visual, tokens de marca y responsive
- `app.js`: lógica completa del flujo y estado
- `assets/tecma-logo.png`: logotipo principal TECMA
- `assets/tecma-badge.png`: sello/gráfico institucional
- `assets/tecma-badge-alt.png`: variante de sello institucional

## Cómo ejecutar

1. Abrir `index.html` en el navegador.
2. Capturar nombre del empleado.
3. Simular escaneo con botón de inicio.
4. Completar el flujo hasta certificado.

## Notas de marca para producción

- Reemplazar `TECMA` placeholder por logotipo oficial en SVG/PNG aprobado.
- Sustituir cápsulas `MEX / USA / CAN` por escudos o banderas oficiales.
- Integrar firma facsímil y sello institucional reales.
- Conectar emisión de folio a backend transaccional (evitar aleatorio en producción).
- Implementar verificación pública del certificado mediante endpoint seguro.

## Siguiente iteración recomendada

- Migrar a framework (React/Next) con rutas y componentes desacoplados.
- Implementar autenticación real por token QR firmado desde backend.
- Persistir auditoría completa de lectura, aceptación, respuestas y emisión de certificado.
- Integrar endpoint para validar certificado por folio + hash criptográfico.
