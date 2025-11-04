const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

let mainWindow;
let cancelRequested = false;

function createWindow() {
  // Set icon based on platform
  let iconPath;
  if (process.platform === 'win32') {
    iconPath = path.join(__dirname, 'favicon.ico');
  } else if (process.platform === 'darwin') {
    iconPath = path.join(__dirname, 'gif.icns');
  } else {
    // Linux - try .png or .ico
    iconPath = path.join(__dirname, 'favicon.ico');
  }
  
  mainWindow = new BrowserWindow({
    width: 700,
    height: 850,
    backgroundColor: '#000000',
    resizable: false,
    autoHideMenuBar: true,
    frame: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools(); // Uncomment for debugging
}

// Add IPC handlers for window controls
ipcMain.on('minimize-window', () => {
  mainWindow.minimize();
});

ipcMain.on('close-window', () => {
  mainWindow.close();
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Get binary paths - cross-platform support
function getBinaryPath(binaryName) {
  // Determine binary extension based on platform
  let binary = binaryName;
  if (process.platform === 'win32') {
    binary = `${binaryName}.exe`;
  }
  // macOS/Linux binaries typically have no extension
  
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', binary);
  }
  return path.join(__dirname, 'bin', binary);
}

// Normalize paths for networked drives (handles UNC paths on Windows, network mounts on macOS)
function normalizePath(filePath) {
  if (!filePath) return filePath;
  
  // On Windows, preserve UNC paths (\\server\share)
  if (process.platform === 'win32') {
    // UNC paths start with \\ - preserve them
    if (filePath.startsWith('\\\\')) {
      return path.normalize(filePath);
    }
  }
  
  // Use Node's path.normalize for all other cases
  return path.normalize(filePath);
}

// IPC Handlers
ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv'] }
    ]
  });
  return result.filePaths.map(p => normalizePath(p));
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }
  
  const folderPath = normalizePath(result.filePaths[0]);
  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv'];
  
  try {
    const files = fs.readdirSync(folderPath);
    const videoFiles = files
      .filter(file => videoExtensions.includes(path.extname(file).toLowerCase()))
      .map(file => normalizePath(path.join(folderPath, file)));
    return videoFiles;
  } catch (err) {
    console.error('Error reading folder:', err);
    return [];
  }
});

ipcMain.handle('select-output-folder', async (event, defaultPath) => {
  const dialogOptions = {
    properties: ['openDirectory']
  };
  
  // Set default path if provided (for networked drives support)
  if (defaultPath) {
    dialogOptions.defaultPath = normalizePath(defaultPath);
  }
  
  const result = await dialog.showOpenDialog(mainWindow, dialogOptions);
  return result.canceled ? null : normalizePath(result.filePaths[0]);
});

ipcMain.handle('convert-files', async (event, { files, outputFolder, fps, width, quality }) => {
  cancelRequested = false;
  
  const results = {
    converted: 0,
    skipped: 0,
    totalTime: 0
  };
  
  const startTime = Date.now();
  
  // Determine output directory - normalize for networked drives
  const outputDir = normalizePath(outputFolder || path.join(path.dirname(files[0]), 'gifs'));
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  } catch (err) {
    console.error('Error creating output directory:', err);
    throw new Error(`Failed to create output directory: ${err.message}`);
  }
  
  for (let i = 0; i < files.length; i++) {
    if (cancelRequested) {
      results.totalTime = (Date.now() - startTime) / 1000;
      return results;
    }
    
    const file = normalizePath(files[i]);
    const filename = path.basename(file, path.extname(file)) + '.gif';
    const outputPath = normalizePath(path.join(outputDir, filename));
    
    // Send progress update
    event.sender.send('conversion-progress', {
      current: i + 1,
      total: files.length,
      filename: path.basename(file)
    });
    
    // Check if already exists
    if (fs.existsSync(outputPath)) {
      results.skipped++;
      continue;
    }
    
    // Convert
    try {
      await convertSingleVideo(file, outputPath, fps, width, quality);
      results.converted++;
    } catch (err) {
      console.error('Conversion error:', err);
    }
  }
  
  results.totalTime = (Date.now() - startTime) / 1000;
  return results;
});

ipcMain.on('open-folder', (event, folderPath) => {
  shell.openPath(folderPath);
});

ipcMain.handle('convert-files-with-settings', async (event, { files, fps, width, quality }) => {
  cancelRequested = false;
  
  const results = {
    converted: 0,
    skipped: 0,
    totalTime: 0
  };
  
  const startTime = Date.now();
  
  // Create all unique output directories - normalize for networked drives
  const uniqueFolders = [...new Set(files.map(f => normalizePath(f.outputFolder)))];
  uniqueFolders.forEach(folder => {
    try {
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
      }
    } catch (err) {
      console.error(`Error creating output directory ${folder}:`, err);
      // Continue with other folders, but log the error
    }
  });
  
  for (let i = 0; i < files.length; i++) {
    if (cancelRequested) {
      results.totalTime = (Date.now() - startTime) / 1000;
      return results;
    }
    
    const fileConfig = files[i];
    
    // Normalize paths for networked drives
    const inputPath = normalizePath(fileConfig.inputPath);
    const outputPath = normalizePath(fileConfig.outputPath);
    
    // Send progress update
    event.sender.send('conversion-progress', {
      current: i + 1,
      total: files.length,
      filename: path.basename(inputPath)
    });
    
    // Check if already exists
    if (fs.existsSync(outputPath)) {
      results.skipped++;
      continue;
    }
    
    // Convert
    try {
      await convertSingleVideo(inputPath, outputPath, fps, width, quality);
      results.converted++;
    } catch (err) {
      console.error('Conversion error:', err);
    }
  }
  
  results.totalTime = (Date.now() - startTime) / 1000;
  return results;
});

