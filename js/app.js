import { store, DEMO_MIEMBROS } from './store.js';
import { CONFIG } from './config.js';
import { normalizeKey, parecidos, coincideBusqueda } from './normalize.js';
import { ico } from './icons.js';

const CATEGORIAS = [
  'Resistencias', 'Capacitores', 'Diodos y LEDs', 'Transistores', 'Circuitos integrados',
  'Microcontroladores', 'Sensores', 'Módulos', 'Motores y actuadores', 'Fuentes y baterías',
  'Cables y conectores', 'Neumática', 'Herramientas', 'Mecánica y tornillería', 'Otros',
];
// Siglas tipo designador electrónico para las fichas sin foto.
const SIGLA_CAT = {
  'Resistencias': 'R', 'Capacitores': 'C', 'Diodos y LEDs': 'D', 'Transistores': 'Q',
  'Circuitos integrados': 'IC', 'Microcontroladores': 'MCU', 'Sensores': 'SEN', 'Módulos': 'MOD',
  'Motores y actuadores': 'M', 'Fuentes y baterías': 'PWR', 'Cables y conectores': 'J',
  'Neumática': 'PN', 'Herramientas': 'HT', 'Mecánica y tornillería': 'MEC', 'Otros': '··',
};
const ICONO_NOV = {
  nuevo: 'nuevo', sumo: 'mas', saco: 'menos', edito: 'editar', elimino: 'basura', prestamo: 'prestamo',
  devolucion: 'devolver', observacion: 'mensaje', caja: 'caja', foto: 'camara',
};

const S = {
  me: null, members: [], components: [], boxes: [], loans: [], activity: [], observations: [], projects: [],
  analizando: null,
  q: '', cat: '', loanTab: 'activos', installEvt: null,
};

// ------------------------------------------------------------ utilidades
const $ = (sel, r = document) => r.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => crypto.randomUUID();
const ahora = () => new Date().toISOString();
const compById = id => S.components.find(c => c.id === id);
const cajaPorNum = n => S.boxes.find(b => b.number === n);
const prestadas = id => S.loans.filter(l => l.component_id === id && !l.returned_at).reduce((s, l) => s + l.quantity, 0);
const disponibles = c => Math.max(0, c.quantity - prestadas(c.id));
const iniciales = n => (n || '?').trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
const nombreCaja = n => (n ? `Caja ${n}` : 'Sin caja');

function hace(iso) {
  const d = (new Date(iso) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  const tabla = [[60, 'second'], [3600, 'minute', 60], [86400, 'hour', 3600], [604800, 'day', 86400], [2629800, 'week', 604800], [31557600, 'month', 2629800], [Infinity, 'year', 31557600]];
  for (const [lim, u, div = 1] of tabla) if (Math.abs(d) < lim) return rtf.format(Math.round(d / div), u);
}
const fecha = iso => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });

function toast(msg, tipo = '') {
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), tipo === 'error' ? 5000 : 3500);
}
async function intentar(fn) {
  try { return await fn(); } catch (e) { console.error(e); toast(e.message || String(e), 'error'); throw e; }
}

// Pregunta con botones. opciones: [{ valor, texto, clase }]. Devuelve el valor elegido o null.
function preguntar(titulo, html, opciones) {
  const d = $('#dialogo');
  d.className = '';
  d.innerHTML = `<h3>${esc(titulo)}</h3><div>${html}</div><div class="botones">${opciones.map((o, i) =>
    `<button class="btn ${o.clase || ''}" data-i="${i}">${esc(o.texto)}</button>`).join('')}
    <button class="btn" data-i="-1">Cancelar</button></div>`;
  return new Promise(res => {
    d.onclick = e => {
      const b = e.target.closest('[data-i]');
      if (e.target === d) { d.close(); res(null); }
      if (!b) return;
      d.close();
      const i = +b.dataset.i;
      res(i < 0 ? null : opciones[i].valor);
    };
    d.oncancel = () => res(null);
    d.showModal();
  });
}

function verFoto(url) {
  const d = $('#dialogo');
  d.className = 'foto';
  d.innerHTML = `<img src="${esc(url)}" alt="Foto">`;
  d.onclick = () => d.close();
  d.showModal();
}

// Reduce la foto a ~1000 px JPEG para que suba rápido y no ocupe espacio.
async function comprimir(file, max = 1000, calidad = 0.75) {
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la foto.'));
      i.src = URL.createObjectURL(file);
    });
  }
  const esc_ = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * esc_); c.height = Math.round(img.height * esc_);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', calidad));
}

// Deja constancia en "Novedades" y avisa a los demás.
async function registrar(kind, comp, detail) {
  const a = await store.insert('activity', {
    id: uuid(), kind, component_id: comp?.id ?? null, component_name: comp?.name ?? comp?.component_name ?? null,
    actor_email: S.me.email, actor_name: S.me.name, detail,
  });
  store.notify(a.id);
}

// Botones de foto de una ficha (componente o caja): se guarda apenas se elige.
const botonesFoto = tiene => `<div class="botones foto-botones">
      <button class="btn chico" data-action="cambiar-foto" data-fuente="camara">${ico('camara')} ${tiene ? 'Tomar otra foto' : 'Tomar foto'}</button>
      <button class="btn chico" data-action="cambiar-foto" data-fuente="galeria">${ico('galeria')} Elegir de la galería</button>
    </div>
    <input type="file" accept="image/*" capture="environment" id="foto-camara" hidden>
    <input type="file" accept="image/*" id="foto-galeria" hidden>`;

const subirFoto = async (carpeta, f) => store.uploadPhoto(carpeta, await comprimir(f, store.mode === 'demo' ? 700 : 1000));

function conectarBotonesFoto(carpeta, guardar) {
  const subir = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    toast('Subiendo foto…');
    await intentar(async () => {
      await guardar(await subirFoto(carpeta, f));
      toast('Foto guardada');
    });
  };
  $('#foto-camara').onchange = subir;
  $('#foto-galeria').onchange = subir;
}

// Selector de foto dentro de un formulario: se guarda al enviar el formulario.
const selectorFoto = () => `<div class="botones foto-botones">
          <button type="button" class="btn" data-fuente="camara">${ico('camara')} Tomar foto</button>
          <button type="button" class="btn" data-fuente="galeria">${ico('galeria')} Galería</button>
        </div>
        <input id="f-foto-camara" type="file" accept="image/*" capture="environment" hidden>
        <input id="f-foto-galeria" type="file" accept="image/*" hidden>
        <div id="f-foto-caja" class="foto-elegida oculto">
          <img id="f-foto-prev" class="foto-prev" alt="Foto elegida">
          <button type="button" class="btn chico peligro" id="f-foto-quitar">${ico('x')} Quitar foto</button>
        </div>`;

// `actual` es la foto que ya tenía. Devuelve { nueva: archivo o null, quitada: bool }.
function conectarSelectorFoto(raiz, actual = null) {
  const est = { nueva: null, quitada: false };
  const img = $('#f-foto-prev', raiz);
  let temporal = null;
  const mostrar = url => {
    if (temporal) { URL.revokeObjectURL(temporal); temporal = null; }
    if (url) img.src = url; else img.removeAttribute('src');
    $('#f-foto-caja', raiz).classList.toggle('oculto', !url);
    $('.foto-botones [data-fuente="camara"]', raiz).lastChild.textContent = url ? ' Tomar otra' : ' Tomar foto';
  };
  for (const fuente of ['camara', 'galeria']) {
    const inp = $(`#f-foto-${fuente}`, raiz);
    $(`.foto-botones [data-fuente="${fuente}"]`, raiz).onclick = () => inp.click();
    inp.onchange = () => {
      const f = inp.files[0];
      inp.value = '';
      if (!f) return;
      est.nueva = f;
      const url = URL.createObjectURL(f);
      mostrar(url);
      temporal = url;
    };
  }
  $('#f-foto-quitar', raiz).onclick = () => { est.nueva = null; est.quitada = !!actual; mostrar(null); };
  mostrar(actual);
  return est;
}

async function asegurarCaja(n) {
  if (!n || cajaPorNum(n)) return;
  await store.insert('boxes', { number: n, description: '' });
  S.boxes = await store.list('boxes');
}

// ------------------------------------------------------------ arranque
async function boot() {
  $('#titulo-app').textContent = CONFIG.NOMBRE_GRUPO || 'Inventario';
  registrarSW();
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });
  try {
    await store.init();
  } catch (e) {
    $('#vista').innerHTML = `<div class="tarjeta vacio"><div class="grande">${ico('nube')}</div><p>No se pudo conectar. Revisa tu internet y vuelve a abrir la app.</p><p class="peq suave">${esc(e.message)}</p></div>`;
    return;
  }
  store.onChange(cambioRemoto);
  try { S.me = await store.session(); } catch (e) { toast(e.message, 'error'); }
  if (S.me) await entrar(); else pantallaAcceso();
}

async function cargarTodo() {
  const [members, components, boxes, loans, activity, observations] = await Promise.all(
    [store.members(), ...['components', 'boxes', 'loans', 'activity', 'observations'].map(t => store.list(t))]);
  Object.assign(S, { members, components, boxes, loans, activity, observations });
  S.projects = await store.list('projects').catch(() => []);
}

async function entrar() {
  document.body.classList.remove('sin-sesion');
  $('#vista').innerHTML = '<p class="centro suave">Cargando…</p>';
  try { await cargarTodo(); } catch (e) { toast(e.message, 'error'); }
  const modo = $('#modo');
  modo.textContent = store.mode === 'demo' ? 'MODO DEMO' : `${S.components.length} componentes`;
  modo.classList.toggle('demo', store.mode === 'demo');
  $('#btn-yo').textContent = iniciales(S.me.name);
  render();
  if (store.mode === 'nube' && 'Notification' in window && Notification.permission === 'granted') activarPush(true);
}

