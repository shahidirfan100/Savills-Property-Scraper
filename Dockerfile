FROM apify/actor-node:22

COPY package*.json ./
RUN npm install --omit=dev --include=optional --no-audit --no-fund \
    && node -e "import('impit').then(() => console.log('impit OK'))"

COPY . ./

ENV APIFY_LOG_LEVEL=INFO

CMD npm start --silent
