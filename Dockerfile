FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt

COPY backend/app /app/app
RUN mkdir -p /app/uploads

EXPOSE 8000

CMD ["sh", "-c", "python -m app.wait_for_db && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]