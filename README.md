# Mis finanzas

App web instalable (PWA) para llevar ingresos, gastos y presupuesto, basada en la plantilla de Excel del e-book de Brayan Mantilla.

**App publicada:** <https://siangonzalez.github.io/mis-finanzas/>. Se vuelve a publicar sola con cada cambio en `main`.
En el iPhone, ábrela en Safari, toca Compartir y luego "Agregar a pantalla de inicio".

## Fase 1 (lista)

- **Resumen:** "¿Cuánto te queda?", cuánto puedes gastar al día, ingresos vs. gastos, fijos vs. ocasionales, gastos hormiga (≤ $20.000) con proyección anual, gasto por categoría y origen de los ingresos.
- **Movimientos:** lista por día, filtros, búsqueda, editar y eliminar.
- **Presupuesto:** monto por categoría, barra de avance y "copiar del mes anterior".
- **Ajustes:** copia de seguridad (JSON), restaurar, exportar a Excel (CSV) y borrar todo.
- Las categorías salen de la hoja "Drop Down" del Excel.

Por ahora los datos se guardan solo en el navegador del dispositivo (IndexedDB). Todo el acceso a datos pasa por `src/data/db.ts`, para cambiarlo por un servidor (Supabase) en la fase 2.

## Correr en el computador

```bash
npm install
npm run dev
```

## Probar cambios en el iPhone antes de publicarlos (misma red Wi-Fi)

Con `npm run dev` corriendo, abre en Safari `http://<IP-del-PC>:5173`. Los datos de esa dirección son distintos a los de la app publicada.

## Fase 2 (lista): movimientos automáticos

- **Revisar:** bandeja con los movimientos detectados. Cada uno trae una categoría sugerida que puedes aceptar, cambiar o ignorar, y hay un botón de "Aceptar todos".
- **Lectores de alertas** (`src/import/parsers.ts`) para Bancolombia (compras con débito y crédito, retiros, pagos, transferencias), Nequi, PSE y los recibos de Davivienda. Las pruebas están en `parsers.test.ts` (`npm test`).
- **Repetidos:** si el mismo pago llega por el banco, por PSE y por el comercio, se cuenta una sola vez. Lo repetido queda a la vista por si hay que recuperarlo.
- **Reglas que aprenden:** cuando aceptas un comercio con una categoría, los siguientes del mismo comercio llegan con esa categoría.
- **Gmail** con un Apps Script en tu propia cuenta, **Apple Pay** con el Atajo "Transacción" y **SMS** con el Atajo "Mensaje", o pegando la alerta. Los pasos están en [integraciones/README.md](integraciones/README.md).

Falta: importar los extractos PDF de las tarjetas de crédito (Davivienda, Nu, Tuya), que no mandan una alerta por cada compra.

## Próximas fases

3. Metas de ahorro, patrimonio, alertas de pagos y TRM.
4. Asistente de renta (topes en UVT, exógena de la DIAN) y seguimiento de inversiones.
