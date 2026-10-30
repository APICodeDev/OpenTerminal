FROM python:3.11-slim

WORKDIR /app

# Kronos runs on CPU by default in the bundled compose stack. Users with a
# CUDA-enabled deployment can replace this image or set KRONOS_DEVICE after
# installing the matching PyTorch build.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "torch>=2.0.0"
COPY services/kronos/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY services/kronos/vendor/Kronos/model ./vendor/Kronos/model
COPY services/kronos/app.py ./app.py

ENV KRONOS_HOST=0.0.0.0 \
    KRONOS_PORT=8000 \
    KRONOS_DEVICE=cpu \
    PYTHONUNBUFFERED=1

EXPOSE 8000
CMD ["python", "app.py"]

