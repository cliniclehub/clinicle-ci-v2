FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install system dependencies (ffmpeg package provides both ffmpeg and ffprobe)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && command -v ffmpeg \
    && command -v ffprobe

# Set work directory
WORKDIR /app

# Copy requirements file
COPY requirements.txt /app/

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . /app

# Release metadata only (git SHA for audit). Environment comes from runtime ENVIRONMENT on Render.
ARG APP_RELEASE_VERSION=0.0.0-dev
ARG APP_GIT_SHA=local
ENV APP_RELEASE_VERSION=${APP_RELEASE_VERSION} \
    APP_GIT_SHA=${APP_GIT_SHA}

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