function pantallaAcceso(error = '', elegido = localStorage.getItem('inv-ultimo-nombre') || '') {
  document.body.classList.add('sin-sesion');
  const demo = store.mode === 'demo';
  const nombres = (CONFIG.USUARIOS || []).map(u => u.name);
  const claveCorreo = n => `inv-correo-${n}`;
  const correoGuardado = elegido ? localStorage.getItem(claveCorreo(elegido)) || '' : '';
  $('#vista').innerHTML = `
    <div class="acceso tarjeta">
      <img src="icons/icon-192.png" class="logo-grande" alt="">
      <h2 class="centro">${esc(CONFIG.NOMBRE_GRUPO || 'Inventario')}</h2>
      <p class="suave centro" style="margin-top:-2px">${demo ? 'Modo demo: no pide contraseña.' : '¿Quién eres?'}</p>
      <div class="usuarios-demo">${nombres.map(n =>
        `<button type="button" class="btn ${n === elegido && !demo ? 'prim' : ''}" data-action="${demo ? 'entrar-demo' : 'elegir-usuario'}" data-nombre="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      ${!demo && elegido ? `
        <form id="form-acceso">
          <label for="a-email">Correo de ${esc(elegido.split(' ')[0])}</label>
          <input id="a-email" class="campo" type="email" autocomplete="username" inputmode="email" required value="${esc(correoGuardado)}" placeholder="tu correo de la universidad">
          <label for="a-pass">Contraseña</label>
          <input id="a-pass" class="campo" type="password" autocomplete="current-password" required>
          ${error ? `<p class="error">${esc(error)}</p>` : ''}
          <div class="botones"><button class="btn prim ancho">Entrar</button></div>
          ${correoGuardado ? '' : '<p class="ayuda">El correo solo se pide la primera vez; luego este celular lo recuerda.</p>'}
        </form>` : ''}
      <p class="ayuda centro">Solo los integrantes del grupo pueden entrar.</p>
    </div>`;
  const f = $('#form-acceso');
  if (f) {
    (correoGuardado ? $('#a-pass') : $('#a-email')).focus();
    f.onsubmit = async e => {
      e.preventDefault();
      const correo = $('#a-email').value.trim().toLowerCase();
      const b = f.querySelector('button'); b.disabled = true; b.textContent = 'Entrando…';
      try {
        S.me = await store.signIn(correo, $('#a-pass').value);
        localStorage.setItem(claveCorreo(elegido), correo);
        localStorage.setItem('inv-ultimo-nombre', elegido);
        await entrar();
      } catch (err) { pantallaAcceso(err.message, elegido); }
    };
  }
}

// Llegó un cambio (de otro miembro o de esta misma pestaña).
const pendientes = new Set();
let temporizador = null;
function cambioRemoto(table, p) {
  if (!S.me || !(table in S)) return;
  pendientes.add(table);
  clearTimeout(temporizador);
  temporizador = setTimeout(async () => {
    const tablas = [...pendientes]; pendientes.clear();
    try {
      for (const t of tablas) S[t] = await store.list(t);
    } catch (e) { console.error(e); }
    if (document.activeElement?.matches('#p-idea, #p-idea2')) { pintarBadge(); return; }
    if (!$('#sheet').classList.contains('oculto') && tablas.every(t => t === 'activity')) { pintarBadge(); return; }
    render();
  }, 150);
  if (table === 'activity' && p?.eventType === 'INSERT' && p.new && p.new.actor_email !== S.me.email) {
    toast(`${p.new.actor_name} ${p.new.detail}`);
    if (store.mode === 'demo') notificacionLocal(p.new);
  }
}

async function notificacionLocal(a) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
  const reg = await navigator.serviceWorker?.getRegistration();
  reg?.showNotification(a.component_name || 'Inventario', { body: `${a.actor_name} ${a.detail}`, icon: 'icons/icon-192.png', tag: a.id });
}

