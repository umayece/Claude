# ---------------------------------------------------------------------------
# Frontend imajı — Vite derlemesi + nginx ile statik sunum.
#
# NOT (kalıcı): `npm ci` KULLANILMAZ; bu depoda package-lock.json tutulmadığı
# için lock zorunlu kılan `npm ci` derlemeyi çökertiyordu.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
