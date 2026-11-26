// Función "notify": cuando alguien hace un cambio, manda un aviso push
// al celular de los otros integrantes (aunque tengan la app cerrada).
// Se pega en Supabase → Edge Functions → Deploy new function → "notify".
// Necesita los secretos VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Clave con permisos de servidor (sistema antiguo o nuevo de claves de Supabase).
function claveServidor(): string {
  const vieja = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (vieja) return vieja;
  const una = Deno.env.get('SUPABASE_SECRET_KEY');
  if (una) return una;
  const todas = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
  return todas.default || Object.values(todas)[0] as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, claveServidor());

    // ¿Quién llama? Solo los miembros del grupo pueden disparar avisos.
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data: u } = await admin.auth.getUser(token);
    const email = u?.user?.email?.toLowerCase();
    if (!email) return json({ error: 'sin sesión' }, 401);
    const { data: miembro } = await admin.from('members').select('email').ilike('email', email).maybeSingle();
    if (!miembro) return json({ error: 'no es miembro' }, 403);

    const { activity_id } = await req.json();
    const { data: a } = await admin.from('activity').select('*').eq('id', activity_id).single();
    if (!a) return json({ error: 'actividad no encontrada' }, 404);

    const { data: subs } = await admin.from('push_subscriptions').select('*')
      .neq('user_email', a.actor_email);

    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') || 'mailto:inventario@example.com',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    );
    const payload = JSON.stringify({
      title: a.component_name ? a.component_name : 'Inventario',
      body: `${a.actor_name} ${a.detail}`,
      tag: a.id,
      url: a.component_id ? `#comp/${a.component_id}` : '#novedades',
    });

    let enviados = 0;
    await Promise.all((subs || []).map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription, payload, { TTL: 60 * 60 * 24 });
        enviados++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // suscripción vencida (desinstaló la app o borró datos): se elimina
        if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        else console.error('push', code, (e as Error).message);
      }
    }));
    return json({ enviados });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
