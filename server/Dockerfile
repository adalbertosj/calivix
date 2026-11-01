FROM node:24-alpine

# tini: encerra o processo corretamente. tzdata: horários no fuso do servidor.
RUN apk add --no-cache tini tzdata

WORKDIR /app
COPY package.json ./
COPY src ./src
# A interface web e o núcleo compartilhado (ADB em JavaScript, travas de segurança, catálogo)
COPY public ./public

ENV NODE_ENV=production \
    PORT=8795 \
    DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 8795

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD wget -qO- http://127.0.0.1:8795/api/situacao || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
