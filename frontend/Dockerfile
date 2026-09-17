# --- Build stage: produce the static bundle ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Staging web must always call its own same-origin /api path. Do not allow a
# Railway VITE_API_BASE_URL variable to bake an external API origin into the JS.
RUN VITE_API_BASE_URL=/api/v1 npm run build

# --- Runtime stage: serve the bundle with nginx ---
FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
