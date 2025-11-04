const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

let mainWindow;
let cancelRequested = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 700,
    height: 850,
    backgroundColor: '#000000',
    resizable: false,
    autoHideMenuBar: true,
    frame: false,
    icon: path.join(__dirname, 'favicon.ico'), 
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

// Get binary paths
function getBinaryPath(binary) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', binary);
  }
  return path.join(__dirname, 'bin', binary);
}

// IPC Handlers
ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv'] }
    ]
  });
  return result.filePaths;
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }
  
  const folderPath = result.filePaths[0];
  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv'];
  
  try {
    const files = fs.readdirSync(folderPath);
    const videoFiles = files
      .filter(file => videoExtensions.includes(path.extname(file).toLowerCase()))
      .map(file => path.join(folderPath, file));
    return videoFiles;
  } catch (err) {
    console.error('Error reading folder:', err);
    return [];
  }
});

ipcMain.handle('select-output-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('convert-files', async (event, { files, outputFolder, fps, width, quality }) => {
  cancelRequested = false;
  
  const results = {
    converted: 0,
    skipped: 0,
    totalTime: 0
  };
  
  const startTime = Date.now();
  
  // Determine output directory
  const outputDir = outputFolder || path.join(path.dirname(files[0]), 'gifs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  for (let i = 0; i < files.length; i++) {
    if (cancelRequested) {
      results.totalTime = (Date.now() - startTime) / 1000;
      return results;
    }
    
    const file = files[i];
    const filename = path.basename(file, path.extname(file)) + '.gif';
    const outputPath = path.join(outputDir, filename);
    
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
  
  // Create all unique output directories
  const uniqueFolders = [...new Set(files.map(f => f.outputFolder))];
  uniqueFolders.forEach(folder => {
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
  });
  
  for (let i = 0; i < files.length; i++) {
    if (cancelRequested) {
      results.totalTime = (Date.now() - startTime) / 1000;
      return results;
    }
    
    const fileConfig = files[i];
    
    // Send progress update
    event.sender.send('conversion-progress', {
      current: i + 1,
      total: files.length,
      filename: path.basename(fileConfig.inputPath)
    });
    
    // Check if already exists
    if (fs.existsSync(fileConfig.outputPath)) {
      results.skipped++;
      continue;
    }
    
    // Convert
    try {
      await convertSingleVideo(fileConfig.inputPath, fileConfig.outputPath, fps, width, quality);
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
    const stats = fs.statSync(filePath);
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
    const files = fs.readdirSync(folderPath);
    const videoFiles = files
      .filter(file => videoExtensions.includes(path.extname(file).toLowerCase()))
      .map(file => path.join(folderPath, file));
    return videoFiles;
  } catch (err) {
    console.error('Error reading folder:', err);
    return [];
  }
});

// Helper function for single video conversion
async function convertSingleVideo(file, outputPath, fps, width, quality) {
  return new Promise((resolve, reject) => {
    const basename = path.basename(file, path.extname(file));
    // Use system temp directory to avoid network drive issues
    const tempDir = path.join(os.tmpdir(), `gif_converter_${basename}_${Date.now()}`);
    
    try {
      fs.mkdirSync(tempDir, { recursive: true });
    } catch (err) {
      console.error('Failed to create temp directory:', err);
      reject(new Error('Failed to create temp directory'));
      return;
    }
    
    const framePattern = path.join(tempDir, 'frame%04d.png');
    const ffmpegPath = getBinaryPath('ffmpeg.exe');
    
    const ffmpeg = spawn(ffmpegPath, [
      '-i', file,
      '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos`,
      '-y',
      framePattern
    ]);
    
    let errorOutput = '';
    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        console.error('FFmpeg error:', errorOutput);
        cleanup(tempDir);
        reject(new Error(`FFmpeg failed with code ${code}`));
        return;
      }
      
      const gifskiPath = getBinaryPath('gifski.exe');
      const gifski = spawn(gifskiPath, [
        '--fps', fps.toString(),
        '--quality', quality.toString(),
        '-o', outputPath,
        path.join(tempDir, 'frame*.png')
      ]);
      
      let gifskiError = '';
      gifski.stderr.on('data', (data) => {
        gifskiError += data.toString();
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
      fs.readdirSync(dir).forEach(file => {
        fs.unlinkSync(path.join(dir, file));
      });
      fs.rmdirSync(dir);
    }
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}