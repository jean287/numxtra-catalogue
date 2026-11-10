// NumXtra Cloud : construit catalogue/catalogue.json à partir du dépôt NumPlay.
// Lancé chaque jour par GitHub Actions (.github/workflows/catalogue.yml), ou à la main : node scripts/build.mjs
// Variables d'environnement facultatives :
//   GITHUB_TOKEN  évite la limite de requêtes de l'API GitHub
//   DEEPL_KEY     clé de l'API DeepL pour traduire les textes en français
//   DEEPL_URL     https://api-free.deepl.com/v2/translate (par défaut) ou l'adresse de l'offre payante
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

const DEPOT = 'Mason363/NumPlay';
const RAW = `https://raw.githubusercontent.com/${DEPOT}/main/`;
const API = `https://api.github.com/repos/${DEPOT}`;
const SORTIE = 'catalogue/catalogue.json';
const MANIFESTE = 'catalogue/manifest.json';
const TRAD = 'data/traductions.json';
const ICONES = ['src/icon.png', 'assets/icon.png', 'tetris/src/data/icon.png', 'docs/icon.png'];
const ICONE_PARTAGEE = { hkfungal: 'hollowknight' };
// Nom du fichier .nwa publié, quand il ne se déduit pas du titre du jeu.
const ALIAS = {
  fnaf: 'FiveNightsAtFreddys', fnaf2: 'FiveNightsAtFreddys2', fnaf3: 'FiveNightsAtFreddys3', fnaf4: 'FiveNightsAtFreddys4',
  fnafworld: 'FiveNightsAtFreddysWorld', isaac: 'BindingOfIsaac', twoplayer: 'TwoPlayers', fourplayer: 'FourPlayers',
  g2048: '2048', dinorun: 'ChromeDino', invaders: 'SpaceInvaders', breakout: 'BlockBreaker', uttt: 'UltimateTicTacToe',
  hkfungal: 'HollowKnightFungalWastes', subway: 'SubwaySurfers', fnf: 'FridayNightFunkin', pvz: 'PlantsVsZombies',
  hillclimb: 'HillClimbRacing', sonic: 'SonicTheHedgehog', suika: 'SuikaGame', portal: 'PortalReturns',
  buckshot: 'BuckshotRoulette', towerblock: 'TowerBlocks', snowrider: 'SnowRider3D', paperclips: 'UniversalPaperclips',
  badtime: 'BadTimeSimulator', chess: 'NumChess', circloo: 'CircloO', retrogo: 'RetroGo',
};

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
const hex = (v) => '#' + String(v || '0x888888').replace(/^0x/i, '').padStart(6, '0').toLowerCase();
const sha = (data, algo = 'sha256') => createHash(algo).update(data).digest('hex');
const log = (...a) => console.log('[catalogue]', ...a);

async function lireJson(chemin, defaut) {
  try { return JSON.parse(await readFile(chemin, 'utf8')); } catch { return defaut; }
}
async function recuperer(url, opts = {}, essais = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.ok || r.status === 404 || i >= essais) return r;
    } catch (e) { if (i >= essais) throw e; }
    await new Promise((ok) => setTimeout(ok, 1500 * i));
  }
}
async function existe(url) {
  const r = await recuperer(url, { method: 'HEAD' });
  return r.ok;
}

