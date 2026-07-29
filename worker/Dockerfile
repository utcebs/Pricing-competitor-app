# Build the scraper worker from the official Playwright image, which ships
# Chromium + every OS dependency + Node preinstalled. This is the reliable
# way to run Playwright on Render — the native runtime can't `apt-get` the
# system libs that `playwright install --with-deps` needs.
#
# Tag MUST match the `playwright` version in package.json/package-lock
# (currently 1.61.1) so the preinstalled browser revision matches.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

# Install deps first (cached layer) — only re-runs when package files change.
COPY package.json package-lock.json ./
RUN npm ci

# App source (node_modules excluded via .dockerignore).
COPY . .

# Belt-and-suspenders: ensure the Chromium revision matching this exact
# playwright version is present (OS deps already in the base image).
RUN npx playwright install chromium

CMD ["node", "src/index.js"]
