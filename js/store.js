// Capa de datos. Dos versiones con la misma forma:
//  - NubeStore: Supabase (compartido entre los tres, en tiempo real)
//  - DemoStore: localStorage (para probar sin configurar nada)
import { CONFIG } from './config.js';
import { normalizeKey } from './normalize.js';

const PK = { boxes: 'number', push_subscriptions: 'endpoint' };
const pk = t => PK[t] || 'id';

// ---------------------------------------------------------------- Nube
class NubeStore {
  mode = 'nube';
  async init() {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    this.sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    this.listeners = [];
    this.user = null;
  }
  onChange(cb) { this.listeners.push(cb); }
  _emit(t, p) { this.listeners.forEach(cb => cb(t, p)); }

  _subscribe() {
    if (this.channel) return;
    this.channel = this.sb.channel('cambios')
      .on('postgres_changes', { event: '*', schema: 'public' }, p => this._emit(p.table, p))
      .subscribe();
  }

  async _cargarUsuario(session) {
    if (!session) { this.user = null; return null; }
    const email = session.user.email.toLowerCase();
    const { data } = await this.sb.from('members').select('*').ilike('email', email).maybeSingle();
    if (!data) {
      await this.sb.auth.signOut();
      throw new Error('Este correo no está en la lista de miembros del grupo.');
    }
    this.user = { email, name: data.name };
    this._subscribe();
    return this.user;
  }
  async session() {
    const { data } = await this.sb.auth.getSession();
    return this._cargarUsuario(data.session);
  }
  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message);
    return this._cargarUsuario(data.session);
  }
  async signOut() { await this.sb.auth.signOut(); this.user = null; }

  async members() {
    const { data, error } = await this.sb.from('members').select('*').order('name');
    if (error) throw error;
    return data;
  }
  async list(table) {
    let q = this.sb.from(table).select('*');
    if (table === 'activity') q = q.order('created_at', { ascending: false }).limit(300);
    else if (table === 'boxes') q = q.order('number');
    else if (table === 'loans') q = q.order('lent_at', { ascending: false });
    else if (table !== 'push_subscriptions') q = q.order('created_at', { ascending: false });
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }
  async insert(table, row) {
    const { data, error } = await this.sb.from(table).insert(row).select().single();
    if (error) throw traducir(error);
    return data;
  }
  async upsert(table, row) {
    const { error } = await this.sb.from(table).upsert(row);
    if (error) throw traducir(error);
  }
  async update(table, id, patch) {
    const { data, error } = await this.sb.from(table).update(patch).eq(pk(table), id).select().single();
    if (error) throw traducir(error);
    return data;
  }
  async remove(table, id) {
    const { error } = await this.sb.from(table).delete().eq(pk(table), id);
    if (error) throw traducir(error);
  }
  async uploadPhoto(id, blob) {
    const path = `${id}/${Date.now()}.jpg`;
    const { error } = await this.sb.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
    return this.sb.storage.from('fotos').getPublicUrl(path).data.publicUrl;
  }
  async removePhoto(url) {
    const i = url ? url.indexOf('/fotos/') : -1;
    if (i < 0) return;
    await this.sb.storage.from('fotos').remove([decodeURIComponent(url.slice(i + 7))]);
  }
  // Pide al servidor que mande la notificación push a los otros dos.
  notify(activityId) {
    this.sb.functions.invoke('notify', { body: { activity_id: activityId } }).catch(() => {});
  }
  // La IA compara la idea con el inventario. Devuelve el proyecto ya guardado.
  async analizarProyecto(descripcion, projectId) {
    const { data, error } = await this.sb.functions.invoke('proyecto', { body: { descripcion, project_id: projectId || null } });
    if (error) {
      const cuerpo = await error.context?.json?.().catch(() => null);
      throw new Error(cuerpo?.error || 'No se pudo hablar con la IA. Revisa tu internet e intenta de nuevo.');
    }
    return data.proyecto;
  }
}

function traducir(error) {
  if (error.code === '23505') return new Error('Ya existe un registro igual (nombre o número repetido).');
  if (error.code === '23503') return new Error('Esa caja no existe o está en uso.');
  return new Error(error.message);
}