// ---------------------------------------------------------------- journal des versions
function lireChangelog(md) {
  const out = []; let cur = null;
  const propre = (t) => t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '').replace(/`/g, '').trim();
  for (const ligne of md.split('\n')) {
    const v = /^##\s+([\d.]+)\s*:\s*(.*)$/.exec(ligne);
    if (v) { cur = { num: v[1], titre: propre(v[2]), notes: [] }; out.push(cur); continue; }
    if (cur && /^- /.test(ligne)) {
      const b = /^- \*\*(.+?):\*\*\s*(.*)$/.exec(ligne);
      cur.notes.push(b ? { jeu: propre(b[1]), texte: propre(b[2]) } : { jeu: '', texte: propre(ligne.slice(2)) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- traduction (DeepL), avec mémoire
async function traduire(textes, memoire) {
  const cle = process.env.DEEPL_KEY;
  const url = process.env.DEEPL_URL || (cle && cle.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate');
  const manquants = [...new Set(textes.filter((t) => t && !memoire[sha(t, 'sha1')]))];
  if (!cle) { if (manquants.length) log(`${manquants.length} textes non traduits (pas de DEEPL_KEY)`); return; }
  for (let i = 0; i < manquants.length; i += 40) {
    const lot = manquants.slice(i, i + 40);
    const r = await recuperer(url, {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${cle}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lot, source_lang: 'EN', target_lang: 'FR', formality: 'less', preserve_formatting: true }),
    });
    if (!r.ok) { log(`DeepL a répondu ${r.status} : traduction arrêtée pour cette fois`); return; }
    const res = await r.json();
    res.translations.forEach((t, k) => { memoire[sha(lot[k], 'sha1')] = t.text; });
    log(`traduit ${Math.min(i + 40, manquants.length)}/${manquants.length}`);
  }
}
const fr = (t, memoire) => (t ? memoire[sha(t, 'sha1')] || null : null);

// ---------------------------------------------------------------- construction
async function main() {
  const ancien = await lireJson(SORTIE, null);
  const memoire = await lireJson(TRAD, {});
  const ancienParId = Object.fromEntries(((ancien && ancien.jeux) || []).map((j) => [j.id, j]));
  const anciensFichiers = Object.fromEntries(((ancien && ancien.jeux) || []).filter((j) => j.fichier).map((j) => [j.fichier.nom, j.fichier]));

  const entetes = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
  const [rj, rc, rr] = await Promise.all([
    recuperer(RAW + 'games/games.json'),
    recuperer(RAW + 'CHANGELOG.md'),
    recuperer(API + '/releases/latest', { headers: { ...entetes, Accept: 'application/vnd.github+json' } }),
  ]);
  if (!rj.ok || !rc.ok) throw new Error(`NumPlay injoignable (games.json ${rj.status}, CHANGELOG ${rc.status})`);
  const jeux = await rj.json();
  const versions = lireChangelog(await rc.text());
  // RELEASE_FICHIER : pour les tests, une release lue dans un fichier au lieu de l'API.
  const release = process.env.RELEASE_FICHIER ? await lireJson(process.env.RELEASE_FICHIER, null) : (rr.ok ? await rr.json() : null);
  if (!release) log(`release introuvable (${rr.status}) : les fichiers .nwa gardent les anciennes infos`);
  const assets = release ? release.assets.filter((a) => /\.nwa$/i.test(a.name)) : [];

  jeux.sort((a, b) => (a.rank || 999) - (b.rank || 999));
  const sortie = [];
  for (const g of jeux) {
    const avant = ancienParId[g.id] || {};
    // Fichier .nwa du jeu seul (absent : le jeu n'existe que dans NumPlay.nwa)
    const noms = [g.app && g.app.replace(/\.nwa$/i, ''), ALIAS[g.id], g.title].filter(Boolean).map(norm);
    const a = assets.find((x) => noms.includes(norm(x.name.replace(/\.nwa$/i, ''))));
    let fichier = null;
    if (a) {
      const deja = anciensFichiers[a.name];
      if (deja && deja.taille === a.size && deja.maj === a.updated_at && deja.sha256) {
        fichier = deja;
      } else {
        const r = await recuperer(a.browser_download_url);
        const buf = Buffer.from(await r.arrayBuffer());
        fichier = { nom: a.name, taille: a.size, url: a.browser_download_url, sha256: sha(buf), maj: a.updated_at };
        log(`empreinte ${a.name}`);
      }
    } else if (!release && avant.fichier) fichier = avant.fichier;

    // Icône et vidéo : on garde ce qu'on avait trouvé, sinon on cherche
    let icone = avant.icone;
    if (icone === undefined) {
      icone = null;
      const dossier = ICONE_PARTAGEE[g.id] || g.id;
      for (const p of ICONES) { const u = `${RAW}games/${dossier}/${p}`; if (await existe(u)) { icone = u; break; } }
    }
    let video = avant.video;
    if (video === undefined) {
      video = null;
      for (const d of ['previews', 'gallery']) { const u = `${RAW}docs/media/${d}/${g.id}.gif`; if (await existe(u)) { video = u; break; } }
    }
    // Description : la phrase en gras sous le titre de la page du jeu
    let description = avant.description;
    if (description === undefined) {
      description = '';
      const r = await recuperer(`${RAW}games/${g.id}/README.md`);
      if (r.ok) {
        const m = /<b>([\s\S]*?)<\/b><br>\s*([^<\n]*)/.exec(await r.text());
        if (m) description = (m[1] + ' ' + m[2]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      }
    }
    sortie.push({
      id: g.id,
      titre: g.title,
      accroche: g.tagline || '',
      description,
      credit: g.credit || null,
      couleurs: { haut: hex(g.top), bas: hex(g.bottom), accent: hex(g.accent) },
      rang: g.rank || null,
      icone, video,
      sauvegardes: g.records || [],
      reinitialiser: g.reset || [],
      fichier,
      depot: g.repo || null,
      fr: {},
    });
  }

  // Traductions
  const aTraduire = [];
  for (const j of sortie) aTraduire.push(j.accroche, j.description, j.credit);
  for (const v of versions) { aTraduire.push(v.titre); for (const n of v.notes) aTraduire.push(n.texte); }
  await traduire(aTraduire.filter(Boolean), memoire);
  for (const j of sortie) j.fr = { accroche: fr(j.accroche, memoire), description: fr(j.description, memoire), credit: fr(j.credit, memoire) };
  const versionsSortie = versions.map((v) => ({
    num: v.num, titre: v.titre, titre_fr: fr(v.titre, memoire),
    notes: v.notes.map((n) => ({ jeu: n.jeu, texte: n.texte, texte_fr: fr(n.texte, memoire) })),
  }));

  const contenu = {
    format: 1,
    source: `https://github.com/${DEPOT}`,
    numplay: { version: versions[0] ? versions[0].num : null, release: release ? release.tag_name : (ancien && ancien.numplay && ancien.numplay.release) || null },
    jeux: sortie,
    versions: versionsSortie,
  };
  const empreinte = sha(JSON.stringify(contenu));
  if (ancien && ancien.empreinte === empreinte) { log('rien de nouveau'); await writeFile(TRAD, JSON.stringify(memoire, null, 1)); return; }

  const genere = new Date().toISOString();
  await mkdir('catalogue', { recursive: true });
  await mkdir('data', { recursive: true });
  await writeFile(SORTIE, JSON.stringify({ genere, empreinte, ...contenu }, null, 1));
  await writeFile(MANIFESTE, JSON.stringify({ genere, empreinte, numplay: contenu.numplay, jeux: sortie.length }, null, 1));
  await writeFile(TRAD, JSON.stringify(memoire, null, 1));
  log(`catalogue écrit : ${sortie.length} jeux, ${sortie.filter((j) => j.fichier).length} fichiers .nwa, NumPlay ${contenu.numplay.version}`);
}

main().catch((e) => { console.error('[catalogue] échec :', e.message); process.exit(1); });