// ------------------------------------------------------------ navegación
function ruta() {
  const h = location.hash.replace(/^#/, '') || 'inventario';
  const [vista, ...resto] = h.split('/');
  return { vista, arg: decodeURIComponent(resto.join('/')) };
}

function render() {
  if (!S.me) return;
  const { vista, arg } = ruta();
  const tab = { comp: 'inventario', caja: 'cajas', proyecto: 'proyectos' }[vista] || vista;
  $('.btn-ia').classList.toggle('activo', tab === 'proyectos');
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('activo', a.dataset.tab === tab));
  document.documentElement.style.setProperty('--barra-alto', $('.barra').offsetHeight + 'px');
  const v = $('#vista');
  const vistas = { inventario: vistaInventario, comp: vistaComponente, cajas: vistaCajas, caja: vistaCaja, prestamos: vistaPrestamos, novedades: vistaNovedades, proyectos: vistaProyectos, proyecto: vistaProyecto };
  (vistas[vista] || vistaInventario)(v, arg);
  if (store.mode === 'nube') $('#modo').textContent = `${S.components.length} componentes`;
  pintarBadge();
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

function claveVisto() { return `inv-visto-${S.me?.email}`; }
function pintarBadge() {
  const visto = localStorage.getItem(claveVisto()) || '';
  const n = S.activity.filter(a => a.created_at > visto && a.actor_email !== S.me.email).length;
  const b = $('#badge');
  b.textContent = n > 99 ? '99+' : n;
  b.classList.toggle('oculto', !n || ruta().vista === 'novedades');
}

// ------------------------------------------------------------ vista: inventario / buscar
function tarjetaComp(c) {
  const disp = disponibles(c), prest = prestadas(c.id);
  return `<button class="comp" data-go="comp/${c.id}">
    <div class="thumb">${c.photo_url ? `<img src="${esc(c.photo_url)}" alt="" loading="lazy">` : `<span class="sigla">${SIGLA_CAT[c.category] || '··'}</span>`}</div>
    <div class="crece">
      <div class="nombre">${esc(c.name)}</div>
      <div class="sub"><span>${esc(c.category)}</span>${c.quantity === 0 ? '<span class="etq agotado">Agotado</span>' : ''}${prest ? `<span class="etq prestado">${prest} prestado${prest > 1 ? 's' : ''}</span>` : ''}</div>
    </div>
    <div class="lado">
      <span class="caja-pill ${c.box ? '' : 'sin'}">${nombreCaja(c.box)}</span>
      <span class="qty">${disp === c.quantity ? `${c.quantity} u.` : `${disp} de ${c.quantity} u.`}</span>
    </div>
  </button>`;
}

function vistaInventario(v) {
  const cats = [...new Set(S.components.map(c => c.category))].sort((a, b) => CATEGORIAS.indexOf(a) - CATEGORIAS.indexOf(b));
  const instalable = !matchMedia('(display-mode: standalone)').matches && !navigator.standalone && !localStorage.getItem('inv-no-instalar');
  const pedirAvisos = 'Notification' in window && Notification.permission === 'default';
  v.innerHTML = `
    <div class="buscador">
      <input id="q" type="search" placeholder="¿Qué buscas? Ej: lm358, servo, 10k…" value="${esc(S.q)}" autocomplete="off" enterkeyhint="search">
      ${cats.length > 1 ? `<div class="chips">${['', ...cats].map(c =>
        `<button class="chip ${S.cat === c ? 'activo' : ''}" data-action="cat" data-cat="${esc(c)}">${c ? esc(c) : 'Todas'}</button>`).join('')}</div>` : ''}
    </div>
    ${instalable ? `<div class="tarjeta instalar"><span class="ico-caja">${ico('movil')}</span><div class="crece peq"><b>Instálala en tu celular</b><div class="suave">Para abrirla como app y recibir avisos.</div></div><button class="btn chico acento" data-action="instalar">Cómo</button><button class="cerrar-x" data-action="no-instalar" aria-label="Ocultar">${ico('x')}</button></div>` : ''}
    ${pedirAvisos ? `<div class="tarjeta instalar"><span class="ico-caja">${ico('campana')}</span><div class="crece peq"><b>Activa los avisos</b><div class="suave">Para enterarte cuando alguien agregue, saque o preste algo.</div></div><button class="btn chico acento" data-action="activar-push">Activar</button></div>` : ''}
    ${!S.q && !S.cat ? `<a class="tarjeta instalar enlace-ia" href="#proyectos"><span class="ico-caja">${ico('ia')}</span><div class="crece peq"><b>¿Tienes un proyecto?</b><div class="suave">La IA revisa si les alcanza con lo que hay o qué falta comprar.</div></div>${ico('sig')}</a>` : ''}
    <div id="lista"></div>`;
  const q = $('#q');
  q.oninput = () => { S.q = q.value; pintarLista(); };
  pintarLista();
}

function pintarLista() {
  const cont = $('#lista');
  if (!cont) return;
  const q = S.q.trim();
  let lista = S.components.filter(c => !S.cat || c.category === S.cat);
  if (q) lista = lista.map(c => [c, coincideBusqueda(c, q)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  else lista.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));

  if (!S.components.length) {
    cont.innerHTML = `<div class="tarjeta vacio"><div class="grande">${ico('caja')}</div><p><b>Todavía no hay nada registrado.</b></p><p class="suave">Empieza por una caja: saca todo, registra cada componente con el botón + y anota el número de la caja.</p><button class="btn acento" data-action="nuevo">${ico('mas')} Agregar el primero</button></div>`;
    return;
  }
  const unidades = lista.reduce((s, c) => s + c.quantity, 0);
  cont.innerHTML = lista.length
    ? `<div class="resumen">${q ? `${lista.length} resultado${lista.length > 1 ? 's' : ''} para «${esc(q)}»` : `${lista.length} componentes · ${unidades} unidades`}</div>
       <div class="lista">${lista.map(tarjetaComp).join('')}</div>`
    : `<div class="tarjeta vacio"><div class="grande">${ico('carrito')}</div><p><b>No tienen «${esc(q)}» registrado.</b></p>
       <p class="suave">Si lo encuentras en alguna caja, agrégalo. Si no, ese sí toca comprarlo.</p>
       <button class="btn acento" data-action="nuevo" data-nombre="${esc(q)}">${ico('mas')} Agregar «${esc(q)}»</button></div>`;
}

// ------------------------------------------------------------ vista: componente
function vistaComponente(v, id) {
  const c = compById(id);
  if (!c) { v.innerHTML = `<a class="volver" href="#inventario">${ico('atras')} Volver</a><div class="tarjeta vacio"><p>Este componente ya no existe (lo eliminaron).</p></div>`; return; }
  const caja = cajaPorNum(c.box);
  const activos = S.loans.filter(l => l.component_id === c.id && !l.returned_at);
  const obs = S.observations.filter(o => o.component_id === c.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const disp = disponibles(c);
  v.innerHTML = `
    <a class="volver" href="#inventario">${ico('atras')} Volver</a>
    <h2 style="margin-bottom:10px">${esc(c.name)}</h2>
    ${c.aliases?.length ? `<div class="alias">También escrito como: ${c.aliases.map(esc).join(', ')}</div>` : ''}
    <div class="foto-grande" data-action="${c.photo_url ? 'ver-foto' : 'cambiar-foto'}" data-fuente="camara" data-id="${c.id}">
      ${c.photo_url ? `<img src="${esc(c.photo_url)}" alt="Foto de ${esc(c.name)}">` : `<div class="agregar-foto"><span class="ico-grande">${ico('camara')}</span>Toca para tomarle una foto</div>`}
    </div>
    ${botonesFoto(c.photo_url)}

    <a class="ubicacion ${c.box ? '' : 'sin'}" href="${c.box ? `#caja/${c.box}` : '#cajas'}">
      ${iconoCaja(caja)}
      <div class="crece"><div class="peq">Está guardado en</div><div class="num">${nombreCaja(c.box)}</div>
      ${caja?.description ? `<div class="peq">${esc(caja.description)}</div>` : ''}</div>${ico('sig')}
    </a>

    <div class="cantidades">
      <div><b>${c.quantity}</b><span>en total</span></div>
      <div><b>${disp}</b><span>en la caja</span></div>
      <div><b>${c.quantity - disp}</b><span>prestados</span></div>
    </div>
    <div class="botones">
      <button class="btn" data-action="ajustar" data-modo="saco" data-id="${c.id}" ${disp ? '' : 'disabled'}>${ico('menos')} Saqué / gasté</button>
      <button class="btn" data-action="ajustar" data-modo="sumo" data-id="${c.id}">${ico('mas')} Agregué más</button>
    </div>
    <div class="botones" style="margin-top:8px">
      <button class="btn acento" data-action="prestar" data-id="${c.id}" ${disp ? '' : 'disabled'}>${ico('prestamo')} Prestar</button>
    </div>

    ${activos.length ? `<h3>Quién lo tiene ahora</h3><div class="lista">${activos.map(tarjetaPrestamo).join('')}</div>` : ''}

    ${c.notes ? `<h3>Descripción</h3><div class="tarjeta" style="white-space:pre-wrap">${esc(c.notes)}</div>` : ''}

    <h3>Observaciones</h3>
    <div class="lista">${obs.map(o => `<div class="obs"><div style="white-space:pre-wrap">${esc(o.text)}</div>
      <div class="meta fila entre"><span>${esc(o.author)} · ${hace(o.created_at)}</span>
      ${o.author === S.me.name ? `<button class="btn chico peligro" data-action="borrar-obs" data-id="${o.id}" style="min-height:26px;padding:0 8px">Borrar</button>` : ''}</div></div>`).join('') || '<p class="suave peq">Nadie ha dejado observaciones. Ej: "uno está quemado", "faltan los cables".</p>'}</div>
    <form id="form-obs" class="fila" style="margin-top:8px">
      <input class="campo crece" id="obs-texto" placeholder="Escribe una observación…" maxlength="500">
      <button class="btn prim">Enviar</button>
    </form>

    <div class="botones" style="margin-top:22px">
      <button class="btn" data-action="editar" data-id="${c.id}">${ico('editar')} Editar</button>
      <button class="btn peligro" data-action="eliminar" data-id="${c.id}">${ico('basura')} Eliminar</button>
    </div>
    <p class="peq suave centro">Registrado por ${esc(c.created_by || '—')} ${c.created_at ? hace(c.created_at) : ''}${c.updated_by && c.updated_at !== c.created_at ? ` · último cambio: ${esc(c.updated_by)} ${hace(c.updated_at)}` : ''}</p>`;

  $('#form-obs').onsubmit = async e => {
    e.preventDefault();
    const texto = $('#obs-texto').value.trim();
    if (!texto) return;
    await intentar(async () => {
      await store.insert('observations', { id: uuid(), component_id: c.id, author: S.me.name, text: texto });
      await registrar('observacion', c, `comentó en ${c.name}: "${texto.slice(0, 90)}${texto.length > 90 ? '…' : ''}"`);
    });
  };
  conectarBotonesFoto(c.id, async url => {
    const vieja = c.photo_url;
    await store.update('components', c.id, { photo_url: url, updated_by: S.me.name, updated_at: ahora() });
    if (vieja) store.removePhoto(vieja).catch(() => {});
    await registrar('foto', c, `${vieja ? 'cambió' : 'agregó'} la foto de ${c.name}`);
  });
}

// ------------------------------------------------------------ vista: cajas
// Foto de la caja en pequeño, o el ícono si no tiene.
const iconoCaja = b => `<span class="ico-ubic">${b?.photo_url ? `<img src="${esc(b.photo_url)}" alt="">` : ico('caja')}</span>`;

function vistaCajas(v) {
  const sinCaja = S.components.filter(c => !c.box);
  v.innerHTML = `
    <div class="fila entre"><h2>Cajas</h2><button class="btn chico acento" data-action="nueva-caja">${ico('mas')} Nueva caja</button></div>
    ${S.boxes.length ? `<div class="rejilla">${S.boxes.map(b => {
      const comps = S.components.filter(c => c.box === b.number);
      return `<button class="tarjeta caja-card" data-go="caja/${b.number}">
        ${b.photo_url ? `<img class="caja-foto" src="${esc(b.photo_url)}" alt="Foto de la caja ${b.number}" loading="lazy">` : ''}
        <span class="num">${b.number}</span>
        <span class="desc">${esc(b.description) || '<i>Sin descripción</i>'}</span>
        <span class="peq">${comps.length} componente${comps.length === 1 ? '' : 's'}</span></button>`;
    }).join('')}</div>` : `<div class="tarjeta vacio"><div class="grande">${ico('caja')}</div><p>No hay cajas todavía.</p><p class="suave">Numeren físicamente las cajas (marcador o etiqueta) y créenlas aquí. También se crean solas al registrar un componente con un número de caja nuevo.</p></div>`}
    ${sinCaja.length ? `<h3>Sin caja asignada (${sinCaja.length})</h3><div class="lista">${sinCaja.map(tarjetaComp).join('')}</div>` : ''}`;
}

function vistaCaja(v, arg) {
  const n = +arg;
  const b = cajaPorNum(n);
  const comps = S.components.filter(c => c.box === n).sort((a, z) => a.name.localeCompare(z.name, 'es', { numeric: true }));
  v.innerHTML = `
    <a class="volver" href="#cajas">${ico('atras')} Todas las cajas</a>
    <div class="ubicacion"><span class="ico-ubic">${ico('caja')}</span><div class="crece"><div class="num">Caja ${n}</div>
      <div class="peq">${esc(b?.description || '')}</div></div></div>
    ${b ? `<div class="foto-grande de-caja" data-action="${b.photo_url ? 'ver-foto' : 'cambiar-foto'}" data-fuente="camara" data-n="${n}">
      ${b.photo_url ? `<img src="${esc(b.photo_url)}" alt="Foto de la caja ${n}">` : `<div class="agregar-foto"><span class="ico-grande">${ico('camara')}</span>Toca para tomarle una foto a la caja</div>`}
    </div>
    ${botonesFoto(b.photo_url)}` : ''}
    ${b ? `<div class="botones"><button class="btn chico" data-action="editar-caja" data-n="${n}">${ico('editar')} Editar caja</button>
      <button class="btn chico" data-action="nuevo" data-caja="${n}">${ico('mas')} Agregar a esta caja</button></div>` : '<p class="suave">Esta caja no existe.</p>'}
    <h3>Contenido (${comps.length})</h3>
    <div class="lista">${comps.map(tarjetaComp).join('') || '<p class="suave">La caja está vacía.</p>'}</div>`;
  if (b) conectarBotonesFoto(`caja-${n}`, async url => {
    const vieja = b.photo_url;
    await store.update('boxes', n, { photo_url: url });
    if (vieja) store.removePhoto(vieja).catch(() => {});
    await registrar('caja', null, `${vieja ? 'cambió' : 'agregó'} la foto de la caja ${n}`);
  });
}

// ------------------------------------------------------------ vista: proyectos con IA
// Cruza la lista de la IA con el inventario de este momento.
// La IA a veces cita el número interno del componente ("ref 74"), que aquí no sirve.
const sinRef = s => String(s ?? '').replace(/\s*\(refs?\.?\s*\d+\)|\s+refs?\.?\s*\d+/gi, '');
function estadoProyecto(p) {
  const r = p.result || {};
  const partes = (r.tengo || []).map(t => {
    const c = compById(t.component_id);
    const hay = c ? disponibles(c) : 0;
    return { ...t, c, hay, faltan: Math.max(0, t.cantidad - hay) };
  });
  const comprar = [
    ...partes.filter(t => t.faltan).map(t => ({
      nombre: t.c?.name || t.nombre, cantidad: t.faltan, para_que: t.para_que, obligatorio: true,
      especificacion: !t.c ? 'Ya no está en el inventario.' : `Se necesitan ${t.cantidad} y hay ${t.hay} en la caja.${prestadas(t.c.id) ? ` Hay ${prestadas(t.c.id)} prestadas: si las devuelven, puede que no toque comprar.` : ''}`,
    })),
    ...(r.comprar || []),
  ];
  return { partes, comprar, obligatorios: comprar.filter(x => x.obligatorio), opcionales: comprar.filter(x => !x.obligatorio) };
}
const etiquetaProyecto = e => e.obligatorios.length
  ? `<span class="etq prestado">Falta comprar ${e.obligatorios.length}</span>`
  : '<span class="etq ok">Alcanza</span>';

function vistaProyectos(v) {
  v.innerHTML = `
    <h2>Proyectos con IA</h2>
    <form id="form-proy" class="tarjeta">
      <label for="p-idea" style="margin-top:0">¿Qué quieres hacer?</label>
      <textarea id="p-idea" class="campo" maxlength="4000" rows="5" placeholder="Ej: un carro que siga una línea negra, con dos motores y batería recargable">${esc(localStorage.getItem('inv-idea') || '')}</textarea>
      <p class="error" id="p-error"></p>
      <div class="botones"><button class="btn prim ancho" id="p-enviar">${ico('ia')} Revisar si nos alcanza</button></div>
      <p class="ayuda">Entre más detalles escribas, mejor. A Gemini (Google) se le envía la idea, los componentes y sus observaciones; nunca correos, contraseñas ni a quién le prestaron. La IA se puede equivocar: revisa la lista antes de comprar.</p>
    </form>
    ${S.projects.length ? `<h3>Proyectos revisados</h3><div class="lista">${S.projects.map(p => `<a class="comp" href="#proyecto/${p.id}">
      <span class="thumb">${ico('ia')}</span>
      <div class="crece"><div class="nombre">${esc(p.title)}</div><div class="sub">${esc(p.created_by || '')} · ${hace(p.updated_at || p.created_at)}</div></div>
      ${etiquetaProyecto(estadoProyecto(p))}</a>`).join('')}</div>` : ''}`;
  const idea = $('#p-idea');
  idea.oninput = () => localStorage.setItem('inv-idea', idea.value);
  pintarAnalizando();
  $('#form-proy').onsubmit = e => {
    e.preventDefault();
    const texto = idea.value.trim();
    if (texto.length < 10) { $('#p-error').textContent = 'Cuenta un poco más sobre el proyecto.'; return; }
    analizar(texto);
  };
}

// Mientras la IA responde, los botones quedan bloqueados aunque la pantalla se refresque.
function pintarAnalizando() {
  for (const b of document.querySelectorAll('#p-enviar, #p-otra')) {
    b.disabled = !!S.analizando;
    if (S.analizando) b.textContent = 'La IA está revisando… (puede tardar hasta 2 minutos)';
  }
}

async function analizar(texto, id = null) {
  if (S.analizando) return;
  S.analizando = true;
  if ($('#p-error')) $('#p-error').textContent = '';
  pintarAnalizando();
  try {
    const p = await store.analizarProyecto(texto, id);
    S.projects = [p, ...S.projects.filter(x => x.id !== p.id)];
    if (!id) localStorage.removeItem('inv-idea');
    S.analizando = null;
    if (location.hash === `#proyecto/${p.id}`) render(); else location.hash = `proyecto/${p.id}`;
    toast('La IA terminó de revisar');
  } catch (ex) {
    S.analizando = null;
    render();
    const err = $('#p-error');
    if (err) err.textContent = ex.message; else toast(ex.message, 'error');
  }
}

function vistaProyecto(v, id) {
  const p = S.projects.find(x => x.id === id);
  if (!p) { v.innerHTML = `<a class="volver" href="#proyectos">${ico('atras')} Proyectos</a><p class="suave">Este proyecto ya no existe.</p>`; return; }
  const e = estadoProyecto(p);
  const compra = x => `<div class="tarjeta compra"><div class="fila entre"><b>${esc(x.nombre)}</b><span class="qty">× ${x.cantidad}</span></div>
    <div class="peq suave">${esc(sinRef(x.para_que))}</div>${x.especificacion ? `<div class="peq">${esc(sinRef(x.especificacion))}</div>` : ''}</div>`;
  v.innerHTML = `
    <a class="volver" href="#proyectos">${ico('atras')} Proyectos</a>
    <h2>${esc(p.title)}</h2>
    <div class="aviso ${e.obligatorios.length ? 'amarillo' : 'verde'}" style="margin-top:0">${ico(e.obligatorios.length ? 'carrito' : 'check')}
      <b>${e.obligatorios.length ? `Todavía no alcanza: falta comprar ${e.obligatorios.length === 1 ? '1 cosa' : `${e.obligatorios.length} cosas`}.` : 'Alcanza con lo que tienen.'}</b>${e.opcionales.length ? ` Hay ${e.opcionales.length} ${e.opcionales.length === 1 ? 'compra opcional' : 'compras opcionales'}.` : ''}</div>
    <p style="white-space:pre-wrap">${esc(sinRef(p.result?.resumen))}</p>

    ${e.obligatorios.length ? `<h3>Falta comprar (${e.obligatorios.length})</h3><div class="lista">${e.obligatorios.map(compra).join('')}</div>` : ''}
    ${e.opcionales.length ? `<h3>Opcional (${e.opcionales.length})</h3><div class="lista">${e.opcionales.map(compra).join('')}</div>` : ''}
    ${e.comprar.length ? `<div class="botones"><button class="btn" data-action="compartir-compras" data-id="${p.id}">${ico('compartir')} Compartir lista de compras</button></div>` : ''}

    <h3>Lo que ya tienen (${e.partes.filter(t => t.hay).length})</h3>
    <div class="lista">${e.partes.filter(t => t.hay).map(t => `<a class="comp" href="#comp/${t.component_id}">
      <span class="thumb">${t.c.photo_url ? `<img src="${esc(t.c.photo_url)}" alt="" loading="lazy">` : `<span class="sigla">${SIGLA_CAT[t.c.category] || '··'}</span>`}</span>
      <div class="crece"><div class="nombre">${esc(t.c.name)}</div><div class="sub">${esc(sinRef(t.para_que))}</div>${t.nota ? `<div class="sub nota-ia">${esc(sinRef(t.nota))}</div>` : ''}</div>
      <div class="lado"><span class="caja-pill ${t.c.box ? '' : 'sin'}">${nombreCaja(t.c.box)}</span><span class="qty">${t.faltan ? `necesita ${t.cantidad}, hay ${t.hay}` : `usa ${t.cantidad} de ${t.hay}`}</span></div></a>`).join('') || '<p class="suave">Nada del inventario sirve para este proyecto.</p>'}</div>

    ${p.result?.dudas?.length ? `<h3>La IA pregunta</h3><div class="tarjeta"><ul class="dudas">${p.result.dudas.map(d => `<li>${esc(sinRef(d))}</li>`).join('')}</ul></div>` : ''}

    <h3>Tu idea</h3>
    <textarea id="p-idea2" class="campo" maxlength="4000" rows="5">${esc(p.description)}</textarea>
    <p class="error" id="p-error"></p>
    <div class="botones">
      <button class="btn acento" id="p-otra">${ico('ia')} Volver a revisar</button>
      <button class="btn peligro" data-action="borrar-proyecto" data-id="${p.id}">${ico('basura')} Eliminar</button>
    </div>
    <p class="ayuda">Responde las preguntas o cambia la idea aquí y toca «Volver a revisar». Las cantidades se comparan con lo que hay ahora en las cajas. La IA se puede equivocar: revisa la lista antes de comprar.</p>
    ${/lite/.test(p.model || '') ? '<p class="ayuda">Los modelos principales de Gemini estaban ocupados y respondió uno más sencillo. Más tarde puedes volver a revisar para una lista mejor.</p>' : ''}
    <p class="peq suave centro">Revisado ${hace(p.updated_at || p.created_at)} · ${esc(p.model || '')}</p>`;
  pintarAnalizando();
  $('#p-otra').onclick = () => {
    const texto = $('#p-idea2').value.trim();
    if (texto.length < 10) { $('#p-error').textContent = 'Cuenta un poco más sobre el proyecto.'; return; }
    analizar(texto, p.id);
  };
}

async function compartirCompras(p) {
  const e = estadoProyecto(p);
  const linea = x => `- ${x.cantidad} × ${x.nombre}${x.especificacion ? ` (${sinRef(x.especificacion)})` : ''}`;
  const text = [`Compras para: ${p.title}`, ...e.obligatorios.map(linea), ...(e.opcionales.length ? ['', 'Opcional:', ...e.opcionales.map(linea)] : [])].join('\n');
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast('Lista copiada'); }
  } catch (ex) { if (ex.name !== 'AbortError') toast('No se pudo compartir la lista.', 'error'); }
}