// ---------------------------------------------------------------- Demo
const DEMO_KEY = 'inv-demo-datos';
const DEMO_USER = 'inv-demo-usuario';
// En modo demo cada nombre recibe un correo de prueba.
export const DEMO_MIEMBROS = CONFIG.USUARIOS.map(u => ({
  name: u.name,
  email: u.name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '.') + '@demo',
}));

class DemoStore {
  mode = 'demo';
  async init() {
    this.listeners = [];
    this.bc = 'BroadcastChannel' in self ? new BroadcastChannel('inv-demo') : null;
    if (this.bc) this.bc.onmessage = e => this._emit(e.data.table, e.data, false);
    if (!localStorage.getItem(DEMO_KEY)) this._save(semilla());
  }
  onChange(cb) { this.listeners.push(cb); }
  _emit(table, p, broadcast = true) {
    this.listeners.forEach(cb => cb(table, p));
    if (broadcast && this.bc) this.bc.postMessage({ table, eventType: p.eventType, new: p.new });
  }
  _load() { return JSON.parse(localStorage.getItem(DEMO_KEY) || '{}'); }
  _save(db) { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); }

  async session() {
    const e = localStorage.getItem(DEMO_USER);
    return (this.user = DEMO_MIEMBROS.find(m => m.email === e) || null);
  }
  async signIn(email) {
    const m = DEMO_MIEMBROS.find(m => m.email === email);
    if (!m) throw new Error('Elige uno de los usuarios de prueba.');
    localStorage.setItem(DEMO_USER, email);
    return (this.user = m);
  }
  async signOut() { localStorage.removeItem(DEMO_USER); this.user = null; }
  async members() { return DEMO_MIEMBROS; }

  async list(table) {
    const rows = [...(this._load()[table] || [])];
    if (table === 'boxes') rows.sort((a, b) => a.number - b.number);
    else rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return table === 'activity' ? rows.slice(0, 300) : rows;
  }
  async insert(table, row) {
    const db = this._load();
    db[table] = db[table] || [];
    const r = { created_at: new Date().toISOString(), ...row };
    if (pk(table) === 'id' && !r.id) r.id = crypto.randomUUID();
    if (db[table].some(x => x[pk(table)] === r[pk(table)])) throw new Error('Ya existe un registro igual (nombre o número repetido).');
    if (table === 'components' && db[table].some(x => x.key === r.key)) throw new Error('Ya existe un registro igual (nombre o número repetido).');
    db[table].push(r);
    this._save(db);
    this._emit(table, { eventType: 'INSERT', new: r });
    return r;
  }
  async upsert(table, row) {
    const db = this._load();
    db[table] = (db[table] || []).filter(x => x[pk(table)] !== row[pk(table)]);
    db[table].push(row);
    this._save(db);
  }
  async update(table, id, patch) {
    const db = this._load();
    const r = (db[table] || []).find(x => x[pk(table)] === id);
    if (!r) throw new Error('No encontrado');
    if (table === 'components' && patch.key && db.components.some(x => x.key === patch.key && x.id !== id))
      throw new Error('Ya existe un registro igual (nombre o número repetido).');
    // si cambia el número de una caja, mover sus componentes (como "on update cascade")
    if (table === 'boxes' && patch.number && patch.number !== id) {
      if (db.boxes.some(b => b.number === patch.number)) throw new Error('Ya existe una caja con ese número.');
      db.components.forEach(c => { if (c.box === id) c.box = patch.number; });
    }
    Object.assign(r, patch);
    this._save(db);
    this._emit(table, { eventType: 'UPDATE', new: r });
    if (table === 'boxes') this._emit('components', { eventType: 'UPDATE' });
    return r;
  }
  async remove(table, id) {
    const db = this._load();
    db[table] = (db[table] || []).filter(x => x[pk(table)] !== id);
    if (table === 'components') {
      db.observations = (db.observations || []).filter(o => o.component_id !== id);
      (db.loans || []).forEach(l => { if (l.component_id === id) l.component_id = null; });
    }
    if (table === 'boxes') (db.components || []).forEach(c => { if (c.box === id) c.box = null; });
    this._save(db);
    this._emit(table, { eventType: 'DELETE', old: { [pk(table)]: id } });
  }
  async uploadPhoto(id, blob) {
    return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  }
  async removePhoto() {}
  notify() {}
  // Respuesta de ejemplo: en modo demo no se llama a ninguna IA.
  async analizarProyecto(descripcion, projectId) {
    await new Promise(r => setTimeout(r, 900));
    const db = this._load();
    const result = {
      resumen: 'Respuesta de ejemplo del modo demo: aquí la IA explica cómo armar el proyecto.',
      tengo: db.components.slice(0, 2).map((c, i) => ({ component_id: c.id, nombre: c.name, cantidad: i ? c.quantity + 1 : 1, para_que: 'Parte de ejemplo', nota: i ? '' : 'Verifica que funcione antes de montarlo.' })),
      comprar: [
        { nombre: 'Fuente 12 V 2 A', cantidad: 1, para_que: 'Alimentar todo', especificacion: 'Fuente conmutada 12 V, mínimo 2 A', obligatorio: true },
        { nombre: 'Caja plástica', cantidad: 1, para_que: 'Proteger el circuito', especificacion: '15 × 10 × 5 cm', obligatorio: false },
      ],
      dudas: ['¿Va a funcionar con batería o conectado a la pared?'],
    };
    const fila = { title: descripcion.slice(0, 40), description: descripcion, result, model: 'ejemplo', updated_at: new Date().toISOString() };
    return projectId ? this.update('projects', projectId, fila) : this.insert('projects', { ...fila, created_by: this.user.name });
  }
}

