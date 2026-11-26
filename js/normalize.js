// Unificación de nombres: "LM358", "lm 358", "Lm-358" → la misma clave "lm358".
// La clave se guarda única en la base de datos, así no hay fichas repetidas.

// Palabras que significan lo mismo (todas en minúscula y sin tildes).
const SINONIMOS = {
  resistor: 'resistencia', resistencias: 'resistencia', resistores: 'resistencia', res: 'resistencia',
  condensador: 'capacitor', condensadores: 'capacitor', capacitores: 'capacitor', cap: 'capacitor',
  transistores: 'transistor',
  diodos: 'diodo',
  leds: 'led',
  potenciometro: 'potenciometro', potenciometros: 'potenciometro', pot: 'potenciometro', trimmer: 'potenciometro',
  pulsador: 'pulsador', pulsadores: 'pulsador', boton: 'pulsador', botones: 'pulsador', pushbutton: 'pulsador',
  sensores: 'sensor',
  modulos: 'modulo', module: 'modulo',
  motores: 'motor',
  cables: 'cable',
  integrado: 'ic', circuito: 'ic', chip: 'ic',
  servomotor: 'servo', servos: 'servo',
  relay: 'rele', reles: 'rele', relevo: 'rele', relevos: 'rele',
  de: '', del: '', la: '', el: '', los: '', las: '', para: '',
};

function limpiarBase(texto) {
  return String(texto || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // quita tildes
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')  // 4,7k → 4.7k (coma decimal)
    .replace(/[µμ]/g, 'u')          // µF → uF
    .replace(/[Ωω]/g, 'ohm')
    .replace(/\bohmios?\b|\bohms?\b/g, 'ohm');
}

// Separa en palabras ya traducidas por sinónimos.
export function tokens(texto) {
  return limpiarBase(texto)
    .split(/[\s,;/()+]+/)
    .map(t => t.replace(/[^a-z0-9.]/g, ''))
    .map(t => t.replace(/\.(?!\d)|(?<!\d)\./g, ''))   // deja el punto solo en 4.7, 0.1
    .map(t => (t in SINONIMOS ? SINONIMOS[t] : t))
    .filter(Boolean);
}

// Clave única del componente.
export function normalizeKey(texto) {
  let k = tokens(texto).join('');
  k = k.replace(/(\d|[kmr])ohm/g, '$1');   // 10kohm → 10k, 220ohm → 220
  k = k.replace(/(\d)\.0+(?=\D|$)/g, '$1'); // 5.0v → 5v
  k = k.replace(/\./g, 'p');                 // 4.7k → 4p7k (puntos fuera)
  return k;
}

// Distancia de edición (cuántas letras cambiar para pasar de a a b).
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

// ¿Qué tan parecidos son dos nombres? 0 = nada, 1 = idénticos.
export function similitud(nombreA, nombreB) {
  const a = normalizeKey(nombreA), b = normalizeKey(nombreB);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // mismas palabras en otro orden: "arduino uno" / "uno arduino"
  const ta = tokens(nombreA).sort().join(' '), tb = tokens(nombreB).sort().join(' ');
  if (ta === tb) return 0.97;
  const largo = Math.max(a.length, b.length);
  const d = levenshtein(a, b);
  let s = 1 - d / largo;
  // uno contiene al otro: "lm358" dentro de "lm358n"
  const corto = a.length < b.length ? a : b, otro = corto === a ? b : a;
  if (corto.length >= 4 && otro.includes(corto)) s = Math.max(s, 0.85);
  return s;
}

// Componentes que probablemente son el mismo (para preguntar antes de crear uno nuevo).
// Devuelve [{ comp, score, exacto }] ordenado de más a menos parecido.
export function parecidos(nombre, componentes, limite = 4) {
  const key = normalizeKey(nombre);
  if (key.length < 2) return [];
  const out = [];
  for (const c of componentes) {
    const nombres = [c.name, ...(c.aliases || [])];
    let mejor = 0;
    for (const n of nombres) mejor = Math.max(mejor, similitud(nombre, n));
    if (c.key === key) mejor = 1;
    const umbral = key.length <= 4 ? 0.75 : 0.72;
    if (mejor >= umbral) out.push({ comp: c, score: mejor, exacto: c.key === key });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limite);
}

// Búsqueda tolerante: encuentra "lm358" escribiendo "LM 358", "lm358n", "358"...
export function coincideBusqueda(c, consulta) {
  const q = normalizeKey(consulta);
  if (!q) return 0;
  const campos = [c.name, ...(c.aliases || []), c.category, c.notes].map(normalizeKey);
  if (campos[0] === q || (c.aliases || []).some(a => normalizeKey(a) === q)) return 100;
  if (campos.some(f => f.startsWith(q))) return 80;
  if (campos.some(f => f.includes(q))) return 60;
  // cada palabra de la búsqueda aparece en algún campo
  const palabras = tokens(consulta).map(normalizeKey).filter(Boolean);
  if (palabras.length > 1 && palabras.every(p => campos.some(f => f.includes(p)))) return 50;
  // error de tipeo pequeño
  if (q.length >= 4) {
    const s = Math.max(...[c.name, ...(c.aliases || [])].map(n => similitud(consulta, n)));
    if (s >= 0.75) return Math.round(40 * s);
  }
  return 0;
}
