# Quota JemaOS — outil USB (Linux · macOS · Windows)

Outil **multiplateforme** pour provisionner le **quota d'installation signé** sur
une clé USB JemaOS fraîchement flashée. Il écrit un compteur signé (HMAC-SHA256)
sur la **partition EFI (ESP)** de la clé ; GRUB et l'installeur le vérifient
avant toute installation.

Interface graphique moderne (fenêtre unique), **CLI** headless, ou **web local**.
Le tout **sans dépendance** à l'exécution (Node ≥ 18).

---

## Ce que fait l'outil

Écrit le fichier `<ESP>/efi/boot/jemaos-quota.cfg` :

```
# JemaOS install quota - signed, do not edit
set jemaos_quota_limit=100
set jemaos_quota_used=0
set jemaos_quota_sig=<hmac-sha256 hex de "limit|used">
```

Détail **important** (compatibilité stricte avec le CLI vendeur) :

- **Message signé** = la chaîne `"<limit>|<used>"` (ex. `100|0`).
- **HMAC-SHA256**, sortie **hex minuscule**.
- **Clé** = contenu de `jemaos-quota.key` **sans le retour à la ligne final**
  (le shell fait `$(cat KEY)`, qui supprime les `\n` de fin).
- La clé doit être **identique** à `/usr/share/jemaos/quota.key` dans l’image.

Vérifié octet pour octet contre `openssl dgst -sha256 -hmac` (voir `test/`).

---

## Interface graphique

3 étapes, épuré (façon ColorOS 17) :

1. **Choisir la clé USB** (disques remarquables + détection ESP par GUID
   `c12a7328-f81f-11d2-ba4b-00a0c93ec93b`).
2. **Limite d’installations** (stepper + préréglages).
3. **Initialiser la clé** → écriture + relecture + vérification de signature.

Fonctionne en **auto clair/sombre**, sans dépendance externe.

---

## Démarrage

### 1) Application web locale (le plus simple)
```bash
sudo node server.js         # droits admin requis pour monter l'ESP
# puis ouvre http://127.0.0.1:8770
```

### 2) CLI (headless / script)
```bash
sudo node bin/jemaos-quota.js list
sudo node bin/jemaos-quota.js show --device /dev/sda
sudo node bin/jemaos-quota.js init --device /dev/sda --limit 100
```
Options : `--key <fichier>` (ou `JEMAOS_QUOTA_KEY`).

### 3) Application de bureau (Electron)
```bash
npm install                 # installe Electron (dev)
npm run electron            # fenêtre native
# paquetage :
npm run dist                # -> AppImage/deb (Linux), dmg (macOS), nsis (Windows)
```

---

## Élévation des privilèges (obligatoire pour écrire sur l’ESP)

| OS | Comment |
| --- | --- |
| **Linux** | `sudo node server.js` (ou `pkexec`) |
| **macOS** | lancer depuis un shell admin ; `diskutil mount` sur la part EFI |
| **Windows** | exécuter **en tant qu’administrateur** (UAC). Un lettre de lecteur temporaire est attribuée à l’ESP (`Set-Partition`), puis retirée |

Sans droits admin : l’outil **détecte** le manque d’élévation, affiche un bandeau,
et désactive l’action.

---

## Matrice plateformes

| OS | Détection disques | ESP | Montage/écriture | État |
| --- | --- | --- | --- | --- |
| **Linux** | `lsblk -J` | GUID PARTTYPE | `mount -o rw` | ✅ testé (clé USB `/dev/sda` détectée) |
| **macOS** | `diskutil list -plist` + `plutil` | Content `EFI` | `diskutil mount` | ⚠️ implémenté, à valider sur Mac |
| **Windows** | `Get-Disk` / `Get-Partition` | GptType ESP | `Set-Partition -NewDriveLetter` | ⚠️ implémenté, à valider sur Win10/11 |

---

## Arborescence

```
bin/jemaos-quota.js       CLI
src/core/crypto.js        HMAC (compatible openssl)
src/core/quota.js         format/parse/verify + écriture atomique
src/core/service.js       orchestration scan/init/show
src/platform/{linux,darwin,win32}.js   backends système
server.js                 serveur local + API (/api/*)
ui/                       interface (HTML/CSS/JS, sans dépendance)
electron/main.js          fenêtre native
resources/jemaos-quota.key             clé HMAC
test/spec.test.js         vecteurs + round-trip + anti-falsification
```

---

## Sécurité — à lire

- La **clé HMAC est un secret partagé**. Un outil **distribué largement** qui
  embarque la clé la rend **publique** (n’importe qui peut alors forger un
  compteur). À réserver à un usage **interne/vendeur**, ou déporter la clé
  (coffre, keychain, activation serveur).
- Pour la production : **une clé par lot** plutôt qu’une clé globale, et la
  rotation se fait **en même temps** dans l’image et ici.
- Le compteur reste contournable avec un accès physique à une autre machine
  (reflash, `dd`, restauration d’un fichier `used=0`), sauf si vous ajoutez
  Secure Boot (image + GRUB signés), un compteur scellé TPM, ou une activation
  serveur. Voir le README d’origine.

---

## Développement / tests

```bash
npm test          # vecteurs HMAC + round-trip + falsification refusée
```
