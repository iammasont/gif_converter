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
  
  // Open DevTools for debugging (uncomment if needed)
  // For packaged apps, you can also add a keyboard shortcut to toggle DevTools
  if (!app.isPackaged) {
    // mainWindow.webContents.openDevTools(); // Uncomment for debugging in dev mode
  }
  
  // Log errors to console
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });
  
  // Enable DevTools with Cmd+Option+I (Mac) or Ctrl+Shift+I (Windows/Linux)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'i' && (input.meta || input.control) && input.shift) {
      mainWindow.webContents.toggleDevTools();
    }
  });
  
  // Log all console messages
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer ${level}]:`, message);
  });
}

// Add IPC handlers for window controls
ipcMain.on('minimize-window', () => {
  mainWindow.minimize();
});

ipcMain.on('close-window', () => {
  mainWindow.close();
});

app.whenReady().then(() => {
  createWindow(); // Create the initial window
  
  // Now that the app is ready, set up the activate listener
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Get binary paths - cross-platform support
function getBinaryPath(binaryName) {
  // Determine binary extension for Windows
  let binary = (process.platform === 'win32') ? `${binaryName}.exe` : binaryName;
  
  let arch = process.arch; // 'arm64' or 'x64'
  let platform = process.platform; // 'darwin' or 'win32'
  let platformArchFolder;

  // Determine the correct subfolder
  if (platform === 'darwin') {
    if (arch === 'arm64') {
      platformArchFolder = 'mac-arm64';
    } else {
      // Default to x64 for Intel or Rosetta
      platformArchFolder = 'mac-x64';
    }
  } else if (platform === 'win32') {
    // Assuming 64-bit Windows for simplicity
    platformArchFolder = 'win-x64'; // You'll need to create this folder for Windows
  } else {
    // Unsupported platform
    throw new Error(`Unsupported platform: ${platform}`);
  }

  let binaryPath;
  if (app.isPackaged) {
    // In production, extraResources are copied to the resourcesPath
    binaryPath = path.join(process.resourcesPath, 'bin', platformArchFolder, binary);
  } else {
    // In development
    binaryPath = path.join(__dirname, 'bin', platformArchFolder, binary);
  }
  
  // Resolve to absolute path
  binaryPath = path.resolve(binaryPath);
  
  // Verify binary exists
  if (!fs.existsSync(binaryPath)) {
    console.error(`Binary not found at expected path: ${binaryPath}`);
    console.error(`Platform: ${platform}, Arch: ${arch}`);
    throw new Error(`Binary not found: ${binaryName} for ${platform}-${arch}`);
  }
  
  // On macOS, remove quarantine attribute
  if (process.platform === 'darwin') {
    try {
      const { execSync } = require('child_process');
      execSync(`xattr -d com.apple.quarantine "${binaryPath}" 2>/dev/null || true`, { stdio: 'ignore' });
    } catch (err) {
      // Ignore errors - xattr might not be available or already removed
    }
  }
  
  console.log(`Binary resolved: ${binaryPath}`);
  return binaryPath;
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
      console.log(`Successfully converted: ${file} -> ${outputPath}`);
    } catch (err) {
      console.error('Conversion error:', err);
      console.error('Input:', file);
      console.error('Output:', outputPath);
      // Re-throw to show error to user
      throw err;
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
      console.log(`Successfully converted: ${inputPath} -> ${outputPath}`);
    } catch (err) {
      console.error('Conversion error:', err);
      console.error('Input:', inputPath);
      console.error('Output:', outputPath);
      // Re-throw to show error to user
      throw err;
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
    // *** MODIFICATION: Added guard variable ***
    let ffmpegFinished = false;

    // Normalize input and output paths for networked drives
    const normalizedFile = normalizePath(file);
    const normalizedOutputPath = normalizePath(outputPath);
    
    const basename = path.basename(normalizedFile, path.extname(normalizedFile));
    // Sanitize basename to avoid issues with special characters
    const sanitizedBasename = basename.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // Use system temp directory to avoid network drive issues
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
    
    console.log(`FFmpeg path: ${ffmpegPath}`);
    console.log(`FFmpeg exists: ${fs.existsSync(ffmpegPath)}`);
    
    // Use absolute paths for input file
    const absoluteInputFile = path.isAbsolute(normalizedFile) 
      ? normalizedFile 
      : path.resolve(normalizedFile);
    
    const ffmpegArgs = [
      '-nostdin', 
      '-i', absoluteInputFile,
      '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos`,
      '-y',
      framePattern
    ];
    
    console.log(`Running FFmpeg: ${ffmpegPath}`);
    console.log(`FFmpeg args:`, ffmpegArgs);
    console.log(`Absolute input file: ${absoluteInputFile}`);
    console.log(`Temp dir: ${tempDir}`);
    
    console.log(`Spawning FFmpeg process...`);
    
    // Test if binary works by running a quick version check first
    try {
      const testProcess = spawn(ffmpegPath, ['-version'], { stdio: 'pipe' });
      let testOutput = '';
      testProcess.stdout.on('data', (data) => { testOutput += data.toString(); });
      testProcess.stderr.on('data', (data) => { testOutput += data.toString(); });
      
      testProcess.on('close', (code) => {
        if (code === 0 && testOutput.includes('ffmpeg version')) {
          console.log('FFmpeg binary test passed');
        } else {
          console.warn('FFmpeg binary test suspicious - code:', code);
        }
      });
      
      setTimeout(() => {
        if (!testProcess.killed && testProcess.exitCode === null) {
          testProcess.kill();
        }
      }, 2000);
    } catch (err) {
      console.warn('Could not test FFmpeg binary:', err.message);
    }
    
    const ffmpeg = spawn(ffmpegPath, ffmpegArgs, {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'], 
      detached: false
    });
    
    if (ffmpeg.stdin) {
      ffmpeg.stdin.end();
    }
    
    ffmpeg.stdin.on('error', (err) => {
      if (err.code !== 'EPIPE') {
        console.warn('FFmpeg stdin error:', err);
      }
    });
    
    console.log(`FFmpeg process spawned - PID: ${ffmpeg.pid}`);
    
    setTimeout(() => {
      try {
        process.kill(ffmpeg.pid, 0); 
        console.log(`FFmpeg process ${ffmpeg.pid} exists`);
      } catch (err) {
        console.error(`FFmpeg process ${ffmpeg.pid} does not exist!`, err);
      }
    }, 100);
    
    const startupTimeout = setTimeout(() => {
      if (!ffmpegStarted) {
        console.error('FFmpeg timeout - no output after 10 seconds');
        console.error('Attempting to kill process...');
        try {
          ffmpeg.kill('SIGTERM');
          setTimeout(() => {
            if (!ffmpeg.killed) {
              ffmpeg.kill('SIGKILL');
            }
          }, 2000);
        } catch (err) {
          console.error('Error killing FFmpeg:', err);
        }
        
        // *** MODIFICATION: Added clearInterval ***
        clearInterval(activityMonitor); 

        cleanup(tempDir);
        reject(new Error('FFmpeg failed to start - no output received after 10 seconds. Check if the binary is working.'));
      }
    }, 10000);
    
    let errorOutput = '';
    let standardOutput = '';
    let lastActivity = Date.now();
    let frameCount = 0;
    let ffmpegStarted = false;
    
    const activityMonitor = setInterval(() => {
      const timeSinceActivity = Date.now() - lastActivity;
      
      try {
        const isRunning = !ffmpeg.killed && ffmpeg.exitCode === null;
        console.log(`FFmpeg status - Running: ${isRunning}, Killed: ${ffmpeg.killed}, ExitCode: ${ffmpeg.exitCode}`);
      } catch (err) {
        console.log('FFmpeg status check error:', err.message);
      }
      
      // Check if frames are being created
      try {
        const currentFrames = fs.readdirSync(tempDir).filter(f => f.startsWith('frame') && f.endsWith('.png')).length;
        
        // *** MODIFICATION: Added this block to cancel timeout if frames are found ***
        if (currentFrames > 0 && !ffmpegStarted) {
            console.log('Activity monitor confirmed FFmpeg start.');
            clearTimeout(startupTimeout); // Cancel the 10-second timeout
            ffmpegStarted = true;         // Mark it as started
        }

        if (currentFrames > frameCount) {
          frameCount = currentFrames;
          lastActivity = Date.now();
          console.log(`FFmpeg progress: ${frameCount} frames created`);
        } else if (currentFrames > 0) {
          console.log(`FFmpeg: ${currentFrames} frames exist (no new frames)`);
        }
      } catch (err) {
        // Error here is fine if dir doesn't exist yet
      }
      
      if (timeSinceActivity > 10000) {
        if (!ffmpegStarted) {
          console.warn(`FFmpeg hasn't started outputting - waiting ${Math.round(timeSinceActivity/1000)}s`);
          console.warn(`Process PID: ${ffmpeg.pid}`);
          console.warn(`Process killed: ${ffmpeg.killed}`);
        } else {
          // *** MODIFICATION: Check if process is still running before saying "stuck" ***
          const isStillRunning = !ffmpeg.killed && ffmpeg.exitCode === null;
          if (isStillRunning) {
            console.warn(`FFmpeg appears stuck - no activity for ${Math.round(timeSinceActivity/1000)}s`);
            console.warn(`Current frames: ${frameCount}`);
            console.warn(`FFmpeg process alive: ${!ffmpeg.killed}`);
          }
        }
      }
    }, 2000); 
    
    ffmpeg.stdout.on('data', (data) => {
      const output = data.toString();
      standardOutput += output;
      lastActivity = Date.now();
      console.log('FFmpeg stdout:', output.trim());
    });
    
    ffmpeg.stdout.on('readable', () => {
      console.log('FFmpeg stdout is readable');
    });
    
    ffmpeg.stdout.on('error', (err) => {
      console.error('FFmpeg stdout error:', err);
    });
    
    ffmpeg.stderr.on('data', (data) => {
      clearTimeout(startupTimeout); 
      const output = data.toString();
      errorOutput += output;
      lastActivity = Date.now();
      if (!ffmpegStarted) {
        console.log('FFmpeg started producing output!');
        ffmpegStarted = true;
      }
      
      const frameMatch = output.match(/frame=\s*(\d+)/);
      if (frameMatch) {
        const currentFrame = parseInt(frameMatch[1]);
        if (currentFrame > frameCount) {
          frameCount = currentFrame;
          console.log(`FFmpeg frame: ${currentFrame}`);
        }
      }
      
      const lines = output.split('\n').filter(l => l.trim());
      lines.forEach(line => {
        if (errorOutput.length < 2000 || line.includes('frame=') || line.includes('error') || line.includes('Duration:') || line.includes('Stream') || line.includes('Input')) {
          console.log('FFmpeg:', line.trim());
        }
      });
    });
    
    ffmpeg.stderr.on('readable', () => {
      console.log('FFmpeg stderr is readable');
    });
    
    ffmpeg.stderr.on('error', (err) => {
      console.error('FFmpeg stderr error:', err);
    });
    
    ffmpeg.on('error', (err) => {
      clearTimeout(startupTimeout);
      clearInterval(activityMonitor);
      console.error('FFmpeg spawn error:', err);
      cleanup(tempDir);
      reject(new Error(`Failed to start FFmpeg: ${err.message} (code: ${err.code})`));
    });
    
    // *** MODIFICATION: Moved all logic from 'close' to this new function ***
    function handleFfmpegFinished(code, signal) {
      // Guard to ensure this only runs once
      if (ffmpegFinished) return;
      ffmpegFinished = true;

      clearTimeout(startupTimeout);
      clearInterval(activityMonitor);
      console.log(`FFmpeg finished - exit code: ${code}, signal: ${signal}`);
      console.log(`Total frames processed: ${frameCount}`);
      
      if (code === null) {
        console.error('FFmpeg process was killed or failed to start');
        console.error('FFmpeg stderr:', errorOutput);
        cleanup(tempDir);
        reject(new Error(`FFmpeg process failed to start or was killed. Error: ${errorOutput || 'Unknown error'}`));
        return;
      }
      
      if (code !== 0) {
        console.error('FFmpeg error output:', errorOutput);
        console.error('FFmpeg standard output:', standardOutput);
        cleanup(tempDir);
        reject(new Error(`FFmpeg failed with code ${code}. Error: ${errorOutput}`));
        return;
      }
      
      const frameFiles = fs.readdirSync(tempDir).filter(f => f.startsWith('frame') && f.endsWith('.png')).sort();
      if (frameFiles.length === 0) {
        console.error('No frame files created by FFmpeg');
        console.error('FFmpeg stderr (last 1000 chars):', errorOutput.slice(-1000));
        cleanup(tempDir);
        reject(new Error('FFmpeg did not create any frame files'));
        return;
      }
      
      console.log(`FFmpeg created ${frameFiles.length} frame files`);
      
      const gifskiPath = getBinaryPath('gifski');
      const frameFilesList = frameFiles.map(f => path.join(tempDir, f));
      
      console.log(`Calling gifski with ${frameFilesList.length} frames`);
      console.log(`Output path: ${normalizedOutputPath}`);
      
      const gifskiArgs = [
        '--fps', fps.toString(),
        '--quality', quality.toString(),
        '-o', normalizedOutputPath,
        ...frameFilesList
      ];
      
      console.log('Gifski command:', gifskiPath, gifskiArgs.join(' '));
      
      const gifski = spawn(gifskiPath, gifskiArgs, {
        shell: false
      });
      
      let gifskiOutput = '';
      let gifskiError = '';
      let gifskiLastActivity = Date.now();
      let gifskiStarted = false;
      
      const gifskiMonitor = setInterval(() => {
        const timeSinceActivity = Date.now() - gifskiLastActivity;
        try {
          if (fs.existsSync(normalizedOutputPath)) {
            const stats = fs.statSync(normalizedOutputPath);
            gifskiLastActivity = Date.now();
            console.log(`Gifski progress: Output file ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
          }
        } catch (err) {
          // Ignore errors
        }
        
        if (timeSinceActivity > 30000 && gifskiStarted) {
          console.warn(`Gifski appears stuck - no activity for ${Math.round(timeSinceActivity/1000)}s`);
          console.warn(`Gifski process alive: ${!gifski.killed}`);
        }
      }, 5000);
      
      gifski.stdout.on('data', (data) => {
        const output = data.toString();
        gifskiOutput += output;
        gifskiLastActivity = Date.now();
        gifskiStarted = true;
        console.log('Gifski output:', output.trim());
      });
      
      gifski.stderr.on('data', (data) => {
        const output = data.toString();
        gifskiError += output;
        gifskiLastActivity = Date.now();
        gifskiStarted = true;
        console.log('Gifski stderr:', output.trim());
      });
      
      gifski.on('error', (err) => {
        clearInterval(gifskiMonitor);
        console.error('Gifski spawn error:', err);
        cleanup(tempDir);
        reject(new Error(`Failed to start Gifski: ${err.message}`));
      });
      
      gifski.on('close', (code) => {
        clearInterval(gifskiMonitor);
        console.log(`Gifski finished with exit code: ${code}`);
        
        cleanup(tempDir);
        
        if (code === 0) {
          if (fs.existsSync(normalizedOutputPath)) {
            const stats = fs.statSync(normalizedOutputPath);
            console.log(`GIF created successfully: ${normalizedOutputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
            resolve();
          } else {
            console.error(`GIF file not found after conversion: ${normalizedOutputPath}`);
            reject(new Error(`GIF file was not created at ${normalizedOutputPath}`));
          }
        } else {
          console.error('Gifski error:', gifskiError || gifskiOutput);
          reject(new Error(`Gifski failed with code ${code}: ${gifskiError || gifskiOutput}`));
        }
      });
    }

    // *** MODIFICATION: Listen to 'exit' as well as 'close' ***
    ffmpeg.on('exit', (code, signal) => {
      handleFfmpegFinished(code, signal);
    });
    
    ffmpeg.on('close', (code, signal) => {
      handleFfmpegFinished(code, signal);
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
  }
}