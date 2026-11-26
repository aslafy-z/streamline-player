# Pourquoi WebKitGTK coûte si cher sans GPU, et jusqu'où on peut descendre

Rapport d'enquête, 26 novembre 2026. Il se lit seul. Le détail, les captures et les profils sont
dans ce dossier (`README.md` en est le journal, en anglais).

Trois niveaux de certitude, toujours indiqués :

- **mesuré** : un chiffre du bench (`dev/bench`), dans le conteneur décrit plus bas ;
- **lu** : une affirmation tirée du code source, avec fichier, ligne et version ;
- **supposé** : une déduction que personne n'a vérifiée.

## En une page

**La cause.** Sans GPU, OpenGL est émulé sur le processeur par Mesa llvmpipe. WebKitGTK ne s'en
aperçoit pas et garde son mode « composité », pensé pour un GPU : à chaque image, il redessine
toute la fenêtre par OpenGL, attend la fin du rendu, relit toute la surface et la fait
redessiner en entier par GTK. Le coût suit la surface de la fenêtre et le nombre d'images, pas
ce qui a changé. Sur la page d'accueil, 256 des 279 % d'un cœur sont dans les quatre threads de
rastérisation de llvmpipe (mesuré).

**Ce n'est pas un bug isolé**, c'est un cas que WebKitGTK ne traite pas : il possède un chemin
tout CPU, 2,5 à 7 fois moins cher sur les mêmes pages, et ne le choisit jamais de lui-même.

**Une seconde cause, propre au player, découverte en route.** La zone OpenGL où mpv dessine la
vidéo, placée sous la webview, fait basculer toute la fenêtre GTK 3 en OpenGL dès qu'elle est
affichée, pour de bon. Sans GPU, le processus de l'interface dépense alors 110 à 130 % d'un
cœur à lui seul, sur toutes les pages, lecture ou pas. Le bench d'origine ne le voyait pas : il
n'avait pas cette zone.

**Ce qui est fait, du moins profond au plus profond.**

| niveau | changement | effet mesuré sans GPU | avec GPU | état |
|---|---|---|---|---|
| application, 14 lignes | la zone OpenGL de mpv n'est affichée que pendant la lecture | 197 % → 84 % tant que rien n'a été lu | 12 % → 10 % | PR en draft, fork #6 et amont #9 |
| application, 28 lignes | pas de VA-API par Wayland quand OpenGL est logiciel | l'application ne plante plus au démarrage sous Wayland sans GPU | inchangé | PR en draft, fork #7 |
| application, page | fond fixe et barre par pas quand le rendu est logiciel | accueil au repos : 279 % → 69 % (2.52), 224 % → 49 % (2.54) | neutre | PR amont #8, existante |
| wry | pouvoir régler la webview avant son premier chargement | condition du chemin tout CPU en 2.54 | | brouillon de demande |
| WebKitGTK, 5 patchs | composition, relecture et redessin limités à la zone modifiée | petite animation : 82 % → 14 %, en restant composité | | compilés et mesurés, à proposer en amont |
| WebKitGTK, 1 patch | repli automatique sur le chemin tout CPU sans GPU | accueil : 285 % → 106 %, sans rien régler | sans effet | compilé et mesuré ; inadapté à une fenêtre avec vidéo |

**Ce qui ne marche pas, et pourquoi il fallait le vérifier.** Couper le compositing de WebKit
quand le rendu est logiciel divise le coût par 2,5 à 7 dans une fenêtre simple. Dans le player,
cela donne une fenêtre noire : une webview non composée n'est pas dessinée dans une fenêtre
GTK 3 passée en OpenGL, et elle ne peut de toute façon pas laisser voir la vidéo au travers. Ce
correctif a été écrit, essayé sur la vraie application, et retiré.

**Deux pièges de version.**

- `WEBKIT_DISABLE_COMPOSITING_MODE=1`, le contournement connu, aide en 2.52 (279 % → 106 %) et
  **aggrave** en 2.54 (224 % → 257 %). `WEBKIT_DISABLE_DMABUF_RENDERER=1` donne le chemin tout
  CPU sur les deux (106 % et 106 %).
