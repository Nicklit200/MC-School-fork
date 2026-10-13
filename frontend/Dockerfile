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
# Vite replaces import.meta.env during npm run build, not at nginx runtime.
# Explicitly declare the Railway build arg so the owner-only pilot button
# can be included in the static bundle when enabled.
ARG VITE_MINDCRAFTI_ONLINE_ENABLED=false
ENV VITE_MINDCRAFTI_ONLINE_ENABLED=$VITE_MINDCRAFTI_ONLINE_ENABLED
# Full Farhad classroom is separately gated; this remains OFF on the live site
# until verified with a dedicated staging LiveKit configuration.
ARG VITE_MINDCRAFTI_LIVEKIT_ENABLED=false
ENV VITE_MINDCRAFTI_LIVEKIT_ENABLED=$VITE_MINDCRAFTI_LIVEKIT_ENABLED
RUN npm run build

# --- Runtime stage: serve the bundle with nginx ---
FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