// Add these handlers with your other ipcMain handlers
ipcMain.handle('get-file-stats', async (event, filePath) => {
  try {
    const normalizedPath = normalizePath(filePath);
    const stats = fs.statSync(normalizedPath);
    return {
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile()
    };
  } catch (err) {
    console.error('Error getting file stats:', err);
    return { isDirectory: false, isFile: false };
  }
});

ipcMain.handle('get-video-files-from-folder', async (event, folderPath) => {
  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv'];
  
  try {
    const normalizedFolderPath = normalizePath(folderPath);
    const files = fs.readdirSync(normalizedFolderPath);
    const videoFiles = files
      .filter(file => videoExtensions.includes(path.extname(file).toLowerCase()))
      .map(file => normalizePath(path.join(normalizedFolderPath, file)));
    return videoFiles;
  } catch (err) {
    console.error('Error reading folder:', err);
    return [];
  }
});

// Helper function for single video conversion
async function convertSingleVideo(file, outputPath, fps, width, quality) {
  return new Promise((resolve, reject) => {
    // Normalize input and output paths for networked drives
    const normalizedFile = normalizePath(file);
    const normalizedOutputPath = normalizePath(outputPath);
    
    const basename = path.basename(normalizedFile, path.extname(normalizedFile));
    // Sanitize basename to avoid issues with special characters
    const sanitizedBasename = basename.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // Use system temp directory to avoid network drive issues
    // This ensures temp files are always on local storage, even when working with network drives
    const tempDir = path.join(os.tmpdir(), `gif_converter_${sanitizedBasename}_${Date.now()}`);
    
    try {
      fs.mkdirSync(tempDir, { recursive: true });
    } catch (err) {
      console.error('Failed to create temp directory:', err);
      reject(new Error('Failed to create temp directory'));
      return;
    }
    
    const framePattern = path.join(tempDir, 'frame%04d.png');
    const ffmpegPath = getBinaryPath('ffmpeg');
    
    // On Windows, ensure the binary is executable
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(ffmpegPath, '755');
      } catch (err) {
        // Ignore chmod errors, may not be critical
      }
    }
    
    const ffmpeg = spawn(ffmpegPath, [
      '-i', normalizedFile,
      '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos`,
      '-y',
      framePattern
    ]);
    
    let errorOutput = '';
    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    ffmpeg.on('error', (err) => {
      console.error('FFmpeg spawn error:', err);
      cleanup(tempDir);
      reject(new Error(`Failed to start FFmpeg: ${err.message}`));
    });
    
    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        console.error('FFmpeg error:', errorOutput);
        cleanup(tempDir);
        reject(new Error(`FFmpeg failed with code ${code}`));
        return;
      }
      
      const gifskiPath = getBinaryPath('gifski');
      
      // On Windows, ensure the binary is executable
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(gifskiPath, '755');
        } catch (err) {
          // Ignore chmod errors, may not be critical
        }
      }
      
      // Gifski accepts glob patterns on all platforms
      // On Unix-like systems, use shell for proper glob expansion
      const framePatternArg = path.join(tempDir, 'frame*.png');
      
      const gifski = spawn(gifskiPath, [
        '--fps', fps.toString(),
        '--quality', quality.toString(),
        '-o', normalizedOutputPath,
        framePatternArg
      ], {
        // On Unix-like systems, use shell for glob expansion
        // On Windows, gifski handles the pattern directly
        shell: process.platform !== 'win32'
      });
      
      let gifskiError = '';
      gifski.stderr.on('data', (data) => {
        gifskiError += data.toString();
      });
      
      gifski.on('error', (err) => {
        console.error('Gifski spawn error:', err);
        cleanup(tempDir);
        reject(new Error(`Failed to start Gifski: ${err.message}`));
      });
      
      gifski.on('close', (code) => {
        cleanup(tempDir);
        if (code === 0) {
          resolve();
        } else {
          console.error('Gifski error:', gifskiError);
          reject(new Error(`Gifski failed with code ${code}`));
        }
      });
    });
  });
}

function cleanup(dir) {
  try {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        try {
          const filePath = path.join(dir, file);
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            // Recursively clean subdirectories
            cleanup(filePath);
            fs.rmdirSync(filePath);
          } else {
            fs.unlinkSync(filePath);
          }
        } catch (err) {
          console.error(`Error removing file ${file}:`, err);
        }
      });
      fs.rmdirSync(dir);
    }
  } catch (err) {
    console.error('Cleanup error:', err);
    // Don't throw - cleanup errors shouldn't break the app
  }
}