# --- Build stage: produce the static bundle ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The app calls the API at this base path; nginx (below) proxies it to the backend,
# so the browser talks to the same origin and no CORS is needed.
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# --- Runtime stage: serve the bundle with nginx ---
FROM nginx:1.29-alpine
# Rendered at container start by the image's envsubst entrypoint. The filter
# restricts substitution to LIVEKIT_* so nginx's own $uri/$scheme/$remote_addr
# are left untouched.
ENV NGINX_ENVSUBST_FILTER=LIVEKIT_
# Empty by default: with online classes disabled the CSP is byte-for-byte the
# strict policy that shipped before the feature.
ENV LIVEKIT_CSP_ORIGINS=""
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