// ------------------------------------------------------------ vista: préstamos
function tarjetaPrestamo(l) {
  const vencido = !l.returned_at && l.due_at && l.due_at < ahora().slice(0, 10);
  const c = compById(l.component_id);
  return `<div class="tarjeta prestamo-card ${vencido ? 'vencido' : ''}">
    <div class="fila entre envolver">
      <span class="quien">${esc(l.borrower_name)}</span>
      <span class="etq ${l.borrower_kind === 'externo' ? 'ext' : 'ok'}">${l.borrower_kind === 'externo' ? 'Externo' : 'Del grupo'}</span>
    </div>
    <div>${l.quantity} × ${c ? `<a href="#comp/${c.id}">${esc(l.component_name)}</a>` : esc(l.component_name)} <span class="suave peq">· su lugar: ${nombreCaja(l.box)}</span></div>
    ${l.borrower_contact ? `<div class="peq">${ico('tel')} ${esc(l.borrower_contact)}</div>` : ''}
    <div class="peq suave">Prestado por ${esc(l.lent_by)} el ${fecha(l.lent_at)} (${hace(l.lent_at)})</div>
    ${l.due_at && !l.returned_at ? `<div class="peq ${vencido ? 'error' : ''}" style="margin:0">${vencido ? ico('alerta') + ' Debía devolverlo' : 'Devuelve'} el ${fecha(l.due_at + 'T12:00:00')}</div>` : ''}
    ${l.notes ? `<div class="peq">${ico('nota')} ${esc(l.notes)}</div>` : ''}
    ${l.returned_at ? `<div class="peq"><span class="etq ok">Devuelto ${fecha(l.returned_at)}</span></div>`
      : `<button class="btn chico prim" data-action="devolver" data-id="${l.id}">${ico('devolver')} Ya lo devolvió</button>`}
  </div>`;
}

