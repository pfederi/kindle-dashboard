# Kindle-Dashboard – Architekturdokumentation (arc42)

Stand: 4. November 2026, abends · Vorlage: [arc42](https://arc42.org), Version 8

## Inhalt

1. [Einführung und Ziele](#1-einführung-und-ziele)
2. [Randbedingungen](#2-randbedingungen)
3. [Kontextabgrenzung](#3-kontextabgrenzung)
4. [Lösungsstrategie](#4-lösungsstrategie)
5. [Bausteinsicht](#5-bausteinsicht)
6. [Laufzeitsicht](#6-laufzeitsicht)
7. [Verteilungssicht](#7-verteilungssicht)
8. [Querschnittliche Konzepte](#8-querschnittliche-konzepte)
9. [Architekturentscheidungen](#9-architekturentscheidungen)
10. [Qualitätsanforderungen](#10-qualitätsanforderungen)
11. [Risiken und technische Schulden](#11-risiken-und-technische-schulden)
12. [Glossar](#12-glossar)

---

## 1. Einführung und Ziele

### 1.1 Aufgabenstellung

Ein ausgedienter E-Reader (Kindle 7. Generation) hängt im Eingang und zeigt auf einen Blick, was man beim Verlassen der Wohnung wissen will:

- Wetter jetzt und heute (inkl. Zürichsee-Temperatur, Regen nach Stunden), ausführlich mit Wind, Barometer und 7-Tage-Übersicht
- Termine aus mehreren Kalendern, dazu Papier- und Kartonsammlung; Gast-Modus, der die Titel schwärzt, wenn Besuch da ist; Geburtstagsgruss
- Abfahrten an drei Haltestellen, im Detail in beide Richtungen mit Endhaltestelle
- die Bring!-Einkaufsliste: ansehen (seitenweise), abhaken, als dringend markieren, Artikel erfassen
- Aufgaben aus einer zweiten Bring!-Liste: am Kindle und am Handy erfassen, mit einem Tipp erledigen
- Fahrzeit mit dem Roller zur Arbeit und zur Schule mit Verkehr, Karte «Arbeitsweg» mit Stau; mit einem monatlichen Dienstplan (PDF, per iPhone-Kurzbefehl hochgeladen) stehen die Dienste im Kalender, und die Zeile sagt, wann man losfahren muss

Ab 19 Uhr rückt der folgende Tag in den Vordergrund, in der Nachtruhe (00:00–05:30) zeigt ein ruhiger Nachtbildschirm das Wichtigste des kommenden Tages. Bei den Abfahrten berücksichtigt das Dashboard den Fussweg zur Haltestelle («los 07:45»). Bedient wird per Touch; ohne Bedienung kehrt die Anzeige zu «Heute» zurück. Bei Besuch schwärzt ein Gast-Modus die Termintitel, an Geburtstagen grüsst «Heute» mit «Happy Birthday …!».

### 1.2 Qualitätsziele

| Priorität | Ziel | Bedeutung |
|---|---|---|
| 1 | **Zuverlässigkeit im Dauerbetrieb** | Das Gerät läuft wochenlang unbeaufsichtigt; Netz- oder Quellenausfälle führen zu veralteten, nicht zu leeren oder falschen Anzeigen. Der Kindle darf nie in einem unbedienbaren Zustand enden. |
| 2 | **Lesbarkeit auf E-Ink** | Aus 1–2 m lesbar; Graustufen und Schriftgrössen auf 600 × 800 px bei 167 ppi abgestimmt. |
| 3 | **Änderbarkeit** | Neue Inhalte und Ansichten ohne Eingriff auf dem Kindle. |
| 4 | **Vertraulichkeit** | iCal-Adressen, Bring!-Zugang und Gerätetoken verlassen den Server nicht und erscheinen in keinem Log. |

### 1.3 Stakeholder

| Rolle | Erwartung |
|---|---|
| Haushalt (Nutzerinnen und Nutzer im Eingang) | Schnell erfassbare, aktuelle Informationen; einfache Bedienung; Einkaufsliste synchron mit der Bring!-App |
| Betreiber (Eigentümer von Gerät und Server) | Einfaches Deployment (Git-Push), keine Geheimnisse im Repo, Fehlersuche ohne Shell auf dem Gerät |
| Entwicklung | Testbarer Code, klare Grenzen zwischen Gerät und Server |

---

## 2. Randbedingungen

### 2.1 Technisch

| Randbedingung | Auswirkung |
|---|---|
| Kindle 7. Gen. (WP63GW), Firmware 5.12.2.2, Jailbreak WinterBreak2 + KMC | Eigene Programme laufen als Skript aus der Bibliothek; Anzeige über FBInk |
| Bildschirm 600 × 800 px, 167 ppi, 16 Graustufen, Infrarot-Touch (zForce2) | Server rendert genau in dieser Grösse; Touch verliert Finger nahe am Rahmen |
| Kernel 3.0.35, ARMv7, kein brauchbares Zeitzonen- und Zertifikatsverzeichnis | Statisches Go-Binary mit eingebauten Zertifikaten und Zeitzonendaten |
| Kindle-Oberfläche (Java-Framework `lab126_gui`, Fenstermanager `awesome`, Statusleiste `pillow`, App-Manager `appmgrd`) | Muss für das Dashboard angehalten und danach sauber zurückgegeben werden |
| Hosting auf eigenem Server mit Coolify (Docker, Traefik, Let's Encrypt) | Server als Docker-Image, Deployment per Git-Webhook |
| Öffentliche Datenquellen ohne SLA, Bring! nur über inoffizielle API | Zwischenspeicher mit Rückfall auf ältere Daten; robuste Fehlerbehandlung |

### 2.2 Organisatorisch

- Ein Entwickler, Umsetzung mit KI-Unterstützung.
- Privates Git-Repository; ein Push auf `master` deployt den Server.
- Geheimnisse ausschliesslich als Umgebungsvariablen in Coolify bzw. in `config.json` auf dem Gerät.

### 2.3 Konventionen

- Oberfläche Deutsch (Schweiz): «ss» statt «ß», Zeiten in Europe/Zurich.
- Code und Kommentare Englisch; Commit-Nachrichten Englisch.
- Jede Änderung mit Tests (Vitest bzw. `go test`).

---

## 3. Kontextabgrenzung

### 3.1 Fachlicher Kontext

```mermaid
flowchart LR
  user([Haushalt])
  subgraph system [Kindle-Dashboard]
    kindle[Kindle im Eingang]
    server[Render-Server]
  end
  user -- liest, tippt --> kindle
  kindle <--> server
  server --> meteo[Open-Meteo<br/>Wetter]
  server --> alplakes[Alplakes<br/>Seetemperatur]
  server --> smn[MeteoSchweiz<br/>Messwerte Uetliberg]
  server --> ics[Kalender<br/>iCal]
  server --> transport[opentransportdata.swiss<br/>Abfahrten]
  server --> erz[OpenERZ<br/>Entsorgung]
  server <--> bring[Bring!<br/>Einkaufsliste, Aufgaben]
  server --> here[HERE<br/>Fahrzeit, Karte]
  admin([Betreiber]) -- Vorschau im Browser --> server
  phone([iPhone-Kurzbefehl]) -- Dienstplan-PDF --> server
  bringapp([Bring!-App]) <--> bring
  server -- Push bei Ausfall oder leerem Akku --> ntfy[ntfy] --> admin
```

| Nachbar | Austausch |
|---|---|
| Haushalt | sieht Bilder, tippt auf Tabs, Kacheln, Spalten; drückt lange auf die Termine (Gast-Modus) |
| ntfy | Push-Benachrichtigung an den Betreiber, wenn der Kindle sich nicht mehr meldet oder sein Akku fast leer ist |
| Betreiber | sieht alle Ansichten unter `/preview` |
| Open-Meteo | aktuelles Wetter, stündlich und täglich für 7 Tage (Temperatur, Regen, Wind in Knoten, Luftdruck, Sonnenzeiten) |
| Alplakes (Eawag) | Oberflächentemperatur des Zürichsees (Simstrat-Modell) |
| MeteoSchweiz (SwissMetNet) | 10-Minuten-Werte von Sonnenscheindauer und Globalstrahlung auf dem Uetliberg und in Zürich-Fluntern: Sonne über dem Nebel |
| HERE Routing | Fahrzeit mit dem Roller (Modus `scooter`, Autobahn wählbar) mit Echtzeitverkehr und üblicher Fahrzeit; für «Arbeitsweg» zusätzlich Verlauf, Tempo pro Abschnitt, Strassennamen und eine Alternative |
| HERE Map Image | Hintergrundkarte für «Arbeitsweg» (Stil `lite.day`, Schrift doppelt gross) |
| Kalender | geheime iCal-Adressen, ein Kürzel pro Kalender |
| iPhone-Kurzbefehl | schickt den Dienstplan (PDF aus WhatsApp, Teilen-Menü) an `POST /dienstplan`; bekommt eine lesbare Antwort zurück |
| opentransportdata.swiss (OJP 2.0, `OPENTRANSPORTDATA_KEY`) | Abfahrtstafeln (Linie, Zeit, Verspätung, Endhaltestelle, Zwischenhalte) |
| OpenERZ | Sammeltermine Papier und Karton für eine Postleitzahl |
| Bring! | Liste lesen, Artikel hinzufügen, abhaken, zurücklegen; Artikelkatalog |

### 3.2 Technischer Kontext

```mermaid
flowchart LR
  subgraph home [Zuhause]
    k[Kindle<br/>dashboard Go-Binary]
  end
  subgraph vps [Server · Coolify]
    t[Traefik<br/>TLS] --> s[Node.js · Fastify<br/>+ Chromium]
  end
  k -- "HTTPS GET /screen.png<br/>Bearer-Token" --> t
  k -- "HTTPS POST /tap {x,y,hold?}" --> t
  b([Browser]) -- "HTTPS /preview<br/>Basic Auth" --> t
  p([iPhone]) -- "HTTPS POST /dienstplan<br/>Bearer ROSTER_TOKEN" --> t
  s -- HTTPS --> apis[(Externe APIs)]
  s -- "HTTPS POST /topic" --> n[ntfy.sh]
  gh[GitHub] -- Webhook --> c[Coolify] -- Build & Deploy --> s
```

| Schnittstelle | Protokoll | Inhalt |
|---|---|---|
| `GET /screen.png` | HTTPS, `Authorization: Bearer <DEVICE_TOKEN>`; optional `X-Battery` (0–100) und `X-Charging: 1` | PNG 600 × 800, Header `ETag`, `X-Refresh-Seconds`, `X-Full-Refresh` |
| `POST /tap` | HTTPS, Bearer | JSON `{x, y, hold?}` in Gerätepixeln, `hold: true` für einen Langdruck; Antwort neues PNG oder `204` |
| `GET /healthz` | HTTPS | `ok` für den Healthcheck |
| `POST /dienstplan` | HTTPS, `Authorization: Bearer <ROSTER_TOKEN>`, `Content-Type: application/pdf`, höchstens 2 MB; Route nur mit `ROSTER_TOKEN` | Antwort `text/plain`: 200 mit Zusammenfassung («November 2026: 10× Arbeit, 9× Schule, 11× frei. Nächster Dienst: …»), 422 mit Grund («Name nicht gefunden»), 413, 415, 401 ohne Hinweis, 500 bei nicht beschreibbarer Ablage; dieselbe Meldung geht per ntfy |
| `GET /preview`, `/preview/:view` | HTTPS, Basic Auth (`admin`) | Übersicht, HTML oder PNG einer Ansicht (`?png=1`, `?station=N`, `?abend=1`, `?nacht=1`, `?akku=1`, `?laden=1`, `?nebel=1` (Uetliberg sonnig über dem Nebel), `?stau=1` (Stau auf der echten Route nachgestellt), `?ziel=0|1` (Arbeit oder Schule), `?schule=1` (Heute mit Schule an jedem Tag), `?dienst=arbeit|schule` (Heute mit erfundenem Dienst in ein bis zwei Stunden), `?mond=0–359`, `?feiertag=neujahr|ostern|august|weihnachten`); `/preview/nacht` mit allen Mondphasen und Feiertagen; `/preview/status` mit Kindle, Akkukurve, Datenquellen und Dienstplänen |
| HERE (ausgehend) | HTTPS `GET router.hereapi.com/v8/routes?transportMode=scooter&return=summary,typicalDuration` mit `apiKey` | Fahrzeit und übliche Fahrzeit je Ziel (Arbeit, optional Schule); alle 5 Min., nur solange «Heute» abgefragt wird; Fehler nennen nie die Adresse (Schlüssel) |
| HERE «Arbeitsweg» (ausgehend) | HTTPS `GET router.hereapi.com/v8/routes?…&return=polyline,summary,typicalDuration&spans=dynamicSpeedInfo,names,length&alternatives=1`, `GET image.maps.hereapi.com/mia/v3/base/mc/center:…;zoom=…/1106x1076/png?style=lite.day&ppi=200` | Nur beim Öffnen von «Arbeitsweg», Route höchstens alle 2 Min.; die Karte eines Ausschnitts wird einmal geholt und behalten (bis 8 Ausschnitte); ohne Karte wird die Route auf Weiss gezeichnet |
| ntfy (ausgehend) | HTTPS `POST <NTFY_SERVER>/<NTFY_TOPIC>` | Meldung «Kindle meldet sich nicht» bzw. «wieder online», «Kindle-Akku fast leer», bei 5 % «Kindle-Akku: JETZT LADEN» |

Alle Antworten tragen HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` und `Referrer-Policy: no-referrer`; die Vorschau zusätzlich `Cache-Control: no-store` und eine Content-Security-Policy ohne Skripte und fremde Inhalte.

---

## 4. Lösungsstrategie

| Ziel | Ansatz |
|---|---|
| Änderbarkeit | **Thin Client:** Der Kindle zeigt nur fertige Bilder und meldet Taps. Daten, Layout und Logik liegen auf dem Server. |
| Lesbarkeit | Ansichten als HTML/CSS (Preact), gerendert von **Chromium** mit Skalierungsfaktor 600/1072 direkt auf 600 × 800; danach auf **16 Graustufen** quantisiert. |
| Zuverlässigkeit (Server) | Jede Quelle hinter einem **Zwischenspeicher mit Ablaufzeit**; bei Fehlern bleiben die letzten Daten stehen, die Ansicht zeigt «keine Daten» erst ohne jeden Wert. |
| Zuverlässigkeit (Gerät) | **Kindle-Oberfläche anhalten statt beenden**, jede Rückgabe-Strecke (auch Panic, Signal, Absturz) gibt die Oberfläche zurück; **Watchdog** und Shell-Wrapper als zweite Sicherung; Offline-Anzeige und Backoff. |
| Interaktion ohne Logik auf dem Gerät | Server liefert pro Bild die **Tap-Bereiche** (aus `data-action`-Attributen) und wertet Taps selbst aus. |
| Vertraulichkeit | Geheimnisse nur als Umgebungsvariablen; Fehlermeldungen nennen nie URLs oder Werte. |
| Betrieb | Docker-Image, Coolify mit Git-Webhook; Browser-Vorschau statt Shell-Zugriff. |

---

## 5. Bausteinsicht

### 5.1 Ebene 1

```mermaid
flowchart TB
  subgraph client [client · Go]
    cmd[cmd/dashboard]
  end
  subgraph server [server · TypeScript]
    app[HTTP-API]
    dash[Dashboard]
    src[Datenquellen]
    views[Ansichten]
    render[Renderer]
  end
  cmd -- HTTPS --> app --> dash
  dash --> src
  dash --> views
  dash --> render
```

| Baustein | Verantwortung |
|---|---|
| **client** | Bildschirm übernehmen, Bilder holen und anzeigen, Taps und Ein/Aus-Taste erkennen, Oberfläche zurückgeben |
| **server** | Daten sammeln, Zustand pro Gerät führen, Ansichten rendern, Taps auswerten |

### 5.2 Ebene 2 – Server (`server/src`)

| Baustein | Dateien | Verantwortung |
|---|---|---|
| HTTP-API | `app.ts`, `main.ts` | Routen (inkl. `/dienstplan` mit eigenem Token), Authentifizierung, Verdrahtung, Herunterfahren |
| Konfiguration | `config.ts` | Umgebungsvariablen lesen und prüfen (Kalender, Haltestellen, Geburtstage, Nachtruhe, Roller-Fahrten, Dienstplan, `STATE_DIR`, …); Fehler nennen nie geheime Werte |
| Dashboard | `dashboard.ts` | Zustand (Ansicht, Eingabe, Meldungen, Gast-Schalter), Taps und Langdrücke auf Aktionen abbilden, Daten je Ansicht zusammenstellen (inkl. Gast-Modus und Geburtstage des Tages), Vorschau |
| Zustand | `state.ts`, `zones.ts` | Ansichten, Aktionen (`nav:`, `key:`, `add:`, `done:`, `station:`, `weather`, `commute:`, `guest`, …), Navigation, Rückkehr nach Inaktivität, Aktualisierungsrhythmus, Tap- und Langdruck-Bereiche |
| Gast-Modus | `guest.ts` | Wann Termintitel verborgen werden («Besuch»-Termine, Langdruck), Titel durch Balken ersetzen, Gästenamen aus den «Besuch»-Terminen |
| Begrüssung | `views/heute.tsx`, `views/qr.ts` | «Herzlich willkommen …!» mit QR-Code fürs Gäste-WLAN statt der Termine in «Heute» im Gast-Modus |
| Status | `status.ts`, `health.ts`, `views/status.tsx` | Letzte Abfrage und Akkuverlauf des Kindle (Kurve in `STATE_DIR/battery.json`, `BatteryFile`), Erfolg und Fehler jeder Datenquelle (aus `TtlCache`), geladene Dienstplanmonate und letzter Upload-Fehler; Seite `/preview/status` |
| Dienstplan | `roster/pdf.ts`, `parse.ts`, `store.ts`, `upload.ts`, `shift.ts`, `calendar.ts`, `summary.ts` | `extractPdf` liest Wörter und gefüllte Rechtecke aus dem PDF (pdfjs-dist), `parseRoster` (rein) macht daraus Tage mit Dienst oder frei; `RosterStore` legt pro Monat `roster-YYYY-MM.json` in `STATE_DIR` ab; `receiveRoster` verbindet Lesen, Ablegen, Antwort und ntfy; `withRoster` fügt die Dienste als Kalendertermine ein; `shift.ts` rechnet Dienstzeiten und Losfahrzeit |
| Datenquellen | `sources/weather.ts`, `lake.ts`, `uetliberg.ts`, `calendar.ts`, `transit.ts`, `waste.ts`, `commute.ts`, `commute-route.ts`, `bring/` | Abruf und Aufbereitung je Quelle; Bring! mit zwei Listen (Einkauf, Aufgaben) über eine Anmeldung |
| Zwischenspeicher | `cache.ts` | Ablaufzeit, Rückfall auf ältere Werte, 60 s Pause nach einem Fehlschlag, gleichzeitige Abfragen bündeln |
| Überwachung | `monitor.ts` | Merkt sich nach jedem Bild, wann der Kindle wiederkommen soll; meldet Ausfall und Rückkehr über ntfy, ebenso einen Akku ab 20 % |
| Ansichten | `views/*.tsx`, `styles.ts`, `icons.ts` | Heute, Woche, Einkauf, Hinzufügen, Wetter, Haltestelle als Preact-Komponenten; SVG-Grafiken; gemeinsame Bausteine wie Terminliste (mit Balken im Gast-Modus) und Geburtstagsbanner in `components.tsx` |
| Renderer | `render/` | Chromium (Playwright), Bildschirmgrösse und Skalierung, Graustufen; blockiert jeden Netzwerkzugriff gerenderter Seiten |
| Nachtbildschirm | `views/nacht.tsx`, `moon.ts` | «Gute Nacht» mit Mondhimmel (Phase aus Sonnen- und Mondlänge berechnet), Wetter, Terminen und Grüssen des kommenden Tages während der Nachtruhe; Antippen startet den Tag; Vorschau `/preview/nacht` |
| Feiertage | `holidays.ts` | Neujahr, Ostern (Sonntag und Montag, berechnet), 1. August, Weihnachten (24.–26.12.) als Gruss wie ein Geburtstag |

Aktualisierungsintervalle der Zwischenspeicher:

| Quelle | Ablaufzeit |
|---|---|
| ÖV-Abfahrten, Bring!-Liste | 2 Minuten |
| Kalender, Uetliberg-Messwerte | 10 Minuten |
| Wetter | 30 Minuten |
| Seetemperatur | 3 Stunden |
| Entsorgung | 6 Stunden |
| Bring!-Katalog | 24 Stunden |

### 5.3 Ebene 2 – Client (`client/`)

| Paket | Verantwortung |
|---|---|
| `cmd/dashboard` | Start, Übernahme und Rückgabe der Oberfläche, Watchdog, Touch- und Tastenschleifen |
| `internal/app` | Hauptschleife: abfragen im vom Server vorgegebenen Rhythmus (auch Ruhezeiten), anzeigen, Taps senden, Offline-Status; WLAN aus, solange die nächste Abfrage 15 Min. oder mehr entfernt ist |
| `internal/api` | HTTP-Client (ETag, Refresh-Header, Token, Ladestand) |
| `internal/touch`, `internal/input` | Rohereignisse lesen (evdev), skalieren, Tap, Halten (über 1,2 s) und Langdruck-Ecke erkennen |
| `internal/device` | FBInk, `lipc` (auch Ladestand), Fenstermanager, Statusleiste, Bildschirminhalt sichern/zurückschreiben |
| `internal/overlay` | Statusanzeige («offline seit …», «Token ungültig») ins Bild zeichnen |
| `internal/wifi`, `backoff`, `pidfile`, `logx`, `certs`, `config` | WLAN sicherstellen und ausschalten, Wartezeiten, Einzelinstanz, rotierendes Log, Zertifikate, Konfiguration |
| `kindle/documents/*.sh` | Startskript mit Rückfall-Wiederherstellung; Diagnose- und Systeminfo-Skripte (nur lesend), WLAN-Test |

---

## 6. Laufzeitsicht

### 6.1 Regelmässige Aktualisierung

```mermaid
sequenceDiagram
  participant K as Kindle
  participant S as Server
  participant C as Zwischenspeicher
  participant Q as Quelle
  loop alle 120 s (ausser Ruhezeit)
    K->>S: GET /screen.png (Bearer)
    S->>C: Daten für Ansicht
    alt abgelaufen
      C->>Q: abrufen
      Q-->>C: Daten (oder Fehler → alte Daten bleiben)
    end
    S->>S: HTML rendern → PNG, Tap-Bereiche merken
    S-->>K: PNG, ETag, X-Refresh-Seconds, X-Full-Refresh
    alt ETag neu oder Vollbild verlangt
      K->>K: FBInk zeichnet (stündlich voller Bildwechsel)
    end
  end
```

### 6.2 Tap, z. B. Artikel abhaken

```mermaid
sequenceDiagram
  participant K as Kindle
  participant S as Server
  participant B as Bring!
  K->>S: POST /tap {x, y}
  S->>S: Tap-Bereich → done:Milch
  S->>B: PUT Liste: Milch (uuid) → TO_RECENTLY
  B-->>S: ok
  S->>S: Meldung «Milch abgehakt · Rückgängig»
  S-->>K: neues PNG
```

Taps, während ein vorheriger noch läuft, verwirft der Kindle. So entstehen keine doppelten Aktionen.

### 6.3 Langdruck, Gast-Modus umschalten

```mermaid
sequenceDiagram
  participant K as Kindle
  participant S as Server
  K->>K: Finger über 1,2 s ruhig, ausserhalb der Ecke oben links
  K->>S: POST /tap {x, y, hold: true}
  S->>S: Langdruck-Bereich (data-hold) → guest
  S->>S: laufende Termine (Kalender-Cache) → Schalter: ein bis Terminende, oder aus bis Besuchsende
  S-->>K: neues PNG mit Balken statt Titeln, voller Bildwechsel
```

Die Ecke oben links bleibt dem Beenden vorbehalten: Ein Halten dort, das vor 5 Sekunden endet, gilt als abgebrochenes Beenden und wird nicht gesendet.

### 6.4 Start und Beenden auf dem Kindle

```mermaid
sequenceDiagram
  participant U as Haushalt
  participant W as Dashboard.sh
  participant D as dashboard
  participant UI as Kindle-Oberfläche
  U->>W: «Dashboard» in der Bibliothek
  W->>D: starten (losgelöst)
  D->>D: Einzelinstanz, Konfiguration, Touch und Taste öffnen
  D->>UI: Bildschirmschoner aus, Bild sichern, Statusleiste aus, awesome anhalten
  loop Betrieb
    D->>D: anzeigen, Taps senden
  end
  U->>D: Ecke 5 s halten oder Ein/Aus-Taste loslassen
  D->>UI: Geräte freigeben, awesome fortsetzen, Bild zurück, Statusleiste an, Bibliothek öffnen
  D-->>W: Ende (Code 0)
  Note over W: bei Absturz (Code ≠ 0, ≠ 3) stellt das Skript die Oberfläche selbst wieder her
```

### 6.5 Netz weg

Schlägt eine Abfrage zweimal fehl, zeichnet der Kindle «offline seit HH:MM» in das letzte Bild und versucht es mit wachsendem Abstand (30 s bis 10 min) weiter. Bei `401` erscheint «Token ungültig». Sobald wieder ein Bild kommt, verschwindet die Anzeige mit einem vollen Bildwechsel.

### 6.6 Ausfallerkennung

```mermaid
sequenceDiagram
  participant K as Kindle
  participant S as Server
  participant M as Monitor
  participant N as ntfy
  K->>S: GET /screen.png
  S->>M: seen(refreshSeconds) – nächste Abfrage fällig in 120 s (nachts bis 05:30)
  loop jede Minute
    M->>M: fällig + Toleranz (15 Min.) überschritten?
  end
  M->>N: «Kindle meldet sich nicht» (einmal)
  K->>S: GET /screen.png (wieder da)
  S->>M: seen(…)
  M->>N: «Kindle wieder online»
```

### 6.7 Dienstplan hochladen

```mermaid
sequenceDiagram
  participant P as iPhone (Kurzbefehl)
  participant S as Server
  participant R as parseRoster
  participant D as STATE_DIR
  participant N as ntfy
  P->>S: POST /dienstplan (PDF, Bearer ROSTER_TOKEN)
  S->>S: Token (konstante Zeit), Typ, Grösse prüfen
  S->>R: extractPdf → Wörter und Rechtecke → parseRoster(Name)
  alt erkannt
    R->>D: roster-YYYY-MM.json (temporäre Datei, rename) – ersetzt den Monat
    S-->>P: 200 «November 2026: 10× Arbeit, …»
    S->>N: «Dienstplan» (falls NTFY_TOPIC)
  else nicht erkannt
    S-->>P: 422 «Dienstplan nicht erkannt: …» (bisheriger Plan bleibt)
    S->>N: «Dienstplan nicht erkannt»
  end
```

Danach erscheinen die Dienste über `withRoster` als Termine «Arbeit» bzw. «Schule» in «Heute», «Woche» und auf dem Nachtbildschirm. Die Roller-Zeile zeigt an Diensttagen nur das Ziel des Dienstes mit der Losfahrzeit, an freien Tagen keine Zeile; für einen Monat ohne Plan bleibt alles wie ohne Dienstplan.

---

## 7. Verteilungssicht

```mermaid
flowchart LR
  subgraph device [Kindle · /mnt/us]
    bin[dashboard/dashboard<br/>config.json · client.log]
    sh[documents/Dashboard.sh]
    fb[FBInk aus libkh/KMC]
  end
  subgraph host [VPS · Coolify]
    traefik[Traefik + Let's Encrypt]
    container[Docker: Playwright-Image<br/>Node.js + Chromium<br/>Port 3000]
    env[(Umgebungsvariablen<br/>Secrets)]
    vol[(Volume /app/state<br/>Dienstpläne · battery.json)]
  end
  device -- WLAN / Internet / HTTPS --> traefik --> container
  env -.-> container
  vol <-.-> container
  git[GitHub privat] -- Webhook --> host
```

| Knoten | Artefakt | Hinweise |
|---|---|---|
| Kindle | `dashboard` (statisches ARMv7-Binary, ca. 6,6 MB), `config.json`, Skripte | Gebaut mit `make dist` in Docker; per USB kopiert |
| Server | Docker-Image aus `server/Dockerfile` | Basis `mcr.microsoft.com/playwright`; Healthcheck `/healthz` |
| Konfiguration | Umgebungsvariablen in Coolify | siehe README; Geheimnisse als *Secret* markiert |
| Ablage | Volume auf `/app/state` (`STATE_DIR`) | Einziger dauerhafter Zustand: `roster-YYYY-MM.json` je Monat und `battery.json` (Akkukurve, 7 Tage). Das Dockerfile legt das Verzeichnis für `pwuser` an, damit ein neues Volume die Rechte erbt. Ohne Volume läuft alles, die Daten gehen aber beim nächsten Deploy verloren; `RosterStore.persistent()` erkennt das (Gerät des Verzeichnisses ≠ Gerät des übergeordneten) und warnt in Log, Upload-Antwort und Statusseite. Fehlt das Verzeichnis oder ist es nicht beschreibbar, läuft der Server weiter. |

---

## 8. Querschnittliche Konzepte

### 8.1 Rendering und Bildschirm

- Layout in **1072 × 1429 CSS-Pixeln**, gerendert mit `deviceScaleFactor` 600/1072 auf **600 × 800** – Schrift wird in Zielgrösse gerastert, nicht nachträglich verkleinert.
- Ausgabe als 1-Kanal-PNG mit **16 Graustufen** (Werte in Schritten von 17); nur Farben aus einer kleinen Palette (`#000`, `#fff`, `#555`, `#999`, `#ececec`).
- Grafiken (Temperaturkurve, Regen, Wind, Windrose, Barometer) als **inline SVG**; Blöcke mit `flex: none`, damit nichts gestaucht wird – zu viel Inhalt fällt in Tests als Überlauf auf.
- **Terminzeilen in «Heute»:** 4 neben Regenband und vier Abfahrten pro Haltestelle, an Tagen ohne Regenband 5; Geburtstagsbanner und Aufgabenbox ziehen davon ab. Der Render-Test prüft alle Kombinationen darauf, dass die letzte Zeile nicht abgeschnitten wird.
- **Tap-Bereiche** entstehen aus `data-action`-Attributen, Bereiche für einen Langdruck aus `data-hold`; der Renderer misst sie und rechnet sie in Gerätepixel um.

### 8.2 E-Ink-Bildwechsel

- Teilweiser Bildwechsel im Normalfall; **voller Bildwechsel** beim ersten Bild, stündlich, beim Betreten und Verlassen von Overlays (Hinzufügen, Haltestelle, Wetter, Arbeitsweg), nach Statusanzeigen, beim Tab ⟳ und beim Umschalten des Gast-Modus (als sichtbare Bestätigung; beim Gast-Modus verschwinden so auch Geisterbilder der Titel).
- Gleiches ETag ohne Vollbild-Wunsch → kein Neuzeichnen.

### 8.3 Zustand und Navigation

- Der Server führt **einen** Gerätezustand: Ansicht, Rückkehr-Tab, Eingabe, Meldung, abgehakter Artikel (für «Rückgängig»), eingefrorene «Oft gekauft»-Kacheln, gewählte Haltestelle, Reiter von «Hinzufügen» (Einkauf/Aufgabe), eben erfasster Artikel (für «🏃 Dringend» in der Meldung), Seite von «Einkauf», Gast-Schalter.
- Overlays (Hinzufügen, Haltestelle, Wetter, Arbeitsweg) merken sich den Tab, von dem sie geöffnet wurden.
- Nach 2 Minuten ohne Tap kehrt die Anzeige zu «Heute» zurück; ausserhalb von «Heute» plant der Server die nächste Abfrage genau auf diesen Zeitpunkt. Ab 19 Uhr wechselt «Heute» in den Abendmodus, in der Nachtruhe (Standard 00:00–05:30) in den Nachtbildschirm. Der Kindle schaltet dann das WLAN aus und erst zur nächsten Abfrage oder bei einem Tap wieder ein (etwa 6 s).
- **Akku:** Der Kindle schickt mit jeder Bildabfrage `X-Battery` und `X-Charging`. Bei 20 % oder weniger ohne Netzteil zeigen «Heute» und der Nachtbildschirm den Ladestand im Kopf (leerer Akku, schwarz), am Netzteil immer (Akku mit Blitz, grau); `BatteryMonitor` meldet einmal «fast leer» und bei 5 % dringend «JETZT LADEN», erneut erst nach dem Laden. Jede Änderung des Ladestands steht im Server-Log. Die Akkukurve der letzten 7 Tage liegt in `STATE_DIR/battery.json` und übersteht Deployments; ein Schreibfehler wird einmal geloggt und nie geworfen.
- Abfahrten berücksichtigen den Fussweg pro Haltestelle (`walk`): nicht mehr erreichbare sind grau, die Losgeh-Zeit steht als Uhrzeit im Spaltenkopf. Als Uhrzeit, weil das Bild bis zu 2 Minuten alt sein kann.
- **Gast-Modus:** Solange ein Termin läuft, dessen Titel mit «Besuch» beginnt, sind in Heute, Woche und Nachtbildschirm alle Termintitel durch einen gleich breiten schwarzen Balken ersetzt; Uhrzeit, Kalenderkürzel, «Besuch»-Termine und Entsorgung bleiben lesbar, ein Schloss zeigt den Modus an. Die Titel gelangen gar nicht erst ins HTML. Ein Langdruck auf die Termine schaltet von Hand um: ein bis zum Ende der gerade laufenden Termine mit Uhrzeit (ohne laufenden Termin bis zum nächsten Langdruck), während eines Besuchs aus bis zu dessen Ende. Der Schalter liegt nur im Arbeitsspeicher; nach einem Neustart des Servers gilt wieder nur der Kalender. Mit `GUEST_WIFI_SSID` zeigt «Heute» im Gast-Modus im Terminbereich eine Begrüssung mit den Gästenamen (Text nach «Besuch» im Termin) und einem QR-Code fürs Gäste-WLAN, ohne Netzname und Passwort als Text; der Rest von «Heute» bleibt; ein Modul ist eine ganze Zahl Gerätepixel, damit der Code auf E-Ink scharf und lesbar bleibt (im Test aus dem Kindle-PNG zurückgelesen).
- **Geburtstage** (`BIRTHDAYS`, Datum `MM-TT`, nach Zürcher Datum): Banner mit Kuchen über den Terminen in «Heute» (zwei Terminzeilen hoch, im Abendmodus kompakt eine Zeile) und auf dem Nachtbildschirm für den Tag, in den die Nacht führt.
- **Aufgaben** (`BRING_TASKS_LIST`): zweite `BringSource` mit wörtlichen Namen (`verbatimNames`, kein Artikelkatalog). In «Heute» die neueste offene Aufgabe in einer Box (weiss auf schwarz) über den Terminen (kostet eine Zeile, weitere als «+ N»); Antippen erledigt sie ohne «Rückgängig». «+ Aufgabe» im ersten Abschnittstitel öffnet «Hinzufügen» im Reiter «Aufgabe» (2 Spalten, feste Vorschläge nach den zuletzt erledigten). Abends am Geburtstag mit Aufgaben bleibt Platz für nur einen Abschnitt.
- **Dienstplan** (`ROSTER_TOKEN`, `ROSTER_NAME`): Der Plan ist ein Excel-Export als PDF (Tageszeile «1. 2. 3. …», je Person eine Zeile mit Beginn und Ende). Gelesen wird deterministisch über Positionen, ohne Sprachmodell: Monat und Jahr aus dem Kopf, Spalten aus der Tageszeile, die Zeile der Person über den Namen, je Spalte zwei Zeiten = Dienst (Ende vor Beginn = endet am Folgetag), Freikürzel oder leer = frei, alles andere = Fehler mit Datum. Schule ist die Zellfarbe Blau (`#00b0f0`); fehlen Farben im Band, gilt 07:30–16:25 als Schule. Bei jedem Fehler wird nichts übernommen und der alte Plan bleibt. Ein neuer Plan ersetzt den ganzen Monat. Das PDF wird nicht aufbewahrt. **Losfahrzeit** = Beginn − Puffer (`ROSTER_BUFFER_WORK` 5, `ROSTER_BUFFER_SCHOOL` 10 Min.) − Fahrzeit − Fussweg (`COMMUTE_WALK_MINUTES`), auf die Minute abgerundet. Bis 30 Min. vor der Losfahrzeit fragt der Server HERE mit `departureTime` (üblicher Verkehr zu jener Zeit, auf 5 Min. gerundet für den Cache), danach live. Die Zeile zeigt «Arbeit 13:30 · los 12:58 · 22 Min.», nach der Losfahrzeit «los sofort», ab Dienstbeginn nichts. Die Vorschau «Heute mit Dienst (Beispiel, …)» erfindet einen Dienst in ein bis zwei Stunden, unabhängig vom Plan.
- **«Dringend»:** Bring! speichert es als Attribut `PURCHASE_CONDITIONS` (`urgent`, daneben `convenient`, `discounted`); gesetzt wird es mit `ATTRIBUTE_UPDATE` wie in der App, die beiden anderen Werte bleiben erhalten. Dringende Artikel stehen in «Einkauf» zuerst (schwarze Kachel) und im Widget fett mit rennendem Mann; dringende Aufgaben kommen in der Box zuerst. Jede Kachel hat rechts eine eigene Tippfläche (`urgent:`), der Rest hakt ab.
- **Seiten in «Einkauf»:** 10 Artikel pro Seite, darunter «Hinzufügen» und der Paginator; die Seitengrösse ist fest, damit beim Erscheinen der Meldung keine Kachel auf die nächste Seite springt. Die Seite steht im Gerätezustand, wird beim Öffnen auf 1 gesetzt und beim Anzeigen auf die vorhandenen Seiten begrenzt (Abhaken des letzten Artikels einer Seite).
- Die Vorschau rendert mit eigenem Kontext (Zeit, Haltestelle, Gast-Modus) und verändert den Zustand nie.

### 8.4 Fehlerbehandlung

- Quellen werfen bei Fehlern; der Zwischenspeicher behält den letzten gültigen Wert. Nach einem Fehlschlag versucht er es 60 Sekunden lang nicht erneut, damit eine ausgefallene Quelle nicht bei jedem Bild den vollen Timeout kostet; ein erzwungener Abruf (Antippen) und `invalidate()` überspringen die Pause. Die Abfahrten brechen nach 5 Sekunden ab, die übrigen Quellen nach 15.
- Ansichten unterscheiden «keine Daten» (Quelle fehlt) von «keine Termine/Abfahrten» (leer).
- Bring!-Aktionen liefern ein Ergebnis (`added`, `duplicate`, `done`, `gone`, `failed`), das als Meldung angezeigt wird.
- Der Client überlebt jeden Fehler in einer Goroutine (Panic → sauberes Beenden mit Rückgabe der Oberfläche).

### 8.5 Sicherheit

- Gerät: Bearer-Token (256 Bit), verglichen in konstanter Zeit; Dienstplan-Upload mit eigenem `ROSTER_TOKEN` (mindestens 24 Zeichen), Antwort bei falschem Token ohne Hinweis, Körper höchstens 2 MB, Prüfung auf PDF-Kopf; Name und Pläne nur in Coolify bzw. im Volume, das echte PDF nie im Repository (Tests mit anonymisierter Fixture); Vorschau: Basic Auth, nach 20 falschen Passwörtern 15 Minuten gesperrt (global, da alle Anfragen über den Proxy kommen; der Kindle ist nicht betroffen).
- Geheimnisse nur in Umgebungsvariablen bzw. `config.json` auf dem Gerät; Fehlermeldungen der Konfiguration nennen nur Feld und Index, nie den Wert; Logs entfernen Adressen (mögliche iCal-Pfade).
- Eingaben: Taps nach Schema geprüft (Ganzzahlen im Bildschirmbereich); Texte aus Quellen werden als Text gerendert (Preact maskiert), der Renderer blockiert zusätzlich jeden Netzwerkzugriff der gerenderten Seite.
- HTTP-Sicherheitsheader (HSTS, nosniff, kein Einbetten, kein Referrer; CSP und `no-store` für die Vorschau).
- Container läuft als `pwuser`, nicht als root; `npm audit` ohne Befunde; keine Geheimnisse im Git-Verlauf.
- Kindle: Zertifikatsprüfung mit eingebauter CA-Liste, mindestens TLS 1.2.
- Ausgehende Abrufe mit Zeitlimit; nur fest konfigurierte Ziele, keine Weitergabe von Geheimnissen an Dritte.

### 8.6 Zeit und Sprache

- Server läuft mit `TZ=Europe/Zurich`; Datumsvergleiche über das Zürcher Kalenderdatum.
- Texte, Wochentage und Zahlen in Deutsch (Schweiz).

### 8.7 Testkonzept

- Server: ca. 300 Vitest-Tests – Quellen mit nachgebildeten HTTP-Antworten, Zustandslogik, HTML der Ansichten, Rendering mit Chromium (Grösse, Überlauf, Tap- und Langdruck-Bereiche, Mindestgrössen von Tasten). Gast-Modus: Zeitfenster, Umschalten und dass verborgene Titel nicht im HTML stehen; Geburtstage: Datum, Platz und kein Abschneiden.
- Client: `go test -race` für alle Pakete; Touch-Erkennung (Tap, Halten, Ecke zum Beenden) gegen aufgezeichnete Rohereignisse vom Gerät; Wrapper-Skript in einer Busybox-Shell geprüft.
- Gerätespezifische Erkenntnisse in `client/DEVICE_FACTS.md`.

---

## 9. Architekturentscheidungen

| # | Entscheidung | Begründung | Konsequenz |
|---|---|---|---|
| 1 | **Thin Client**: Server rendert Bilder, Kindle zeigt nur an | Kindle-Software ist schwer zu aktualisieren; Webtechnik für Layout und Grafiken | Neue Funktionen ohne Gerät; ohne Netz nur das letzte Bild |
| 2 | **Go** für den Client, statisch gebaut | Ein Binary ohne Abhängigkeiten, läuft auf Kernel 3.0 / ARMv7 | Zertifikate und Zeitzonen eingebaut |
| 3 | **Chromium (Playwright)** als Renderer | Volles CSS und SVG, Schriftglättung | Grösseres Docker-Image, mehr RAM auf dem Server |
| 4 | Layout für 1072 px, **skaliert** auf 600 × 800 | Gerät erwies sich als Kindle 7 statt Paperwhite 3; kein Neuentwurf nötig | Kleine Schriften bewusst gross wählen |
| 5 | **Oberfläche anhalten** (awesome stoppen, Statusleiste aus, Bild sichern) statt `lab126_gui` zu beenden | Beenden führte zu 30 s Startbildschirm und «Softwarefehler» (App-Manager-Zeitüberschreitung); Vorgehen wie KOReader | Rückkehr in 1–2 s; Framework läuft im Hintergrund weiter |
| 6 | **Ein/Aus-Taste beim Loslassen** auswerten | Sonst erreicht das Loslassen den Kindle während der Rückgabe | Kurzer Druck genügt |
| 7 | **Langdruck-Ecke tolerant** gegen kurze Aussetzer (400 ms) | Infrarot-Touch verliert Finger am Rahmen | Zuverlässiges Beenden ohne Taste |
| 8 | **Tap-Bereiche vom Server** | Keine Layoutkenntnis auf dem Gerät | Ein Tap kostet einen Server-Umlauf |
| 9 | **Zwischenspeicher mit Rückfall** pro Quelle | Quellen ohne Verfügbarkeitszusage | Anzeige kann einige Minuten alt sein |
| 10 | **Bring! über die App-API** (Liste per `uuid` abhaken) | Kein offizielles API; Verhalten wie die App | Kann bei Änderungen von Bring! brechen |
| 11 | **ÖV-Störungen nicht umgesetzt** | Nationale SIRI-SX-Daten enthielten keine Meldungen von VBZ/SZU | Verspätungen ab 5 Min. werden hervorgehoben; Störungen später nachrüstbar |
| 12 | **Wind in Knoten**, Woche als **rollende 7 Tage** | Wunsch der Nutzer | – |
| 13 | **Ausfallerkennung über die angekündigte nächste Abfrage** statt fester Zeitspanne | Der Server weiss, wann der Kindle wiederkommen soll (auch nach stundenlanger Nachtruhe) | Kein Fehlalarm in der Nacht; Alarm erst nach Ablauf der Toleranz |
| 14 | **Nachtbildschirm als «Heute» in der Nachtruhe** | Ruhiges Bild statt veralteter Abfahrten | Zeigt den kommenden Tag; tagsüber in der Vorschau prüfbar |
| 15 | **Losgeh-Zeit als Uhrzeit** («los 07:45») statt Countdown | Das Bild kann bis zu 2 Minuten alt sein; eine Uhrzeit stimmt trotzdem | Man rechnet kurz selbst |
| 16 | **Renderer ohne Netz**, Vorschau mit Sperre gegen Passwort-Raten | Tiefenverteidigung; Vorschau zeigt private Daten | Eine Sperre trifft auch den Betreiber für 15 Minuten |
| 17 | **WhatsApp-Nachrichten verworfen** | Offizielle API verlangt eigene Nummer und aufwendige Meta-Einrichtung; inoffizielle Wege sind nicht erlaubt | Nachrichten teilt die Familie direkt untereinander |
| 18 | **Gast-Modus über «Besuch»-Termine und Langdruck**, alle Titel geschwärzt | Automatisch ohne Daran-Denken; von Hand für spontanen Besuch; kein Pflegen, welcher Termin privat ist | Langdruck brauchte ein Update des Kindle-Programms; Schalter geht bei Server-Neustart verloren |
| 19 | **Geburtstage in der Konfiguration** (`BIRTHDAYS`, mit Standardwerten wie die Haltestellen) statt aus dem Kalender | Feste, wenige Daten; der Gruss soll gross und verlässlich erscheinen, unabhängig von Kalendereinträgen | Neue Geburtstage brauchen eine Änderung in Coolify oder im Code |
| 20 | **Aufgaben als Bring!-Liste** statt Datei auf einem Volume | Kein Speicher auf dem Server nötig; Erfassen und Abhaken auch in der App | Hängt an der inoffiziellen Bring!-API |
| 21 | **«Dringend» über `ATTRIBUTE_UPDATE` wie die App** | Bring! speichert es als `PURCHASE_CONDITIONS`; vor dem Einbau mit einem Testartikel am echten Konto geprüft (setzen und entfernen) | Hängt an einer undokumentierten Operation; «günstig» und «Aktion» werden mitgeschickt und müssen erhalten bleiben |
| 22 | **Feste Seiten zu 10 Artikeln** in «Einkauf» statt «+ N weitere» | Alle Artikel erreichbar; Platz für Meldung, «Hinzufügen» und Paginator; keine springenden Kacheln, wenn die Meldung erscheint | Bei kurzer Liste bleibt unten Platz frei |
| 23 | **Terminzeilen nach dem Regenband** (4 oder 5) statt fest | Ohne Regenband hat der Terminbereich knapp zwei Zeilen mehr Platz | Dieselbe Regel steht in Wetterblock und Terminliste (gemeinsame Funktion `showsRainStrip`) |
| 24 | **Ladestand per Header** bei jeder Bildabfrage, Anzeige und Push erst ab 20 % | Der Server kennt den Zustand ohne eigenen Kanal; volle Akkus stören das Bild nicht | Älterer Client schickt nichts, dann bleibt die Anzeige aus |
| 25 | **WLAN in der Nachtruhe aus** statt Ruhezustand (Suspend) | Am Gerät getestet: wieder verbunden nach 6 s; Suspend hätte Touch abgeschaltet und ist mit angehaltener Oberfläche ungetestet | Ein Tap in der Nacht wartet einige Sekunden; der Prozessor bleibt wach |
| 26 | **Begrüssung im Terminbereich statt geschwärzter Termine** bei konfiguriertem Gäste-WLAN, QR-Code auf dem Server erzeugt | Gäste sehen, was sie brauchen; Namen kommen ohne Pflege aus dem «Besuch»-Termin; QR-Bibliothek ohne Abhängigkeiten | Während eines Besuchs sind die Termine des Tages nur in der Vorschau sichtbar; das Passwort steckt nur im QR-Code, nicht als Text |
| 27 | **Status-Seite ohne Speicher und ohne Skripte** | Kein Volume nötig; die strenge CSP der Vorschau bleibt; Tooltips über SVG-`<title>` | Abfragen und Datenquellen beginnen nach jedem Deployment neu; die Akkukurve (höchstens 7 Tage) liegt seit Entscheidung 34 auf dem Volume |
| 28 | **Roller-Fahrzeit über HERE** (Modus `scooter`) statt Google oder TomTom; Zeile über den Abfahrten, Verzögerung gegen die übliche Fahrzeit zur Tageszeit | Einziger Dienst mit eigenem Roller-Modus und Autobahn-Schalter für 125 cm³; grosszügiges Gratiskontingent | Kostet eine Terminzeile; Start und Ziel nur in Coolify; Trennlinien auf 3 px verschmälert, damit das Bild ruhiger bleibt |
| 29 | **«Tag starten» per Tipp auf den Nachtbildschirm**, gültig bis zum Ende dieser Nachtruhe; Grüsse nachts erst ab Mitternacht; Mondphase lokal berechnet | Wer früher aufsteht, will nicht die Konfiguration ändern; ein Gruss für morgen um 22 Uhr wirkt verfrüht; keine weitere Datenquelle | Ein versehentlicher Tipp weckt das Dashboard bis zum Morgen (WLAN an); der Schalter liegt nur im Arbeitsspeicher |
| 30 | **Karte «Arbeitsweg»: Hintergrund von HERE, Route und Stau als eigenes SVG** statt der Verkehrsebene eines Kartendienstes | Rot/Gelb/Grün wird in 16 Graustufen zu Grau; Dicke und Strichart bleiben lesbar; der Renderer blockiert jedes Netz, darum kommt die Karte als `data:`-URL; `ppi=200` vergrössert nur die Schrift, nicht den Massstab | Stau nur auf der eigenen Route, nicht auf Nebenstrassen; die Projektion (Web Mercator, 256-px-Kacheln) muss zum Kartenbild passen |
| 31 | **Schule als zweites Ziel** mit gleichem Start: in «Heute» nach Trennlinie ein Symbol pro Ziel, ohne Ankunftszeit; in «Arbeitsweg» Reiter | Zwei Ziele mit Text und Ankunft sprengen die Zeile (gemessen: über 300 Layout-Pixel zu breit); Symbole und Kürzel wie im Kalender sagen ohne Text, wessen Weg es ist | Ankunft nur auf der Karte; an Schultagen (`COMMUTE_SCHOOL_DAYS`, Standard Mo–Fr) doppelt so viele HERE-Abfragen, an den anderen Tagen keine für die Schule (die Karte behält beide Reiter); das Kürzel steht direkt nach dem Roller und nur in Coolify |

| 32 | **Dienstplan per iOS-Kurzbefehl direkt an den Server** (`POST /dienstplan`) statt über ntfy oder WhatsApp | Das PDF liegt nie bei Dritten; Antwort mit Zusammenfassung sofort auf dem iPhone; WhatsApp-Anbindung scheidet aus (Entscheidung 17) | Eigener Token; Kurzbefehl einmal von Hand anlegen; ohne `ROSTER_TOKEN` gibt es die Route nicht |
| 33 | **PDF über Positionen lesen** (pdfjs-dist, Wörter und gefüllte Rechtecke), kein Sprachmodell; Schule an der Zellfarbe | Deterministisch, kostenlos, offline, ohne dass der Plan an einen Dritten geht; Parser rein und ohne PDF testbar | Bricht, wenn sich das Layout der Excel-Vorlage ändert; dann meldet der Upload den Grund und der alte Plan bleibt |
| 34 | **Zustand auf einem Volume** (`STATE_DIR`: Dienstpläne und Akkukurve als JSON, über temporäre Datei und `rename`) | Pläne müssen Deployments überstehen; die Akkukurve ebenso, sonst beginnt sie nach jedem Deploy neu (löst die Einschränkung aus Entscheidung 27) | Ein Volume in Coolify nötig; ohne warnt der Server (Log, Antwort, Statusseite). Gast-Schalter und Gerätezustand bleiben im Arbeitsspeicher |
| 35 | **Losfahrzeit mit üblichem Verkehr zur Abfahrtszeit**, ab 30 Min. vorher live | Eine Stunde vorher sagt der Live-Verkehr wenig über die Fahrt zur Losfahrzeit; kurz davor zählt er | Die erste Schätzung nimmt die Live-Fahrzeit, danach wird sie nachgeführt; zusätzliche HERE-Abfragen (Cache 15 Min.) |
| 36 | **Abfahrten über die offizielle OJP-2.0-Schnittstelle von opentransportdata.swiss** (`OPENTRANSPORTDATA_KEY`, Pflicht) statt über den Community-Dienst transport.opendata.ch | Der Community-Dienst fiel aus, und jede Anfrage wartete den vollen Timeout; die offizielle Quelle hat keinen Zwischenbetreiber | API-Key nötig (nur in Coolify); Antwort ist XML (`fast-xml-parser`), Folgehalte werden für die Richtung mitgeladen; gestrichene Fahrten werden nicht erkannt |

---

## 10. Qualitätsanforderungen

### 10.1 Qualitätsbaum

```mermaid
mindmap
  root((Qualität))
    Zuverlässigkeit
      Dauerbetrieb
      Netzausfall
      Rückgabe der Kindle-Oberfläche
    Lesbarkeit
      Distanz 1–2 m
      Kontrast E-Ink
    Bedienbarkeit
      Tap-Ziele gross genug
      sichtbare Rückmeldung
    Änderbarkeit
      Server-seitige Ansichten
    Sicherheit
      Geheimnisse geschützt
```

### 10.2 Qualitätsszenarien

| Szenario | Erwartete Reaktion |
|---|---|
| Akku sinkt ohne Netzteil auf 20 % bzw. 5 % | Akku mit Ladestand im Kopf; je eine Push-Nachricht, die zweite dringend |
| WLAN fällt für eine Stunde aus | Letztes Bild bleibt, «offline seit …» erscheint; nach Rückkehr des Netzes innerhalb von 10 Min. aktuelles Bild |
| Eine Quelle (z. B. Wetter) antwortet nicht | Letzte Wetterdaten bleiben sichtbar; übrige Inhalte unberührt |
| Dashboard-Prozess stürzt ab | Startskript gibt die Kindle-Oberfläche zurück; Bibliothek ist bedienbar |
| Nutzer drückt die Ein/Aus-Taste | Dashboard endet, Bibliothek nach 1–2 s ohne Neustart und ohne Fehlermeldung |
| Artikel in der Bring!-App abgehakt, auf dem Kindle angetippt | Meldung «schon abgehakt», Liste lädt neu |
| Neue Ansicht wird gebaut | Deployment per Push; Kindle unverändert |
| Viele Termine oder lange Texte | Begrenzung mit «+ N weitere», Ellipsen; Tests prüfen, dass nichts überläuft |
| Tasten der Bildschirmtastatur | mindestens 80 × 90 Layout-Pixel (Test) |
| Kindle meldet sich über 15 Min. nach der fälligen Abfrage nicht | Push «Kindle meldet sich nicht», nach Rückkehr «wieder online»; nachts kein Fehlalarm |
| Jemand probiert Vorschau-Passwörter durch | Nach 20 Fehlversuchen 15 Minuten Sperre (429) |
| Abfahrt in 3 Minuten bei 4 Minuten Fussweg | Abfahrt grau, Losgeh-Zeit der nächsten erreichbaren im Spaltenkopf |
| Gäste stehen im Eingang, «Besuch»-Termin läuft | Kein Termintitel lesbar, weder im Bild noch im HTML; Uhrzeit, Kürzel und der Besuch selbst bleiben stehen |
| Geburtstag mit vielen Terminen, auch am Abend | Gruss gross auf einer Zeile, darunter Termine mit «+ N weitere»; Tests prüfen, dass nichts abgeschnitten wird |
| Aufgabe am Handy erledigt, dann am Kindle angetippt | Liste lädt neu, kein Fehler |
| Einkaufsliste mit 25 Artikeln, nach dem Abhaken | 10 pro Seite, «Hinzufügen» und Paginator bleiben über der Tableiste sichtbar (Render-Test) |
| Artikel in der App auf «Dringend» gesetzt | Steht in «Einkauf» zuerst mit schwarzer Kachel, im Widget fett mit rennendem Mann |
| Artikel steht schon auf der Liste, aber auf Seite 3 | In «Hinzufügen» eintippen: «steht schon auf der Liste» mit «🏃 Dringend» |
| Geburtstag, Aufgaben und Abendmodus zugleich | Nur ein Abschnitt (heute Abend oder morgen), nichts abgeschnitten (Render-Test) |

---

## 11. Risiken und technische Schulden

| Risiko / Schuld | Auswirkung | Massnahme |
|---|---|---|
| Bring! ändert die inoffizielle API | Einkaufsliste fällt aus | Meldung «Bring! … keine Daten»; Anpassung nach Vorbild bring-api |
| Firmware-Update entfernt den Jailbreak | Dashboard startet nicht mehr | Gerät ist nicht bei Amazon registriert; Updates unwahrscheinlich |
| Nur **ein Gerät** pro Server | Zweiter Bildschirm noch nicht möglich | Zurückgestellt: Tolino Shine 3 (Android 4.4, 1072 × 1448) als zweites Gerät; bräuchte Zustand, Token und Auflösung pro Gerät sowie eine Android-App |
| Tolino schläft trotz «Bildschirm anlassen» nach dem System-Timeout ein | Bild würde einfrieren | Wach-Test bestanden: mit Bildschirm-Timeout «nie» (von einer App ohne Root setzbar) und Wake-Locks über 20 Minuten durchgehend wach und im WLAN |
| Tolino mit Android 4.4 | Keine Sicherheitsupdates mehr; kennt das aktuelle Let's-Encrypt-Stammzertifikat nicht | Eigene App mit mitgeliefertem Zertifikat, nur im Heimnetz; Browser nicht für fremde Seiten nutzen |
| Kindle-Framework läuft angehalten über Tage | Unbekanntes Langzeitverhalten | Dauertest; Neustart des Kindle behebt jeden Zustand |
| Kein Autostart nach Neustart | Nach Stromausfall bleibt die Bibliothek stehen | Bewusst so entschieden; bei Bedarf nachrüsten |
| ÖV-Störungen fehlen | Umleitungen nicht sichtbar | Nachfrage bei VBZ; Umsetzung, sobald Meldungen im Datenstrom erscheinen |
| Ausfall des Kindle | Eingefrorenes Bild fiel früher erst beim Hinsehen auf | Benachrichtigung über ntfy (`NTFY_TOPIC`) |
| Akku bei Dauerbetrieb ohne Netzteil | Gerät schaltet ab | Netzteil; ab 20 % Akkuanzeige im Kopf und Push über ntfy |
| Bring! ändert die Operation für «Dringend» | Umschalten schlägt fehl (Bildschirm blinkt), Anzeige bleibt | Erneut mit einem Testartikel prüfen, Anpassung nach Vorbild bring-api |
| Dienstplan-Layout ändert sich (neue Excel-Vorlage, andere Farben) | Upload meldet «nicht erkannt» oder liest falsche Zeiten | Strenge Prüfungen (Tageszahl, Name, ein Dienst pro Tag); bisheriger Plan bleibt; Parser mit Fixture getestet, nach einem neuen Layout anpassen |
| Kein Volume auf `/app/state` | Dienstplan und Akkukurve gehen beim Deploy verloren | Warnung im Log, in der Upload-Antwort und auf der Statusseite; Volume in Coolify einrichten |
| Kurzbefehl-Token auf dem iPhone | Wer ihn hat, kann Pläne ersetzen | Eigener Token nur für diese Route, in Coolify rotierbar; Kindle und Vorschau sind davon getrennt |
| Gast-Schalter nur im Arbeitsspeicher | Von Hand eingeschalteter Gast-Modus ist nach einem Deployment aus | «Besuch»-Termine greifen weiter; bei Bedarf Zustand auf ein Volume schreiben |

---

## 12. Glossar

| Begriff | Bedeutung |
|---|---|
| **appmgrd** | App-Manager des Kindle; öffnet u. a. die Bibliothek |
| **awesome** | Fenstermanager der Kindle-Oberfläche; wird für das Dashboard angehalten |
| **DDIP / SKI** | Nationale Datendrehscheibe für ÖV-Ereignismeldungen |
| **DIDOK** | Schweizer Haltestellennummer, z. B. 8503000 (Zürich HB) |
| **ETag** | Kennung eines Bildes; gleiches ETag → kein Neuzeichnen |
| **FBInk** | Werkzeug, um Bilder direkt in den E-Ink-Framebuffer zu schreiben |
| **KMC** | Kindle Modding Community; Werkzeuge nach dem Jailbreak |
| **Overlay** | Ansicht ohne Tab mit «Schliessen» (Hinzufügen, Haltestelle, Wetter, Arbeitsweg) |
| **pillow** | Statusleiste der Kindle-Oberfläche |
| **SIRI-SX** | Standard für ÖV-Ereignismeldungen |
| **Dienstplan** | Monatlicher Plan als PDF; liefert Dienste («Arbeit», «Schule») und freie Tage für eine Person |
| **Losfahrzeit** | Dienstbeginn minus Puffer, Fahrzeit und Fussweg, auf die Minute abgerundet («los 12:58») |
| **STATE_DIR** | Verzeichnis für dauerhaften Zustand (Dienstpläne, Akkukurve), in Coolify ein Volume |
| **Dringend** | Markierung eines Artikels in Bring! («Purchase condition» `urgent`) |
| **Gast-Modus** | Termintitel als Balken, solange Besuch da ist |
| **Langdruck (Hold)** | Berührung über 1,2 s ohne Bewegung, ausserhalb der Ecke zum Beenden |
| **Tap-Bereich (Zone)** | Rechteck mit zugehöriger Aktion (und Langdruck-Aktion), vom Server pro Bild ermittelt |
| **Thin Client** | Gerät ohne eigene Logik, zeigt nur an |
| **TtlCache** | Zwischenspeicher mit Ablaufzeit und Rückfall auf den letzten Wert |
| **WinterBreak** | Jailbreak-Methode für Kindle-Firmware 5.x |
