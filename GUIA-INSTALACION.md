# Inventario de componentes — guía de instalación

> **Estado (26 nov 2026):** todo configurado. La app está publicada en **https://montealegrejj.github.io/inventario/**. Solo falta que cada uno la instale en su celular (paso 7).

App compartida para **Manuel Cruz, Mabel Rincón y Juan Montealegre**: qué componentes tienen, en qué caja está cada uno, quién tiene algo prestado y avisos al celular de cada cambio.

Todo es gratis: **Supabase** (base de datos, fotos y avisos) + **GitHub Pages** (la página de la app). Se hace una sola vez (unos 30 minutos) y la hace **una sola persona**. Los otros dos solo instalan la app en el celular (paso 7).

---

## 0. Probarla antes (opcional)

Mientras `js/config.js` no tenga `SUPABASE_URL`, la app abre en **modo demo**: no pide contraseña, trae datos de ejemplo y todo se guarda solo en ese navegador. Sirve para ver cómo funciona antes de configurar nada.

---

## 1. Crear el proyecto en Supabase

1. Entra a <https://supabase.com> → **Start your project** y crea una cuenta (puede ser con GitHub).
2. **New project** → nombre `inventario`, una contraseña de base de datos cualquiera (guárdala), región **South America (São Paulo)** → **Create**.
3. Espera 1–2 minutos a que termine de crearse.

## 2. Crear las tablas

1. Menú izquierdo → **SQL Editor** → **New query**.
2. Abre el archivo `supabase/schema.sql`, copia **todo** y pégalo.
3. **Run**. Debe decir *Success. No rows returned*.

Esto crea las cajas, los componentes, las observaciones, los préstamos, las novedades, el espacio para fotos y la regla de que **solo los tres integrantes** pueden ver o cambiar algo.

## 3. Crear los tres usuarios con contraseña

1. **Authentication → Users → Add user → Create new user**.
2. Crea uno por persona con **su correo de la universidad** y su contraseña. Deja marcado **Auto Confirm User**.
3. En **SQL Editor**, los mismos tres correos deben estar en la tabla `members` (con su nombre). Solo quien esté ahí puede ver o cambiar datos.
4. **Authentication → Sign In / Providers**: desactiva **Allow new users to sign up** → **Save changes**. Así nadie más puede crearse una cuenta.

En la app cada uno toca su nombre y escribe su correo **la primera vez**; el celular lo recuerda y después solo pide la contraseña. Los correos no se escriben en el código de la app.

> **¿Alguien olvidó la contraseña?** En **Authentication → Users**, los tres puntos al lado del usuario → **Send password recovery**, o cámbiala desde ahí.

## 4. Conectar la app con Supabase

1. **Project Settings → API** (o **Data API** / **API Keys**).
2. Copia la **Project URL** y la clave **anon public** (o **publishable**).
3. Abre `js/config.js` y pégalas:

   ```js
   SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
   SUPABASE_ANON_KEY: 'eyJhbGciOi...',
   ```

   Esa clave puede ser pública: la seguridad la ponen las reglas del paso 2.

## 5. Activar los avisos push (función `notify`)

1. **Edge Functions → Deploy a new function → Via Editor**.
2. Nombre: `notify` (exacto). Borra el código de ejemplo y pega todo el contenido de `supabase/functions/notify/index.ts` → **Deploy function**.
3. **Edge Functions → Secrets** (o *Manage secrets*): agrega los tres valores que están en `SECRETOS-NO-SUBIR.txt` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).

⚠️ `SECRETOS-NO-SUBIR.txt` **no se sube a GitHub ni se comparte**: con esa clave cualquiera podría mandarles avisos.

## 6. Publicar la app en internet (GitHub Pages)

1. En <https://github.com> → **New repository** → nombre `inventario` → **Public** → **Create**.
2. **uploading an existing file** → arrastra **todo el contenido** de la carpeta `inventario-componentes` **excepto** `SECRETOS-NO-SUBIR.txt` → **Commit changes**.
3. **Settings → Pages** → *Source*: **Deploy from a branch** → rama `main`, carpeta `/ (root)` → **Save**.
4. En 1–2 minutos queda en `https://SU-USUARIO.github.io/inventario/`. Ese es el enlace que se pasa a los otros dos.

Cuando cambien algo de la app, se vuelve a subir el archivo cambiado al mismo repositorio.

## 7. Instalar en el celular (cada uno)

**Android (Chrome):** abre el enlace → menú **⋮** → **Instalar app** (o *Agregar a la pantalla principal*).

**iPhone (Safari, iOS 16.4 o más nuevo):** abre el enlace en **Safari** → botón **Compartir** → **Agregar a pantalla de inicio**. En iPhone los avisos **solo** funcionan si se abre desde ese ícono.

Luego, en la app: tocar su nombre → contraseña → círculo con las iniciales (arriba a la derecha) → **🔔 Activar avisos** → **Permitir**.

---

## Cómo se usa

- **🔎 Buscar:** escriban lo que necesitan antes de comprarlo. Si está, sale en qué **caja** está y cuántos quedan. Si no, sale «No lo tienen registrado».
- **＋ Agregar:** nombre, cantidad, categoría, número de caja y foto. Si ya existe, la app avisa y **suma las unidades al mismo** en vez de crear otro:
  - `LM358`, `lm358`, `Lm-358` y `LM 358` se toman como el mismo componente, sin preguntar.
  - Si es casi igual (`LM979` y `LM9797`, `LM358` y `LM358N`, `Arduino Uno` y `Uno Arduino`), pregunta *«¿Es el mismo componente?»*.
  - También entiende `10kΩ` = `10k ohm` = `10K`, `4,7k` = `4.7k`, `resistor` = `resistencia`, `condensador` = `capacitor`.
  - La forma en que cada uno lo escribió queda guardada como «también escrito como», y la búsqueda la encuentra.
- **Ficha del componente:** foto, caja, cantidades, quién lo tiene, observaciones (ej. «uno está quemado»), *Saqué/gasté*, *Agregué más*, *Prestar*, *Editar*, *Eliminar*.
- **📦 Cajas:** lo que hay en cada caja numerada. Una caja nueva se crea sola al guardar un componente con un número que no existía.
- **🤝 Préstamos:** a alguien del grupo o a alguien externo (nombre y celular), con fecha de devolución opcional. Muestra quién lo tiene, desde cuándo y a qué caja vuelve. Los préstamos vencidos salen en rojo.
- **🔔 Novedades:** historial de todo lo que pasó. Cada cambio le llega como aviso a los otros dos.
- **Descargar inventario:** en el menú de las iniciales, un archivo que abre en Excel.

## Bueno saber

- **El plan gratis de Supabase pausa el proyecto si nadie lo usa en 7 días.** Los datos no se pierden: entren a supabase.com y toquen **Restore project**. Si la usan seguido no pasa.
- El plan gratis da 500 MB de datos y 1 GB de fotos, que alcanza para miles de componentes, porque las fotos se reducen antes de subirlas.
- Las fotos quedan en un enlace público que nadie puede adivinar. No suban fotos privadas.