function vistaPrestamos(v) {
  const activos = S.loans.filter(l => !l.returned_at).sort((a, b) => (a.due_at || '9').localeCompare(b.due_at || '9'));
  const devueltos = S.loans.filter(l => l.returned_at).sort((a, b) => b.returned_at.localeCompare(a.returned_at));
  const lista = S.loanTab === 'activos' ? activos : devueltos;
  v.innerHTML = `
    <div class="fila entre"><h2>Préstamos</h2><button class="btn chico acento" data-action="prestar">${ico('mas')} Prestar</button></div>
    <div class="segmento">
      <button class="${S.loanTab === 'activos' ? 'activo' : ''}" data-action="loan-tab" data-tab="activos">Prestados ahora (${activos.length})</button>
      <button class="${S.loanTab === 'devueltos' ? 'activo' : ''}" data-action="loan-tab" data-tab="devueltos">Historial (${devueltos.length})</button>
    </div>
    <div class="lista" style="margin-top:12px">${lista.map(tarjetaPrestamo).join('') ||
      `<div class="tarjeta vacio"><div class="grande">${ico('prestamo')}</div><p class="suave">${S.loanTab === 'activos' ? 'Nadie tiene nada prestado. Todo está en sus cajas.' : 'Aún no hay préstamos devueltos.'}</p></div>`}</div>`;
}

// ------------------------------------------------------------ vista: novedades
function vistaNovedades(v) {
  const visto = localStorage.getItem(claveVisto()) || '';
  const notifOk = 'Notification' in window && Notification.permission === 'granted';
  v.innerHTML = `
    <h2>Novedades</h2>
    ${!notifOk ? `<div class="tarjeta fila" style="margin-bottom:10px"><span class="ico-caja">${ico('campana')}</span><div class="crece peq">Activa los avisos para enterarte cuando alguien agregue, saque o preste algo.</div><button class="btn chico acento" data-action="activar-push">Activar</button></div>` : ''}
    <div class="lista">${S.activity.map(a => `
      <${a.component_id && compById(a.component_id) ? `a href="#comp/${a.component_id}" style="color:inherit;text-decoration:none"` : 'div'} class="tarjeta nov ${a.created_at > visto && a.actor_email !== S.me.email ? 'nueva' : ''}">
        <span class="ico">${ico(ICONO_NOV[a.kind] || 'nuevo')}</span>
        <div class="crece"><div><b>${esc(a.actor_name)}</b> ${esc(a.detail)}</div><div class="cuando">${hace(a.created_at)} · ${fecha(a.created_at)}</div></div>
      </${a.component_id && compById(a.component_id) ? 'a' : 'div'}>`).join('') || '<p class="suave">Todavía no ha pasado nada.</p>'}</div>`;
  if (S.activity[0]) localStorage.setItem(claveVisto(), S.activity[0].created_at);
}

// ------------------------------------------------------------ hoja (modal)
function abrirHoja(html) {
  $('#sheet-cuerpo').innerHTML = html;
  $('#sheet').classList.remove('oculto');
  document.body.style.overflow = 'hidden';
  document.activeElement?.blur?.();
  return $('#sheet-cuerpo');
}
function cerrarHoja() {
  $('#sheet').classList.add('oculto');
  document.body.style.overflow = '';
  render();
}

function selectorCaja(actual) {
  return `<input id="f-caja" class="campo" type="number" inputmode="numeric" min="1" placeholder="Número de la caja" value="${actual ?? ''}" required>
    ${S.boxes.length ? `<div class="cajas-rapidas">${S.boxes.map(b => `<button type="button" data-caja="${b.number}" class="${b.number === actual ? 'activo' : ''}" title="${esc(b.description)}">${b.number}</button>`).join('')}</div>` : ''}
    <div class="ayuda" id="f-caja-desc"></div>`;
}
function conectarSelectorCaja(raiz) {
  const inp = $('#f-caja', raiz), desc = $('#f-caja-desc', raiz);
  const pintar = () => {
    const n = +inp.value, b = cajaPorNum(n);
    raiz.querySelectorAll('.cajas-rapidas button').forEach(x => x.classList.toggle('activo', +x.dataset.caja === n));
    desc.textContent = !n ? '' : b ? (b.description || `Caja ${n}`) : `La caja ${n} no existe aún: se creará al guardar.`;
  };
  raiz.querySelectorAll('.cajas-rapidas button').forEach(x => x.onclick = () => { inp.value = x.dataset.caja; pintar(); });
  inp.oninput = pintar;
  pintar();
}

// Formulario para agregar o editar un componente.
function formComponente(c = null, preset = {}) {
  const editando = !!c;
  const raiz = abrirHoja(`
    <h2>${editando ? 'Editar componente' : 'Agregar componente'}</h2>
    <form id="f-comp" novalidate>
      <label for="f-nombre">Nombre o referencia</label>
      <input id="f-nombre" class="campo" required maxlength="120" autocomplete="off" placeholder="Ej: LM358, Arduino Nano, resistencia 220" value="${esc(c?.name ?? preset.nombre ?? '')}">
      <div id="f-parecidos"></div>
      <div class="dos">
        <div>
          <label for="f-cant">Cantidad</label>
          <input id="f-cant" class="campo" type="number" inputmode="numeric" min="0" value="${c?.quantity ?? 1}" required>
        </div>
        <div>
          <label for="f-cat">Categoría</label>
          <select id="f-cat" class="campo">${CATEGORIAS.map(x => `<option ${x === (c?.category ?? preset.categoria) ? 'selected' : ''}>${x}</option>`).join('')}
            ${c && !CATEGORIAS.includes(c.category) ? `<option selected>${esc(c.category)}</option>` : ''}</select>
        </div>
      </div>
      <label for="f-caja">¿En qué caja queda?</label>
      ${selectorCaja(c?.box ?? (preset.caja ? +preset.caja : undefined))}
      <label for="f-notas">Descripción <span class="suave">(opcional)</span></label>
      <textarea id="f-notas" class="campo" maxlength="1000" placeholder="Ej: amplificador operacional, encapsulado DIP-8">${esc(c?.notes ?? '')}</textarea>
      ${editando ? '' : `<label>Foto <span class="suave">(opcional)</span></label>
        ${selectorFoto()}`}
      <p class="error" id="f-error"></p>
      <div class="botones">
        <button type="button" class="btn" data-action="cerrar">Cancelar</button>
        <button class="btn prim" id="f-guardar">${editando ? 'Guardar cambios' : 'Guardar'}</button>
      </div>
    </form>`);
  conectarSelectorCaja(raiz);
  const nombre = $('#f-nombre', raiz);
  if (!editando) setTimeout(() => nombre.focus(), 50);
  let destino = null;      // componente existente al que se sumará
  const otros = () => S.components.filter(x => x.id !== c?.id);

  const pintarParecidos = () => {
    const caja = $('#f-parecidos', raiz);
    destino = null;
    const ps = parecidos(nombre.value, otros());
    if (!ps.length) { caja.innerHTML = ''; return; }
    const exacto = ps.find(p => p.exacto);
    if (exacto) {
      destino = exacto.comp;
      if (!editando) {   // completa caja y categoría con las del que ya existe
        const cj = $('#f-caja', raiz);
        if (!cj.value && exacto.comp.box) { cj.value = exacto.comp.box; cj.dispatchEvent(new Event('input')); }
        const cat = $('#f-cat', raiz);
        if ([...cat.options].some(o => o.value === exacto.comp.category)) cat.value = exacto.comp.category;
      }
      caja.innerHTML = editando
        ? `<div class="aviso amarillo">${ico('alerta')} Ya existe <b>${esc(exacto.comp.name)}</b> en ${nombreCaja(exacto.comp.box)}. No puedes ponerle este nombre; si son el mismo, suma las unidades en ese y elimina este.</div>`
        : `<div class="aviso amarillo">${ico('alerta')} <b>Ya lo tienen:</b> ${esc(exacto.comp.name)} — <b>${nombreCaja(exacto.comp.box)}</b>, ${exacto.comp.quantity} u.<br>Al guardar, se <b>suman</b> las unidades a ese mismo (no se crea otro).</div>`;
      return;
    }
    caja.innerHTML = `<div class="aviso azul"><b>¿Es alguno de estos?</b> Ya están registrados:
      ${ps.map(p => `<div class="parecido"><span>${esc(p.comp.name)} <span class="suave peq">· ${nombreCaja(p.comp.box)} · ${p.comp.quantity} u.</span></span>
        ${editando ? `<a class="btn chico" href="#comp/${p.comp.id}" data-action="cerrar-ir">Ver</a>` : `<button type="button" class="btn chico" data-elegir="${p.comp.id}">Es este</button>`}</div>`).join('')}</div>`;
    caja.querySelectorAll('[data-elegir]').forEach(b => b.onclick = () => {
      destino = compById(b.dataset.elegir);
      caja.innerHTML = `<div class="aviso amarillo">${ico('check')} Se sumará a <b>${esc(destino.name)}</b> (${nombreCaja(destino.box)}). <button type="button" class="btn chico" id="f-deshacer">No, es otro</button></div>`;
      $('#f-deshacer', raiz).onclick = () => { pintarParecidos(); destino = null; caja.dataset.ignorar = '1'; caja.innerHTML = ''; };
    });
  };
  nombre.oninput = () => { delete $('#f-parecidos', raiz).dataset.ignorar; pintarParecidos(); };
  pintarParecidos();

  const fotoSel = editando ? null : conectarSelectorFoto(raiz);

  $('#f-comp', raiz).onsubmit = async e => {
    e.preventDefault();
    const err = $('#f-error', raiz);
    err.textContent = '';
    const datos = {
      name: nombre.value.trim().replace(/\s+/g, ' '),
      quantity: Math.max(0, parseInt($('#f-cant', raiz).value, 10) || 0),
      category: $('#f-cat', raiz).value,
      box: parseInt($('#f-caja', raiz).value, 10) || null,
      notes: $('#f-notas', raiz).value.trim(),
    };
    const key = normalizeKey(datos.name);
    if (!key) { err.textContent = 'Escribe el nombre del componente.'; return; }
    if (!datos.box) { err.textContent = 'Indica el número de la caja donde lo vas a guardar.'; return; }
    const boton = $('#f-guardar', raiz);
    boton.disabled = true;
    try {
      if (editando) await guardarEdicion(c, datos, key);
      else {
        // ¿Hay uno casi igual que no se eligió? Preguntar antes de crear otro.
        if (!destino && !$('#f-parecidos', raiz).dataset.ignorar) {
          const casi = parecidos(datos.name, S.components).filter(p => p.score >= 0.85)[0];
          if (casi) {
            const r = await preguntar('¿Es el mismo componente?',
              `Escribiste <b>${esc(datos.name)}</b> y ya existe <b>${esc(casi.comp.name)}</b> en ${nombreCaja(casi.comp.box)}.`,
              [{ valor: 'sumar', texto: `Sí, sumar a ${casi.comp.name}`, clase: 'prim' }, { valor: 'nuevo', texto: 'No, es otro distinto' }]);
            if (!r) { boton.disabled = false; return; }
            if (r === 'sumar') destino = casi.comp;
          }
        }
        const foto = fotoSel?.nueva;
        if (destino) await sumarA(compById(destino.id) || destino, datos, foto);
        else await crear(datos, key, foto);
      }
      cerrarHoja();
    } catch (ex) {
      err.textContent = ex.message;
      boton.disabled = false;
    }
  };
}

