FROM mcr.microsoft.com/playwright:v1.61.0-noble
WORKDIR /opt/qa-agent
COPY package*.json ./
COPY scripts/ ./scripts/
RUN npm ci --omit=dev --no-audit --no-fund
COPY dist/ ./dist/
RUN chmod +x ./scripts/wait-for-ready.sh ./dist/main.js \
  && ln -sf /opt/qa-agent/dist/main.js /usr/local/bin/qa-agent \
  && ln -sf /opt/qa-agent/scripts/wait-for-ready.sh /opt/qa-agent/wait-for-ready.sh
ENV NODE_ENV=production
ENTRYPOINT []
