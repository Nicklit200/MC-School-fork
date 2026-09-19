# Transcription agent — a separate service from the MC-School backend.
# SONIOX_API_KEY lives only in this container; it never reaches the backend or a
# browser.
FROM python:3.12-slim

WORKDIR /app

# Dependencies first so a code change does not re-resolve them.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY agent ./agent

# Run unprivileged.
RUN useradd --create-home --uid 10001 agent
USER agent

ENV HEALTH_PORT=8090
EXPOSE 8090

# Liveness only: a Soniox outage must not look like a dead container and
# trigger a restart loop. Readiness is /readyz.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8090/healthz', timeout=3).status==200 else 1)"

CMD ["python", "-m", "agent.main"]
