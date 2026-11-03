# Integraciones

## 1. Tu cuenta de Google: alertas de Gmail y hoja de deudas

El archivo [gmail-apps-script.gs](gmail-apps-script.gs) corre en tu propia cuenta de Google y hace dos cosas:

- **Gmail:** lee solo los correos de alertas de Bancolombia, Nequi, PSE y los pagos de Davivienda, y le pasa el texto a la app.
- **Deudas:** guarda las deudas y sus pagos en la hoja **"Mis finanzas – Deudas"** de tu Drive. Así el iPhone, el computador y el tablero de Claude que compartes con Juan Camilo ven lo mismo, y no pierdes nada si cambias de teléfono.

Solo responde cuando la app presenta tu clave secreta.

### Instalación (unos 5 minutos, una sola vez)

1. Entra a <https://script.google.com> con la cuenta donde te llegan las alertas y crea un **Proyecto nuevo**. Ponle de nombre "Mis finanzas".
2. Borra lo que trae el editor y pega todo el contenido de `gmail-apps-script.gs`. Guarda con Ctrl+S.
3. Arriba, elige la función **`crearClave`** y dale **Ejecutar**.
   - Google te pide permiso para leer tu Gmail y manejar tus hojas de cálculo. Ese permiso es para tu propio script: revisa la pantalla y acepta.
   - Si aparece "Google no verificó esta app", entra a *Configuración avanzada → Ir a Mis finanzas*.
4. Abre **Registro de ejecución** y copia la clave que aparece.
5. Elige **`configurarHoja`** y dale **Ejecutar**. Se crea la hoja "Mis finanzas – Deudas" y en el registro aparece su enlace.
6. Opcional: ejecuta **`probar`** para confirmar que encuentra tus alertas.
7. Ve a **Implementar → Nueva implementación**:
   - Tipo: **Aplicación web**.
   - Ejecutar como: **Yo**.
   - Quién tiene acceso: **Cualquier usuario**. Sin la clave secreta el script no devuelve nada.
   - Dale **Implementar** y copia la **URL de la aplicación web**, que termina en `/exec`.
8. En la app, entra a **Ajustes (⚙) → Cuenta de Google**, pega la URL y la clave, y toca **Probar conexión**.
9. En **Deudas**, toca **Cargar archivo de deuda** y elige `deuda-juan-camilo.json`. La deuda se sube sola a la hoja. En cualquier otro dispositivo basta con conectar la cuenta de Google: la deuda baja sola.

**Actualizar el script (por ejemplo, para la sincronización entre dispositivos):** en script.google.com, borra el código, pega el nuevo `gmail-apps-script.gs` y guarda. Luego ve a *Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar*. La URL y la clave siguen iguales. Esta actualización no pide permisos nuevos: la sincronización usa la misma hoja, en una pestaña nueva llamada **datos**, que se crea sola.

**Si ya tenías instalada una versión anterior del script:** pega el código nuevo, ejecuta `configurarHoja` (acepta el permiso nuevo de hojas de cálculo) y luego ve a *Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar*. Así la URL sigue siendo la misma.

Para agregar otro banco, súmalo a la lista `SENDERS` del script y crea una nueva versión de la misma forma. La app solo entiende los formatos que ya conoce; si llega otro, avísame con un ejemplo.

### Recordatorios de pagos por correo

El script te escribe a tu Gmail cada mañana (7 a. m., hora de Colombia) cuando una tarjeta, el crédito o la cuota de una deuda vence en 3 días, mañana u hoy, y cada 3 días mientras algo siga vencido. No te avisa lo que ya pagaste: usa los pagos que llegaron en tus alertas después de la fecha de corte y el **"Ya pagué"** que marques en Deudas.

Para activarlos (una sola vez):

1. Pega el código nuevo del script y crea una **Nueva versión** de la implementación (como en "Actualizar el script").
2. En el editor, elige la función **`activarRecordatorios`** y dale **Ejecutar**. Google te pide dos permisos nuevos: **enviar correo como tú** (solo a ti mismo) y **ejecutarse cuando no estás** (para el aviso diario). Revisa y acepta.
3. Te llega un correo **"Mis finanzas: recordatorios activados"** con lo que tienes pendiente hoy.

Para ver la lista sin mandar correos, ejecuta `verRecordatorios` y mira el registro. Para apagarlos, ejecuta `desactivarRecordatorios`.

### Sincronización entre tus dispositivos

Con el script conectado, la app sincroniza sola los movimientos, Revisar, el presupuesto, las reglas de categorías, las tarjetas y las cuentas de cobro entre tu PC y tu iPhone. Lo hace al abrir la app, al volver a ella y unos segundos después de cada cambio. Todo queda en la pestaña **datos** de tu hoja, una fila por registro. Si cambias lo mismo en dos dispositivos, gana el cambio más reciente. Para un dispositivo nuevo, basta con pegar la URL y la clave en **⚙ → Cuenta de Google**: baja todo lo que ya tienes.

### Tablero compartido de Claude

Una tarea programada de Claude copia una vez al día los pagos nuevos entre la hoja y el tablero "Deuda Juan Camilo", en las dos direcciones, sin borrar nada. Esa tarea corre en la app de Claude de tu computador, no en este código.

## 2. Apple Pay: Atajo "Transacción"

Cada vez que pagas con Apple Pay, el iPhone le pasa la compra a la app.

1. Abre **Atajos → Automatización → Nueva automatización → Transacción**.
2. Elige tus tarjetas y marca **Ejecutar inmediatamente**.
3. Acción: **Abrir URLs** con esta dirección:

   ```
   https://siangonzalez.github.io/mis-finanzas/#/applepay?monto=[Cantidad]&comercio=[Comercio]&tarjeta=[Tarjeta]
   ```

   Inserta `Cantidad`, `Comercio` y `Tarjeta` como variables del atajo, no como texto.
4. La compra aparece en **Revisar**. Si también llega la alerta de Bancolombia, la app la detecta como repetida y no la cuenta dos veces.

## 3. SMS del banco: Atajo "Mensaje"

1. Ve a **Automatización → Mensaje**, con remitente "Bancolombia" (o el que te escriba) y **Ejecutar inmediatamente**.
2. Acción: **Abrir URLs** con:

   ```
   https://siangonzalez.github.io/mis-finanzas/#/alerta?texto=[Mensaje]
   ```

   Usa *Codificar URL* sobre el mensaje antes de armar la dirección.

Lo que va después de `#` se queda en el teléfono: no llega al servidor donde está publicada la app.
