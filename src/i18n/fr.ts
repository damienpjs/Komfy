/** Ressources françaises. Garder les clés synchronisées avec en.ts. */

export default {
  common: {
    cancel: 'Annuler',
    done: 'Terminé',
    delete: 'Supprimer',
    save: 'Enregistrer',
    close: 'Fermer',
    copy: 'Copier',
    loading: 'Chargement…',
    retry: 'Réessayer',
    pin: 'Épingler',
    unpin: 'Détacher',
    justNow: "à l'instant",
    minutesAgo: 'il y a {{count}} min',
    hoursAgo: 'il y a {{count}} h',
    daysAgo: 'il y a {{count}} j',
  },
  textResult: {
    copied: 'Prompt copié ✓',
    analyzing: 'Gemma-4 analyse…',
    pendingHint:
      'Quelques secondes en général — le job est visible dans la Queue.',
    serverError: 'Serveur injoignable — {{message}}',
    failed:
      "✗ Le job a échoué. Si Ollama n'est pas lancé sur le serveur, le démarrer puis relancer le workflow (détail dans l'accueil ou le journal WS).",
    usePrompt: 'Utiliser comme prompt',
    library: 'Prompts sauvegardés',
  },
  tabs: {
    queue: 'Queue',
    workflows: 'Workflows',
    library: 'Bibliothèque',
    settings: 'Réglages',
  },
  library: {
    images: 'Images',
    prompts: 'Prompts',
  },
  nav: {
    workflow: 'Workflow',
    textResult: 'Prompt généré',
    prompts: 'Prompts sauvegardés',
    wsLog: 'Journal WS',
    console: 'Console ComfyUI',
    back: 'Retour',
    importWorkflow: 'Importer un workflow',
    editWorkflow: 'Éditer le workflow',
  },
  queue: {
    clearTitle: 'Vider la queue ?',
    clearBody_one:
      "{{count}} job en attente sera supprimé. Le job en cours n'est pas affecté.",
    clearBody_other:
      "{{count}} jobs en attente seront supprimés. Le job en cours n'est pas affecté.",
    clear: 'Vider',
    clearQueue: 'Vider la queue',
    offlineTitle: 'Serveur injoignable',
    offlineBody:
      'Vérifier que ComfyUI tourne (port 8188, IP Tailscale) et que Tailscale est actif sur ce téléphone.',
    errorTitle: '✗ Échec — {{node}}',
    tapToDismiss: 'toucher pour masquer',
    noRunning: 'Aucun job en cours',
    pendingSection: 'En attente',
    empty: 'La queue est vide.',
  },
  setup: {
    title: 'Connectez votre serveur ComfyUI',
    subtitle:
      "Komfy a besoin de l'adresse de votre serveur ComfyUI pour fonctionner. Renseignez-la ci-dessous — vous pourrez la modifier plus tard dans les Réglages.",
    urlLabel: 'URL du serveur ComfyUI',
    hint: "IP Tailscale de la machine qui fait tourner ComfyUI (ex. http://100.x.y.z:8188) — la même URL à la maison comme en 4G/5G. N'exposez jamais le port à Internet.",
    save: 'Enregistrer et continuer',
    saveAnyway: 'Enregistrer quand même',
    saveAnywayHint:
      "Le serveur peut être hors ligne pour l'instant — vous pourrez corriger l'URL plus tard dans les Réglages.",
  },
  wf: {
    common: {
      dimensions: 'Dimensions',
      sourceImage: 'Image source',
      threshold: 'Seuil de détection',
      model: 'Modèle',
      modelHint:
        'Modèles de diffusion installés sur le serveur — famille compatible uniquement',
      negativePrompt: 'Prompt négatif',
      lorasHint:
        'Chaînés sur le modèle (LoraLoaderModelOnly), force ~0,9 recommandée',
      turboStepsHint:
        'Turbo : 8 étapes suffisent, au-delà le gain est négligeable',
      stepsHint: '8 pour Turbo, 20–30 pour un checkpoint classique (SDXL…)',
      cfgHint:
        '1 = Turbo (rapide, sans négatif). 4–8 pour un checkpoint classique',
      samplerHint:
        'KREA2 : euler + simple. Checkpoints classiques : essayer dpmpp_2m + karras',
      negativePlaceholder: 'flou, doigts en trop, filigrane…',
      negativeHint:
        'Pris en compte seulement si CFG > 1 (ignoré par les modèles Turbo)',
      needsOllama: 'Nécessite Ollama lancé sur le serveur',
    },
    modelSource: {
      hint: 'N’importe quel checkpoint (autonome), ou un modèle de diffusion avec son propre encodeur CLIP et son VAE',
      checkpoints: 'Checkpoints',
      diffusion: 'Modèles de diffusion',
      checkpointBadge: 'Checkpoint',
      diffusionBadge: 'Diffusion',
      clipType: 'Type d’encodeur CLIP',
      diffusionHint:
        'Un modèle de diffusion a besoin de son encodeur CLIP et de son VAE — présélectionnés d’après le nom, à ajuster si besoin',
    },
    t2i: {
      name: 'Créer une image',
      description:
        'Text-to-image — choisis un checkpoint ou un modèle de diffusion (KREA2 Turbo par défaut)',
    },
    i2i: {
      name: 'Image → Image (KREA2)',
      description: 'Retravaille une image existante — denoise réglable',
      promptPlaceholder: 'Décrire le résultat attendu…',
      denoiseHint: 'Faible = fidèle à la source · 1 = régénération complète',
    },
    edit: {
      name: 'Éditer une image (KREA2)',
      description:
        'Décrit la modification à faire — identité et scène sont préservées, sans masque',
      promptPlaceholder:
        'sa main droite se pose sur la table, rien d’autre ne bouge…',
      promptHint:
        'Décrire la MODIFICATION, pas l’image entière — et préciser ce qui ne doit pas changer',
      lorasHint:
        'Chaînés après le LoRA d’identité — garder les autres légers (~0,4), ils entrent en concurrence avec lui',
      refBoost: 'Fidélité à la source (ref_boost)',
      refBoostHint:
        '1 = neutre. Au-dessus, le résultat colle davantage à l’apparence de la source ; en dessous, il s’en détache — la bonne valeur dépend du modèle',
      canvas: 'Canvas de sortie',
      canvasHint:
        '« Source » garde exactement le cadre de la source (arrondi au multiple de 16 inférieur). 1/2 MP conservent son ratio dans un format plus léger — pour une photo trop grande à générer en taille réelle',
      canvasSource: 'Source',
      canvasManual: 'Manuel',
      formatHint: 'Format de l’image générée — la source y est ajustée',
    },
    ltx: {
      name: 'Image → Vidéo + audio (LTX 2.3)',
      description:
        'Anime une image fixe en court clip avec audio synchronisé — LTX 2.3, deux passes (base puis upscale latent)',
      promptPlaceholder:
        'Décris la scène, le mouvement et le son — ce qui bouge, la caméra, l’ambiance…',
      duration: 'Durée (secondes)',
      durationHint:
        'Durée du clip en secondes (images = durée × FPS + 1). LTX est surtout entraîné autour de ~10 s. Attention : la passe upscale garde en mémoire une matrice d’attention qui croît avec le CARRÉ de résolution × durée — doubler l’un des deux la quadruple. Si le serveur abandonne sur la seconde passe, raccourcis le clip, baisse la résolution, ou relance ComfyUI avec le backend d’attention split',
      fpsHint: 'Fréquence d’images de base gravée dans le clip (LTX par défaut 24)',
      targetFps: 'Fréquence cible (RIFE)',
      targetFpsHint:
        'Fréquence d’images après interpolation RIFE — utilisée seulement si l’interpolation est active',
      firstFrameStrength: 'Force de la première image',
      firstFrameStrengthHint:
        'À quel point l’image de référence ancre les premières images — plus haut colle à la photo mais limite le mouvement',
      audioVolume: 'Volume audio (dB)',
      audioVolumeHint: 'Ajuste l’audio généré : +6 double le volume, −6 le divise par deux',
      model: 'Modèle de diffusion (GGUF)',
      modelHint: 'UNet LTX 2.3 (GGUF) installé sur le serveur',
      clip: 'Encodeur de texte (Gemma)',
      clipHint:
        'Encodeur Gemma-3 pour LTX — garde-le sauf si tu as une variante',
      vae: 'VAE vidéo',
      audioVae: 'VAE audio',
      upscaleModel: 'Modèle d’upscale',
      upscaleModelHint:
        'Modèle ESRGAN pour l’upscale final des images — utilisé seulement si l’upscale final est actif',
      loras: 'LoRAs',
      distilled: 'LoRA distillé',
      distilledHint:
        'Applique le LoRA accélérateur distillé LTX 2.3 sur les deux passes. Désactive-le quand le modèle de diffusion est déjà distillé — le LoRA n’est alors pas chargé du tout',
      distilledOn: 'On',
      distilledOff: 'Off',
      distilledFirst: 'Force distillé — première passe',
      distilledFirstHint: 'Poids du LoRA sur la passe de base (0 = aucun effet)',
      distilledUpscale: 'Force distillé — passe d’upscale',
      distilledUpscaleHint:
        'Poids du LoRA sur la passe d’upscale latent (0 = aucun effet)',
      scheduler: 'Planification d’échantillonnage',
      schedulerHint:
        'Sigmas manuels (calés pour le montage distillé/DMD) ou un BasicScheduler par pas',
      schedulerSigmas: 'Sigmas manuels',
      schedulerSteps: 'Pas (BasicScheduler)',
      upscaleSigmas: 'Sigmas de l’upscale',
      upscaleSigmasHint:
        'Programme de bruit de la seconde passe, du niveau de départ jusqu’à 0. La valeur par défaut (0,92 → 0 en 3 pas) suppose un modèle distillé : si l’upscale sort grisâtre et flou, partez plus bas (ex. 0.65, 0.45, 0.28, 0.14, 0.0) ou ajoutez des pas',
      upscaleSteps: 'Pas de l’upscale',
      upscaleStepsHint:
        'Pas d’échantillonnage de la seconde passe — trop peu de pas à fort débruitage donne une image délavée et pâteuse',
      upscaleDenoise: 'Débruitage de l’upscale',
      upscaleDenoiseHint:
        'Part de la passe de base que l’upscale régénère. ≤ 0,45 affine l’image existante · au-delà il la réinvente et exige plus de pas',
      finalUpscale: 'Upscale final',
      finalUpscaleHint:
        'Passe ESRGAN + redimensionnement des images (→ 1080×1920). Appliquée sur la branche RIFE — active l’interpolation pour t’en servir',
      finalUpscaleOff: 'Off',
      finalUpscaleOn: 'On',
      interpolation: 'Interpolation d’images (RIFE)',
      interpolationHint:
        'RIFE insère des images intermédiaires pour un mouvement plus fluide, lu à la fréquence cible. Off garde les images de base. Dans les deux cas un seul fichier est écrit',
      interpOn: 'RIFE',
      interpOff: 'Off',
      lastFrame: 'Enregistrer la dernière image',
      lastFrameHint:
        'Enregistre aussi la dernière image du clip — utile pour enchaîner des segments (boucle / continuation)',
      lastFrameOff: 'Off',
      lastFrameOn: 'Enregistrer',
    },
    upscale: {
      name: 'Upscale (KREA2)',
      description:
        'Agrandissement non destructif — détails affinés, visages préservés',
      mode: 'Mode',
      modeHint:
        'Génératif = l’upscaler pixel, puis une passe KREA2 qui synthétise de la vraie texture · Sans diffusion = l’upscaler seul, déterministe, zéro dérive d’identité — mais il n’invente aucun détail et amplifie les artefacts existants',
      modeGenerative: 'Génératif (KREA2)',
      modePixel: 'Sans diffusion',
      factor: 'Facteur d’agrandissement',
      factorHint:
        '×2 = largeur et hauteur doublées. Le raffinement se fait tuile par tuile, un facteur plus grand prend juste plus de temps',
      nativeScaleHint:
        'Fraction de l’échelle propre au modèle d’upscale (×4 pour UltraSharp, ×2 pour RealESRGAN_x2plus). Native = la sortie brute du modèle, sans aucun rééchantillonnage',
      scaleNative: 'Native (sans rééchantillonnage)',
      scaleThreeQuarters: '¾ de la native',
      scaleHalf: '½ de la native',
      denoiseHint:
        'Force de la passe de détail KREA2. ≤ 0,25 = ajoute de la texture sans toucher à l’identité · plus haut commence à réinventer',
      promptPlaceholder: 'ex. photo portrait, peau détaillée, netteté…',
      promptHint:
        'Optionnel — décrire brièvement l’image peut guider le détail ajouté',
      upscaler: 'Modèle d’upscale',
      upscalerHint:
        'Upscaler pixel — tout le travail en mode « Sans diffusion », la passe avant le raffinement KREA2 sinon (UltraSharp = plus net, ESRGAN = plus doux)',
      tileSize: 'Taille des tuiles',
      tileSizeHint:
        'Le raffinement se fait tuile par tuile. Plus grand = moins de raccords et visages plus cohérents, mais plus de mémoire par tuile',
    },
    depth: {
      name: 'ControlNet Depth (KREA2)',
      description:
        'Génère depuis un prompt en gardant la structure de profondeur d’une photo source',
      imageHint:
        'Sa carte de profondeur guide la composition — le contenu vient du prompt',
      promptPlaceholder:
        'Décrire la nouvelle scène — elle suivra la composition de la source…',
      channelMode: 'Mode de la carte de profondeur',
      channelModeHint:
        'Niveaux de gris = un seul canal, recommandé pour la profondeur · RVB envoie telles quelles les couleurs du préprocesseur',
      modeGrayscale: 'Niveaux de gris (recommandé)',
      modeRgb: 'RVB',
      strength: 'Force du contrôle',
      strengthHint:
        '≈1 = suit fidèlement la profondeur · baisser pour laisser plus de liberté au prompt',
      depthModel: 'Estimateur de profondeur',
      depthModelHint:
        'Plus grand = carte plus fine et plus stable, mais plus lent (ViT-B est téléchargé par le serveur au premier usage)',
      vits: 'ViT-S — le plus rapide',
      vitb: 'ViT-B — équilibré',
      vitl: 'ViT-L — le meilleur, le plus lent',
      depthResolution: 'Résolution de la carte de profondeur',
      depthResolutionHint:
        'Résolution du calcul de profondeur avant adaptation au format de sortie — plus haut = structures plus fines',
      dimensionsHint:
        'Garder l’orientation de la source (« Inverser » pour portrait) — la carte est recadrée au centre à ce format',
    },
    detectReplace: {
      name: 'Détecter & Remplacer (KREA2)',
      description:
        'Remplace les zones détectées — un même contenu pour toutes, ou un par zone',
      dilation: 'Zone modifiée (autour de la détection)',
      dilationHint:
        'Agrandit la zone régénérée à partir de la zone détectée (en pixels). ~10 = zone serrée · 80–150 = alentours larges. Si la zone est coupée, augmenter le « Cadrage ».',
      thresholdHint:
        'Monter (0,6–0,7) élimine les fausses détections qui décalent les n° de zones ; baisser si une zone n’est pas trouvée',
      cropFactor: 'Cadrage autour de la zone',
      cropFactorHint:
        'Contexte fourni au re-générateur (× la zone détectée). Doit rester assez grand pour contenir la zone dilatée — à augmenter si une grande dilatation est rognée',
      zones: 'Remplacements',
      zonesHint:
        'Un même contenu pour toutes les zones, ou un par zone (numérotées de gauche à droite sur la photo)',
    },
    t2p: {
      name: 'Texte → Prompt',
      description:
        'Gemma-4 développe une idée brute en prompt complet (KREA2, SDXL, Pony…) — résultat texte',
      idea: 'Idée',
      ideaPlaceholder: 'ex. un chat noir cyberpunk sous la pluie…',
      seedHint: 'Re-tirer le seed donne une variante différente',
    },
    i2p: {
      name: 'Image → Prompt',
      description:
        'Gemma-4 décrit l’image en prompt (KREA2, SDXL, Pony…) — résultat texte',
      image: 'Image à décrire',
      instruction: 'Consigne (optionnelle)',
      instructionPlaceholder: 'ex. insister sur la lumière et l’ambiance…',
      instructionHint:
        'Oriente la description de Gemma-4 sans remplacer l’analyse de l’image',
      seedHint: 'Re-tirer le seed donne une description différente',
    },
    style: {
      label: 'Style de prompt',
      hint: 'Conventions du modèle pour lequel le prompt est écrit',
    },
    inpaintDraw: {
      name: 'Inpaint (masque dessiné)',
      description: 'Peindre une zone au doigt et la régénérer',
      mask: 'Zone à régénérer',
      maskHint:
        "Peindre sur l'image — le pinceau marque ce qui sera régénéré",
      promptPlaceholder: 'Ce qui doit apparaître dans la zone peinte…',
      maskMode: 'Méthode de masquage',
      maskModeNoise: 'Masque de bruit',
      maskModeConditioning: 'Conditionnement inpaint',
      maskModeHint:
        'Le masque de bruit fonctionne avec tous les modèles. Le conditionnement fond mieux les bords, mais convient aux modèles entraînés pour l’inpainting',
      area: 'Zone peinte',
      areaRepaint: 'La régénérer',
      areaPreserve: 'La préserver',
      areaHint:
        'Ou inverser : garder le dessin intact et refaire tout le reste',
      grow: 'Élargir',
      growHint:
        'Élargit (ou rétrécit, si négatif) la zone peinte de ce nombre de pixels',
      feather: 'Adoucir',
      featherHint:
        'Adoucit le bord du masque — plus la valeur est haute, plus le fondu est progressif',
      denoiseHint:
        "1 = la zone est entièrement réécrite, moins en conserve une partie de l'original",
      cfgHint:
        'Fidélité au prompt. 1 pour un modèle turbo/distillé, 5–8 sinon',
    },
  },
  model: {
    search: 'Rechercher un modèle…',
    missing: 'Introuvable sur le serveur — choisir un autre fichier',
    noResult: 'Aucun modèle correspondant',
  },
  importWf: {
    card: 'Importer',
    cardDescription: 'Ajouter un workflow depuis son JSON au format API',
    help:
      'Coller un workflow au format API (ComfyUI : Réglages → Dev mode → « Save (API Format) »). L’app détecte les champs réglables ; le graphe lui-même est embarqué tel quel.',
    paste: 'Coller depuis le presse-papiers',
    analyze: 'Analyser',
    invalid:
      'Graphe illisible — exporter au format API (« Save (API Format) »), pas au format éditeur.',
    tooBig: 'Fichier trop volumineux pour un graphe de workflow (max 512 Ko).',
    name: 'Nom',
    defaultName: 'Workflow importé',
    defaultDescription: 'Importé depuis un graphe au format API',
    fields: 'Champs détectés',
    noFields: 'Aucun champ réglable détecté — le workflow sera lancé tel quel.',
    import: 'Importer',
    imported: 'Workflow importé ✓',
    startOver: 'Recommencer',
    deleteTitle: 'Supprimer ce workflow ?',
    deleteBody: '{{name}} sera retiré de l’app. Le serveur n’est pas affecté.',
    customBadge: 'Workflow importé',
    edit: 'Éditer',
  },
  editWf: {
    notFound:
      'Workflow introuvable — seuls les workflows importés sont éditables.',
    fields: 'Champs (libellé, ordre, suppression)',
    addField: 'Ajouter un champ',
    addLoras: 'Champ LoRAs (chaîne modèle détectée)',
    noCandidates:
      'Plus rien à ajouter : chaque input littéral a déjà son champ.',
    saved: 'Workflow mis à jour ✓',
    export: 'Copier le JSON du manifeste (partage)',
    copied: 'Manifeste copié ✓ — à coller dans Importer sur un autre téléphone',
  },
  availability: {
    title: 'Indisponible sur ce serveur',
    missingNodes: 'Nœuds manquants (custom nodes à installer) :\n{{list}}',
    missingModels: 'Modèles ou fichiers manquants :\n{{list}}',
    openAnyway: 'Ouvrir quand même',
  },
  validation: {
    required: 'Champ requis',
    imageRequired: 'Image requise',
    maskRequired: 'Dessiner la zone à régénérer',
    modelRequired: 'Choisir un modèle',
    integerDims: 'Dimensions entières requises',
    dimRange: 'Entre {{min}} et {{max}} px',
    dimStep: 'Multiples de {{step}} requis',
    atLeastOneZone: 'Au moins un remplacement',
    allBypassed: 'Toutes les zones sont en bypass — rien à générer',
    promptRequired: 'Prompt requis pour chaque zone active',
    maxLorasPerZone: 'Maximum {{count}} LoRAs par zone',
    denoiseRange: 'Denoise entre 0,05 et 1 pour chaque zone active',
    stepsRange: 'Steps entre 1 et 30',
    invalidStrength: 'Force invalide',
    invalidNumber: 'Nombre invalide',
    integerExpected: 'Entier attendu',
    min: 'Minimum {{min}}',
    max: 'Maximum {{max}}',
  },
  notif: {
    doneTitle: 'Job terminé ✓',
    doneBody: 'La génération est terminée.',
    failedTitle: 'Job échoué ✗',
  },
  launch: {
    notFound: 'Workflow introuvable',
    applied: 'Réglages appliqués ✓',
    launchFailed: 'Échec du lancement',
    jobQueued: 'Job ajouté à la queue ✓ (#{{number}})',
    jobsQueued: '{{count}} jobs ajoutés à la queue ✓ (#{{number}}…)',
    custom: 'Personnalisé',
    multiplesOf: 'multiples de {{step}}',
    invert: 'Inverser (portrait)',
    imageCount: "Nombre d'images",
    distinctSeeds: 'seeds distincts',
    destination: 'Destination',
    launching: 'Lancement…',
    launchX: 'Lancer ×{{count}}',
    launch: 'Lancer',
    done: 'Terminé',
    sourceSeed: "Seed d'origine {{seed}} — réutiliser",
    sourceSeedActive: "Seed d'origine de l'image réutilisé.",
    sourceSeedA11y: "Réutiliser le seed de l'image d'origine, {{seed}}",
  },
  graph: {
    model: 'Modèle',
    prompt: 'Prompt',
    negative: 'Négatif',
    seed: 'Seed',
    sampling: 'Sampling',
    dimensions: 'Dimensions',
    loras: 'LoRAs ({{count}})',
    nodes: 'Nœuds',
    copied: '{{label}} copié',
    copyA11y: 'Copier le {{label}}',
    nodeCount_one: '{{count}} nœud',
    nodeCount_other: '{{count}} nœuds',
  },
  saveToPhotos: {
    denied: 'Accès à la photothèque refusé (réglages système → Komfy).',
    httpError: 'HTTP {{status}} — fichier indisponible sur le serveur ?',
  },
  status: {
    offline: 'hors ligne',
    connected: 'connecté',
    ws: 'WS…',
  },
  volume: {
    title: '⚠︎ Dossier de sortie indisponible sur le serveur',
    detail:
      'Le dossier output est introuvable — la galerie est indisponible. Nouvelle vérification automatique en cours…',
  },
  wsLog: {
    events_one: '{{count}} événement',
    events_other: '{{count}} événements',
    clear: 'Effacer',
    empty: "En attente d'événements… (lancer un job pour voir le flux)",
  },
  zones: {
    allZonesLabel: 'Même contenu pour toutes les zones',
    allZonesTitle: 'Toutes les zones détectées',
    allZonesNote:
      'Ce contenu remplace toutes les zones trouvées sur la photo, quel qu’en soit le nombre — pas de numérotation, rien à énumérer. Les zones ratées par la détection restent intactes : baisser le « Seuil de détection » pour en attraper davantage.',
    zoneTitle: 'Zone n°{{number}} (gauche → droite)',
    bypassLabel: 'Ne pas modifier cette zone (bypass)',
    bypassNote:
      'Zone conservée telle quelle — aucune passe générée, elle garde son numéro dans l’ordre gauche → droite.',
    promptPlaceholder: 'Contenu de la zone (ex. a man’s face…)',
    denoiseLabel: 'Denoise de cette zone',
    denoiseLabelAll: 'Denoise de chaque zone',
    detailLabel: 'Niveau de détail',
    detailHint:
      'Résolution à laquelle la zone est régénérée. À augmenter (768–1280) pour plus de détail sur les images haute résolution ; plus lent et plus gourmand en VRAM.',
    addZone: 'Ajouter un remplacement',
    maxZones: 'Maximum {{count}} zones',
    steps: 'Steps',
    seed: 'Seed',
    randomSeed: 'aléatoire',
  },
  remix: {
    unknownNote:
      'Workflow inconnu de Komfy — paramètres extraits des métadonnées de l’image (lecture seule).',
    requeue: 'Relancer en variante (nouveaux seeds)',
    import: 'Importer comme workflow…',
  },
  dirPicker: {
    title: 'Dossier de destination',
    confirmVerb: 'Enregistrer dans',
    noSubfolders: 'Aucun sous-dossier ici.',
    newSubfolder: 'Nouveau sous-dossier (optionnel)',
  },
  imageInput: {
    accessDenied: 'Accès refusé',
    accessDeniedBody: "Autoriser l'accès aux photos dans les réglages système.",
    tooLarge: 'Image trop lourde',
    tooLargeBody:
      '{{size}} Mo — la limite est de {{limit}} Mo. Choisir une image plus légère.',
    uploadFailed: 'Upload impossible',
    choose: 'Choisir une image',
  },
  maskInput: {
    needsSource: "Choisir d'abord l'image source",
    draw: 'Dessiner le masque',
    uploadFailed: 'Upload du masque impossible',
  },
  maskEditor: {
    title: 'Peindre la zone',
    paint: 'Pinceau',
    erase: 'Gomme',
    undo: 'Annuler',
    clear: 'Tout effacer',
    fit: 'Recadrer',
    hint: 'Un doigt dessine · deux doigts zooment et déplacent',
  },
  lora: {
    add: 'Ajouter un LoRA',
    fixed: 'Toujours appliqué · ×{{strength}}',
    max: 'Maximum {{count}} LoRAs',
    search: 'Rechercher dans tous les dossiers…',
    listError: 'Impossible de lister les LoRAs (serveur injoignable ?)',
    noResults: 'Aucun résultat',
    emptyDir: 'Dossier vide',
  },
  prompt: {
    copied: 'Prompt copié',
    edit: 'Modifier',
    collapse: 'Réduire',
    showAll: 'Afficher tout',
    placeholder: 'Toucher « Modifier » pour saisir',
    library: 'Bibliothèque',
  },
  prompts: {
    search: 'Rechercher un prompt…',
    empty: 'Aucun prompt sauvegardé',
    emptyHint:
      'Les prompts générés par Image → Prompt arrivent ici tout seuls, et y restent.',
    noMatch: 'Aucun prompt ne correspond à cette recherche',
    use: 'Utiliser ce prompt',
    more: 'Plus d’actions',
    applied: 'Prompt appliqué ✓',
    pending: 'Génération en cours…',
  },
  presets: {
    fallback: 'Réglages',
    title: 'Réglages récents',
    apply: 'Appliquer le réglage : {{label}}',
  },
  viewer: {
    imageUnavailable: 'Image indisponible',
    videoUnavailable: 'Vidéo indisponible',
    unavailableBody: 'Fichier indisponible sur le serveur, ou supprimé.',
    readingRecipe: 'Lecture de la recette…',
    detailsTitle: 'Détails',
    detailsName: 'Nom',
    detailsFolder: 'Dossier',
    detailsDimensions: 'Dimensions',
    detailsDuration: 'Durée',
    detailsSize: 'Poids',
    detailsCreated: 'Création',
    detailsModified: 'Modification',
    detailsNeedsExt:
      "Poids et dates nécessitent l'extension komfy-listing : redémarrer ComfyUI pour la recharger.",
    detailsRecipe: 'Recette',
    detailsRecipeFailed: 'Recette illisible : {{message}}',
  },
  jobDetail: {
    title: 'Job #{{number}}',
    ok: 'OK',
    unknownWorkflow:
      "Workflow inconnu de Komfy — variante impossible depuis l'app (paramètres affichés en lecture seule).",
  },
  job: {
    interruptTitle: 'Interrompre le job ?',
    interruptBody: 'Le job en cours sera arrêté immédiatement.',
    interrupt: 'Interrompre',
    interrupting: 'Interruption…',
    etaRemaining: '~{{eta}} restant',
    preview: 'aperçu',
    previewNode: 'aperçu · nœud {{node}}',
    node: 'nœud {{node}}',
    external: 'lancé hors Komfy — pas de suivi fin',
    expandPreview: "Agrandir l'aperçu",
    livePreviewFinished: 'Génération terminée',
    livePreviewFinishedHint: "L'image finale est maintenant dans la galerie.",
    livePreviewWaiting: 'En attente du prochain aperçu…',
    previewTimeline: 'Timeline des aperçus',
    live: 'LIVE',
  },
  gallery: {
    updateExtTitle: 'Extension à mettre à jour',
    updateExtBody:
      'La route « {{action}} » manque côté serveur : redémarrer ComfyUI pour recharger komfy-listing.',
    actionFailedTitle: '{{action}} impossible',
    actionDelete: 'Suppression',
    actionMove: 'Déplacement',
    actionMkdir: 'Création du dossier',
    partialDelete: 'Suppression partielle',
    partialMove: 'Déplacement partiel',
    root: 'racine',
    uploadedToast_one: '{{count}} image envoyée dans input ✓',
    uploadedToast_other: '{{count}} images envoyées dans input ✓',
    trashToast: '{{label}} → corbeille ✓',
    movedToast: '{{label}} → {{dest}} ✓',
    folderCreated: 'Dossier {{path}}/ créé ✓',
    deleteTitle: 'Supprimer {{label}} ?',
    deleteBody: 'Déplacé vers la corbeille sur le serveur (récupérable).',
    remixAction: 'Recréer une variante',
    saveToPhotos: 'Enregistrer dans Photos',
    saveFailed: 'Enregistrement impossible',
    noMetadataTitle: 'Image sans métadonnées ComfyUI',
    noMetadataBody:
      "Impossible d'en extraire la recette (chunk `prompt` absent — image retouchée ou importée ?).",
    extractFailed: 'Extraction impossible',
    unavailable: 'Galerie indisponible',
    volumeBody:
      'Le dossier de sortie est indisponible sur le serveur. Nouvelle vérification automatique en cours…',
    selectAll: 'Tout sélectionner',
    deselectAll: 'Tout désélectionner',
    select: 'Sélectionner',
    empty: "Aucune image ici pour l'instant.",
    emptyLimited:
      "\n(Listing limité à la session ComfyUI en cours — redémarrer ComfyUI pour activer l'extension komfy-listing.)",
    selectedCount_one: '{{count}} sélectionné',
    selectedCount_other: '{{count}} sélectionnés',
    save: 'Enregistrer dans Photos',
    savedCount_one: '{{count}} image enregistrée dans Photos ✓',
    savedCount_other: '{{count}} images enregistrées dans Photos ✓',
    move: 'Déplacer',
    itemCount_one: '{{count}} élément',
    itemCount_other: '{{count}} éléments',
    moveTo: 'Déplacer vers',
    newFolderTitle: 'Créer un dossier',
    createFolder: 'Créer le dossier',
    requeueFailed: 'Relance impossible',
    variantQueued: 'Variante ajoutée à la queue ✓ (#{{number}})',
  },
  supervisor: {
    title: 'Alimentation serveur',
    unreachable: 'Serveur injoignable',
    unreachableHint:
      'La machine est éteinte, ou Tailscale est coupé. Rien à démarrer à distance.',
    off: 'ComfyUI est éteint',
    offHint: 'La machine est allumée — vous pouvez démarrer ComfyUI à distance.',
    on: 'ComfyUI est en marche',
    onHint: 'Joignable et prêt à générer.',
    starting: 'Démarrage de ComfyUI…',
    checking: 'Vérification…',
    turnOn: 'Allumer',
    turnOff: 'Éteindre',
    turnOffTitle: 'Éteindre ComfyUI ?',
    turnOffBody: 'Le serveur va s’arrêter. Tout job en cours est perdu.',
    startFailed: 'Impossible de démarrer ComfyUI',
    stopFailed: 'Impossible d’arrêter ComfyUI',
    alreadyRunning: 'ComfyUI tourne déjà.',
    needsToken: 'Ajoutez le token du superviseur pour piloter le serveur.',
    notConfigured:
      'Renseignez l’URL et le token du superviseur (ou scannez le QR d’appairage) pour activer l’allumage distant.',
    supervisorUrl: 'URL du superviseur',
    supervisorUrlHint:
      'Vide = déduite de l’URL serveur (même hôte, port 8189).',
    token: 'Token du superviseur',
    tokenHint: 'Imprimé par `npm run pair` sur le serveur.',
    openConsole: 'Console en direct →',
  },
  console: {
    title: 'Console ComfyUI',
    empty: 'Aucune sortie — démarrez ComfyUI pour voir ses logs.',
    connecting: 'Connexion au superviseur…',
    disconnected: 'Console déconnectée — reconnexion…',
    clear: 'Effacer',
    lines_one: '{{count}} ligne',
    lines_other: '{{count}} lignes',
    needsConfig:
      'Renseignez d’abord l’URL et le token du superviseur dans les Réglages.',
  },
  pairing: {
    scan: 'Scanner le QR',
    paste: 'Coller le code',
    scanTitle: 'Scannez le QR d’appairage',
    scanHint:
      'Lancez `npm run pair` sur le serveur, puis visez le QR avec la caméra.',
    cameraDenied: 'Accès caméra désactivé — activez-le dans les réglages système.',
    grantCamera: 'Autoriser la caméra',
    invalid: 'Code d’appairage Komfy invalide.',
    pasteEmpty: 'Le presse-papier est vide.',
    applied: 'Appairage appliqué ✓',
  },
  settings: {
    serverUrl: 'URL du serveur ComfyUI',
    serverHint:
      "IP Tailscale du serveur — une seule URL, à la maison comme en 4G/5G. Jamais d'exposition internet.",
    test: 'Tester la connexion',
    saved: 'Enregistré ✓',
    testOk: '✓ ComfyUI {{version}} répond',
    previews: 'Aperçus du sampler',
    previewsHint:
      'Image en cours de génération sur la carte du job (nécessite `--preview-method auto` côté ComfyUI)',
    loraMax: 'LoRAs par champ',
    loraMaxHint:
      'Limite le nombre de LoRAs par champ, dans tous les workflows (Détecter & Remplacer : par zone). Désactivé = aucune limite.',
    loraMaxValue: 'Maximum',
    trashTitle: 'Corbeille',
    trashEmptyState: 'Vide — rien à supprimer.',
    trashSummary_one: '{{count}} fichier · {{size}}',
    trashSummary_other: '{{count}} fichiers · {{size}}',
    trashEmpty: 'Vider',
    trashConfirmTitle: 'Vider la corbeille ?',
    trashConfirmBody_one:
      'Supprime définitivement {{count}} fichier ({{size}}) de output/ et input/. Action irréversible.',
    trashConfirmBody_other:
      'Supprime définitivement {{count}} fichiers ({{size}}) de output/ et input/. Action irréversible.',
    trashEmptied_one: 'Corbeille vidée — {{count}} fichier, {{size}} libéré ✓',
    trashEmptied_other:
      'Corbeille vidée — {{count}} fichiers, {{size}} libérés ✓',
    trashEmptyFailed: 'Impossible de vider la corbeille',
    wsLog: 'Journal des événements WebSocket →',
    language: 'Langue',
  },
};
