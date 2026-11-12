# Liquidación semanal de gastos PBS Honduras — servicio web

## Instalar (PC o servidor Windows)
1. Instale **Node.js 22 LTS o superior** (https://nodejs.org). Es lo único que se instala.
2. Descomprima esta carpeta, por ejemplo en `C:\fondo-fijo`.
3. Doble clic en **iniciar.bat**. La primera vez muestra (y guarda en `data\PRIMERA_CLAVE_ADMIN.txt`) la clave temporal del usuario `admin`. Borre ese archivo después.
4. Abra `http://localhost:3000`. Los colaboradores entran desde su equipo con `http://NOMBRE-O-IP-DEL-SERVIDOR:3000`.
5. Permita el puerto 3000 en el Firewall de Windows (Entrada, TCP).

## Primeros pasos del administrador
1. Ingrese como `admin`; el sistema pide crear una contraseña nueva.
2. **Administración → Configuración**: pegue la clave de la API de Claude de la empresa (https://console.anthropic.com). Aquí también se cambia el costo por km (5.40).
3. **Administración → Cuentas**: cree una cuenta por colaborador con nombre, cargo y fondo fijo. La contraseña es temporal; cada persona la cambia al entrar.

## Qué puede hacer cada rol
- **Administrador**: crear/editar/desactivar cuentas, cambiar nombre, cargo, fondo fijo y rol, restablecer contraseñas, cambiar L. por km y la clave de la API, ver y quitar facturas registradas, ver la bitácora.
- **Colaborador**: solo ingresar, subir facturas y descargar su PDF. Nombre, cargo y fondo fijo se precargan de su cuenta y están bloqueados; el servidor los toma de la cuenta (no de lo que envíe el navegador), igual que los L. por km.

## Facturas duplicadas
Al descargar un PDF se registran las facturas (solo datos: RTN emisor, N° de factura, CAI, fecha, monto, quién y cuándo; no se guardan imágenes). Durante 4 semanas, cualquier colaborador que use una factura con el mismo **RTN del emisor + correlativo** (o CAI + correlativo si falta el RTN), o la misma imagen, recibe un aviso al subirla y el PDF lleva al pie de esa página una marca discreta: *FACTURA DUPLICADA, utilizada el (fecha y hora) por (gestor), correlativo, fecha, monto y qué coincidió*. Volver a descargar el mismo reporte (mismo correlativo y período) no cuenta como duplicado. Los registros se borran solos a las 4 semanas.

## HTTPS (recomendado)
Copie `config.example.json` a `config.json` y ponga las rutas de su certificado: `"https": {"key": "cert\\key.pem", "cert": "cert\\cert.pem"}`. Sin HTTPS, las contraseñas viajan sin cifrar dentro de la red local.

## Que corra siempre (servicio de Windows)
Con NSSM (https://nssm.cc): `nssm install FondoFijo "C:\Program Files\nodejs\node.exe" "--disable-warning=ExperimentalWarning" "server.js"` y en Directorio de inicio ponga la carpeta del sistema; luego `nssm start FondoFijo`.

## Respaldo
Todo está en la carpeta `data` (`fondo-fijo.db`, `secret.key`). Ejecute **respaldar.bat** o copie esa carpeta. Para actualizar el sistema, reemplace todo menos `data` y `config.json`.

## Si alguien olvida la contraseña
Un administrador usa **Restablecer clave** en la cuenta. Si se pierde la del único administrador: detenga el servicio, borre `data\fondo-fijo.db` solo si acepta perder cuentas y registros, o contacte a soporte.
