/*
 * qa-domain-runner — snippets de capture d'écran pour navigateur interactif.
 *
 * À exécuter via `javascript_tool` (action javascript_exec) dans l'onglet de
 * l'app. Chaque bloc est une IIFE async dont la dernière expression est
 * renvoyée comme résultat. Ne PAS retourner de base64 directement (sortie
 * bloquée) : on passe par localStorage puis un zip unique.
 *
 * Pourquoi html-to-image et pas html2canvas : html2canvas plante sur les
 * couleurs `oklab` générées par Tailwind v4 ("unsupported color function").
 *
 * Clé localStorage = qa_<navigateur>_<langue>_<domaine>_<ecran>_<etat>
 * Le navigateur/langue sont portés par le PREFIXE ; le fichier final extrait
 * garde un nom court <domaine>_<ecran>_<etat>.jpg car le chemin encode déjà
 * navigateur/langue.
 */

// ---------------------------------------------------------------------------
// 0) RÉGLER LA LANGUE (utilisateur authentifié). LANG ∈ {'fr','en','ar'}.
//    Pour 'ar', contrôle RTL après reload.
// ---------------------------------------------------------------------------
(async () => {
  const LANG = "ar"; // <-- À PERSONNALISER : 'fr' | 'ar'
  await fetch("/api/account/locale", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify({ locale: LANG }),
  });
  location.reload();
})();
// Après reload, vérifier le RTL pour 'ar' :
// (() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang }))();

// ---------------------------------------------------------------------------
// 1) CAPTURER l'état courant.
//    NOM = <navigateur>_<langue>_<domaine>_<ecran>_<etat>  (sans le prefixe qa_)
//    bg : #fafaf9 pages claires, #000 pour le 404.
// ---------------------------------------------------------------------------
(async () => {
  if (typeof htmlToImage === "undefined") {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.js";
    document.head.appendChild(s);
    await new Promise((res, rej) => {
      s.onload = res;
      s.onerror = () => rej("html-to-image bloqué (CSP ?)");
      setTimeout(() => rej("timeout chargement html-to-image"), 8000);
    });
  }
  const NOM = "chrome_fr_auth_login_affichage-initial"; // <-- À PERSONNALISER
  const bg = "#fafaf9";
  const data = await htmlToImage.toJpeg(document.body, { quality: 0.6, backgroundColor: bg });
  localStorage.setItem("qa_" + NOM, data);
  return { capture: NOM, total: Object.keys(localStorage).filter((k) => k.startsWith("qa_")).length };
})();

// ---------------------------------------------------------------------------
// 2) ZIPPER toutes les captures qa_* et déclencher UN SEUL téléchargement.
//    NB côté bash AVANT : supprimer un éventuel zip homonyme dans ~/Downloads
//    pour éviter le renommage Chrome en "(1)".
//    Le bash d'extraction range chaque <navigateur>_<langue>_<domaine>_… dans
//    docs/qa/results/<run>/<navigateur>/<langue>/<domaine>/<ecran>_<etat>.jpg
// ---------------------------------------------------------------------------
(async () => {
  if (typeof JSZip === "undefined") {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    document.head.appendChild(s);
    await new Promise((res, rej) => {
      s.onload = res;
      s.onerror = () => rej("JSZip bloqué");
      setTimeout(() => rej("timeout chargement JSZip"), 8000);
    });
  }
  const RUN = "qa-run"; // <-- nom du zip, ex. qa-run-2026-06-08_14h00
  const zip = new JSZip();
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("qa_"));
  for (const k of keys) {
    // garde le chemin complet <navigateur>/<langue>/<domaine>/<ecran>_<etat>.jpg
    const parts = k.replace(/^qa_/, "").split("_");
    const [nav, lang, dom, ...rest] = parts;
    zip.file(`${nav}/${lang}/${dom}/${rest.join("_")}.jpg`, localStorage.getItem(k).split(",")[1], { base64: true });
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = RUN + "-screenshots.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { fichier: RUN + "-screenshots.zip", captures: keys.length, ko: Math.round(blob.size / 1024) };
})();

// ---------------------------------------------------------------------------
// 3) NETTOYER les clés qa_* (après archivage réussi).
// ---------------------------------------------------------------------------
(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("qa_"));
  keys.forEach((k) => localStorage.removeItem(k));
  return "localStorage nettoyé (" + keys.length + " clés)";
})();