async function crear(datos, key, foto) {
  await asegurarCaja(datos.box);
  const id = uuid();
  let photo_url = null;
  if (foto) {
    toast('Subiendo foto…');
    try { photo_url = await store.uploadPhoto(id, await comprimir(foto, store.mode === 'demo' ? 700 : 1000)); }
    catch (e) { toast('No se pudo subir la foto; el componente se guarda sin ella.', 'error'); }
  }
  const c = await store.insert('components', {
    id, ...datos, key, aliases: [], photo_url,
    created_by: S.me.name, updated_by: S.me.name, created_at: ahora(), updated_at: ahora(),
  });
  await registrar('nuevo', c, `agregó ${c.quantity} × ${c.name} en la caja ${c.box}`);
  toast(`Guardado en la caja ${c.box}`);
}

async function sumarA(dest, datos, foto) {
  let box = dest.box;
  if (dest.box && datos.box !== dest.box) {
    const r = await preguntar('¿Dónde quedan?',
      `<b>${esc(dest.name)}</b> ya está en la <b>caja ${dest.box}</b> y elegiste la <b>caja ${datos.box}</b>. Para encontrarlo fácil conviene tenerlo todo junto.`,
      [{ valor: dest.box, texto: `Todo en la caja ${dest.box}`, clase: 'prim' }, { valor: datos.box, texto: `Mover todo a la caja ${datos.box}` }]);
    if (r === null) throw new Error('Cancelado: no se guardó nada.');
    box = r;
  } else if (!dest.box) box = datos.box;
  await asegurarCaja(box);
  const escrito = datos.name;
  const yaEsta = [dest.name, ...(dest.aliases || [])].some(n => n.toLowerCase() === escrito.toLowerCase());
  const patch = {
    quantity: dest.quantity + datos.quantity, box,
    aliases: yaEsta ? dest.aliases || [] : [...(dest.aliases || []), escrito],
    updated_by: S.me.name, updated_at: ahora(),
  };
  if (foto && !dest.photo_url) {
    try { patch.photo_url = await store.uploadPhoto(dest.id, await comprimir(foto, store.mode === 'demo' ? 700 : 1000)); } catch { /* sin foto */ }
  }
  const c = await store.update('components', dest.id, patch);
  if (datos.notes) await store.insert('observations', { id: uuid(), component_id: c.id, author: S.me.name, text: datos.notes });
  await registrar('sumo', c, `agregó ${datos.quantity} × ${c.name} (ahora hay ${c.quantity}) — caja ${c.box}${box !== dest.box && dest.box ? `, movido desde la caja ${dest.box}` : ''}`);
  toast(`Sumado a ${c.name}: ahora hay ${c.quantity}`);
}

async function guardarEdicion(c, datos, key) {
  const choque = S.components.find(x => x.key === key && x.id !== c.id);
  if (choque) throw new Error(`Ya existe "${choque.name}" en ${nombreCaja(choque.box)}. Usa ese en vez de crear un nombre repetido.`);
  if (datos.quantity < prestadas(c.id)) throw new Error(`Hay ${prestadas(c.id)} prestados: la cantidad total no puede ser menor.`);
  await asegurarCaja(datos.box);
  const cambios = [];
  if (datos.name !== c.name) cambios.push(`renombró "${c.name}" a "${datos.name}"`);
  if (datos.box !== c.box) cambios.push(`lo movió de la ${nombreCaja(c.box).toLowerCase()} a la caja ${datos.box}`);
  if (datos.quantity !== c.quantity) cambios.push(`cambió la cantidad de ${c.quantity} a ${datos.quantity}`);
  if (datos.category !== c.category) cambios.push(`categoría: ${datos.category}`);
  if (datos.notes !== c.notes) cambios.push('actualizó la descripción');
  if (!cambios.length) return;
  const aliases = datos.name !== c.name && normalizeKey(c.name) === key
    ? [...new Set([...(c.aliases || []), c.name])] : c.aliases;
  const nuevo = await store.update('components', c.id, { ...datos, key, aliases, updated_by: S.me.name, updated_at: ahora() });
  await registrar('edito', nuevo, `editó ${nuevo.name}: ${cambios.join(', ')}`);
  toast('Cambios guardados');
}

function formAjustar(c, modo) {
  const saco = modo === 'saco';
  const disp = disponibles(c);
  const raiz = abrirHoja(`
    <h2>${saco ? 'Saqué / gasté' : 'Agregué más'}: ${esc(c.name)}</h2>
    <p class="suave">Hay ${c.quantity} en total${disp !== c.quantity ? `, ${disp} en la caja` : ''}.</p>
    <form id="f-aj">
      <label for="aj-n">¿Cuántos?</label>
      <input id="aj-n" class="campo" type="number" inputmode="numeric" min="1" ${saco ? `max="${disp}"` : ''} value="1" required>
      <label for="aj-motivo">${saco ? '¿Para qué? (opcional)' : 'Nota (opcional)'}</label>
      <input id="aj-motivo" class="campo" maxlength="200" placeholder="${saco ? 'Ej: se usó en el proyecto de control, se quemó…' : 'Ej: compra de noviembre'}">
      ${saco ? '<p class="ayuda">Si es para prestarlo a alguien, mejor usa "Prestar": así queda registrado quién lo tiene.</p>' : ''}
      <p class="error" id="aj-error"></p>
      <div class="botones"><button type="button" class="btn" data-action="cerrar">Cancelar</button><button class="btn prim">Guardar</button></div>
    </form>`);
  $('#f-aj', raiz).onsubmit = async e => {
    e.preventDefault();
    const n = parseInt($('#aj-n', raiz).value, 10);
    const motivo = $('#aj-motivo', raiz).value.trim();
    if (!(n > 0)) return;
    if (saco && n > disp) { $('#aj-error', raiz).textContent = `Solo hay ${disp} en la caja.`; return; }
    try {
      const actual = compById(c.id) || c;
      const q = saco ? actual.quantity - n : actual.quantity + n;
      await store.update('components', c.id, { quantity: q, updated_by: S.me.name, updated_at: ahora() });
      await registrar(saco ? 'saco' : 'sumo', c, saco
        ? `sacó ${n} × ${c.name} de la caja ${c.box ?? '—'} (quedan ${q})${motivo ? ` — ${motivo}` : ''}${q === 0 ? ' · ¡SE ACABÓ!' : ''}`
        : `agregó ${n} × ${c.name} (ahora hay ${q}) — caja ${c.box ?? '—'}${motivo ? ` — ${motivo}` : ''}`);
      cerrarHoja();
      toast(q === 0 ? 'Quedó en 0: aparecerá como agotado.' : `Ahora hay ${q}`);
    } catch (ex) { $('#aj-error', raiz).textContent = ex.message; }
  };
}

