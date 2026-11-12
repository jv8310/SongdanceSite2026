# Individuele sessies: Zoom‑app en koppelingen (opdracht voor een Chrome‑sessie)

Deze opdracht is voor Claude in Chrome, in de browser van Jacob. Het doel: de
individuele sessies op songdance.co/sessions krijgen per boeking een eigen
Zoom‑meeting, en elke geboekte sessie komt in Jacobs Google‑agenda.

De site zelf is klaar (prijs €175, 50 minuten). Er ontbreken nog drie dingen,
die alleen in Jacobs eigen accounts kunnen:

1. **Zoom**: een Server‑to‑Server OAuth‑app, zodat de site meetings mag aanmaken.
2. **Cloudflare**: de gegevens van die app als geheimen op de worker `songdance-site`.
3. **Google**: de agendakoppeling opnieuw maken, met toestemming om afspraken te bewerken.

## Regels voor deze sessie

- **Geheimen nooit herhalen.** Het Client Secret (en de andere sleutels) kopieer
  je rechtstreeks van het Zoom‑tabblad naar het Cloudflare‑veld. Zet ze nooit in
  de chat, in een samenvatting of in een notitie.
- **Stop en vraag Jacob** bij elke inlog, tweestapsverificatie of
  toestemmingsscherm (Google "Toestaan", Zoom‑voorwaarden). Die knop drukt hij
  zelf in. Zeg duidelijk welk tabblad en welke knop.
- Verander niets anders in Zoom, Cloudflare of op de site dan wat hieronder staat.
- Lukt een stap niet, of ziet het scherm er anders uit dan beschreven: beschrijf
  wat je ziet en vraag wat te doen, in plaats van te gokken.

## Deel A: de Zoom‑app aanmaken

1. Open **https://marketplace.zoom.us/**. Je moet ingelogd zijn als
   **jacob@songdance.co** (dat account host de Songdance‑meetings). Is dat niet
   zo, stop en vraag Jacob in te loggen.
2. Klik rechtsboven op **Develop** → **Build App** (of "Build Server‑to‑Server
   App"). Kies **Server‑to‑Server OAuth App** → **Create**.
3. App name: **Songdance sessions**. Bevestig.
4. Tabblad **App Credentials**: hier staan **Account ID**, **Client ID** en
   **Client Secret**. Laat dit tabblad open; je hebt ze straks nodig in deel B.
5. Tabblad **Information**: vul in wat verplicht is.
   - Company name: **Songdance BV**
   - Developer contact name: **Jacob**
   - Developer contact email: **jacob@songdance.co**
6. Tabblad **Features**: niets aanzetten (geen event subscriptions). Ga verder.
7. Tabblad **Scopes** → **Add Scopes** → categorie **Meeting**. Vink deze drie aan:
   - `meeting:write:meeting:admin` (een meeting aanmaken voor een gebruiker)
   - `meeting:update:meeting:admin` (een meeting wijzigen, voor als een klant verzet)
   - `meeting:delete:meeting:admin` (een meeting verwijderen, bij annuleren)

   Zie je alleen de oudere scopes zonder het middelste woord, kies dan
   `meeting:write:admin`. Klik **Done** en ga verder.
8. Tabblad **Activation** → **Activate your app**. De status moet **Activated**
   worden. Lukt het niet, noteer de melding (zonder sleutels) en vraag Jacob.

## Deel B: de geheimen in Cloudflare zetten

1. Open **https://dash.cloudflare.com**, kies het Songdance‑account →
   **Workers & Pages** → de worker **songdance-site**.
2. **Settings** → **Variables and Secrets** → **+ Add**.
3. Voeg deze vier toe, **elk met Type = Secret**. Kies geen Text: een deploy
   vanuit GitHub wist tekstvariabelen die in het dashboard zijn gezet, geheimen
   niet.

   | Naam | Waarde |
   | --- | --- |
   | `ZOOM_ACCOUNT_ID` | de Account ID van het Zoom‑tabblad |
   | `ZOOM_CLIENT_ID` | de Client ID van het Zoom‑tabblad |
   | `ZOOM_CLIENT_SECRET` | het Client Secret van het Zoom‑tabblad |
   | `ZOOM_USER` | `jacob@songdance.co` |

4. Klik **Deploy** (of **Save and deploy**). Cloudflare zet de geheimen meteen live.

## Deel C: Google‑agenda opnieuw koppelen, met schrijfrechten

1. Open **https://songdance.co/admin/settings/calendar-sync**. Vraagt de site om
   in te loggen, laat Jacob dat doen.
2. Klik **Re-connect**.
3. Google toont een toestemmingsscherm. **Stop hier en vraag Jacob** zijn account
   te kiezen (**jacob.vermeulen@gmail.com**, de agenda met de SVH‑workshops) en
   zelf op **Toestaan / Allow** te drukken. Het scherm hoort te vragen om
   afspraken te bekijken en te bewerken.
4. Terug op de site: controleer dat bij **3 · Calendar** nog steeds de agenda
   **jacob.vermeulen@gmail.com** gekozen is. Verander niets als dat zo is.

## Deel D: controleren

1. Open **https://songdance.co/admin/sessions?zoomcheck=1** en lees de tabel **Status**:
   - **Booking**: "open", €175 per sessie.
   - **Google Calendar**: "Writing booked sessions into the calendar: allowed".
   - **Zoom**: "API" en "Connected — every booking gets a Zoom meeting of its own".
     Staat er een foutmelding, geef die letterlijk door (er staan geen sleutels in).
2. Kijk bij **Free moments, next 14 days**. Die lijst blijft leeg tot er
   afspraken met de titel **Boekingen** in de agenda staan. Meld wat je ziet.

## Terugmelden aan Jacob

Een korte lijst: wat gelukt is (A, B, C, D), wat niet en waarom, en waar hij
nog iets moet doen. Nooit met de waarde van een sleutel erin.
