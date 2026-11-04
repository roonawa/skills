FROM node:22-bookworm
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium firefox \
    && apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /ms-playwright
COPY --chown=node:node bin ./bin
COPY --chown=node:node lib ./lib
COPY --chown=node:node builtin ./builtin
COPY --chown=node:node tests ./tests
COPY --chown=node:node ui ./ui
COPY --chown=node:node playwright.config.* ./
COPY --chown=node:node deploy/user-manual.html deploy/site-exam-guide.html deploy/security-ai-guide.html ./deploy/
RUN mkdir -p /data /policy && chown node:node /data /policy
USER node
EXPOSE 4310
CMD ["node", "ui/start-shared.mjs"]