- Poser la politique d'accélération `NEVER` après la création de la webview, comme le conseille
  l'équipe Tauri, marche en 2.52 et donne une **page blanche** en 2.54.

## Le montage

- Machine : portable Arch, Ryzen 7 7840U, Radeon 780M. Les mesures sans GPU tournent dans un
  conteneur qui ne reçoit pas `/dev/dri`, sur quatre cœurs : Ubuntu 24.04, WebKitGTK 2.52.6,
  GTK 3.24.41, Mesa 25.2.8, Xvfb, fenêtre 1440×900, Tauri 2.12.5. Ce sont les versions du
  conteneur cloud de `RESULTS.md` ; la page d'accueil y coûte 282 % dans les deux.
- Une seconde image, Arch, porte WebKitGTK 2.54.3 et Mesa 26.3.1. Ubuntu en reste à 2.52.6
  jusqu'en 26.10.
- Un second conteneur reçoit le GPU (`BENCH_GPU=1`) et dessine sous Weston : mêmes binaires,
  même page, pour comparer les deux côtés sur une seule machine.
- Le processeur est en % d'un cœur pour l'ensemble des processus de l'application.

## 1. À quoi est dû le coût

### Les trois cœurs sont ceux de llvmpipe (mesuré)

Page d'accueil au repos, billboard en rotation, mode composité, 15 s :

| processus, threads | CPU |
|---|---|
| processus web, 4 × `llvmpipe-N` | 255,6 % (60 à 67 % chacun) |
| processus web, compositeur (`ThreadedCompositor`) | 11,9 % |
| processus web, thread principal | 6,7 % |
| processus web, 2 × `SkiaGPUWorker` | 3,9 % |
| processus de l'interface | 2,8 % |
| total | 282 % |

Avec perf sur la même phase : 86 % des échantillons sont dans le code que llvmpipe compile à la
volée, ses shaders de fragments ; 91 % sous `rasterize_scene`. perf ne peut pas nommer ces
fonctions, elles n'existent dans aucun fichier.

`GLFence::create`, que le bug WebKit 276580 désigne, n'apparaît pas : c'est l'endroit où le
compositeur attend ces threads, pas celui où le temps est dépensé.

Limiter llvmpipe à un thread (`LP_NUM_THREADS=1`) ramène l'accueil à 105 %, et le défilement à
12 images par seconde contre 52 sans compositing pour le même coût : le travail par image est
le même, il y a seulement moins de machine pour le faire.

### Chaque image redessine et relit toute la fenêtre (lu, 2.52.6)

1. Sans nœud de rendu DRM, le processus de l'interface n'offre que la mémoire partagée, et le
   processus web compose dans un tampon hors écran (`AcceleratedBackingStore.cpp:97-114`,
   `AcceleratedSurface.cpp:660-665`).
2. Pour chaque image, le compositeur peint tout l'arbre de calques par OpenGL
   (`ThreadedCompositor.cpp:346-428`), attend la fin du rendu sur une barrière
   (`AcceleratedSurface.cpp:266-283`), puis relit toute la surface par `glReadPixels`
   (`AcceleratedSurface.cpp:514-518`).
3. Le processus de l'interface demande le redessin de tout le widget et le remplit depuis ce
   tampon (`AcceleratedBackingStore.cpp:203-208`, `:273-283`).
4. La zone modifiée est calculée et transmise à chaque image, et rien ne s'en sert sur ce
   chemin en 2.52 : `UseDamagingInformationForCompositing` y est désactivé
   (`UnifiedWebPreferences.yaml:8553`), activé en 2.54.2 (`:9191`). La relecture et le redessin
   GTK 3 restent complets dans les deux.

### Vérifié sur une page à une seule animation (mesuré)

Un fond en dégradé, un paragraphe, un élément animé. 60 images par seconde partout.

| page | 2.52.6 composité | 2.52.6 tout CPU | 2.54.3 composité | 2.54.3 tout CPU |
|---|---|---|---|---|
| rien ne bouge | 0 % | 0 % | 0 % | 0 % |
| barre de 44 px | 84 % | 12 % | 22 % | 14 % |
| zoom plein écran | 148 % | 70 % | 115 % | 40 % |