function formPrestamo(compId = null) {
  let elegido = compId ? compById(compId) : null;
  let tipo = 'miembro';
  const raiz = abrirHoja(`
    <h2>Prestar</h2>
    <form id="f-pr" novalidate>
      <label for="pr-buscar">Componente</label>
      <div id="pr-comp"></div>
      <div class="dos">
        <div><label for="pr-n">Cantidad</label><input id="pr-n" class="campo" type="number" inputmode="numeric" min="1" value="1"></div>
        <div><label for="pr-hasta">Devolver antes de <span class="suave">(opcional)</span></label><input id="pr-hasta" class="campo" type="date"></div>
      </div>
      <label>¿Quién se lo lleva?</label>
      <div class="segmento"><button type="button" data-tipo="miembro" class="activo">Alguien del grupo</button><button type="button" data-tipo="externo">Alguien externo</button></div>
      <div id="pr-miembro">
        <select id="pr-quien" class="campo" style="margin-top:8px">${S.members.map(m => `<option value="${esc(m.name)}" ${m.email === S.me.email ? 'selected' : ''}>${esc(m.name)}${m.email === S.me.email ? ' (yo)' : ''}</option>`).join('')}</select>
      </div>
      <div id="pr-externo" class="oculto">
        <input id="pr-nombre" class="campo" style="margin-top:8px" maxlength="80" placeholder="Nombre de quien se lo lleva">
        <input id="pr-contacto" class="campo" style="margin-top:8px" maxlength="80" placeholder="Celular o correo (para cobrarlo)">
      </div>
      <label for="pr-notas">Nota <span class="suave">(opcional)</span></label>
      <input id="pr-notas" class="campo" maxlength="200" placeholder="Ej: para el proyecto de Control">
      <p class="error" id="pr-error"></p>
      <div class="botones"><button type="button" class="btn" data-action="cerrar">Cancelar</button><button class="btn prim">Registrar préstamo</button></div>
    </form>`);

  const pintarComp = () => {
    const cont = $('#pr-comp', raiz);
    if (elegido) {
      const d = disponibles(elegido);
      cont.innerHTML = `<div class="aviso azul fila entre"><span><b>${esc(elegido.name)}</b><br><span class="peq">${nombreCaja(elegido.box)} · ${d} disponible${d === 1 ? '' : 's'}</span></span>
        ${compId ? '' : '<button type="button" class="btn chico" id="pr-cambiar">Cambiar</button>'}</div>`;
      $('#pr-n', raiz).max = d;
      const b = $('#pr-cambiar', raiz);
      if (b) b.onclick = () => { elegido = null; pintarComp(); };
      return;
    }
    cont.innerHTML = `<input id="pr-buscar" class="campo" placeholder="Busca el componente…" autocomplete="off"><div class="opciones-comp" id="pr-ops"></div>`;
    const inp = $('#pr-buscar', raiz);
    const ops = () => {
      const q = inp.value.trim();
      let l = S.components.filter(c => disponibles(c) > 0);
      if (q) l = l.map(c => [c, coincideBusqueda(c, q)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).map(x => x[0]);
      $('#pr-ops', raiz).innerHTML = l.slice(0, 8).map(c => `<button type="button" data-id="${c.id}">${esc(c.name)} <span class="suave peq">· ${nombreCaja(c.box)} · ${disponibles(c)} disp.</span></button>`).join('') || '<p class="suave peq">No hay coincidencias con unidades disponibles.</p>';
      raiz.querySelectorAll('#pr-ops button').forEach(b => b.onclick = () => { elegido = compById(b.dataset.id); pintarComp(); });
    };
    inp.oninput = ops;
    ops();
  };
  pintarComp();

  raiz.querySelectorAll('[data-tipo]').forEach(b => b.onclick = () => {
    tipo = b.dataset.tipo;
    raiz.querySelectorAll('[data-tipo]').forEach(x => x.classList.toggle('activo', x === b));
    $('#pr-miembro', raiz).classList.toggle('oculto', tipo !== 'miembro');
    $('#pr-externo', raiz).classList.toggle('oculto', tipo !== 'externo');
  });

  $('#f-pr', raiz).onsubmit = async e => {
    e.preventDefault();
    const err = $('#pr-error', raiz);
    err.textContent = '';
    if (!elegido) { err.textContent = 'Elige el componente que vas a prestar.'; return; }
    const c = compById(elegido.id) || elegido;
    const n = parseInt($('#pr-n', raiz).value, 10);
    if (!(n > 0)) { err.textContent = 'La cantidad debe ser al menos 1.'; return; }
    if (n > disponibles(c)) { err.textContent = `Solo hay ${disponibles(c)} disponibles.`; return; }
    const quien = tipo === 'miembro' ? $('#pr-quien', raiz).value : $('#pr-nombre', raiz).value.trim();
    if (!quien) { err.textContent = 'Escribe el nombre de quien se lo lleva.'; return; }
    try {
      await store.insert('loans', {
        id: uuid(), component_id: c.id, component_name: c.name, box: c.box, quantity: n,
        borrower_kind: tipo, borrower_name: quien,
        borrower_contact: tipo === 'externo' ? $('#pr-contacto', raiz).value.trim() : '',
        lent_by: S.me.name, lent_at: ahora(), due_at: $('#pr-hasta', raiz).value || null,
        returned_at: null, notes: $('#pr-notas', raiz).value.trim(),
      });
      const yo = quien === S.me.name;
      await registrar('prestamo', c, yo
        ? `se llevó ${n} × ${c.name} de la caja ${c.box ?? '—'}`
        : `prestó ${n} × ${c.name} a ${quien}${tipo === 'externo' ? ' (externo)' : ''} — sale de la caja ${c.box ?? '—'}`);
      cerrarHoja();
      toast('Préstamo registrado');
    } catch (ex) { err.textContent = ex.message; }
  };
}

function formCaja(b = null) {
  const raiz = abrirHoja(`
    <h2>${b ? `Editar caja ${b.number}` : 'Nueva caja'}</h2>
    <form id="f-caja-form">
      <label for="cj-n">Número</label>
      <input id="cj-n" class="campo" type="number" inputmode="numeric" min="1" required value="${b?.number ?? (Math.max(0, ...S.boxes.map(x => x.number)) + 1)}">
      <label for="cj-d">¿Qué hay o dónde está? <span class="suave">(opcional)</span></label>
      <input id="cj-d" class="campo" maxlength="140" placeholder="Ej: caja roja, estante de arriba — sensores" value="${esc(b?.description ?? '')}">
      <label>Foto de la caja <span class="suave">(opcional)</span></label>
      ${selectorFoto()}
      <p class="error" id="cj-error"></p>
      <div class="botones">
        ${b ? '<button type="button" class="btn peligro" id="cj-borrar">Eliminar caja</button>' : ''}
        <button type="button" class="btn" data-action="cerrar">Cancelar</button><button class="btn prim" id="cj-guardar">Guardar</button>
      </div>
    </form>`);
  const fotoSel = conectarSelectorFoto(raiz, b?.photo_url);
  $('#f-caja-form', raiz).onsubmit = async e => {
    e.preventDefault();
    const number = parseInt($('#cj-n', raiz).value, 10);
    const description = $('#cj-d', raiz).value.trim();
    if (!(number > 0)) return;
    const err = $('#cj-error', raiz), boton = $('#cj-guardar', raiz);
    err.textContent = '';
    if (number !== b?.number && cajaPorNum(number)) { err.textContent = `Ya existe la caja ${number}.`; return; }
    boton.disabled = true;
    try {
      const vieja = b?.photo_url;
      const datos = { number, description };
      if (fotoSel.nueva) { toast('Subiendo foto…'); datos.photo_url = await subirFoto(`caja-${number}`, fotoSel.nueva); }
      else if (fotoSel.quitada) datos.photo_url = null;
      if (b) {
        const antes = b.number;
        await store.update('boxes', antes, datos);
        if ('photo_url' in datos) {
          if (vieja) store.removePhoto(vieja).catch(() => {});
          await registrar('caja', null, `${!datos.photo_url ? 'quitó' : vieja ? 'cambió' : 'agregó'} la foto de la caja ${number}`);
        }
        if (number !== antes) await registrar('caja', null, `cambió el número de la caja ${antes} a ${number}`);
        cerrarHoja();
        location.hash = `caja/${number}`;
      } else {
        await store.insert('boxes', datos);
        await registrar('caja', null, `creó la caja ${number}${description ? ` (${description})` : ''}`);
        cerrarHoja();
      }
    } catch (ex) { err.textContent = ex.message; boton.disabled = false; }
  };
  const borrar = $('#cj-borrar', raiz);
  if (borrar) borrar.onclick = async () => {
    const n = S.components.filter(c => c.box === b.number).length;
    const r = await preguntar(`¿Eliminar la caja ${b.number}?`,
      n ? `Tiene <b>${n} componentes</b>. No se borran: quedarán en "Sin caja" hasta que les asignes otra.` : 'La caja está vacía.',
      [{ valor: true, texto: 'Sí, eliminar la caja', clase: 'peligro' }]);
    if (!r) return;
    try {
      await store.remove('boxes', b.number);
      if (b.photo_url) store.removePhoto(b.photo_url).catch(() => {});
      await registrar('caja', null, `eliminó la caja ${b.number}${n ? ` (${n} componentes quedaron sin caja)` : ''}`);
      cerrarHoja();
      location.hash = 'cajas';
    } catch (ex) { $('#cj-error', raiz).textContent = ex.message; }
  };
}

function hojaAjustes() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const permiso = 'Notification' in window ? Notification.permission : 'no';
  abrirHoja(`
    <h2>${esc(S.me.name)}</h2>
    <p class="suave" style="margin-top:-8px">Integrante del grupo${store.mode === 'demo' ? ' · modo demo' : ''}</p>

    <h3>Avisos</h3>
    <div class="tarjeta">
      ${permiso === 'granted' ? '<p style="margin:0">' + ico('check') + ' Los avisos están activados en este dispositivo.</p>'
        : permiso === 'denied' ? '<p style="margin:0">Bloqueaste los avisos. Actívalos desde los ajustes del navegador para este sitio.</p>'
        : permiso === 'no' ? `<p style="margin:0">Este navegador no permite avisos${ios && !instalada ? '. En iPhone primero instala la app (abajo) y ábrela desde el ícono.' : '.'}</p>`
        : '<p style="margin-top:0">Recibe un aviso cada vez que alguien agregue, saque o preste algo.</p><button class="btn acento ancho" data-action="activar-push">' + ico('campana') + ' Activar avisos</button>'}
    </div>

    <h3>Instalar en el celular</h3>
    <div class="tarjeta peq">
      ${instalada ? ico('check') + ' Ya estás usando la app instalada.'
        : S.installEvt ? '<button class="btn prim ancho" data-action="instalar">' + ico('movil') + ' Instalar app</button>'
        : ios ? 'En iPhone: abre este enlace en <b>Safari</b>, toca el botón <b>Compartir</b> (cuadro con flecha) → <b>Agregar a pantalla de inicio</b>.'
        : 'En Android: abre el menú <b>⋮</b> de Chrome → <b>Instalar app</b> (o "Agregar a la pantalla principal").'}
    </div>

    <h3>Datos</h3>
    <div class="botones" style="margin-top:0">
      <button class="btn" data-action="exportar">${ico('descargar')} Descargar inventario (Excel/CSV)</button>
    </div>

    <div class="botones">
      ${store.mode === 'demo' ? '<button class="btn" data-action="reiniciar-demo">Reiniciar datos de prueba</button>' : ''}
      <button class="btn peligro" data-action="salir">Cerrar sesión</button>
      <button class="btn prim" data-action="cerrar">Listo</button>
    </div>`);
}

