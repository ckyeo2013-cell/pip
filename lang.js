'use strict';
/*
 * Languages and extra offline tricks for Pip's own brain (no AI, no internet).
 *   process(text, lang, now) -> { text }   the same request with a foreign command turned into the English one brain.js already knows
 *                            -> { reply }  an answer straight away (small talk in that language, or an offline trick)
 * lang: 'auto' (try every language), 'en', or one of es fr de pt it. The AI answers in any language by itself; this is for what works without it.
 */
const crypto = require('crypto');
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const LANGS = {
  en: { name: 'English', locale: 'en-US' },
  es: {
    name: 'Español', locale: 'es-ES',
    talk: [
      [/^(?:hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|hey)(?: pip)?$/, ['¡Hola! ¿Qué puedo hacer por ti?', '¡Hola! Listo cuando quieras.']],
      [/^(?:gracias|muchas gracias|mil gracias)(?: pip)?$/, ['¡De nada!', '¡Con gusto!']],
      [/^(?:c[oó]mo est[aá]s|qu[eé] tal|c[oó]mo te va)\??$/, ['Peludo y feliz. ¿Y tú?', 'Muy bien, tengo snacks y un escritorio.']],
      [/^(?:qui[eé]n eres|c[oó]mo te llamas|qu[eé] eres)\??$/, ['Soy Pip, un petauro del azúcar que vive en tu pantalla.']],
      [/^(?:buenas noches|hasta luego|a dormir)(?: pip)?$/, ['¡Buenas noches! Que duermas bien.']],
      [/^(?:te quiero|te adoro)(?: pip)?$/, ['Aww. Yo también te quiero.']],
      [/^(?:cu[eé]ntame un chiste|un chiste|chiste)$/, ['¿Qué le dice un petauro a otro? ¡Qué planeo tan bueno!', '¿Por qué los programadores prefieren el modo oscuro? Porque la luz atrae bugs.']],
      [/^(?:dime un dato(?: curioso)?|dato curioso|un dato)$/, ['Los petauros del azúcar pueden planear unos 50 metros entre árboles.', 'La miel nunca se echa a perder: han encontrado miel comestible en tumbas egipcias.']],
      [/^(?:ayuda|qu[eé] puedes hacer)\??$/, ['Sin IA puedo abrir sitios y apps ("abre YouTube"), buscar ("busca gatos en google"), subir o bajar el volumen, poner temporizadores ("temporizador de 5 minutos"), hacer cuentas, lanzar una moneda o un dado, decir la hora y la fecha, y contar chistes.']],
    ],
    time: (t) => `Son las ${t}.`, date: (d) => `Hoy es ${d}.`, coin: ['¡Cara!', '¡Cruz!'],
    q: { time: /^(?:qu[eé] hora es|la hora|hora)\??$/, date: /^(?:qu[eé] d[ií]a es(?: hoy)?|la fecha|fecha de hoy|a cu[aá]ntos estamos)\??$/, coin: /^(?:lanza|tira) una moneda$|^cara o cruz\??$/ },
    cmd: [[/^(?:abre|abrir|abra|ábreme)\s+(.+)$/, 'open $1'], [/^(?:busca|buscar|búscame)\s+(.+)$/, 'search $1'], [/^(?:sube|subir) (?:el )?volumen$|^m[aá]s fuerte$/, 'volume up'], [/^(?:baja|bajar) (?:el )?volumen$|^m[aá]s bajo$/, 'volume down'], [/^silencio$|^silenciar$|^mute$/, 'mute'], [/^(?:siguiente|pasa la canci[oó]n|siguiente canci[oó]n)$/, 'next'], [/^(?:anterior|canci[oó]n anterior)$/, 'previous'], [/^(?:pausa|pausar|reproduce|reanuda)$/, 'pause'], [/^(?:temporizador|pon un temporizador|cron[oó]metro) (?:de |por )?(\d+) (minutos?|segundos?|horas?)$/, (m) => `set a timer for ${m[1]} ${/^m/.test(m[2]) ? 'minutes' : /^s/.test(m[2]) ? 'seconds' : 'hours'}`], [/^(?:recu[eé]rdame) en (\d+) minutos? (?:de |que |para )?(.+)$/, 'remind me in $1 minutes to $2'], [/^(?:despl[aá]zate|baja) (?:hacia )?abajo$/, 'scroll down'], [/^(?:despl[aá]zate|sube) (?:hacia )?arriba$/, 'scroll up']],
  },
  fr: {
    name: 'Français', locale: 'fr-FR',
    talk: [
      [/^(?:salut|bonjour|bonsoir|coucou|hello)(?: pip)?$/, ['Salut ! Que puis-je faire pour toi ?', 'Coucou ! Prêt quand tu veux.']],
      [/^(?:merci|merci beaucoup)(?: pip)?$/, ['De rien !', 'Avec plaisir !']],
      [/^(?:comment (?:vas[- ]tu|ça va)|ça va)\??$/, ['Tout doux et tout poilu. Et toi ?', 'Très bien, j\'ai des snacks et un bureau.']],
      [/^(?:qui es[- ]tu|comment tu t'appelles|tu es qui)\??$/, ['Je suis Pip, un petit planeur qui vit sur ton écran.']],
      [/^(?:bonne nuit|à demain)(?: pip)?$/, ['Bonne nuit ! Dors bien.']],
      [/^(?:je t'aime)(?: pip)?$/, ['Aww. Moi aussi je t\'aime bien.']],
      [/^(?:raconte(?:-moi)? une blague|une blague|blague)$/, ['Pourquoi les programmeurs aiment le mode sombre ? Parce que la lumière attire les bugs.', 'Comment appelle-t-on un planeur qui fait des blagues ? Un possum-pitre !']],
      [/^(?:dis(?:-moi)? un fait(?: amusant)?|un fait amusant|anecdote)$/, ['Les petauros peuvent planer environ 50 mètres entre deux arbres.', 'Le miel ne se périme jamais.']],
      [/^(?:aide|qu'est[- ]ce que tu sais faire)\??$/, ['Sans IA, je peux ouvrir des sites et des applis (« ouvre YouTube »), chercher (« cherche chats sur google »), régler le volume, lancer des minuteurs (« minuteur de 5 minutes »), faire des calculs, lancer une pièce ou un dé, donner l\'heure et la date, et raconter des blagues.']],
    ],
    time: (t) => `Il est ${t}.`, date: (d) => `Nous sommes le ${d}.`, coin: ['Pile !', 'Face !'],
    q: { time: /^(?:quelle heure est[- ]il|l'heure|heure)\??$/, date: /^(?:quel jour (?:sommes|est)[- ]nous(?: aujourd'hui)?|la date|date du jour|on est le combien)\??$/, coin: /^(?:lance|jette) une pi[eè]ce$|^pile ou face\??$/ },
    cmd: [[/^(?:ouvre|ouvrir)\s+(.+)$/, 'open $1'], [/^(?:cherche|rechercher|recherche)\s+(.+)$/, 'search $1'], [/^(?:monte|augmente) le (?:volume|son)$|^plus fort$/, 'volume up'], [/^(?:baisse|diminue) le (?:volume|son)$|^moins fort$/, 'volume down'], [/^(?:muet|coupe le son)$/, 'mute'], [/^(?:suivant|chanson suivante|piste suivante)$/, 'next'], [/^(?:précédent|chanson précédente)$/, 'previous'], [/^(?:pause|mets en pause|lecture)$/, 'pause'], [/^(?:minuteur|minuterie) (?:de |pour )?(\d+) (minutes?|secondes?|heures?)$/, (m) => `set a timer for ${m[1]} ${/^m/.test(m[2]) ? 'minutes' : /^s/.test(m[2]) ? 'seconds' : 'hours'}`], [/^rappelle[- ]moi dans (\d+) minutes? (?:de |d'|que |pour )?(.+)$/, 'remind me in $1 minutes to $2'], [/^(?:fais )?défiler vers le bas$/, 'scroll down'], [/^(?:fais )?défiler vers le haut$/, 'scroll up']],
  },
  de: {
    name: 'Deutsch', locale: 'de-DE',
    talk: [
      [/^(?:hallo|hi|guten (?:morgen|tag|abend)|servus|moin)(?: pip)?$/, ['Hallo! Was kann ich für dich tun?', 'Hi! Bereit, wenn du es bist.']],
      [/^(?:danke|vielen dank|dankeschön)(?: pip)?$/, ['Gern geschehen!', 'Immer gern!']],
      [/^(?:wie geht(?:'s| es dir| es)|wie läuft(?:'s| es))\??$/, ['Flauschig und gut. Und dir?', 'Super, ich habe Snacks und einen Desktop.']],
      [/^(?:wer bist du|wie heißt du|was bist du)\??$/, ['Ich bin Pip, ein Kurzkopfgleitbeutler, der auf deinem Bildschirm wohnt.']],
      [/^(?:gute nacht|schlaf gut)(?: pip)?$/, ['Gute Nacht! Schlaf gut.']],
      [/^(?:ich liebe dich|hab dich lieb)(?: pip)?$/, ['Aww. Ich mag dich auch.']],
      [/^(?:erzähl(?: mir)? einen witz|einen witz|witz)$/, ['Warum mögen Programmierer den Dunkelmodus? Weil Licht Bugs anlockt.', 'Wie nennt man einen Gleitbeutler mit Humor? Ein Scherz-Possum!']],
      [/^(?:sag(?: mir)? einen fun fact|fun fact|wusstest du)$/, ['Zuckergleiter können etwa 50 Meter zwischen Bäumen gleiten.', 'Honig wird nie schlecht.']],
      [/^(?:hilfe|was kannst du)\??$/, ['Ohne KI kann ich Seiten und Apps öffnen („öffne YouTube“), suchen („suche Katzen auf google“), die Lautstärke ändern, Timer stellen („Timer 5 Minuten“), rechnen, Münze oder Würfel werfen, Uhrzeit und Datum sagen und Witze erzählen.']],
    ],
    time: (t) => `Es ist ${t} Uhr.`, date: (d) => `Heute ist ${d}.`, coin: ['Kopf!', 'Zahl!'],
    q: { time: /^(?:wie spät ist es|wie viel uhr ist es|uhrzeit|die uhrzeit)\??$/, date: /^(?:welcher tag ist (?:heute|es)|das datum|datum|den wievielten haben wir)\??$/, coin: /^(?:wirf|wirf eine) (?:eine )?münze$|^kopf oder zahl\??$/ },
    cmd: [[/^(?:öffne|öffnen|starte)\s+(.+)$/, 'open $1'], [/^(?:suche|such|suchen)\s+(.+)$/, 'search $1'], [/^(?:lauter|lautstärke (?:hoch|erhöhen))$/, 'volume up'], [/^(?:leiser|lautstärke (?:runter|verringern))$/, 'volume down'], [/^(?:stumm|stummschalten)$/, 'mute'], [/^(?:nächstes lied|weiter|nächster titel)$/, 'next'], [/^(?:voriges lied|zurück|vorheriger titel)$/, 'previous'], [/^(?:pause|pausieren|abspielen)$/, 'pause'], [/^timer (?:für |auf )?(\d+) (minuten?|sekunden?|stunden?)$/, (m) => `set a timer for ${m[1]} ${/^m/.test(m[2]) ? 'minutes' : /^s[ei]/.test(m[2]) ? 'seconds' : 'hours'}`], [/^erinnere mich in (\d+) minuten? (?:an |daran, |zu )?(.+)$/, 'remind me in $1 minutes to $2'], [/^nach unten scrollen$/, 'scroll down'], [/^nach oben scrollen$/, 'scroll up']],
  },
  pt: {
    name: 'Português', locale: 'pt-BR',
    talk: [
      [/^(?:oi|olá|ola|bom dia|boa tarde|boa noite|e aí)(?: pip)?$/, ['Oi! O que posso fazer por você?', 'Olá! Pronto quando você quiser.']],
      [/^(?:obrigad[oa]|valeu|muito obrigad[oa])(?: pip)?$/, ['De nada!', 'Sempre às ordens!']],
      [/^(?:como vai|tudo bem|como você está|como voce esta)\??$/, ['Fofinho e feliz. E você?', 'Ótimo, tenho lanches e uma área de trabalho.']],
      [/^(?:quem é você|quem e voce|qual é o seu nome|como você se chama)\??$/, ['Sou o Pip, um petauro-do-açúcar que mora na sua tela.']],
      [/^(?:boa noite|durma bem)(?: pip)?$/, ['Boa noite! Durma bem.']],
      [/^(?:eu te amo|te amo)(?: pip)?$/, ['Aww. Eu também gosto de você.']],
      [/^(?:conte uma piada|uma piada|piada)$/, ['Por que programadores preferem o modo escuro? Porque a luz atrai bugs.', 'Como se chama um planador que conta piadas? Um gambá-engraçado!']],
      [/^(?:conte um fato(?: curioso)?|fato curioso|curiosidade)$/, ['Petauros-do-açúcar planam cerca de 50 metros entre as árvores.', 'O mel nunca estraga.']],
      [/^(?:ajuda|o que você pode fazer)\??$/, ['Sem IA eu posso abrir sites e apps ("abra o YouTube"), pesquisar ("pesquise gatos no google"), mudar o volume, criar timers ("timer de 5 minutos"), fazer contas, jogar moeda ou dado, dizer a hora e a data e contar piadas.']],
    ],
    time: (t) => `São ${t}.`, date: (d) => `Hoje é ${d}.`, coin: ['Cara!', 'Coroa!'],
    q: { time: /^(?:que horas são|que horas sao|as horas|hora)\??$/, date: /^(?:que dia é hoje|que dia e hoje|a data|data de hoje)\??$/, coin: /^(?:jogue|lance) uma moeda$|^cara ou coroa\??$/ },
    cmd: [[/^(?:abra|abrir|abre)\s+(.+)$/, 'open $1'], [/^(?:pesquise|pesquisar|procure|busque)\s+(.+)$/, 'search $1'], [/^(?:aumente|aumentar|sobe) (?:o )?volume$|^mais alto$/, 'volume up'], [/^(?:diminua|diminuir|baixe|baixar) (?:o )?volume$|^mais baixo$/, 'volume down'], [/^(?:silenciar|mudo)$/, 'mute'], [/^(?:próxima|próxima música|proxima musica)$/, 'next'], [/^(?:anterior|música anterior|musica anterior)$/, 'previous'], [/^(?:pausar|pausa|tocar|continuar)$/, 'pause'], [/^timer (?:de |por )?(\d+) (minutos?|segundos?|horas?)$/, (m) => `set a timer for ${m[1]} ${/^m/.test(m[2]) ? 'minutes' : /^s/.test(m[2]) ? 'seconds' : 'hours'}`], [/^me lembre em (\d+) minutos? (?:de |para |que )?(.+)$/, 'remind me in $1 minutes to $2'], [/^role para baixo$/, 'scroll down'], [/^role para cima$/, 'scroll up']],
  },
  it: {
    name: 'Italiano', locale: 'it-IT',
    talk: [
      [/^(?:ciao|salve|buongiorno|buonasera|ehi)(?: pip)?$/, ['Ciao! Cosa posso fare per te?', 'Ciao! Pronto quando vuoi.']],
      [/^(?:grazie|grazie mille)(?: pip)?$/, ['Prego!', 'Di niente!']],
      [/^(?:come stai|come va|tutto bene)\??$/, ['Soffice e felice. E tu?', 'Benissimo, ho snack e un desktop.']],
      [/^(?:chi sei|come ti chiami|cosa sei)\??$/, ['Sono Pip, uno scoiattolo-zucchero che vive sul tuo schermo.']],
      [/^(?:buonanotte|dormi bene)(?: pip)?$/, ['Buonanotte! Dormi bene.']],
      [/^(?:ti voglio bene|ti amo)(?: pip)?$/, ['Aww. Anch\'io ti voglio bene.']],
      [/^(?:raccontami una barzelletta|una barzelletta|barzelletta)$/, ['Perché i programmatori amano la modalità scura? Perché la luce attira i bug.', 'Come si chiama uno scoiattolo volante che fa battute? Un possum-comico!']],
      [/^(?:dimmi una curiosità|curiosità|lo sapevi)$/, ['Gli scoiattoli-zucchero possono planare circa 50 metri tra gli alberi.', 'Il miele non scade mai.']],
      [/^(?:aiuto|cosa sai fare)\??$/, ['Senza IA posso aprire siti e app ("apri YouTube"), cercare ("cerca gatti su google"), cambiare il volume, impostare timer ("timer di 5 minuti"), fare calcoli, lanciare una moneta o un dado, dire ora e data e raccontare barzellette.']],
    ],
    time: (t) => `Sono le ${t}.`, date: (d) => `Oggi è ${d}.`, coin: ['Testa!', 'Croce!'],
    q: { time: /^(?:che ore sono|che ora è|l'ora|ora)\??$/, date: /^(?:che giorno è(?: oggi)?|la data|data di oggi)\??$/, coin: /^(?:lancia|tira) una moneta$|^testa o croce\??$/ },
    cmd: [[/^(?:apri|aprire)\s+(.+)$/, 'open $1'], [/^(?:cerca|cercare)\s+(.+)$/, 'search $1'], [/^(?:alza|aumenta) (?:il )?volume$|^più forte$/, 'volume up'], [/^(?:abbassa|diminuisci) (?:il )?volume$|^più piano$/, 'volume down'], [/^(?:muto|silenzia)$/, 'mute'], [/^(?:prossima|prossima canzone|avanti)$/, 'next'], [/^(?:precedente|canzone precedente)$/, 'previous'], [/^(?:pausa|metti in pausa|riproduci)$/, 'pause'], [/^timer (?:di |da )?(\d+) (minuti?|secondi?|ore?)$/, (m) => `set a timer for ${m[1]} ${/^m/.test(m[2]) ? 'minutes' : /^s/.test(m[2]) ? 'seconds' : 'hours'}`], [/^ricordami tra (\d+) minuti? (?:di |che |per )?(.+)$/, 'remind me in $1 minutes to $2'], [/^scorri in basso$/, 'scroll down'], [/^scorri in alto$/, 'scroll up']],
  },
};
const CODES = Object.keys(LANGS).filter((c) => c !== 'en');

function tryLang(code, text, now) {
  const L = LANGS[code];
  for (const [re, answers] of L.talk) if (re.test(text)) return { reply: pick(answers) };
  if (L.q.time.test(text)) return { reply: L.time(now.toLocaleTimeString(L.locale, { hour: 'numeric', minute: '2-digit' })) };
  if (L.q.date.test(text)) return { reply: L.date(now.toLocaleDateString(L.locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })) };
  if (L.q.coin.test(text)) return { reply: pick(L.coin) };
  for (const [re, to] of L.cmd) {
    const m = re.exec(text);
    if (m) return { text: typeof to === 'function' ? to(m) : text.replace(re, to) };
  }
  return null;
}

// ---- offline tricks that need no language (English words, any answer)
const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const toRoman = (n) => { let s = ''; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; } return s; };
function extras(orig, t, now) {
  let m;
  if ((m = /^(?:generate |make |give me )?(?:a )?(?:random |strong |secure )?password(?: (?:of|with) (\d{1,3})(?: characters| chars| letters)?)?$/.exec(t))) {
    const n = Math.max(6, Math.min(64, Number(m[1]) || 16)), set = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*?';
    let p = ''; for (const b of crypto.randomBytes(n)) p += set[b % set.length];
    return `${p}\n(made on your computer, never sent anywhere)`;
  }
  if ((m = /^(?:pick|choose|decide)(?: between| from)?\s+(.{3,200})$/.exec(t)) && /,| or /.test(m[1])) {
    const opts = m[1].split(/\s*,\s*|\s+or\s+/).map((s) => s.trim()).filter(Boolean);
    if (opts.length >= 2) return `I pick: ${pick(opts)}`;
  }
  if ((m = /^(?:what(?:'s| is) )?(\d+(?:\.\d+)?)\s*(?:%|percent)\s+of\s+(\d+(?:\.\d+)?)\??$/.exec(t))) return `${Math.round(Number(m[1]) * Number(m[2])) / 100}`;
  if ((m = /^reverse (?:the )?(?:text |word )?(.{1,200})$/i.exec(orig))) return m[1].split('').reverse().join('');
  if ((m = /^(?:uppercase|upper case|shout) (.{1,200})$/i.exec(orig))) return m[1].toUpperCase();
  if ((m = /^(?:lowercase|lower case|whisper) (.{1,200})$/i.exec(orig))) return m[1].toLowerCase();
  if ((m = /^(?:count|how many) (words|letters|characters|chars) (?:in|of)\s+(.{1,300})$/i.exec(orig))) {
    const x = m[2], w = m[1].toLowerCase();
    return w === 'words' ? `${x.trim().split(/\s+/).filter(Boolean).length} words` : w === 'letters' ? `${(x.match(/\p{L}/gu) || []).length} letters` : `${x.length} characters`;
  }
  if ((m = /^(?:is )?(.{1,60}?) a palindrome\??$/i.exec(orig))) { const s = m[1].toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); return s && s === s.split('').reverse().join('') ? `Yes, "${m[1]}" reads the same backwards.` : `No, "${m[1]}" is not a palindrome.`; }
  if ((m = /^(?:hex )?#?([0-9a-f]{6}) (?:to )?rgb$|^(?:convert )?#([0-9a-f]{6}) to rgb$/i.exec(t))) { const h = m[1] || m[2]; return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`; }
  if (/^(?:random|pick a|give me a) colou?r$/.test(t)) { const h = crypto.randomBytes(3).toString('hex').toUpperCase(); return `#${h}  (rgb ${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`; }
  if ((m = /^days between (\d{4}-\d{2}-\d{2}) and (\d{4}-\d{2}-\d{2})$/.exec(t))) { const d = Math.round(Math.abs(Date.parse(m[2]) - Date.parse(m[1])) / 86400000); return Number.isFinite(d) ? `${d} days` : null; }
  if ((m = /^(?:convert |what(?:'s| is) )?(?:the )?(?:roman numerals? (?:for|of) |(\d{1,4}) (?:to|in) roman(?: numerals?)?)(\d{1,4})?\??$/.exec(t))) { const n = Number(m[1] || m[2]); return n >= 1 && n <= 3999 ? toRoman(n) : 'I can do 1 to 3999.'; }
  if ((m = /^base64 (encode|decode) (.{1,300})$/i.exec(orig))) { try { return m[1].toLowerCase() === 'encode' ? Buffer.from(m[2], 'utf8').toString('base64') : Buffer.from(m[2], 'base64').toString('utf8'); } catch (_) { return null; } }
  if ((m = /^how old (?:am i|is someone) (?:if |when )?(?:born|born in) (\d{4})$/.exec(t))) return `About ${now.getFullYear() - Number(m[1])} (or one less before the birthday).`;
  return null;
}

function process(rawText, lang, now) {
  const orig = String(rawText || '').replace(/\s+/g, ' ').trim();
  const t = orig.toLowerCase().replace(/[!.¡¿]+$/g, '').trim();
  if (!t) return null;
  const ex = extras(orig, t, now);
  if (ex) return { reply: ex };
  const codes = lang && lang !== 'auto' ? (LANGS[lang] && lang !== 'en' ? [lang] : []) : CODES;
  for (const c of codes) { const r = tryLang(c, t, now); if (r) return r; }
  return null;
}

module.exports = { process, LANGS, CODES };
