# Quota JemaOS

Application de bureau pour initialiser et vérifier le quota d’installation
signé d’une clé USB JemaOS. Fenêtre native Electron, interface sobre, thèmes
clair/sombre et langues français/anglais.

**Aucun serveur local, navigateur ni port réseau.** L’interface communique
avec le module système par IPC. Les anciens scripts web et installateurs de
Node ont été retirés. Node est embarqué dans les applications empaquetées ;
l’utilisateur n’a pas à l’installer.

## Installation

- **Ubuntu/Debian** : ouvrir le `.deb`, installer, puis lancer **Quota JemaOS**
  depuis Applications. `quota-jemaos` lance la même fenêtre depuis un terminal.
- **Autres Linux x64** : exécuter l’AppImage. Si FUSE n’est pas disponible,
  son option `--appimage-extract-and-run` permet un lancement sans FUSE.
- **Windows 10/11 x64** : lancer `Quota-JemaOS-<version>-windows-x64-Setup.exe`,
  puis le raccourci du menu Démarrer. L’interface reste non-administrateur ;
  UAC est demandé pour les opérations qui le nécessitent.
  Le fichier `Quota-JemaOS-<version>-windows-x64-Portable.exe` lance la même
  application sans installation.
- **macOS** : ouvrir le DMG correspondant au processeur (`x64` pour Intel,
  `arm64` pour Apple Silicon), puis glisser Quota JemaOS dans Applications.

Les installateurs sans certificat ne sont pas signés par un éditeur de confiance
ni notariés : macOS ou Windows peuvent afficher une alerte. Le build macOS utilise
une signature technique ad-hoc lorsqu’aucun certificat n’est fourni, notamment
pour préserver la validité du bundle sur Apple Silicon. Une distribution publique
nécessite les certificats de signature appropriés ; ne désactive pas les
protections de l’OS pour contourner une alerte.

## Utilisation et sécurité des disques

1. Brancher la clé USB JemaOS déjà flashée.
2. Sélectionner la clé et choisir la limite, librement ou via les préréglages
   1, 10, 50, 100, 500, 1 000 et 10 000.
3. Initialiser et accepter l’autorisation système si elle est demandée.

L’initialisation remet le compteur utilisé à zéro. L’application relit ensuite
le fichier et vérifie sa signature. Elle ne formate ni ne reflashe le disque.
Les disques internes/système, les partitions EFI ambiguës et les périphériques
dont l’identité a changé sont refusés.

Linux utilise `lsblk`, `mount` et `pkexec`/polkit ; macOS utilise les outils
`diskutil`, `plutil` et l’autorisation administrateur ; Windows utilise les
cmdlets Storage PowerShell et UAC. Le montage Windows est vérifié avant toute
écriture. Si l’OS refuse d’exposer l’ESP de façon sûre, l’opération s’arrête
avec une erreur : aucun type ni attribut GPT n’est changé pour forcer l’accès.

## Format compatible avec l’installeur

Fichier : `<ESP>/efi/boot/jemaos-quota.cfg`.

```text
# JemaOS install quota - signed, do not edit
set jemaos_quota_limit=100
set jemaos_quota_used=0
set jemaos_quota_sig=<signature>
```

La signature est le HMAC-SHA256, en hexadécimal minuscule, du message exact
`limit|used`. La clé est chargée sans les retours à la ligne finaux, comme
`$(cat KEY)` dans le CLI vendeur. Elle doit correspondre à celle de l’image
JemaOS. `.gitattributes` préserve les octets de la clé lors d’un checkout Windows.

**Outil vendeur/interne :** la clé HMAC embarquée est un secret partagé que le
détenteur de l’application peut extraire. Ne publie pas le dépôt ou les paquets
contenant une clé de production. Une signature locale n’empêche pas de rejouer
un ancien compteur valide ; une limitation forte nécessite un mécanisme
supplémentaire, par exemple une activation serveur.

## Développement et builds natifs

Node 22 et npm sont recommandés pour construire les paquets.

