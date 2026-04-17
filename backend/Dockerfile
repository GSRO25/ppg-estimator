FROM nvidia/cuda:12.6.0-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        software-properties-common gnupg ca-certificates \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y --no-install-recommends \
        python3.12 python3.12-venv python3.12-dev \
        libgl1-mesa-glx libglib2.0-0 \
        libx11-6 libxext6 libxrender1 libxkbcommon0 libfontconfig1 libgl1 libgomp1 \
        xvfb \
    && ln -sf /usr/bin/python3.12 /usr/bin/python \
    && ln -sf /usr/bin/python3.12 /usr/bin/python3 \
    && python3.12 -m ensurepip --upgrade \
    && python3.12 -m pip install --upgrade pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt

# Install ODA File Converter for DWG support
COPY ODAFileConverter*.deb /tmp/
RUN (dpkg -i /tmp/ODAFileConverter*.deb || (apt-get update && apt-get install -f -y)) \
    && rm /tmp/ODA*.deb \
    && rm -rf /var/lib/apt/lists/*

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]