function semilla() {
  const N = DEMO_MIEMBROS.map(m => m.name);
  const t = (d) => new Date(Date.now() - d * 864e5).toISOString();
  const comp = (name, category, box, quantity, notes = '', d = 3) =>
    ({ id: crypto.randomUUID(), name, key: normalizeKey(name), aliases: [], category, box, quantity, notes, photo_url: null,
       created_by: N[0], created_at: t(d), updated_by: N[0], updated_at: t(d) });
  const components = [
    comp('LM358', 'Circuitos integrados', 1, 6, 'Amplificador operacional doble', 20),
    comp('Arduino Uno', 'Microcontroladores', 2, 2, 'Uno tiene el USB flojo', 15),
    comp('Resistencia 10k', 'Resistencias', 1, 50, '', 12),
    comp('Sensor ultrasónico HC-SR04', 'Sensores', 3, 3, '', 8),
    comp('ESP32 DevKit', 'Microcontroladores', 2, 4, '', 5),
    comp('Transistor 2N2222', 'Transistores', 1, 20, '', 4),
    comp('Servo SG90', 'Motores y actuadores', 3, 5, '', 2),
  ];
  return {
    boxes: [
      { number: 1, description: 'Pequeños: ICs, resistencias, transistores', created_at: t(30) },
      { number: 2, description: 'Placas de desarrollo', created_at: t(30) },
      { number: 3, description: 'Sensores y motores', created_at: t(30) },
    ],
    components,
    observations: [
      { id: crypto.randomUUID(), component_id: components[1].id, author: N[1], text: 'El de la caja con cinta roja es el que falla.', created_at: t(10) },
    ],
    loans: [
      { id: crypto.randomUUID(), component_id: components[4].id, component_name: 'ESP32 DevKit', box: 2, quantity: 1,
        borrower_kind: 'externo', borrower_name: 'Daniel (compañero de Control)', borrower_contact: '300 000 0000',
        lent_by: N[2], lent_at: t(6), due_at: t(-2).slice(0, 10), returned_at: null, notes: 'Para su proyecto final' },
    ],
    activity: [
      { id: crypto.randomUUID(), kind: 'prestamo', component_id: components[4].id, component_name: 'ESP32 DevKit',
        actor_email: DEMO_MIEMBROS[2].email, actor_name: N[2], detail: 'prestó 1 a Daniel (compañero de Control)', created_at: t(6) },
    ],
    push_subscriptions: [],
  };
}

export const store = CONFIG.SUPABASE_URL ? new NubeStore() : new DemoStore();