La barre à trois tailles de fenêtre, 2.52.6 composité : 32 % à 720×450, 84 % à 1440×900, 123 %
à 1920×1080. En tout CPU : 12 % aux trois.

- Composité en 2.52, n'importe quelle animation coûte environ 85 % d'un cœur sur une page
  triviale, et ce coût suit la surface de la fenêtre. Ce qui bouge n'importe pas.
- La 2.54 limite la composition à la zone modifiée : la petite animation tombe à 22 %. Elle ne
  change rien quand tout l'écran bouge.
- Le même drapeau, activé à la main en 2.52, donne 20 %. Il doit être posé avant la création de
  la page ; posé après, il n'a aucun effet (une première mesure, faite ainsi, a été retirée).

### Rien ne regarde le moteur de rendu (lu)

- WebKitGTK 2.52 ne détecte nulle part un rendu logiciel. La 2.54 a
  `GLDisplay::isSoftwareRendered()` et ne s'en sert que pour apparier un périphérique Vulkan.
- wry ne règle jamais la politique d'accélération (`wry-0.57.1/src/webkitgtk/mod.rs:427-467`),
  et Tauri n'expose ni elle ni les réglages de WebKit.

## 2. La fenêtre du player : une seconde cause

Le player place une `GtkGLArea` sous la webview (`plugins/tauri-plugin-player/src/view.rs`).

**Lu, GTK 3.24.41.** Une fenêtre peint par OpenGL dès qu'elle possède un contexte GL de
peinture (`gdk/gdkwindow.c:2965`). Une `GtkGLArea` le crée en se réalisant (`:2855-2888`), et
seule la destruction de la fenêtre le libère (`:2106-2111`). À chaque image, le dessin logiciel
de la fenêtre est envoyé comme texture et composé par-dessus (`:3050-3075`). Sous X11, sans âge
de tampon connu, toute la fenêtre est redessinée (`gdk/x11/gdkglcontext-x11.c:122-184`).

**Mesuré, 2.52.6, sans GPU, page « barre », zone factice :**

| zone OpenGL | composité : total (interface, web) | tout CPU |
|---|---|---|
| aucune | 84 % (6, 78) | 12 %, page affichée |
| jamais affichée | 82 % (6, 76) | 13 %, page affichée |
| affichée | 203 % (132, 71) | 139 %, **page invisible** |
| affichée puis cachée | 143 % (65, 79) | 76 %, **page invisible** |

**Mesuré avec le vrai plugin et mpv**, avant et après la PR « zone à la demande », deux
répétitions. Entre parenthèses, la part du processus de l'interface.

| sans GPU, 2.52.6 | avant | après |
|---|---|---|
| page « barre », rien lu | 197 % (126) | 84 % (6) |
| page « barre », zone affichée (lecture) | 323 % (305) | 323 % (304) |
| page « barre », arrêt après lecture | 199 % (127) | 148 % (66) |
| accueil au repos | 287 % (62) | 288 % (3) |
| accueil, défilement | 280 %, 24 images/s (56) | 275 %, 27 images/s (3) |
| accueil au repos, page informée | 75 % (19) | 71 % (1) |

Sur l'accueil les quatre cœurs sont pris dans les deux cas : ce que l'interface rend va aux
images. En lecture sur llvmpipe, l'interface prend trois cœurs à elle seule : ce n'est pas un
player utilisable, avec ou sans le changement.

| avec GPU (Weston, Radeon 780M) | avant | après |
|---|---|---|
| page « barre », rien lu | 12 % | 10 % |
| page « barre », en lecture | 38 % | 38 % |
| page « barre », arrêt après lecture | 12 % | 10 % |
| accueil au repos | 29 % | 28 % |
| accueil, défilement | 45 %, 60 images/s | 44 %, 60 images/s |

Avec le GPU, la vidéo s'affiche et avance à chaque essai, la page par-dessus, charge GPU
identique des deux côtés (4 % au repos, 19 % en lecture).