```bash
npm ci
npm test
npm start
```

```bash
npm run dist:linux   # AppImage et deb
npm run dist:win     # Installateur NSIS exe
npm run dist:win:portable # Application Windows portable
npm run dist:mac     # DMG Intel et Apple Silicon (sur macOS)
npm run dist:mac:linux # DMG Intel et Apple Silicon depuis Linux
```

Les icônes PNG/ICO/ICNS sont générées depuis le logo USB avant le packaging.
Les artefacts sont dans `dist/`. Linux conserve le lanceur compatible avec
les liens `update-alternatives` et le repli `--no-sandbox` nécessaire sur la
machine de test ; ce repli ne s’applique pas à Windows/macOS.

NSIS peut être construit depuis Linux avec Wine, ou sur Windows. Sur macOS, le
DMG utilise `hdiutil`. Le workflow manuel `.github/workflows/build-native.yml`
construit Windows/macOS, exécute les tests et vérifie le démarrage natif avant
de déposer les installateurs en artefacts GitHub Actions. Il doit être exécuté
dans un dépôt privé configuré ; il n’a pas été lancé automatiquement depuis ce
poste.

### DMG depuis Linux (sans Mac, sans hdiutil)

`npm run dist:mac:linux` produit de vrais DMG UDIF compressés (bzip2) pour
Intel et Apple Silicon, à partir d’outils open source vérifiés :

- `mkfs.hfsplus` / `fsck.hfsplus` du paquet Ubuntu `hfsprogs` ;
- [`mozilla/libdmg-hfsplus`](https://github.com/mozilla/libdmg-hfsplus)
  (commit épinglé) pour peupler un volume HFS+ et le convertir en UDIF
  (`dmg build`) ;
- [`apple-codesign` (rcodesign)](https://github.com/indygreg/apple-platform-rs)
  pour une signature **ad-hoc** des bundles et de leurs frameworks.

`scripts/fetch-dmg-tools.sh` récupère/compile ces outils (SHA-256 vérifiés) ;
`scripts/build-macos-dmg.sh` signe le `.app`, crée le volume HFS+, ajoute le
bundle et le lien `Applications`, convertit en DMG et **vérifie l’aller-retour**
(`dmg extract` + `fsck`). La signature ad-hoc garantit l’intégrité et structure
un bundle Apple Silicon, mais **n’est ni une identité vérifiée ni une
notarisation** : ce n’est pas une distribution acceptée par Gatekeeper. Pour une
diffusion publique, signez avec un certificat Developer ID et notarisez sur
macOS.

Pour le portable Windows depuis Linux sans Wine, l’édition des métadonnées
de l’exécutable Electron peut être ignorée :

```bash
npm run dist:win:portable -- --config.win.signAndEditExecutable=false
```

Ce paquet reste non signé et nécessite un essai sur Windows. Le workflow
Windows, lui, construit les métadonnées complètes et les deux formes du paquet.

```bash
node scripts/check-packaged-launch.js
```

Ce contrôle charge la vraie interface empaquetée et son pont IPC avec
`--smoke-test`. Dans ce mode, scan, montage et écriture USB sont désactivés.
Les tests de commandes macOS/Windows utilisent des fixtures sous Linux ; ils
ne remplacent pas une validation sur machine avec une vraie clé.

Le CLI reste disponible pour le support :

```bash
node bin/jemaos-quota.js list
node bin/jemaos-quota.js show --device <identifiant>
node bin/jemaos-quota.js init --device <identifiant> --limit 100
```

## Structure conservée

```text
electron/        Fenêtre native et pont IPC
ui/              Interface FR/EN et thèmes
src/core/        Quota, signature et élévation
src/platform/    Linux, macOS et Windows
bin/             Helper privilégié et CLI de support
resources/       Clé HMAC vendeur
assets/          Icônes des paquets
scripts/         Build, lancement de développement et validation
test/            Régressions et fixtures sans opérations USB réelles
```
