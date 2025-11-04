# Setting Up Binaries for GIF Converter

## macOS Setup

### Option 1: Using Homebrew (Recommended)

```bash
# Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install ffmpeg
brew install ffmpeg

# Install gifski
brew install gifski

# Copy binaries to bin directory
cp $(which ffmpeg) bin/ffmpeg
cp $(which gifski) bin/gifski

# Make binaries executable
chmod +x bin/ffmpeg bin/gifski
```

### Option 2: Manual Download

#### FFmpeg for macOS:
```bash
# Download ffmpeg (choose the right architecture)
# For Intel (x64):
curl -L https://evermeet.cx/ffmpeg/ffmpeg-6.1.1.zip -o ffmpeg.zip
unzip ffmpeg.zip
mv ffmpeg bin/ffmpeg
chmod +x bin/ffmpeg
rm ffmpeg.zip

# For Apple Silicon (arm64):
curl -L https://evermeet.cx/ffmpeg/ffmpeg-6.1.1-arm64.zip -o ffmpeg.zip
unzip ffmpeg.zip
mv ffmpeg bin/ffmpeg
chmod +x bin/ffmpeg
rm ffmpeg.zip
```

#### Gifski for macOS:
```bash
# Download gifski (universal binary or architecture-specific)
curl -L https://github.com/ImageOptim/gifski/releases/latest/download/gifski-mac.zip -o gifski.zip
unzip gifski.zip
mv gifski bin/gifski
chmod +x bin/gifski
rm gifski.zip
```

## Windows Setup

### Option 1: Using Chocolatey (Recommended)

```powershell
# Install Chocolatey if you don't have it (run as Administrator)
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install ffmpeg
choco install ffmpeg -y

# Install gifski
choco install gifski -y

# Copy binaries to bin directory
Copy-Item "C:\ProgramData\chocolatey\bin\ffmpeg.exe" "bin\ffmpeg.exe"
Copy-Item "C:\ProgramData\chocolatey\bin\gifski.exe" "bin\gifski.exe"
```

### Option 2: Manual Download

#### FFmpeg for Windows:
```powershell
# Download ffmpeg
# Visit https://www.gyan.dev/ffmpeg/builds/ or https://ffmpeg.org/download.html
# Download the "ffmpeg-release-essentials.zip" or build from source
# Extract and copy ffmpeg.exe to bin\ffmpeg.exe

# Or use PowerShell to download:
Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile "ffmpeg.zip"
Expand-Archive -Path "ffmpeg.zip" -DestinationPath "temp_ffmpeg"
Copy-Item "temp_ffmpeg\ffmpeg-*\bin\ffmpeg.exe" "bin\ffmpeg.exe"
Remove-Item -Recurse -Force "temp_ffmpeg"
Remove-Item "ffmpeg.zip"
```

#### Gifski for Windows:
```powershell
# Download gifski
Invoke-WebRequest -Uri "https://github.com/ImageOptim/gifski/releases/latest/download/gifski-win.zip" -OutFile "gifski.zip"
Expand-Archive -Path "gifski.zip" -DestinationPath "temp_gifski"
Copy-Item "temp_gifski\gifski.exe" "bin\gifski.exe"
Remove-Item -Recurse -Force "temp_gifski"
Remove-Item "gifski.zip"
```

## Quick Setup Script for macOS

Save this as `setup-binaries.sh` in your project root:

```bash
#!/bin/bash
set -e

echo "Setting up binaries for GIF Converter..."

# Create bin directory if it doesn't exist
mkdir -p bin

# Check if Homebrew is installed
if ! command -v brew &> /dev/null; then
    echo "Homebrew not found. Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Install dependencies
echo "Installing ffmpeg..."
brew install ffmpeg

echo "Installing gifski..."
brew install gifski

# Copy binaries
echo "Copying binaries to bin directory..."
cp $(which ffmpeg) bin/ffmpeg
cp $(which gifski) bin/gifski

# Make executable
chmod +x bin/ffmpeg bin/gifski

echo "✅ Binaries setup complete!"
echo "Files in bin/:"
ls -lh bin/
```

Make it executable and run:
```bash
chmod +x setup-binaries.sh
./setup-binaries.sh
```

## Quick Setup Script for Windows

Save this as `setup-binaries.ps1` in your project root:

```powershell
# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "This script needs to be run as Administrator for Chocolatey installation" -ForegroundColor Yellow
    exit 1
}

Write-Host "Setting up binaries for GIF Converter..." -ForegroundColor Cyan

# Create bin directory if it doesn't exist
New-Item -ItemType Directory -Force -Path "bin" | Out-Null

# Check if Chocolatey is installed
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Chocolatey..." -ForegroundColor Yellow
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
}

# Install dependencies
Write-Host "Installing ffmpeg..." -ForegroundColor Cyan
choco install ffmpeg -y

Write-Host "Installing gifski..." -ForegroundColor Cyan
choco install gifski -y

# Copy binaries
Write-Host "Copying binaries to bin directory..." -ForegroundColor Cyan
$ffmpegPath = "C:\ProgramData\chocolatey\bin\ffmpeg.exe"
$gifskiPath = "C:\ProgramData\chocolatey\bin\gifski.exe"

if (Test-Path $ffmpegPath) {
    Copy-Item $ffmpegPath "bin\ffmpeg.exe" -Force
    Write-Host "✅ ffmpeg.exe copied" -ForegroundColor Green
} else {
    Write-Host "❌ ffmpeg.exe not found at $ffmpegPath" -ForegroundColor Red
}

if (Test-Path $gifskiPath) {
    Copy-Item $gifskiPath "bin\gifski.exe" -Force
    Write-Host "✅ gifski.exe copied" -ForegroundColor Green
} else {
    Write-Host "❌ gifski.exe not found at $gifskiPath" -ForegroundColor Red
}

Write-Host "`n✅ Binaries setup complete!" -ForegroundColor Green
Write-Host "Files in bin\:" -ForegroundColor Cyan
Get-ChildItem bin\ | Format-Table Name, Length
```

Run from PowerShell as Administrator:
```powershell
.\setup-binaries.ps1
```

## Verification

After setup, verify the binaries are in place:

**macOS:**
```bash
ls -lh bin/
bin/ffmpeg --version
bin/gifski --version
```

**Windows:**
```powershell
dir bin\
bin\ffmpeg.exe -version
bin\gifski.exe --version
```

## Notes

- The `bin/` directory is gitignored, so binaries won't be committed to version control
- For production builds, you'll need binaries for each target platform (Windows and macOS)
- When building for distribution, ensure you have the correct binaries for each platform in your build environment

