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

**Si ya tenías instalada una versión anterior del script:** pega el código nuevo, ejecuta `configurarHoja` (acepta el permiso nuevo de hojas de cálculo) y luego ve a *Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar*. Así la URL sigue siendo la misma.

Para agregar otro banco, súmalo a la lista `SENDERS` del script y crea una nueva versión de la misma forma. La app solo entiende los formatos que ya conoce; si llega otro, avísame con un ejemplo.

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
