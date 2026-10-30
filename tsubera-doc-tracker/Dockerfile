FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/data
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY app/server.mjs app/app.html app/online-auth.mjs app/login.html app/trans-order-key.mjs app/online-start.mjs app/cloud-migration.mjs app/migration.html app/payment-deadline.mjs app/receipt-schema-backup.mjs ./
COPY data-package.py ./tools/data-package.py
COPY tools/prepare-cloud.py ./tools/prepare-cloud.py
EXPOSE 8080
CMD ["node", "online-start.mjs"]