// ------------------------------------------------------------ notificaciones push
function b64aBytes(b64) {
  const s = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
}
async function activarPush(silencioso = false) {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    if (!silencioso) toast('Este navegador no permite avisos. En iPhone, instala primero la app en la pantalla de inicio.', 'error');
    return;
  }
  const permiso = silencioso ? Notification.permission : await Notification.requestPermission();
  if (permiso !== 'granted') { if (!silencioso) toast('No se dieron permisos para avisos.', 'error'); return; }
  if (store.mode === 'demo') { if (!silencioso) toast('Avisos activados (en demo solo llegan entre pestañas de este equipo).'); render(); return; }
  if (!CONFIG.VAPID_PUBLIC_KEY || !('PushManager' in window)) {
    if (!silencioso) toast('Avisos dentro de la app activados. (Falta configurar la clave para avisos con la app cerrada.)');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(CONFIG.VAPID_PUBLIC_KEY) });
    await store.upsert('push_subscriptions', { endpoint: sub.endpoint, user_email: S.me.email, subscription: sub.toJSON() });
    if (!silencioso) { toast('Avisos activados en este dispositivo'); render(); }
  } catch (e) {
    console.error(e);
    if (!silencioso) toast('No se pudieron activar los avisos: ' + e.message, 'error');
  }
}

function registrarSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('message', e => { if (e.data?.ir) location.hash = e.data.ir; });
}

function exportarCSV() {
  const filas = [['Componente', 'Otros nombres', 'Categoría', 'Caja', 'Descripción caja', 'Total', 'En caja', 'Prestados', 'Quién lo tiene', 'Descripción', 'Registrado por']];
  for (const c of [...S.components].sort((a, b) => (a.box || 0) - (b.box || 0) || a.name.localeCompare(b.name, 'es'))) {
    const pres = S.loans.filter(l => l.component_id === c.id && !l.returned_at);
    filas.push([c.name, (c.aliases || []).join(' / '), c.category, c.box ?? '', cajaPorNum(c.box)?.description ?? '', c.quantity, disponibles(c),
      prestadas(c.id), pres.map(l => `${l.borrower_name} (${l.quantity})`).join(' / '), c.notes, c.created_by ?? '']);
  }
  const csv = '﻿' + filas.map(f => f.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `inventario-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ------------------------------------------------------------ acciones (clics)
const acciones = {
  cerrar: cerrarHoja,
  'cerrar-ir': () => { $('#sheet').classList.add('oculto'); document.body.style.overflow = ''; },
  nuevo: el => formComponente(null, { nombre: el.dataset.nombre, caja: el.dataset.caja }),
  editar: el => formComponente(compById(el.dataset.id)),
  ajustar: el => formAjustar(compById(el.dataset.id), el.dataset.modo),
  prestar: el => formPrestamo(el.dataset.id || null),
  'nueva-caja': () => formCaja(),
  'editar-caja': el => formCaja(cajaPorNum(+el.dataset.n)),
  ajustes: hojaAjustes,
  cat: el => { S.cat = el.dataset.cat; render(); },
  'loan-tab': el => { S.loanTab = el.dataset.tab; render(); },
  'ver-foto': el => verFoto((el.dataset.n ? cajaPorNum(+el.dataset.n) : compById(el.dataset.id))?.photo_url),
  'cambiar-foto': el => $(el.dataset.fuente === 'galeria' ? '#foto-galeria' : '#foto-camara')?.click(),
  'compartir-compras': el => compartirCompras(S.projects.find(p => p.id === el.dataset.id)),
  'borrar-proyecto': async el => {
    const r = await preguntar('¿Eliminar este proyecto?', 'Se borra la revisión de la IA. Los componentes no se tocan.', [{ valor: true, texto: 'Sí, eliminar', clase: 'peligro' }]);
    if (!r) return;
    await intentar(() => store.remove('projects', el.dataset.id));
    S.projects = S.projects.filter(p => p.id !== el.dataset.id);
    location.hash = 'proyectos';
  },
  'activar-push': () => activarPush(false),
  exportar: exportarCSV,
  'no-instalar': () => { localStorage.setItem('inv-no-instalar', '1'); render(); },
  instalar: async () => {
    if (S.installEvt) { S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; render(); }
    else hojaAjustes();
  },
  'elegir-usuario': el => pantallaAcceso('', el.dataset.nombre),
  'entrar-demo': async el => { S.me = await store.signIn(DEMO_MIEMBROS.find(m => m.name === el.dataset.nombre).email); await entrar(); },
  salir: async () => {
    const r = await preguntar('¿Cerrar sesión?', 'Tendrás que volver a entrar con tu contraseña.', [{ valor: true, texto: 'Cerrar sesión', clase: 'peligro' }]);
    if (!r) return;
    await store.signOut(); S.me = null;
    $('#sheet').classList.add('oculto'); document.body.style.overflow = '';
    location.hash = '';
    pantallaAcceso();
  },
  'reiniciar-demo': async () => {
    const r = await preguntar('¿Reiniciar la demo?', 'Se borran los datos de prueba y vuelven los de ejemplo.', [{ valor: true, texto: 'Reiniciar', clase: 'peligro' }]);
    if (!r) return;
    localStorage.removeItem('inv-demo-datos');
    location.reload();
  },
  eliminar: async el => {
    const c = compById(el.dataset.id);
    const pres = prestadas(c.id);
    const r = await preguntar(`¿Eliminar ${c.name}?`,
      `Se borra la ficha completa (${c.quantity} u. en ${nombreCaja(c.box).toLowerCase()}), con sus observaciones y foto.${pres ? `<br><br>${ico('alerta')} Hay <b>${pres} prestados</b>; el registro del préstamo se conserva.` : ''}<br><br>Si solo se gastaron, mejor usa <b>"Saqué / gasté"</b> para dejarlo en 0 y que se sepa que se acabó.`,
      [{ valor: true, texto: 'Sí, eliminar', clase: 'peligro' }]);
    if (!r) return;
    await intentar(async () => {
      await store.remove('components', c.id);
      if (c.photo_url) store.removePhoto(c.photo_url).catch(() => {});
      await registrar('elimino', { id: null, name: c.name }, `eliminó ${c.name} (${c.quantity} u.) de la ${nombreCaja(c.box).toLowerCase()}`);
      location.hash = 'inventario';
      toast('Eliminado');
    });
  },
  'borrar-obs': async el => {
    const r = await preguntar('¿Borrar la observación?', '', [{ valor: true, texto: 'Borrar', clase: 'peligro' }]);
    if (r) await intentar(() => store.remove('observations', el.dataset.id));
  },
  devolver: async el => {
    const l = S.loans.find(x => x.id === el.dataset.id);
    const r = await preguntar('¿Ya lo devolvió?', `${esc(l.borrower_name)} devuelve ${l.quantity} × <b>${esc(l.component_name)}</b>.<br>Guárdalo de nuevo en la <b>${nombreCaja(l.box).toLowerCase()}</b>.`,
      [{ valor: true, texto: 'Sí, ya está en su caja', clase: 'prim' }]);
    if (!r) return;
    await intentar(async () => {
      await store.update('loans', l.id, { returned_at: ahora() });
      await registrar('devolucion', { id: l.component_id, name: l.component_name },
        `registró que ${l.borrower_name} devolvió ${l.quantity} × ${l.component_name} — vuelve a la ${nombreCaja(l.box).toLowerCase()}`);
      toast('Devolución registrada');
    });
  },
};

document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) { location.hash = go.dataset.go; return; }
  const a = e.target.closest('[data-action]');
  if (a && acciones[a.dataset.action]) {
    if (a.tagName === 'A' && a.dataset.action !== 'cerrar-ir') e.preventDefault();
    acciones[a.dataset.action](a);
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').classList.contains('oculto')) cerrarHoja(); });

boot();
