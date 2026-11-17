// User guide, shown in a dialog from the home screen or the Aide menu.

const GUIDE = `
<h2>Guide de Librescript</h2>
<section>
  <h3>Démarrer</h3>
  <p><b>Créer une histoire</b> : donne-lui un nom et une description, c'est tout. Elle est rangée automatiquement dans
  le dossier <code>Documents/Librescript</code> (créé au premier lancement), dans un fichier <code>.librescript</code>
  qui contient tout : le texte, le synopsis, les fiches, les personnages, la page de titre.</p>
  <p><b>Enregistrement automatique</b> : chaque modification est enregistrée une seconde après que tu t'arrêtes d'écrire,
  et aussi quand tu fermes l'histoire ou quittes l'app. L'indication « ✓ Enregistré » en haut le confirme.
  Si tu renommes l'histoire (module Projet), le fichier est renommé aussi.</p>
  <p><b>Supprimer une histoire</b> : bouton 🗑 sur sa carte à l'accueil, ou menu Fichier → Supprimer l'histoire (<kbd>⌘⌫</kbd>).
  Le fichier part dans la Corbeille de macOS : tu peux encore le récupérer tant qu'elle n'est pas vidée.</p>
  <p><b>Importer un PDF</b> (accueil, ou <kbd>⇧⌘I</kbd>) : Librescript lit le texte d'un scénario PDF et retrouve les scènes,
  personnages, dialogues et la page de titre grâce à la mise en page. Les PDF scannés (images sans texte) ne peuvent pas être importés.</p>
  <p>Les histoires ouvertes récemment apparaissent sur l'accueil. Le logo <b>L</b> en haut à gauche, ou <kbd>⌘W</kbd>, ferme l'histoire et revient à l'accueil.</p>
</section>
<section>
  <h3>Écrire</h3>
  <ul>
    <li><kbd>Entrée</kbd> crée le bloc suivant logique (personnage → dialogue → personnage…).</li>
    <li><kbd>Tab</kbd> / <kbd>⇧Tab</kbd> change le type du bloc. Ou <kbd>⌘1</kbd> à <kbd>⌘6</kbd> : titre de scène, action, personnage, didascalie, dialogue, transition.</li>
    <li>Les pointillés « page N » montrent où tombent les sauts de page au format scénario (1 page ≈ 1 minute).</li>
    <li><kbd>⌘Z</kbd> / <kbd>⇧⌘Z</kbd> pour annuler / rétablir, <kbd>⌘S</kbd> pour enregistrer tout de suite (sinon c'est automatique).</li>
  </ul>
</section>
<section>
  <h3>Rechercher et remplacer</h3>
  <ul>
    <li><kbd>⌘F</kbd> ouvre la recherche, <kbd>Entrée</kbd> / <kbd>⇧Entrée</kbd> ou <kbd>⌘G</kbd> / <kbd>⇧⌘G</kbd> passent d'un résultat à l'autre.</li>
    <li><b>Aa</b> respecte la casse ; le menu « Rechercher dans » limite à un type de bloc (ex. seulement les dialogues).</li>
    <li>Tape <code>#12</code> pour aller directement à la scène 12.</li>
    <li>« Tout remplacer » s'annule en une seule fois avec <kbd>⌘Z</kbd>.</li>
  </ul>
</section>
<section>
  <h3>Modules</h3>
  <ul>
    <li><b>Projet</b> : nom, description et image de couverture affichés sur l'accueil.</li>
    <li><b>Scénario</b> : le texte, avec la liste des scènes à gauche (clic pour y aller, glisser pour déplacer).</li>
    <li><b>Fiches</b> : une carte par scène, avec note et couleur ; glisse les cartes pour réorganiser.</li>
    <li><b>Personnages</b> et <b>Lieux</b> : trouvés automatiquement dans le texte, avec une fiche à remplir.</li>
    <li><b>Stats</b> : durée, temps de parole, intérieur / extérieur, jour / nuit.</li>
    <li><b>Titre</b> : la page de titre des exports.</li>
  </ul>
  <p>Raccourcis : <kbd>⌥⌘0</kbd> à <kbd>⌥⌘6</kbd>.</p>
</section>
<section>
  <h3>Exporter</h3>
  <p>Menu <b>Fichier → Exporter</b> ou bouton <b>Exporter</b> : PDF (format US Letter, avec page de titre et numéros de scène),
  Final Draft (<code>.fdx</code>) et Fountain (<code>.fountain</code>).</p>
</section>
`;

export class Guide {
  constructor() {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'guide-dialog';
    this.dialog.innerHTML = `<div class="guide-body">${GUIDE}</div>
      <form method="dialog" class="dialog-actions"><button class="primary">Fermer</button></form>`;
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
    document.body.appendChild(this.dialog);
  }
  open() { if (!this.dialog.open) this.dialog.showModal(); }
}
