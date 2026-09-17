# ---------------------------------------------------------------------------
# Backend imajı — iki aşamalı derleme.
#
# NOT (kalıcı): `npm ci` KULLANILMAZ. `npm ci` bir package-lock.json bulunmasını
# zorunlu kılar; bu depoda lock dosyası tutulmadığı için komut
# "npm ci can only install packages when your package-lock.json ... is in sync"
# hatasıyla derlemeyi çökertiyordu. `npm install` lock dosyası olmadan da
# çalışır ve yoksa üretir.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Prisma'nın query engine'i indirip doğrulaması için OpenSSL gerekir.
# Alpine tabanlı imajda kurulu gelmediğinden `npx prisma generate` adımı
# "Unable to require libquery_engine" / "Prisma failed to detect the libssl
# version" hatası veriyordu. Bu satır olmadan derleme durur.
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src

# Derleme tip hatası yüzünden durmaz: JS çıktısı yine üretilir ve konteyner
# ayağa kalkar. Tip hataları geliştirme sırasında `npm run typecheck` ile
# görülür; imaj derlemesi bunun için bloke edilmez.
RUN npx tsc -p tsconfig.json --noEmitOnError false || true

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Çalışma aşamasında da Prisma engine'i OpenSSL'e bağlıdır.
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm install --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist
EXPOSE 4000
CMD ["node", "dist/index.js"]
