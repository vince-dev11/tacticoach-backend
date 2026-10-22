// ONBOARDING-EMAIL (20 Oct 2026) · the onboarding emails in the coach's own
// language: the invitation (and its two reminders), the welcome, the
// verification link and the personal "we'll show you round" message.
//
// Why these and not every email: these are the ones a coach must act on to get
// in at all. Of the coaches invited on 10–19 Oct, 11 of 12 never opened their
// English invitation; most early-access requests come from Spanish-,
// Portuguese- and German-speaking coaches. The rest (receipts, admin mail)
// stay English for now.
//
// The languages are the app's own seven; anything else (or none) is English.
// Copy is plain text with {placeholders}; emails.ts escapes and lays it out.

export const EMAIL_LOCALES = ['en', 'de', 'es', 'fr', 'it', 'pt', 'tr'] as const
export type EmailLocale = (typeof EMAIL_LOCALES)[number]

/** 'en-US' → 'en', 'pt-BR' → 'pt', anything unknown → 'en'. */
export function emailLocale(locale: string | null | undefined): EmailLocale {
  const base = (locale ?? '').trim().toLowerCase().split(/[-_]/)[0]
  return (EMAIL_LOCALES as readonly string[]).includes(base) ? (base as EmailLocale) : 'en'
}

/** Fill {name}-style placeholders. */
export function fillIn(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

export interface EmailCopy {
  footer: string
  orPaste: string
  signoff: string
  setup: { subject: string; kicker: string; h1: string; body: string; cta: string; valid: string; ignore: string }
  reminder1: { subject: string; kicker: string; h1: string; body: string }
  reminder2: { subject: string; kicker: string; h1: string; body: string }
  welcome: { subject: string; kicker: string; h1: string; body: string; planTitle: string; step1: string; step2: string; step3: string; verify: string; verifyCta: string; dashboardCta: string }
  activated: { subject: string; kicker: string; h1: string; body: string; step1: string; step2: string; step3: string; cta: string; help: string }
  verification: { subject: string; kicker: string; h1: string; body: string; cta: string; ignore: string }
  personal: { subject: string; hi: string; intro: string; video: string; videoCta: string; noVideo: string; setupFirst: string; setupCta: string; openCta: string; question: string; reply: string }
}

const en: EmailCopy = {
  footer: 'You’re receiving this because you have a TactiCoach account.',
  orPaste: 'Or paste this link into your browser:',
  signoff: 'Happy coaching!\nThe TactiCoach team',
  setup: {
    subject: 'Your TactiCoach account is ready',
    kicker: 'YOUR ACCOUNT',
    h1: 'Your account is ready ⚽',
    body: 'Hi {name}, we’ve set up your TactiCoach account, as you asked. Choose your password to get started.',
    cta: 'Choose your password',
    valid: 'The link works for 7 days.',
    ignore: 'If you weren’t expecting this, you can ignore this email — the account can’t be used until a password is set.',
  },
  reminder1: {
    subject: 'Your TactiCoach account is waiting for you',
    kicker: 'A QUICK REMINDER',
    h1: 'Your board is ready when you are',
    body: 'Hi {name}, we set up your TactiCoach account two days ago. One click to choose a password, and you can have your first session on the board in five minutes.',
  },
  reminder2: {
    subject: 'Last reminder: your TactiCoach account',
    kicker: 'LAST REMINDER',
    h1: 'Still want to try TactiCoach?',
    body: 'Hi {name}, this is our last reminder. The link below is new and works for another 7 days. If now isn’t the right time, no problem — just reply and we’ll set it up again later.',
  },
  welcome: {
    subject: 'Welcome to TactiCoach — your 14-day free trial has started',
    kicker: 'WELCOME TO THE SQUAD',
    h1: 'You’re on the team sheet, {name} ✅',
    body: 'Your 14-day free trial has started: 3 boards, 3 drill sheets, 3 sessions, a season plan and a book to write, with animation and up to 3 videos. After 14 days your work stays in your library.',
    planTitle: 'YOUR KICK-OFF PLAN',
    step1: 'One click puts a full team on the board',
    step2: 'Drag the runs — every movement becomes an animation',
    step3: 'Send the video to your team’s group chat',
    verify: 'Please verify your email address:',
    verifyCta: 'Verify my email',
    dashboardCta: 'Open TactiCoach',
  },
  activated: {
    subject: 'You’re in — your first five minutes on TactiCoach',
    kicker: 'YOU’RE IN',
    h1: 'Welcome, {name} ⚽',
    body: 'Your password is set and your account is ready. Here is the quickest way to see what TactiCoach does:',
    step1: 'Open your dashboard and choose your format (5v5, 7v7, 9v9 or 11v11) under “Build my first session”.',
    step2: 'Open the board and press play — the practice moves.',
    step3: 'Drag one player somewhere new and press play again. That’s the whole idea.',
    cta: 'Open TactiCoach',
    help: 'Stuck on anything? Just reply to this email — a person reads every reply.',
  },
  verification: {
    subject: 'Verify your TactiCoach email address',
    kicker: 'ONE QUICK CHECK',
    h1: 'Verify your email ✉️',
    body: 'Hi {name}, confirm this email address for your TactiCoach account. The link works for 24 hours.',
    cta: 'Verify my email',
    ignore: 'If you didn’t ask for this, you can ignore this email.',
  },
  personal: {
    subject: '{sender} from TactiCoach — let’s get you started',
    hi: 'Hi {name},',
    intro: 'I’m {sender} from TactiCoach. Thanks for asking to try it — I’d like to show you round properly.',
    video: 'Here’s a 60-second video of the board in action:',
    videoCta: 'Watch the 60-second tour',
    noVideo: 'The quickest way to see it: open TactiCoach, choose your format under “Build my first session” and press play.',
    setupFirst: 'First, choose your password — your account is ready:',
    setupCta: 'Choose your password',
    openCta: 'Open TactiCoach',
    question: 'One question: what session are you running this week? Tell me and I’ll help you build it.',
    reply: 'Just reply to this email — it comes straight to me.',
  },
}

const de: EmailCopy = {
  footer: 'Du erhältst diese E-Mail, weil du ein TactiCoach-Konto hast.',
  orPaste: 'Oder kopiere diesen Link in deinen Browser:',
  signoff: 'Viel Spaß beim Training!\nDein TactiCoach-Team',
  setup: {
    subject: 'Dein TactiCoach-Konto ist bereit',
    kicker: 'DEIN KONTO',
    h1: 'Dein Konto ist bereit ⚽',
    body: 'Hallo {name}, wie gewünscht haben wir dein TactiCoach-Konto eingerichtet. Wähle dein Passwort, um loszulegen.',
    cta: 'Passwort wählen',
    valid: 'Der Link ist 7 Tage gültig.',
    ignore: 'Wenn du damit nicht gerechnet hast, kannst du diese E-Mail ignorieren – ohne Passwort kann das Konto nicht genutzt werden.',
  },
  reminder1: {
    subject: 'Dein TactiCoach-Konto wartet auf dich',
    kicker: 'KURZE ERINNERUNG',
    h1: 'Dein Board ist bereit, wenn du es bist',
    body: 'Hallo {name}, vor zwei Tagen haben wir dein TactiCoach-Konto eingerichtet. Ein Klick, um ein Passwort zu wählen, und in fünf Minuten steht deine erste Einheit auf dem Board.',
  },
  reminder2: {
    subject: 'Letzte Erinnerung: dein TactiCoach-Konto',
    kicker: 'LETZTE ERINNERUNG',
    h1: 'Möchtest du TactiCoach noch ausprobieren?',
    body: 'Hallo {name}, das ist unsere letzte Erinnerung. Der Link unten ist neu und weitere 7 Tage gültig. Wenn es gerade nicht passt, kein Problem – antworte einfach, dann richten wir es später neu ein.',
  },
  welcome: {
    subject: 'Willkommen bei TactiCoach – deine 14-tägige Testphase hat begonnen',
    kicker: 'WILLKOMMEN IM TEAM',
    h1: 'Du stehst auf dem Spielberichtsbogen, {name} ✅',
    body: 'Deine 14-tägige Testphase hat begonnen: 3 Boards, 3 Übungsblätter, 3 Einheiten, ein Saisonplan und ein Buch zum Schreiben, mit Animation und bis zu 3 Videos. Nach 14 Tagen bleibt deine Arbeit in deiner Bibliothek.',
    planTitle: 'DEIN ANSTOSS-PLAN',
    step1: 'Ein Klick stellt eine ganze Mannschaft aufs Board',
    step2: 'Zieh die Laufwege – jede Bewegung wird zur Animation',
    step3: 'Schick das Video in den Gruppenchat deiner Mannschaft',
    verify: 'Bitte bestätige deine E-Mail-Adresse:',
    verifyCta: 'E-Mail bestätigen',
    dashboardCta: 'TactiCoach öffnen',
  },
  activated: {
    subject: 'Du bist drin – deine ersten fünf Minuten mit TactiCoach',
    kicker: 'DU BIST DRIN',
    h1: 'Willkommen, {name} ⚽',
    body: 'Dein Passwort ist gesetzt und dein Konto ist bereit. So siehst du am schnellsten, was TactiCoach kann:',
    step1: 'Öffne dein Dashboard und wähle unter „Meine erste Einheit bauen“ dein Format (5 gegen 5, 7 gegen 7, 9 gegen 9 oder 11 gegen 11).',
    step2: 'Öffne das Board und drück auf Abspielen – die Übung bewegt sich.',
    step3: 'Zieh einen Spieler an eine neue Stelle und spiel es noch einmal ab. Das ist die ganze Idee.',
    cta: 'TactiCoach öffnen',
    help: 'Hängst du irgendwo fest? Antworte einfach auf diese E-Mail – ein Mensch liest jede Antwort.',
  },
  verification: {
    subject: 'Bestätige deine E-Mail-Adresse für TactiCoach',
    kicker: 'KURZE PRÜFUNG',
    h1: 'Bestätige deine E-Mail ✉️',
    body: 'Hallo {name}, bestätige diese E-Mail-Adresse für dein TactiCoach-Konto. Der Link ist 24 Stunden gültig.',
    cta: 'E-Mail bestätigen',
    ignore: 'Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren.',
  },
  personal: {
    subject: '{sender} von TactiCoach – lass uns loslegen',
    hi: 'Hallo {name},',
    intro: 'ich bin {sender} von TactiCoach. Danke, dass du es ausprobieren möchtest – ich zeige dir gern alles in Ruhe.',
    video: 'Hier ist ein 60-Sekunden-Video vom Board in Aktion:',
    videoCta: 'Die 60-Sekunden-Tour ansehen',
    noVideo: 'Am schnellsten siehst du es so: Öffne TactiCoach, wähle unter „Meine erste Einheit bauen“ dein Format und drück auf Abspielen.',
    setupFirst: 'Wähle zuerst dein Passwort – dein Konto ist bereit:',
    setupCta: 'Passwort wählen',
    openCta: 'TactiCoach öffnen',
    question: 'Eine Frage: Welche Einheit planst du diese Woche? Schreib es mir, und ich helfe dir, sie zu bauen.',
    reply: 'Antworte einfach auf diese E-Mail – sie kommt direkt bei mir an.',
  },
}

const es: EmailCopy = {
  footer: 'Recibes este correo porque tienes una cuenta de TactiCoach.',
  orPaste: 'O pega este enlace en tu navegador:',
  signoff: '¡Buenos entrenamientos!\nEl equipo de TactiCoach',
  setup: {
    subject: 'Tu cuenta de TactiCoach está lista',
    kicker: 'TU CUENTA',
    h1: 'Tu cuenta está lista ⚽',
    body: 'Hola {name}, hemos creado tu cuenta de TactiCoach, como nos pediste. Elige tu contraseña para empezar.',
    cta: 'Elegir mi contraseña',
    valid: 'El enlace funciona durante 7 días.',
    ignore: 'Si no esperabas este correo, puedes ignorarlo: la cuenta no se puede usar hasta que se elija una contraseña.',
  },
  reminder1: {
    subject: 'Tu cuenta de TactiCoach te está esperando',
    kicker: 'UN RECORDATORIO',
    h1: 'Tu pizarra está lista cuando tú lo estés',
    body: 'Hola {name}, hace dos días creamos tu cuenta de TactiCoach. Un clic para elegir una contraseña y en cinco minutos tendrás tu primera sesión en la pizarra.',
  },
  reminder2: {
    subject: 'Último recordatorio: tu cuenta de TactiCoach',
    kicker: 'ÚLTIMO RECORDATORIO',
    h1: '¿Todavía quieres probar TactiCoach?',
    body: 'Hola {name}, este es nuestro último recordatorio. El enlace de abajo es nuevo y funciona otros 7 días. Si ahora no es buen momento, no pasa nada: respóndenos y la preparamos más adelante.',
  },
  welcome: {
    subject: 'Te damos la bienvenida a TactiCoach: tu prueba gratuita de 14 días ha empezado',
    kicker: 'YA ERES DEL EQUIPO',
    h1: 'Ya estás en la convocatoria, {name} ✅',
    body: 'Tu prueba gratuita de 14 días ha empezado: 3 pizarras, 3 fichas de ejercicios, 3 sesiones, un plan de temporada y un libro para escribir, con animación y hasta 3 vídeos. Después de 14 días, tu trabajo se queda en tu biblioteca.',
    planTitle: 'TU PLAN DE SAQUE INICIAL',
    step1: 'Un clic pone un equipo completo en la pizarra',
    step2: 'Arrastra los desmarques: cada movimiento se convierte en animación',
    step3: 'Envía el vídeo al grupo de tu equipo',
    verify: 'Confirma tu dirección de correo:',
    verifyCta: 'Confirmar mi correo',
    dashboardCta: 'Abrir TactiCoach',
  },
  activated: {
    subject: 'Ya estás dentro: tus primeros cinco minutos en TactiCoach',
    kicker: 'YA ESTÁS DENTRO',
    h1: 'Te damos la bienvenida, {name} ⚽',
    body: 'Tu contraseña está lista y tu cuenta también. Esta es la forma más rápida de ver lo que hace TactiCoach:',
    step1: 'Abre tu panel y elige tu formato (fútbol 5, 7, 9 u 11) en «Crear mi primera sesión».',
    step2: 'Abre la pizarra y pulsa reproducir: el ejercicio se mueve.',
    step3: 'Arrastra un jugador a otro sitio y vuelve a reproducir. Esa es toda la idea.',
    cta: 'Abrir TactiCoach',
    help: '¿Te atascas en algo? Responde a este correo: una persona lee cada respuesta.',
  },
  verification: {
    subject: 'Confirma tu correo de TactiCoach',
    kicker: 'UNA COMPROBACIÓN RÁPIDA',
    h1: 'Confirma tu correo ✉️',
    body: 'Hola {name}, confirma esta dirección de correo para tu cuenta de TactiCoach. El enlace funciona durante 24 horas.',
    cta: 'Confirmar mi correo',
    ignore: 'Si no lo has pedido tú, puedes ignorar este correo.',
  },
  personal: {
    subject: '{sender}, de TactiCoach: empecemos',
    hi: 'Hola {name}:',
    intro: 'Soy {sender}, de TactiCoach. Gracias por querer probarlo; me gustaría enseñártelo bien.',
    video: 'Aquí tienes un vídeo de 60 segundos con la pizarra en acción:',
    videoCta: 'Ver el recorrido de 60 segundos',
    noVideo: 'La forma más rápida de verlo: abre TactiCoach, elige tu formato en «Crear mi primera sesión» y pulsa reproducir.',
    setupFirst: 'Primero, elige tu contraseña; tu cuenta ya está lista:',
    setupCta: 'Elegir mi contraseña',
    openCta: 'Abrir TactiCoach',
    question: 'Una pregunta: ¿qué sesión vas a hacer esta semana? Cuéntamelo y te ayudo a montarla.',
    reply: 'Solo tienes que responder a este correo: me llega directamente a mí.',
  },
}

const fr: EmailCopy = {
  footer: 'Vous recevez cet e-mail parce que vous avez un compte TactiCoach.',
  orPaste: 'Ou collez ce lien dans votre navigateur :',
  signoff: 'Bonnes séances !\nL’équipe TactiCoach',
  setup: {
    subject: 'Votre compte TactiCoach est prêt',
    kicker: 'VOTRE COMPTE',
    h1: 'Votre compte est prêt ⚽',
    body: 'Bonjour {name}, nous avons créé votre compte TactiCoach, comme vous l’avez demandé. Choisissez votre mot de passe pour commencer.',
    cta: 'Choisir mon mot de passe',
    valid: 'Le lien est valable 7 jours.',
    ignore: 'Si vous n’attendiez pas cet e-mail, vous pouvez l’ignorer : le compte ne peut pas être utilisé tant qu’aucun mot de passe n’est choisi.',
  },
  reminder1: {
    subject: 'Votre compte TactiCoach vous attend',
    kicker: 'PETIT RAPPEL',
    h1: 'Votre tableau est prêt quand vous l’êtes',
    body: 'Bonjour {name}, nous avons créé votre compte TactiCoach il y a deux jours. Un clic pour choisir un mot de passe, et votre première séance est sur le tableau en cinq minutes.',
  },
  reminder2: {
    subject: 'Dernier rappel : votre compte TactiCoach',
    kicker: 'DERNIER RAPPEL',
    h1: 'Toujours envie d’essayer TactiCoach ?',
    body: 'Bonjour {name}, ceci est notre dernier rappel. Le lien ci-dessous est nouveau et valable 7 jours de plus. Si ce n’est pas le bon moment, aucun souci : répondez simplement et nous le remettrons en place plus tard.',
  },
  welcome: {
    subject: 'Bienvenue sur TactiCoach : votre essai gratuit de 14 jours a commencé',
    kicker: 'BIENVENUE DANS L’ÉQUIPE',
    h1: 'Vous êtes sur la feuille de match, {name} ✅',
    body: 'Votre essai gratuit de 14 jours a commencé : 3 tableaux, 3 fiches d’exercices, 3 séances, un plan de saison et un livre à écrire, avec l’animation et jusqu’à 3 vidéos. Après 14 jours, votre travail reste dans votre bibliothèque.',
    planTitle: 'VOTRE PLAN DE COUP D’ENVOI',
    step1: 'Un clic place une équipe complète sur le tableau',
    step2: 'Glissez les courses : chaque mouvement devient une animation',
    step3: 'Envoyez la vidéo dans le groupe de votre équipe',
    verify: 'Merci de confirmer votre adresse e-mail :',
    verifyCta: 'Confirmer mon e-mail',
    dashboardCta: 'Ouvrir TactiCoach',
  },
  activated: {
    subject: 'C’est parti : vos cinq premières minutes sur TactiCoach',
    kicker: 'C’EST PARTI',
    h1: 'Bienvenue, {name} ⚽',
    body: 'Votre mot de passe est choisi et votre compte est prêt. Voici le moyen le plus rapide de voir ce que fait TactiCoach :',
    step1: 'Ouvrez votre tableau de bord et choisissez votre format (foot à 5, 7, 9 ou 11) dans « Créer ma première séance ».',
    step2: 'Ouvrez le tableau et appuyez sur lecture : l’exercice s’anime.',
    step3: 'Déplacez un joueur et relancez la lecture. C’est toute l’idée.',
    cta: 'Ouvrir TactiCoach',
    help: 'Un blocage ? Répondez simplement à cet e-mail : une vraie personne lit chaque réponse.',
  },
  verification: {
    subject: 'Confirmez votre adresse e-mail TactiCoach',
    kicker: 'UNE PETITE VÉRIFICATION',
    h1: 'Confirmez votre e-mail ✉️',
    body: 'Bonjour {name}, confirmez cette adresse e-mail pour votre compte TactiCoach. Le lien est valable 24 heures.',
    cta: 'Confirmer mon e-mail',
    ignore: 'Si vous n’avez rien demandé, vous pouvez ignorer cet e-mail.',
  },
  personal: {
    subject: '{sender} de TactiCoach : on commence ?',
    hi: 'Bonjour {name},',
    intro: 'Je suis {sender}, de TactiCoach. Merci de vouloir l’essayer : j’aimerais vous le présenter comme il faut.',
    video: 'Voici une vidéo de 60 secondes du tableau en action :',
    videoCta: 'Voir la visite de 60 secondes',
    noVideo: 'Le plus rapide pour le voir : ouvrez TactiCoach, choisissez votre format dans « Créer ma première séance » et appuyez sur lecture.',
    setupFirst: 'D’abord, choisissez votre mot de passe : votre compte est prêt.',
    setupCta: 'Choisir mon mot de passe',
    openCta: 'Ouvrir TactiCoach',
    question: 'Une question : quelle séance préparez-vous cette semaine ? Dites-le-moi et je vous aide à la construire.',
    reply: 'Répondez simplement à cet e-mail : il m’arrive directement.',
  },
}

const it: EmailCopy = {
  footer: 'Ricevi questa e-mail perché hai un account TactiCoach.',
  orPaste: 'Oppure incolla questo link nel browser:',
  signoff: 'Buon allenamento!\nIl team di TactiCoach',
  setup: {
    subject: 'Il tuo account TactiCoach è pronto',
    kicker: 'IL TUO ACCOUNT',
    h1: 'Il tuo account è pronto ⚽',
    body: 'Ciao {name}, abbiamo creato il tuo account TactiCoach, come ci hai chiesto. Scegli la password per iniziare.',
    cta: 'Scegli la password',
    valid: 'Il link vale 7 giorni.',
    ignore: 'Se non ti aspettavi questa e-mail puoi ignorarla: l’account non si può usare finché non viene scelta una password.',
  },
  reminder1: {
    subject: 'Il tuo account TactiCoach ti aspetta',
    kicker: 'UN PROMEMORIA',
    h1: 'La tua lavagna è pronta quando lo sei tu',
    body: 'Ciao {name}, due giorni fa abbiamo creato il tuo account TactiCoach. Un clic per scegliere una password e in cinque minuti hai la tua prima seduta sulla lavagna.',
  },
  reminder2: {
    subject: 'Ultimo promemoria: il tuo account TactiCoach',
    kicker: 'ULTIMO PROMEMORIA',
    h1: 'Vuoi ancora provare TactiCoach?',
    body: 'Ciao {name}, questo è il nostro ultimo promemoria. Il link qui sotto è nuovo e vale altri 7 giorni. Se non è il momento giusto, nessun problema: rispondi e lo prepariamo più avanti.',
  },
  welcome: {
    subject: 'Ti diamo il benvenuto su TactiCoach: la tua prova gratuita di 14 giorni è iniziata',
    kicker: 'SEI DELLA SQUADRA',
    h1: 'Sei in distinta, {name} ✅',
    body: 'La tua prova gratuita di 14 giorni è iniziata: 3 lavagne, 3 schede esercizi, 3 sedute, un piano stagionale e un libro da scrivere, con animazione e fino a 3 video. Dopo 14 giorni il tuo lavoro resta nella tua libreria.',
    planTitle: 'IL TUO PIANO DI CALCIO D’INIZIO',
    step1: 'Un clic mette una squadra intera sulla lavagna',
    step2: 'Trascina i movimenti: ogni spostamento diventa animazione',
    step3: 'Manda il video nel gruppo della squadra',
    verify: 'Conferma il tuo indirizzo e-mail:',
    verifyCta: 'Conferma la mia e-mail',
    dashboardCta: 'Apri TactiCoach',
  },
  activated: {
    subject: 'Ci sei: i tuoi primi cinque minuti su TactiCoach',
    kicker: 'CI SEI',
    h1: 'Ti diamo il benvenuto, {name} ⚽',
    body: 'La password è impostata e l’account è pronto. Ecco il modo più veloce per vedere cosa fa TactiCoach:',
    step1: 'Apri la dashboard e scegli il tuo formato (calcio a 5, 7, 9 o 11) in «Crea la mia prima seduta».',
    step2: 'Apri la lavagna e premi play: l’esercitazione si muove.',
    step3: 'Sposta un giocatore e premi di nuovo play. È tutta qui l’idea.',
    cta: 'Apri TactiCoach',
    help: 'Ti sei bloccato? Rispondi a questa e-mail: una persona legge ogni risposta.',
  },
  verification: {
    subject: 'Conferma la tua e-mail TactiCoach',
    kicker: 'UN CONTROLLO VELOCE',
    h1: 'Conferma la tua e-mail ✉️',
    body: 'Ciao {name}, conferma questo indirizzo e-mail per il tuo account TactiCoach. Il link vale 24 ore.',
    cta: 'Conferma la mia e-mail',
    ignore: 'Se non l’hai richiesto tu, puoi ignorare questa e-mail.',
  },
  personal: {
    subject: '{sender} di TactiCoach: iniziamo',
    hi: 'Ciao {name},',
    intro: 'sono {sender} di TactiCoach. Grazie per volerlo provare: vorrei mostrartelo per bene.',
    video: 'Ecco un video di 60 secondi con la lavagna in azione:',
    videoCta: 'Guarda il tour di 60 secondi',
    noVideo: 'Il modo più veloce per vederlo: apri TactiCoach, scegli il tuo formato in «Crea la mia prima seduta» e premi play.',
    setupFirst: 'Prima di tutto scegli la password: il tuo account è pronto.',
    setupCta: 'Scegli la password',
    openCta: 'Apri TactiCoach',
    question: 'Una domanda: che seduta farai questa settimana? Dimmelo e ti aiuto a costruirla.',
    reply: 'Basta rispondere a questa e-mail: arriva direttamente a me.',
  },
}

const pt: EmailCopy = {
  footer: 'Recebes este e-mail porque tens uma conta TactiCoach.',
  orPaste: 'Ou cola este link no teu navegador:',
  signoff: 'Bons treinos!\nA equipa TactiCoach',
  setup: {
    subject: 'A tua conta TactiCoach está pronta',
    kicker: 'A TUA CONTA',
    h1: 'A tua conta está pronta ⚽',
    body: 'Olá {name}, criámos a tua conta TactiCoach, como pediste. Escolhe a tua palavra-passe para começar.',
    cta: 'Escolher palavra-passe',
    valid: 'O link funciona durante 7 dias.',
    ignore: 'Se não estavas à espera deste e-mail, podes ignorá-lo: a conta não pode ser usada até ser escolhida uma palavra-passe.',
  },
  reminder1: {
    subject: 'A tua conta TactiCoach está à tua espera',
    kicker: 'UM LEMBRETE',
    h1: 'O teu quadro está pronto quando estiveres',
    body: 'Olá {name}, criámos a tua conta TactiCoach há dois dias. Um clique para escolher uma palavra-passe e em cinco minutos tens o teu primeiro treino no quadro.',
  },
  reminder2: {
    subject: 'Último lembrete: a tua conta TactiCoach',
    kicker: 'ÚLTIMO LEMBRETE',
    h1: 'Ainda queres experimentar o TactiCoach?',
    body: 'Olá {name}, este é o nosso último lembrete. O link abaixo é novo e funciona mais 7 dias. Se agora não é a altura certa, não há problema: responde e preparamos tudo mais tarde.',
  },
  welcome: {
    subject: 'Boas-vindas ao TactiCoach: o teu teste gratuito de 14 dias começou',
    kicker: 'JÁ ÉS DA EQUIPA',
    h1: 'Já estás na convocatória, {name} ✅',
    body: 'O teu teste gratuito de 14 dias começou: 3 quadros, 3 fichas de exercícios, 3 treinos, um plano de época e um livro para escrever, com animação e até 3 vídeos. Depois de 14 dias, o teu trabalho fica na tua biblioteca.',
    planTitle: 'O TEU PLANO DE PONTAPÉ DE SAÍDA',
    step1: 'Um clique põe uma equipa completa no quadro',
    step2: 'Arrasta as movimentações: cada movimento vira animação',
    step3: 'Envia o vídeo para o grupo da tua equipa',
    verify: 'Confirma o teu endereço de e-mail:',
    verifyCta: 'Confirmar o meu e-mail',
    dashboardCta: 'Abrir o TactiCoach',
  },
  activated: {
    subject: 'Já estás dentro: os teus primeiros cinco minutos no TactiCoach',
    kicker: 'JÁ ESTÁS DENTRO',
    h1: 'Boas-vindas, {name} ⚽',
    body: 'A tua palavra-passe está definida e a conta está pronta. Esta é a forma mais rápida de ver o que o TactiCoach faz:',
    step1: 'Abre o teu painel e escolhe o teu formato (futebol de 5, 7, 9 ou 11) em «Criar o meu primeiro treino».',
    step2: 'Abre o quadro e carrega em reproduzir: o exercício mexe-se.',
    step3: 'Arrasta um jogador para outro sítio e reproduz outra vez. É essa a ideia.',
    cta: 'Abrir o TactiCoach',
    help: 'Ficaste preso nalguma coisa? Responde a este e-mail: uma pessoa lê todas as respostas.',
  },
  verification: {
    subject: 'Confirma o teu e-mail do TactiCoach',
    kicker: 'UMA VERIFICAÇÃO RÁPIDA',
    h1: 'Confirma o teu e-mail ✉️',
    body: 'Olá {name}, confirma este endereço de e-mail para a tua conta TactiCoach. O link funciona durante 24 horas.',
    cta: 'Confirmar o meu e-mail',
    ignore: 'Se não foste tu a pedir, podes ignorar este e-mail.',
  },
  personal: {
    subject: '{sender}, do TactiCoach: vamos começar',
    hi: 'Olá {name},',
    intro: 'sou {sender}, do TactiCoach. Obrigado por quereres experimentar: gostava de te mostrar tudo como deve ser.',
    video: 'Aqui tens um vídeo de 60 segundos com o quadro em ação:',
    videoCta: 'Ver a visita de 60 segundos',
    noVideo: 'A forma mais rápida de ver: abre o TactiCoach, escolhe o teu formato em «Criar o meu primeiro treino» e carrega em reproduzir.',
    setupFirst: 'Primeiro, escolhe a tua palavra-passe: a tua conta está pronta.',
    setupCta: 'Escolher palavra-passe',
    openCta: 'Abrir o TactiCoach',
    question: 'Uma pergunta: que treino vais fazer esta semana? Diz-me e ajudo-te a montá-lo.',
    reply: 'Basta responderes a este e-mail: chega diretamente a mim.',
  },
}

const tr: EmailCopy = {
  footer: 'Bu e-postayı bir TactiCoach hesabın olduğu için alıyorsun.',
  orPaste: 'Ya da bu bağlantıyı tarayıcına yapıştır:',
  signoff: 'İyi antrenmanlar!\nTactiCoach ekibi',
  setup: {
    subject: 'TactiCoach hesabın hazır',
    kicker: 'HESABIN',
    h1: 'Hesabın hazır ⚽',
    body: 'Merhaba {name}, istediğin gibi TactiCoach hesabını oluşturduk. Başlamak için şifreni seç.',
    cta: 'Şifremi seç',
    valid: 'Bağlantı 7 gün geçerli.',
    ignore: 'Bu e-postayı beklemiyorsan görmezden gelebilirsin; şifre seçilmeden hesap kullanılamaz.',
  },
  reminder1: {
    subject: 'TactiCoach hesabın seni bekliyor',
    kicker: 'KÜÇÜK BİR HATIRLATMA',
    h1: 'Tahtan sen hazır olduğunda hazır',
    body: 'Merhaba {name}, TactiCoach hesabını iki gün önce oluşturduk. Şifre seçmek için bir tık yeterli; beş dakika içinde ilk antrenmanın tahtada olur.',
  },
  reminder2: {
    subject: 'Son hatırlatma: TactiCoach hesabın',
    kicker: 'SON HATIRLATMA',
    h1: 'TactiCoach’u hâlâ denemek ister misin?',
    body: 'Merhaba {name}, bu son hatırlatmamız. Aşağıdaki bağlantı yeni ve 7 gün daha geçerli. Şu an uygun değilse sorun değil; yanıt vermen yeterli, daha sonra yeniden hazırlarız.',
  },
  welcome: {
    subject: 'TactiCoach’a hoş geldin: 14 günlük ücretsiz denemen başladı',
    kicker: 'TAKIMA HOŞ GELDİN',
    h1: 'Kadrodasın, {name} ✅',
    body: '14 günlük ücretsiz denemen başladı: 3 tahta, 3 alıştırma kartı, 3 antrenman, bir sezon planı ve yazabileceğin bir kitap; animasyon ve en fazla 3 video dahil. 14 gün sonra çalışmaların kütüphanende kalır.',
    planTitle: 'BAŞLANGIÇ PLANIN',
    step1: 'Tek tıkla tahtaya tam bir takım yerleşir',
    step2: 'Koşuları sürükle; her hareket animasyona dönüşür',
    step3: 'Videoyu takımının grup sohbetine gönder',
    verify: 'Lütfen e-posta adresini onayla:',
    verifyCta: 'E-postamı onayla',
    dashboardCta: 'TactiCoach’u aç',
  },
  activated: {
    subject: 'İçeridesin: TactiCoach’taki ilk beş dakikan',
    kicker: 'İÇERİDESİN',
    h1: 'Hoş geldin, {name} ⚽',
    body: 'Şifren belirlendi ve hesabın hazır. TactiCoach’un ne yaptığını görmenin en hızlı yolu:',
    step1: 'Panelini aç ve “İlk antrenmanımı oluştur” bölümünden formatını seç (5’e 5, 7’ye 7, 9’a 9 ya da 11’e 11).',
    step2: 'Tahtayı aç ve oynat’a bas; alıştırma hareket eder.',
    step3: 'Bir oyuncuyu başka bir yere sürükle ve tekrar oynat. Bütün fikir bu.',
    cta: 'TactiCoach’u aç',
    help: 'Bir yerde takıldın mı? Bu e-postayı yanıtla; her yanıtı bir insan okur.',
  },
  verification: {
    subject: 'TactiCoach e-posta adresini onayla',
    kicker: 'KISA BİR KONTROL',
    h1: 'E-postanı onayla ✉️',
    body: 'Merhaba {name}, TactiCoach hesabın için bu e-posta adresini onayla. Bağlantı 24 saat geçerli.',
    cta: 'E-postamı onayla',
    ignore: 'Bunu sen istemediysen bu e-postayı görmezden gelebilirsin.',
  },
  personal: {
    subject: 'TactiCoach’tan {sender}: hadi başlayalım',
    hi: 'Merhaba {name},',
    intro: 'ben TactiCoach’tan {sender}. Denemek istediğin için teşekkürler; sana her şeyi düzgünce göstermek isterim.',
    video: 'Tahtanın çalışırken göründüğü 60 saniyelik bir video:',
    videoCta: '60 saniyelik turu izle',
    noVideo: 'Görmenin en hızlı yolu: TactiCoach’u aç, “İlk antrenmanımı oluştur” bölümünden formatını seç ve oynat’a bas.',
    setupFirst: 'Önce şifreni seç; hesabın hazır:',
    setupCta: 'Şifremi seç',
    openCta: 'TactiCoach’u aç',
    question: 'Bir sorum var: bu hafta hangi antrenmanı yapacaksın? Bana yaz, kurmana yardım edeyim.',
    reply: 'Bu e-postayı yanıtlaman yeterli; doğrudan bana gelir.',
  },
}

export const EMAIL_COPY: Record<EmailLocale, EmailCopy> = { en, de, es, fr, it, pt, tr }

export function emailCopy(locale: string | null | undefined): EmailCopy {
  return EMAIL_COPY[emailLocale(locale)]
}

/** The language a form or account says: stored as one of ours, or null. */
export function storedLocale(input: string | null | undefined): EmailLocale | null {
  if (!input || !input.trim()) return null
  return emailLocale(input)
}
