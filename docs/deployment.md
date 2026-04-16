# PPG Estimator — Deployment Guide for Precision 3280

This guide walks through deploying the PPG Estimator on your Dell Precision 3280 CFF workstation.

**Hardware:** Intel i9-14900 (24 cores), 32GB DDR5, NVIDIA T1000 8GB GDDR6, 1TB NVMe SSD, Windows 11 Pro

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Install Docker Desktop](#2-install-docker-desktop)
3. [Enable GPU Support](#3-enable-gpu-support)
4. [Install ODA File Converter](#4-install-oda-file-converter)
5. [Clone and Configure](#5-clone-and-configure)
6. [Build and Start Services](#6-build-and-start-services)
7. [Import Rate Card](#7-import-rate-card)
8. [Set Up Google OAuth](#8-set-up-google-oauth)
9. [Generate HTTPS Certificates](#9-generate-https-certificates)
10. [Enable AI Models (YOLOv8 + PaddleOCR)](#10-enable-ai-models)
11. [Configure Backup](#11-configure-backup)
12. [Network Access](#12-network-access)
13. [Verify Everything Works](#13-verify-everything-works)
14. [Maintenance](#14-maintenance)

---

## 1. Prerequisites

Ensure the following on the Precision 3280:

- [ ] Windows 11 Pro is up to date
- [ ] NVIDIA GPU driver **version 525.60 or later** installed ([download here](https://www.nvidia.com/download/index.aspx) — select T1000)
- [ ] BitLocker enabled on the C: drive (for encryption at rest)
- [ ] A PPG Google Workspace account for OAuth (any admin account)

Verify the GPU driver:
```powershell
nvidia-smi
# Should show: NVIDIA T1000, Driver Version: 5xx.xx, CUDA Version: 12.x
```

---

## 2. Install Docker Desktop

1. Download Docker Desktop for Windows from https://www.docker.com/products/docker-desktop/
2. Run the installer. When prompted:
   - **Use WSL 2 based engine** — YES (required for GPU support)
   - **Add shortcut to desktop** — optional
3. Restart the machine when prompted
4. Open Docker Desktop, accept the license
5. Go to **Settings > General** — ensure "Use the WSL 2 based engine" is checked
6. Go to **Settings > Resources > WSL integration** — enable for your default distro

Verify Docker is working:
```powershell
docker run hello-world
```

---

## 3. Enable GPU Support

Docker Desktop on Windows with WSL 2 provides GPU access automatically IF the NVIDIA driver is installed on Windows. No separate CUDA install needed inside WSL.

Verify GPU is accessible inside Docker:
```powershell
docker run --rm --gpus all nvidia/cuda:12.6.0-base-ubuntu22.04 nvidia-smi
```

Expected output: Shows T1000 GPU with 8GB memory.

**If this fails:**
- Ensure NVIDIA driver is updated to 525.60+
- Ensure WSL 2 is up to date: `wsl --update`
- Restart Docker Desktop
- Restart the machine

---

## 4. Install ODA File Converter

The extraction engine needs ODA File Converter to read `.dwg` files (ezdxf only reads `.dxf` natively).

1. Go to https://www.opendesign.com/guestfiles/oda_file_converter
2. Register for a free account
3. Download the **Linux x64 .deb** package (NOT the Windows version — it runs inside the Docker container)
4. Place the `.deb` file in `ppg-estimator/backend/`:
   ```
   ppg-estimator/backend/ODAFileConverter_QT6_lnxX64_8.3dll_25.12.deb
   ```
5. Update `backend/Dockerfile` to install it:

   Add these lines AFTER the `pip install` step:
   ```dockerfile
   # Install ODA File Converter for DWG support
   COPY ODAFileConverter*.deb /tmp/
   RUN dpkg -i /tmp/ODAFileConverter*.deb || apt-get install -f -y \
       && rm /tmp/ODA*.deb
   ```

---

## 5. Clone and Configure

```powershell
cd C:\Users\andre\Documents\GitHub
git clone <your-repo-url> ppg-estimator
cd ppg-estimator

# Create environment file
copy .env.example .env
```

Edit `.env` with real values:
```env
POSTGRES_USER=ppg
POSTGRES_PASSWORD=<generate a strong password>
POSTGRES_DB=ppg_estimator
DATABASE_URL=postgresql://ppg:<your-password>@db:5432/ppg_estimator
NEXTAUTH_URL=https://ppg-estimator.local
NEXTAUTH_SECRET=<run: openssl rand -base64 32>
AUTH_GOOGLE_ID=<from Google Cloud Console — see step 8>
AUTH_GOOGLE_SECRET=<from Google Cloud Console — see step 8>
ALLOWED_EMAILS=andrew@primeplumbinggroup.com.au,michael@primeplumbinggroup.com.au,samuel@primeplumbinggroup.com.au
EXTRACTION_API_URL=http://extraction:8000
UPLOAD_DIR=/data/uploads
EXPORT_DIR=/data/exports
```

---

## 6. Build and Start Services

### Switch backend Dockerfile to GPU image

For production with GPU support, update the first line of `backend/Dockerfile`:

```dockerfile
FROM nvidia/cuda:12.6.0-runtime-ubuntu22.04
```

And add Python installation:
```dockerfile
RUN apt-get update && apt-get install -y \
    python3.12 python3.12-venv python3-pip \
    libgl1-mesa-glx libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
```

### Build and start

```powershell
cd C:\Users\andre\Documents\GitHub\ppg-estimator

# Build all services (first time takes 5-10 minutes)
docker compose build

# Start all services
docker compose up -d

# Check status
docker compose ps
```

Expected: Three services running:
- `db` (PostgreSQL) — healthy
- `extraction` (FastAPI) — started
- `web` (Next.js) — started

### Verify health endpoints

```powershell
curl http://localhost:3000/api/health
# {"status":"ok","db":"connected"}

curl http://localhost:8000/health
# {"status":"ok","service":"extraction-api"}
```

### Verify database schema

```powershell
docker compose exec db psql -U ppg -d ppg_estimator -c "\dt"
```

Should list: users, projects, drawings, rate_card_versions, rate_card_items, symbol_mappings, takeoff_items, corrections, estimates, audit_log.

---

## 7. Import Rate Card

Upload the V5.9 estimating spreadsheet:

```powershell
curl -X POST http://localhost:3000/api/rate-cards/import ^
  -F "file=@C:\Users\andre\Downloads\Estimating Document V5.9 April2026.xlsx" ^
  -F "name=PPG Master" ^
  -F "version=V5.9"
```

Expected response: `{"id":1,"itemCount":XXX}` where XXX is the number of rate card items parsed.

Verify:
```powershell
curl http://localhost:3000/api/rate-cards
```

---

## 8. Set Up Google OAuth

1. Go to https://console.cloud.google.com/
2. Create a new project or use existing PPG project
3. Go to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Name: `PPG Estimator`
7. Authorized JavaScript origins:
   - `https://ppg-estimator.local`
   - `http://localhost:3000` (for testing)
8. Authorized redirect URIs:
   - `https://ppg-estimator.local/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`
9. Copy the **Client ID** and **Client Secret** to your `.env` file
10. Restart the web service:
    ```powershell
    docker compose restart web
    ```

---

## 9. Generate HTTPS Certificates

For local network HTTPS with a self-signed certificate:

```powershell
mkdir certs
cd certs

# Generate self-signed cert (valid for 1 year)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 ^
  -keyout key.pem -out cert.pem ^
  -subj "/CN=ppg-estimator.local/O=Prime Plumbing Group"
```

Add the nginx service to `docker-compose.yml`:

```yaml
  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./certs:/etc/nginx/certs:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - web
      - extraction
```

Restart:
```powershell
docker compose up -d
```

Now access via `https://localhost` (browser will warn about self-signed cert — add exception).

**To trust the cert on PPG machines:**
1. Double-click `certs/cert.pem`
2. Install to "Local Machine" > "Trusted Root Certification Authorities"
3. Restart browser

---

## 10. Enable AI Models (YOLOv8 + PaddleOCR)

### Install GPU dependencies in the extraction container

Add to `backend/requirements.txt`:
```
ultralytics>=8.3
paddlepaddle-gpu>=3.0
paddleocr>=2.9
```

Rebuild:
```powershell
docker compose build extraction
docker compose up -d extraction
```

### YOLOv8 Model

For V1, we start with the pre-trained YOLOv8 model. Custom fine-tuning on PPG's plumbing symbols comes later.

```powershell
# Download pre-trained model into the models directory
docker compose exec extraction python3 -c "from ultralytics import YOLO; YOLO('yolov8m.pt')"

# Copy model to the expected location
docker compose exec extraction cp yolov8m.pt /app/models/plumbing_symbols.pt
```

**Note:** The pre-trained model detects general objects, not plumbing symbols specifically. For V1, it provides basic detection. Fine-tuning with PPG-annotated drawings will dramatically improve accuracy — this is a future task.

### PaddleOCR

PaddleOCR downloads its models automatically on first use. Verify:

```powershell
docker compose exec extraction python3 -c "from paddleocr import PaddleOCR; ocr = PaddleOCR(use_angle_cls=True, lang='en'); print('PaddleOCR ready')"
```

### Verify GPU is being used

```powershell
docker compose exec extraction python3 -c "import torch; print('CUDA available:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'N/A')"
```

Expected: `CUDA available: True`, `GPU: NVIDIA T1000`

---

## 11. Configure Backup

### Automated daily backup

Create a Windows Task Scheduler task:

1. Open Task Scheduler
2. Create Task:
   - **Name:** PPG Estimator Backup
   - **Trigger:** Daily at 11:00 PM
   - **Action:** Start a program
     - Program: `powershell.exe`
     - Arguments: `-File "C:\Users\andre\Documents\GitHub\ppg-estimator\database\scripts\run-backup.ps1"`

Create `database/scripts/run-backup.ps1`:
```powershell
$BackupDir = "D:\PPG-Backups"  # Change to your backup drive
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Filename = "ppg_estimator_$Timestamp.sql.gz"

# Create backup directory
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

# Dump database
docker compose -f C:\Users\andre\Documents\GitHub\ppg-estimator\docker-compose.yml exec -T db pg_dump -U ppg ppg_estimator | gzip > "$BackupDir\$Filename"

Write-Host "Backup created: $BackupDir\$Filename"

# Clean backups older than 30 days
Get-ChildItem "$BackupDir\ppg_estimator_*.sql.gz" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item
```

### Manual backup

```powershell
docker compose exec -T db pg_dump -U ppg ppg_estimator > backup.sql
```

### Restore from backup

```powershell
docker compose exec -T db psql -U ppg -d ppg_estimator < backup.sql
```

---

## 12. Network Access

### LAN-only access (default)

The Precision 3280 serves the app on its local IP. Other machines on PPG's network access it via that IP.

Find the machine's IP:
```powershell
ipconfig
# Look for the Ethernet/Wi-Fi adapter's IPv4 address, e.g., 192.168.1.100
```

Other PPG machines access: `https://192.168.1.100`

### Optional: Local DNS

Add to PPG's DNS or each machine's hosts file:
```
192.168.1.100  ppg-estimator.local
```

### VPN for remote access

For estimators working remotely:
1. Set up a VPN server on PPG's network (WireGuard recommended)
2. Remote users connect to VPN first, then access `https://ppg-estimator.local`
3. **Never expose the Precision 3280 directly to the internet**

### Firewall rules

On the Precision 3280, allow inbound connections on ports 80 and 443 from the LAN:

```powershell
netsh advfirewall firewall add rule name="PPG Estimator HTTP" dir=in action=allow protocol=tcp localport=80 remoteip=localsubnet
netsh advfirewall firewall add rule name="PPG Estimator HTTPS" dir=in action=allow protocol=tcp localport=443 remoteip=localsubnet
```

---

## 13. Verify Everything Works

### End-to-end test

1. **Login:** Go to `https://ppg-estimator.local` → sign in with Google (PPG account)
2. **Create project:** Dashboard → New Project → fill in details
3. **Upload drawings:** On the project page, upload DWG files from a real project
4. **Auto-categorization:** Verify drawings are categorized correctly (drainage, pressure, fire, etc.)
5. **Run extraction:** Click "Run Extraction" → wait for status to change to "complete"
6. **Review takeoff:** Click "View Takeoff" → verify fixtures and pipe lengths appear in the AG Grid
7. **Edit quantities:** Click a QTY cell, change the value → verify totals update in real-time
8. **View estimate:** Click "Estimate" → verify section totals and grand total
9. **Export:** Click "Export to Excel" → open the downloaded .xlsx in Excel
10. **Verify formulas:** In Excel, change a QTY cell → verify totals recalculate (formulas are live, not static values)

### Performance check

- DWG extraction: should complete in under 5 seconds per file
- PDF extraction: should complete in 1-2 minutes per set of 10-20 pages
- GPU utilization during PDF extraction: `docker compose exec extraction nvidia-smi`

---

## 14. Maintenance

### Update the application

```powershell
cd C:\Users\andre\Documents\GitHub\ppg-estimator
git pull
docker compose build
docker compose up -d
```

### View logs

```powershell
# All services
docker compose logs -f

# Specific service
docker compose logs -f extraction
docker compose logs -f web
docker compose logs -f db
```

### Restart services

```powershell
docker compose restart          # All services
docker compose restart web      # Just the frontend
docker compose restart extraction  # Just the extraction API
```

### Database maintenance

```powershell
# Connect to database
docker compose exec db psql -U ppg -d ppg_estimator

# Vacuum and analyze (run monthly)
docker compose exec db psql -U ppg -d ppg_estimator -c "VACUUM ANALYZE;"
```

### Update rate card

When rates change, import a new version via the Rate Cards page. Old versions are preserved — projects reference the version they were created with.

### Monitor disk space

With 1TB NVMe, monitor usage periodically:
```powershell
docker system df          # Docker disk usage
wmic logicaldisk get size,freespace,caption   # Windows disk usage
```

### Upgrading GPU for V2

When ready to scale or improve AI accuracy, consider upgrading to:
- **NVIDIA RTX 4060 Ti** (16GB) — fits in CFF with low-profile bracket
- **External GPU enclosure** with RTX 4090 (24GB) — for heavy training workloads

The T1000 8GB is sufficient for V1 inference. Upgrade when you need to:
- Fine-tune YOLOv8 on PPG's drawing annotations
- Process multiple extractions simultaneously
- Move toward Approach B (vision-first for multi-tenant)

---

## Architecture Summary

```
┌──────────────────────────────────────────────────┐
│            Precision 3280 (Windows 11 Pro)         │
│                                                    │
│  Docker Desktop (WSL 2)                            │
│  ┌─────────┐  ┌────────────┐  ┌──────────┐       │
│  │  nginx   │  │ Extraction │  │PostgreSQL│       │
│  │  :443    │  │ API        │  │  :5432   │       │
│  │  :80     │  │ FastAPI    │  │          │       │
│  │          │  │ :8000      │  │          │       │
│  └────┬─────┘  └──────┬─────┘  └──────────┘       │
│       │               │ GPU (T1000 8GB)            │
│  ┌────┴─────┐         │                            │
│  │  Web App │         │                            │
│  │  Next.js │  ┌──────┴──────────────────────┐    │
│  │  :3000   │  │ Local File Storage            │    │
│  └──────────┘  │ /data/uploads  /data/exports  │    │
│                └───────────────────────────────┘    │
│                                                    │
│  BitLocker encrypted C: drive                      │
│  LAN access only (firewall rules)                  │
│  Nightly backup to external drive                  │
└──────────────────────────────────────────────────┘
```

**Data never leaves this machine.** No cloud AI APIs, no external data transmission, no model training on PPG data.
