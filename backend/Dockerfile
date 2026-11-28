# Build the existing Spring Boot backend.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
COPY maven-settings-ci.xml /tmp/maven-settings-ci.xml
COPY src ./src
RUN mvn -B -s /tmp/maven-settings-ci.xml -Dtest=PostLessonHomeworkTaskPlanTest,StudentOnlyHomeworkTest,PostLessonHomeworkRecoveryTest clean package

# Use a Node 22 binary built against the older bullseye glibc (also compatible with jammy).
FROM node:22-bullseye-slim AS node_runtime
WORKDIR /opt/mindcrafti-workbook
COPY src/main/resources/owner-workbook-generator/package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Workbook pilot v3: same SVG -> HTML -> WeasyPrint PDF engine as ChatGPT tests.
FROM eclipse-temurin:21-jre-jammy
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip curl \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 \
    shared-mime-info fonts-dejavu-core fonts-liberation fonts-inter \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
COPY src/main/resources/owner-workbook-generator/requirements.txt /tmp/workbook-requirements.txt
RUN python3 -m venv /opt/mindcrafti-pdf && \
    /opt/mindcrafti-pdf/bin/pip install --no-cache-dir -r /tmp/workbook-requirements.txt
COPY --from=node_runtime /opt/mindcrafti-workbook/node_modules /opt/mindcrafti-workbook/node_modules
ENV PATH="/opt/mindcrafti-pdf/bin:${PATH}"
ENV MINDCRAFTI_WORKBOOK_MODULES="/opt/mindcrafti-workbook/node_modules"
# Required production build gate: actual PDFs from the Java compiler, without AI.
COPY src/main/resources/owner-workbook-generator/ /tmp/workbook-smoke/renderer/
COPY src/test/resources/homework_generator_smoke.py /tmp/workbook-smoke/run.py
COPY --from=build /app/target/homework-generator-smoke/ /tmp/workbook-smoke/fixtures/
RUN ln -s /opt/mindcrafti-workbook/node_modules /tmp/workbook-smoke/renderer/node_modules && \
    python3 /tmp/workbook-smoke/run.py /tmp/workbook-smoke/renderer /tmp/workbook-smoke/fixtures /tmp/workbook-smoke/output && \
    rm -rf /tmp/workbook-smoke

WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY --from=build /app/target/*.jar app.jar
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=50s \
 CMD curl -fsS http://localhost:8080/actuator/health || exit 1
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
