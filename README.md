# Mis finanzas

App web instalable (PWA) para llevar ingresos, gastos y presupuesto, basada en la plantilla de Excel del e-book de Brayan Mantilla.

**App publicada:** <https://siangonzalez.github.io/mis-finanzas/>. Se vuelve a publicar sola con cada cambio en `main`.
En el iPhone, ábrela en Safari, toca Compartir y luego "Agregar a pantalla de inicio".

## Fase 1 (lista)

- **Resumen:** "¿Cuánto te queda?", cuánto puedes gastar al día, ingresos vs. gastos, fijos vs. ocasionales, gastos hormiga (≤ $20.000) con proyección anual, gasto por categoría y origen de los ingresos.
- **Diagnóstico** (se abre desde el Resumen): reglas fijas en `src/lib/diagnosis.ts`, calculadas en el dispositivo, sobre tus gastos, deudas, intereses, cuentas de cobro y presupuesto. Muestra hechos, cálculos y opciones; no dice en qué invertir ni reemplaza a un asesor.
- **Saldo real** (en el Resumen): anotas cuánto hay en tus cuentas y la app te dice cuánto falta por registrar (`src/lib/balances.ts`). Las compras con tarjeta de crédito no cuentan como salida de tus cuentas.
- **Renta del año** (al final del Diagnóstico): compara lo que llevas y lo estimado a diciembre con los topes de la DIAN para declarar (`src/lib/tax.ts`, la UVT de cada año se agrega a mano) y suma lo que te retuvieron en cuentas de cobro.
- **Ocultar montos:** el botón del ojo, arriba, cambia todos los valores por `$ ••••`. Se recuerda en cada dispositivo.
- **Movimientos:** lista por día, filtros, búsqueda, editar y eliminar.
- **Presupuesto:** monto por categoría, barra de avance y "copiar del mes anterior".
- **Ajustes:** copia de seguridad (JSON), restaurar, exportar a Excel (CSV) y borrar todo.
- Las categorías salen de la hoja "Drop Down" del Excel.

Los datos viven en el dispositivo (IndexedDB) y se sincronizan con tu cuenta de Google (ver más abajo). Todo el acceso a datos pasa por `src/data/db.ts`.

## Correr en el computador

```bash
npm install
npm run dev
```

## Probar cambios en el iPhone antes de publicarlos (misma red Wi-Fi)

Con `npm run dev` corriendo, abre en Safari `http://<IP-del-PC>:5173`. Los datos de esa dirección son distintos a los de la app publicada.

## Fase 2 (lista): movimientos automáticos

- **Revisar:** bandeja con los movimientos detectados. Cada uno trae una categoría sugerida que puedes aceptar, cambiar o ignorar, y hay un botón de "Aceptar todos".
- **Lectores de alertas** (`src/import/parsers.ts`) para Bancolombia (compras con débito y crédito, retiros, pagos, transferencias), Nequi (pagos y envíos y recibos por Bre-B), PSE y los recibos de Davivienda. Las pruebas están en `parsers.test.ts` (`npm test`).
- **Repetidos:** si el mismo pago llega por el banco, por PSE y por el comercio, se cuenta una sola vez. Lo repetido queda a la vista por si hay que recuperarlo.
- **Reglas que aprenden:** cuando aceptas un comercio con una categoría, los siguientes del mismo comercio llegan con esa categoría.
- **Gmail** con un Apps Script en tu propia cuenta, **Apple Pay** con el Atajo "Transacción" y **SMS** con el Atajo "Mensaje", o pegando la alerta. Los pasos están en [integraciones/README.md](integraciones/README.md).

- **Extractos de Nequi (Word o PDF):** en Revisar, "Cargar extracto de Nequi" lee el Word o el PDF que descargas de Nequi. Si el PDF tiene contraseña, la app la pide en pantalla y la usa solo para abrir el archivo en el dispositivo (no se guarda ni se envía). Trae lo que no llega por correo (pagos con QR, plata que te mandan de Nequi a Nequi, intereses), junta el 4x1000 del mes en un solo gasto, no repite lo que ya llegó por correo y deja aparte las **transferencias entre tus cuentas**, que no cuentan como gasto ni ingreso.

- **Tarjeta Tuya (PDF):** el mismo botón lee el extracto de Tuya/Carulla. Las compras entran como gasto por su valor total; los pagos a la tarjeta quedan "entre tus cuentas" y se emparejan con el pago que sale de Nequi o Bancolombia, para no contar el gasto dos veces.

- **Tarjetas Bancolombia (PDF):** lee los movimientos nuevos en pesos; abonos y avances quedan "entre tus cuentas".
- **Crédito Davivienda (PDF "Extracto Crédito"):** lee el saldo, la cuota del mes, la fecha límite, la tasa y las cuotas que faltan.
- **Lo que debes en cada tarjeta o crédito:** al cargar el extracto de Tuya o Bancolombia, la app guarda la deuda a la fecha de corte, el pago mínimo, la fecha límite, el cupo y la tasa. Se ven en **Deudas → Tarjetas y créditos**, suman al total que debes y aparecen en el Resumen cuando el pago vence en 7 días o menos.

## Deudas

- **Pestaña Deudas:** lista de lo que **te deben** y lo que **debes**, con totales. Cada deuda muestra el saldo de hoy (con o sin interés compuesto diario y tasas EA que pueden cambiar), las cuotas atrasadas, la gráfica del saldo y "¿cuándo termina?" con la cuota que quieras probar.
- **Nueva deuda** desde la app: quién, cuánto, fecha, interés opcional y cuota opcional. Después puedes sumar más préstamos y registrar pagos o abonos, si quieres también como gasto o ingreso del mes.
- **Cuotas atrasadas:** son las vencidas menos las pagadas. Un pago que cubre dos cuotas cuenta como dos.
- **Alertas:** si en Revisar aceptas una transferencia a (o de) la persona de la deuda, se anota sola como pago (o abono).
- **Nube:** las deudas se guardan en la hoja "Mis finanzas – Deudas" de tu Google Drive (ver integraciones). Los datos **no van en el código**.

## Sincronización entre dispositivos

Movimientos, Revisar, presupuesto, reglas y tarjetas se sincronizan entre tus dispositivos por medio del Apps Script (pestaña `datos` de tu hoja de Google). Ver `src/data/sync.ts`. Cada registro lleva `updatedAt`, y borrar deja una marca `deleted` para que el borrado también llegue al otro dispositivo. Si el mismo registro cambió en los dos lados, gana el cambio más reciente. Las deudas siguen sincronizándose por su lado (`debtSync.ts`).

## Próximas fases

3. Metas de ahorro, patrimonio, alertas de pagos y TRM.
4. Asistente de renta (topes en UVT, exógena de la DIAN) y seguimiento de inversiones.
