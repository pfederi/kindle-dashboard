# Kindle-Dashboard – Server

Einrichtung, Umgebungsvariablen, Vorschau und Entwicklung: siehe das [README im Hauptverzeichnis](../README.md).

Kurz für die lokale Entwicklung:

```bash
npm install
npx playwright install chromium
DEVICE_TOKEN=dev PREVIEW_PASSWORD=dev npm run dev   # http://localhost:3000/preview (admin / dev)
npm test
```
