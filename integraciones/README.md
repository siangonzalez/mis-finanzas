# Integraciones

## 1. Gmail: alertas bancarias automáticas

El archivo [gmail-apps-script.gs](gmail-apps-script.gs) corre en tu propia cuenta de Google. Lee solo los correos de alertas de Bancolombia, Nequi, PSE y los pagos de Davivienda, y le pasa el texto a la app cuando la app presenta tu clave secreta.

### Instalación (unos 5 minutos, una sola vez)

1. Entra a <https://script.google.com> con la cuenta donde te llegan las alertas y crea un **Proyecto nuevo**. Ponle de nombre "Mis finanzas".
2. Borra lo que trae el editor y pega todo el contenido de `gmail-apps-script.gs`. Guarda con Ctrl+S.
3. Arriba, elige la función **`crearClave`** y dale **Ejecutar**.
   - Google te pide permiso para leer tu Gmail. Ese permiso es para tu propio script: revisa la pantalla y acepta.
   - Si aparece "Google no verificó esta app", entra a *Configuración avanzada → Ir a Mis finanzas*.
4. Abre **Registro de ejecución** y copia la clave que aparece.
5. Opcional: ejecuta **`probar`** para confirmar que encuentra tus alertas.
6. Ve a **Implementar → Nueva implementación**:
   - Tipo: **Aplicación web**.
   - Ejecutar como: **Yo**.
   - Quién tiene acceso: **Cualquier usuario**. Sin la clave secreta el script no devuelve nada.
   - Dale **Implementar** y copia la **URL de la aplicación web**, que termina en `/exec`.
7. En la app, entra a **Ajustes → Gmail**, pega la URL y la clave, y toca **Probar conexión**.

Para agregar otro banco, súmalo a la lista `SENDERS` del script y crea una nueva versión en *Implementar → Gestionar implementaciones*. La app solo entiende los formatos que ya conoce; si llega otro, avísame con un ejemplo.

## 2. Apple Pay: Atajo "Transacción"

Cada vez que pagas con Apple Pay, el iPhone le pasa la compra a la app.

1. Abre **Atajos → Automatización → Nueva automatización → Transacción**.
2. Elige tus tarjetas y marca **Ejecutar inmediatamente**.
3. Acción: **Abrir URLs** con esta dirección (cambia el dominio por el de tu app):

   ```
   https://TU-APP/#/applepay?monto=[Cantidad]&comercio=[Comercio]&tarjeta=[Tarjeta]
   ```

   Inserta `Cantidad`, `Comercio` y `Tarjeta` como variables del atajo, no como texto.
4. La compra aparece en **Revisar**. Si también llega la alerta de Bancolombia, la app la detecta como repetida y no la cuenta dos veces.

## 3. SMS del banco: Atajo "Mensaje"

1. Ve a **Automatización → Mensaje**, con remitente "Bancolombia" (o el que te escriba) y **Ejecutar inmediatamente**.
2. Acción: **Abrir URLs** con:

   ```
   https://TU-APP/#/alerta?texto=[Mensaje]
   ```

   Usa *Codificar URL* sobre el mensaje antes de armar la dirección.

Lo que va después de `#` se queda en el teléfono: no llega al servidor donde está publicada la app.
