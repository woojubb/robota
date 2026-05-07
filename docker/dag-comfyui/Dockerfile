FROM python:3.12-slim

ARG COMFYUI_REF=v0.19.3
ARG PYTORCH_INDEX_URL=https://download.pytorch.org/whl/cpu

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    libgl1 \
    libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt

RUN git clone --depth 1 --branch "${COMFYUI_REF}" https://github.com/comfy-org/ComfyUI.git comfyui \
  || (git clone https://github.com/comfy-org/ComfyUI.git comfyui \
    && cd comfyui \
    && git checkout "${COMFYUI_REF}")

WORKDIR /opt/comfyui

RUN python -m pip install --upgrade pip \
  && python -m pip install torch torchvision torchaudio --index-url "${PYTORCH_INDEX_URL}" \
  && python -m pip install -r requirements.txt

EXPOSE 8188

CMD ["python", "main.py", "--listen", "0.0.0.0", "--port", "8188", "--disable-auto-launch"]
