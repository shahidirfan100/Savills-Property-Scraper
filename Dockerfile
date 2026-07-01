FROM apify/actor-node:22

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . ./

ENV APIFY_LOG_LEVEL=INFO

CMD npm start --silent
