FROM node:22-alpine AS verified
WORKDIR /check
COPY . ./personal-study-map/
RUN find personal-study-map -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check
RUN node --test personal-study-map/tests/*.test.mjs
FROM nginx:alpine
COPY --from=verified /check/personal-study-map /usr/share/nginx/html
COPY nginx-cache.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
