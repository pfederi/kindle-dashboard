FROM mcr.microsoft.com/playwright:v1.64.1-noble

ENV NODE_ENV=production \
    TZ=Europe/Zurich \
    PORT=3000

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src ./src
COPY data ./data
RUN npm run build && npm prune --omit=dev

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Read duty rosters live here; mount a volume on it in Coolify so they survive a deploy.
RUN mkdir -p /app/state && chown pwuser:pwuser /app/state
USER pwuser
CMD ["node", "dist/main.js"]
