// Configuración de la conexión. Si SUPABASE_URL queda vacío la app
// arranca en MODO DEMO (datos solo en este navegador) para probarla.
export const CONFIG = {
  SUPABASE_URL: 'https://hphlllxayecwupggsskm.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_HPw29gLBj4_UOAaZrYJLXQ_JSHzM7fm',   // clave pública (publishable)
  VAPID_PUBLIC_KEY: 'BGk-dZ6lhK6l4m7GzG7TVOPI43ZBVBosnjFIFyHro4Grzifga70cTWDmEXY2FinTEO6upJl1F6bCPuy35CffTTg',    // clave pública para notificaciones push
  NOMBRE_GRUPO: 'Inventario del grupo',

  // Los únicos que pueden entrar. Aquí solo van los nombres: el correo
  // cada uno lo escribe la primera vez y el celular lo recuerda (así los
  // correos no quedan publicados en el código). La lista real de quién
  // puede entrar está en la tabla members de Supabase.
  USUARIOS: [
    { name: 'Manuel Cruz' },
    { name: 'Mabel Rincón' },
    { name: 'Juan Montealegre' },
  ],
};