`GDK_GL=software-draw`, un réglage de GTK 3, divise par deux le coût d'une zone affichée (141 %
→ 78 % dans l'interface) sans le supprimer. Il rend aussi visible la raison de fond : une
webview non composée peint en remplaçant ce qui est dessous
(`UIProcess/cairo/BackingStoreCairo.cpp:82-90`), donc là où la page est transparente on voit du
noir, pas la vidéo. Voir à travers une webview exige le mode composité.

**Le plantage sous Wayland sans GPU.** L'application meurt au démarrage sous Weston sans écran
ni GPU. La trace (gdb) : `vaInitialize` dans `libva-wayland`, appelé par
`mpv_render_context_create`, parce que le plugin passe l'affichage Wayland à mpv pour VA-API.
Sans GPU il n'y a aucun décodeur VA-API à utiliser. Le correctif (fork #7) ne passe plus cet
affichage quand `GL_RENDERER` est un rastériseur logiciel : l'application démarre et lit le
clip de test (capture à 6,3 s du clip).

## 3. Ce qui a été essayé

| réglage | 2.52.6, accueil au repos | 2.54.3, accueil au repos | remarque |
|---|---|---|---|
| rien | 279 % | 224 % | |
| page informée du rendu logiciel (PR #8) | 69 % | 49 % | rien au défilement |
| `WEBKIT_DISABLE_COMPOSITING_MODE=1` | 106 % | 257 % | s'inverse en 2.54 |
| `WEBKIT_DISABLE_DMABUF_RENDERER=1` | 106 % | 106 % | le seul sûr sur les deux |
| le même, page informée | 14 % | 16 % | le plancher |
| politique `NEVER` posée après la création | 107 % | page blanche | une répétition |
| politique `NEVER`, puis processus web relancé | 106 % | 106 % | |
| composition limitée à la zone modifiée | 271 % | par défaut | sans effet quand tout l'écran bouge ; une répétition |
| `LP_NUM_THREADS=1` | 105 %, 12 images/s au défilement | 107 %, 18 images/s | échange du CPU contre des images ; une répétition |
| `WEBKIT_USE_SKIA_FOR_COMPOSITION=0` | | 262 % | l'ancien compositeur, pire ; une répétition |

Au défilement de l'accueil : 270 % et 26 images/s composité contre 107 % et 47 à 51 images/s en
tout CPU (2.52) ; 214 % et 39 images/s contre 107 % et 46 images/s (2.54).

Sans effet mesurable : `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` (pire sur une petite animation,
97 % contre 84 %), `WEBKIT_SKIA_GPU_PAINTING_THREADS=0`, et les variables déjà écartées dans
`RESULTS.md`.

Sans compositing, le temps est dans Skia sur le thread principal : sur l'accueil, les étages de
dégradé prennent environ 45 % des échantillons, l'image de fond redimensionnée environ 8 %. Dans
ce mode la page paie ce qu'elle peint, et les dégradés du billboard coûtent plus que sa photo.

### WebKitGTK 2.52.6 recompilé avec les patchs (mesuré)

WebKitGTK 2.52.6 a été compilé depuis les sources, sans patch (témoin, égal au paquet Ubuntu)
puis avec chaque jeu de patchs. Deux répétitions, sans GPU. Le coût de l'application, plus la
part du serveur X.

| build | barre de 44 px | zoom plein écran | accueil au repos | accueil, défilement |
|---|---|---|---|---|
| sans patch | 82 % + 15 % | 147 % + 15 % | 285 % + 10 % | 274 %, 28 images/s |
| composition limitée à la zone modifiée | 22 % + 18 % | 141 % + 16 % | 271 % + 11 % | 274 %, 31 images/s |
| + relecture limitée | 17 % + 16 % | 141 % + 16 % | 271 % + 11 % | 274 %, 30 images/s |
| + redessin GTK 3 limité | 14 % + 2 % | 136 % + 15 % | 274 % + 8 % | 276 %, 31 images/s |
| repli automatique sans GPU | 15 % + 1 % | 65 % + 9 % | 106 % + 5 % | 105 %, 54 images/s |

- Quand peu de choses bougent, les trois patchs « zone modifiée » rendent le mode composité
  aussi bon marché que le chemin tout CPU (14 + 2 contre 15 + 1), tout en gardant le
  compositing dont une fenêtre avec vidéo a besoin.
- Quand tout l'écran bouge, ils n'apportent rien : seul quitter OpenGL aide, et le patch de
  repli le fait sans aucun réglage.
- Le patch de repli cache la page d'une fenêtre qui contient une zone OpenGL, comme les
  variables équivalentes. `WEBKIT_FORCE_COMPOSITING_MODE=1` rétablit le compositing.
- Les cinq patchs ont compilé tels qu'écrits. Celui du redessin laissait une bande blanche : le
  code de WebKitGTK applique le rectangle de découpe après un retournement vertical, ce qui ne
  se voit que si la découpe est plus petite que la vue. Corrigé dans le patch, vérifié à
  l'écran.

## 4. Recommandations

1. **Fusionner la PR « zone à la demande »** (fork #6, amont #9) après un essai de lecture sur
   une machine avec GPU : lancer un titre, l'arrêter, en lancer un autre. C'est le plus petit
   changement pour le plus gros gain sans GPU, et il est neutre avec.
2. **Fusionner la PR « pas de VA-API par Wayland sans GPU »** (fork #7) : sans elle
   l'application plante au démarrage sous Wayland sans GPU.
3. **Garder la PR #8** (page adaptée au rendu logiciel) : en mode composité, moins d'images
   reste le seul levier côté page.
4. **Ne pas couper le compositing dans le player.** Dans une application Tauri sans zone
   OpenGL, c'est au contraire le bon réglage sans GPU : `WEBKIT_DISABLE_DMABUF_RENDERER=1`
   avant la première webview.
5. **Proposer en amont les patchs WebKit « zone modifiée »** (relecture et redessin) : ce sont
   eux qui profitent au player, puisqu'ils gardent le compositing. Le patch de repli est le
   bon défaut pour une application sans vidéo, à proposer avec sa limite.
6. **Remonter en amont** les trois brouillons de `upstream-drafts/` : le coût du compositing
   logiciel et l'absence de repli (WebKit), la page blanche avec `NEVER` en 2.54 (WebKit), la
   documentation inversée et le crochet manquant (Tauri, wry).

## 5. Ce qui reste inconnu

- Pourquoi une webview non composée n'est pas dessinée du tout dans une fenêtre GTK 3 en
  OpenGL. Avec `GDK_GL=software-draw` elle l'est.
- Pourquoi, sans GPU, l'image de mpv reste noire dans une partie des essais de lecture (Xvfb et
  Weston, avec ou sans les correctifs). Jamais avec le GPU.
- Si libva plante aussi sous un compositeur de bureau sans GPU (mutter, KWin) : seul Weston sans
  écran a été essayé.
- Si les patchs WebKit s'appliquent tels quels à la 2.54, dont le compositeur a changé : ils
  sont écrits et mesurés pour la 2.52.6.
- WebKitGTK 2.54 sous Wayland sans GPU : mesuré sous X11 seulement.
- La régression de 5 points de la PR #7 en `wry-nocomp` sous Wayland : non reprise.

## Relecture

Les tableaux des sections 2 et 3 viennent d'une relecture complète (`dev/bench/replay.sh`) :
même conteneur, page de la PR #8 (`af4eb1c`), deux répétitions, les deux images. Entre deux
répétitions une case bouge de 10 points au plus, de moins de 5 presque partout. Les résultats
bruts sont dans `replay/`, les tableaux dans `dev/bench/RESULTS.md`. Les lignes marquées « une
répétition » et les tableaux de la section 1 viennent des séries faites pendant l'enquête ; la
relecture a redonné les mêmes valeurs partout où elle les recouvre (accueil, barre, zoom, à 5
points près).

Un écart a été trouvé et corrigé en la faisant : le harnais utilisait sa propre copie de la
fausse couche native, qui ignorait la commande ajoutée par la PR #8, si bien que la variante
« page informée » ne changeait rien. Avec la couche de la branche mesurée, le gain annoncé par
la session précédente (282 % → 81 %) se retrouve ici : 279 % → 69 %.
