# NumXtra, catalogue

Le catalogue des jeux NumWorks utilisé par les applications NumXtra (PC et téléphone).

Chaque jour, un programme lit le dépôt [NumPlay](https://github.com/Mason363/NumPlay) et met à jour `catalogue/catalogue.json` : nom, description, icône, vidéo, fichiers de sauvegarde, fichier `.nwa` de chaque jeu avec sa taille et son empreinte, et l'historique des versions. Les textes sont traduits en français quand une clé DeepL est configurée.

- `catalogue/catalogue.json` : le catalogue complet.
- `catalogue/manifest.json` : un petit fichier pour savoir si le catalogue a changé.
- `data/traductions.json` : la mémoire des traductions, pour ne jamais traduire deux fois le même texte.

Les jeux restent ceux de leurs auteurs : NumXtra ne recopie pas les fichiers, il pointe vers les publications de NumPlay et garde leurs crédits.

## Lancer à la main

Onglet **Actions**, puis **Catalogue NumXtra**, puis **Run workflow**.
