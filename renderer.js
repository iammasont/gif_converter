let files = [];
let selectedIndices = new Set();
let lastSelectedIndex = null;
let expandedIndices = new Set();
let fileSettings = []; // Store custom settings per file
let outputFolder = null;
let isConverting = false;
let cancelRequested = false;
let selectionMode = false; // New: track if we're in selection mode

// Elements
const fileItems = document.getElementById('file-items');
const dropZone = document.getElementById('drop-zone');
const status = document.getElementById('status');
const progressFill = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const timeLabel = document.getElementById('time-label');
const outputDisplay = document.getElementById('output-display');

const addFilesBtn = document.getElementById('add-files-btn');
const addFolderBtn = document.getElementById('add-folder-btn');
const clearBtn = document.getElementById('clear-btn');
const removeBtn = document.getElementById('remove-btn');
const selectBtn = document.getElementById('select-btn');
const batchPathBtn = document.getElementById('batch-path-btn');
const setOutputBtn = document.getElementById('set-output-btn');
const convertBtn = document.getElementById('convert-btn');
const cancelBtn = document.getElementById('cancel-btn');

const fpsInput = document.getElementById('fps');
const widthInput = document.getElementById('width');
const qualityInput = document.getElementById('quality');

const path = {
  basename: (filepath, ext) => {
    const parts = filepath.replace(/\\/g, '/').split('/');
    const filename = parts[parts.length - 1];
    if (ext) {
      return filename.replace(ext, '');
    }
    return filename;
  },
  extname: (filepath) => {
    const match = filepath.match(/\.[^.]+$/);
    return match ? match[0] : '';
  },
  dirname: (filepath) => {
    return filepath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  },
  join: (...parts) => {
    return parts.join('/').replace(/\/+/g, '/');
  }
};

// Window control buttons
document.getElementById('minimize-btn').addEventListener('click', () => {
  window.electronAPI.minimizeWindow();
});

document.getElementById('close-btn').addEventListener('click', () => {
  window.electronAPI.closeWindow();
});

// Event Listeners
addFilesBtn.addEventListener('click', async () => {
  const newFiles = await window.electronAPI.selectFiles();
  addFiles(newFiles);
});

addFolderBtn.addEventListener('click', async () => {
  const newFiles = await window.electronAPI.selectFolder();
  addFiles(newFiles);
});

clearBtn.addEventListener('click', () => {
  files = [];
  fileSettings = [];
  selectedIndices.clear();
  expandedIndices.clear();
  lastSelectedIndex = null;
  selectionMode = false;
  renderFiles();
  updateStatus('READY');
  updateProgressBar(0, false);
  progressLabel.textContent = '';
  timeLabel.textContent = '';
});

selectBtn.addEventListener('click', () => {
  selectionMode = !selectionMode;
  if (!selectionMode) {
    // Exiting selection mode - clear selections
    selectedIndices.clear();
    lastSelectedIndex = null;
  }
  renderFiles();
  updateSelectionUI();
});

removeBtn.addEventListener('click', () => {
  if (selectedIndices.size > 0) {
    const indicesToRemove = Array.from(selectedIndices).sort((a, b) => b - a);
    indicesToRemove.forEach(index => {
      files.splice(index, 1);
      fileSettings.splice(index, 1);
      expandedIndices.delete(index);
    });
    
    selectedIndices.clear();
    lastSelectedIndex = null;
    renderFiles();
    updateSelectionUI();
    
    if (files.length > 0) {
      updateStatus(`${files.length} LOADED`);
      updateProgressBar(0, false);
    } else {
      updateStatus('READY');
      updateProgressBar(0, false);
      selectionMode = false;
    }
  }
});

batchPathBtn.addEventListener('click', async () => {
  if (selectedIndices.size === 0) return;
  
  let defaultPath = undefined;
  if (files.length > 0) {
    const firstSelectedIndex = Math.min(...selectedIndices);
    defaultPath = path.dirname(files[firstSelectedIndex]);
  }
  
  const folder = await window.electronAPI.selectOutputFolder(defaultPath);
  if (folder) {
    // Apply to all selected files
    selectedIndices.forEach(index => {
      fileSettings[index].customPath = folder;
    });
    renderFiles();
  }
});

setOutputBtn.addEventListener('click', async () => {
  let defaultPath = undefined;
  if (files.length > 0) {
    defaultPath = path.dirname(files[0]);
  }
  
  const folder = await window.electronAPI.selectOutputFolder(defaultPath);
  if (folder) {
    outputFolder = folder;
    const displayPath = folder.length > 50 ? '...' + folder.slice(-47) : folder;
    outputDisplay.textContent = displayPath;
    outputDisplay.classList.add('set');
  }
});

convertBtn.addEventListener('click', () => {
  if (files.length === 0) {
    setProgressLabel('• NO FILES SELECTED', 'error');
    return;
  }
  convertFiles();
});

cancelBtn.addEventListener('click', () => {
  if (isConverting) {
    cancelRequested = true;
    setProgressLabel('• CANCELLING...', 'error');
    cancelBtn.disabled = true;
  }
});

// Drag and Drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  
  const items = Array.from(e.dataTransfer.files);
  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv'];
  let validFiles = [];
  
  for (const item of items) {
    const itemPath = item.path;
    
    // Check if it's a directory using Node.js fs via Electron
    const stat = await window.electronAPI.getFileStats(itemPath);
    
    if (stat.isDirectory) {
      // It's a folder - get all video files from it
      const folderFiles = await window.electronAPI.getVideoFilesFromFolder(itemPath);
      validFiles.push(...folderFiles);
    } else if (videoExtensions.includes(path.extname(itemPath).toLowerCase())) {
      // It's a video file
      validFiles.push(itemPath);
    }
  }
  
  if (validFiles.length > 0) {
    addFiles(validFiles);
  }
});

// Functions
function addFiles(newFiles) {
  newFiles.forEach(file => {
    if (!files.includes(file)) {
      files.push(file);
      // Initialize default settings for this file
      fileSettings.push({
        customName: null,
        customPath: null
      });
    }
  });
  
  renderFiles();
  
  if (files.length > 0) {
    updateStatus(`${files.length} LOADED`);
    updateProgressBar(0, false);
  }
}

function updateSelectionUI() {
  // Update button text and visibility
  selectBtn.textContent = selectionMode ? '[DONE]' : '[SELECT]';
  
  // Show/hide batch action buttons based on selection
  if (selectionMode && selectedIndices.size > 0) {
    removeBtn.style.display = 'block';
    batchPathBtn.style.display = 'block';
  } else if (selectionMode && selectedIndices.size === 0) {
    removeBtn.style.display = 'none';
    batchPathBtn.style.display = 'none';
  } else {
    // Not in selection mode - hide everything
    removeBtn.style.display = 'none';
    batchPathBtn.style.display = 'none';
  }
}

function renderFiles() {
  fileItems.innerHTML = '';
  
  files.forEach((file, index) => {
    const isExpanded = expandedIndices.has(index);
    const isSelected = selectedIndices.has(index);
    const settings = fileSettings[index];
    
    // Main row container
    const rowDiv = document.createElement('div');
    rowDiv.className = 'file-row';
    if (isSelected) rowDiv.classList.add('selected');
    
    // Header (always visible)
    const headerDiv = document.createElement('div');
    headerDiv.className = 'file-header';
    
    // Checkbox (only in selection mode)
    if (selectionMode) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'file-checkbox';
      checkbox.checked = isSelected;
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      checkbox.addEventListener('change', (e) => {
        handleCheckboxChange(index, e.shiftKey);
      });
      headerDiv.appendChild(checkbox);
    }
    
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.innerHTML = isExpanded ? `
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    ` : `
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    arrow.style.marginRight = '8px';
    arrow.style.cursor = 'pointer';
    arrow.style.userSelect = 'none';
    arrow.style.display = 'flex';
    arrow.style.alignItems = 'center';
    
    // Editable file name
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'file-name-input';
    nameInput.value = settings.customName || path.basename(file, path.extname(file));
    nameInput.spellcheck = false;
    
    // Extension label
    const extSpan = document.createElement('span');
    extSpan.className = 'file-extension';
    extSpan.textContent = '.gif';
    
    // Arrow click handler for expansion
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Toggle expansion
      if (expandedIndices.has(index)) {
        expandedIndices.delete(index);
      } else {
        expandedIndices.add(index);
      }
      
      renderFiles();
    });
    
    // Input handlers
    nameInput.addEventListener('input', (e) => {
      e.stopPropagation();
      settings.customName = e.target.value;
    });
    
    nameInput.addEventListener('click', (e) => {
      e.stopPropagation();
      // Select text on click for easy editing
      e.target.select();
    });
    
    nameInput.addEventListener('focus', (e) => {
      e.stopPropagation();
    });
    
    // Header click handler for selection (but not on input or in selection mode)
    if (!selectionMode) {
      headerDiv.addEventListener('click', (e) => {
        // Don't trigger selection if clicking on the input
        if (e.target === nameInput) {
          return;
        }
        
        // Handle selection (ctrl/shift/regular click)
        if (e.shiftKey && lastSelectedIndex !== null) {
          const start = Math.min(lastSelectedIndex, index);
          const end = Math.max(lastSelectedIndex, index);
          for (let i = start; i <= end; i++) {
            selectedIndices.add(i);
          }
        } else if (e.ctrlKey || e.metaKey) {
          if (selectedIndices.has(index)) {
            selectedIndices.delete(index);
          } else {
            selectedIndices.add(index);
          }
          lastSelectedIndex = index;
        } else {
          selectedIndices.clear();
          selectedIndices.add(index);
          lastSelectedIndex = index;
        }
        
        renderFiles();
      });
    }
    
    headerDiv.appendChild(arrow);
    headerDiv.appendChild(nameInput);
    headerDiv.appendChild(extSpan);
    
    rowDiv.appendChild(headerDiv);
    
    // Details panel (shown when expanded)
    if (isExpanded) {
      const detailsDiv = document.createElement('div');
      detailsDiv.className = 'file-details';
      
      // Output Path
      const pathRow = document.createElement('div');
      pathRow.className = 'detail-row';
      
      const pathLabel = document.createElement('label');
      pathLabel.textContent = 'Output Path:';
      pathRow.appendChild(pathLabel);
      
      const pathInput = document.createElement('input');
      pathInput.type = 'text';
      pathInput.className = 'detail-input';
      pathInput.id = `path-${index}`;
      pathInput.value = settings.customPath || outputFolder || path.dirname(file) + '/gifs';
      pathInput.readOnly = true;
      pathRow.appendChild(pathInput);
      
      const browseBtn = document.createElement('button');
      browseBtn.textContent = 'BROWSE';
      browseBtn.className = 'browse-btn';
      browseBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const folder = await window.electronAPI.selectOutputFolder(path.dirname(file));
        if (folder) {
          settings.customPath = folder;
          renderFiles();
        }
      });
      pathRow.appendChild(browseBtn);
      
      detailsDiv.appendChild(pathRow);
      
      // Reset button
      const resetBtn = document.createElement('button');
      resetBtn.textContent = 'RESET TO DEFAULT';
      resetBtn.className = 'reset-btn';
      resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settings.customName = null;
        settings.customPath = null;
        renderFiles();
      });
      detailsDiv.appendChild(resetBtn);
      
      rowDiv.appendChild(detailsDiv);
    }
    
    fileItems.appendChild(rowDiv);
  });
  
  updateSelectionUI();
}

function handleCheckboxChange(index, shiftKey) {
  if (shiftKey && lastSelectedIndex !== null) {
    // Shift-click: select range
    const start = Math.min(lastSelectedIndex, index);
    const end = Math.max(lastSelectedIndex, index);
    const shouldSelect = selectedIndices.has(index);
    
    for (let i = start; i <= end; i++) {
      if (shouldSelect) {
        selectedIndices.add(i);
      } else {
        selectedIndices.delete(i);
      }
    }
  } else {
    // Regular click: toggle single
    if (selectedIndices.has(index)) {
      selectedIndices.delete(index);
    } else {
      selectedIndices.add(index);
    }
  }
  
  lastSelectedIndex = index;
  renderFiles();
}

function updateStatus(text) {
  status.textContent = text;
}

function updateProgressBar(percent, showBar = false) {
  const progressBar = document.querySelector('.progress-bar');
  
  if (showBar) {
    progressBar.classList.add('visible');
  } else {
    progressBar.classList.remove('visible');
  }
  
  progressFill.style.width = `${percent * 100}%`;
  
  if (percent === 0) {
    progressFill.style.backgroundColor = '#333333';
  } else if (percent < 0.33) {
    progressFill.style.backgroundColor = '#FF3333';
  } else if (percent < 0.66) {
    progressFill.style.backgroundColor = '#FFA500';
  } else {
    progressFill.style.backgroundColor = '#00FF00';
  }
}

function setProgressLabel(text, type = '') {
  progressLabel.textContent = text;
  progressLabel.className = `progress-label ${type}`;
}

async function convertFiles() {
  isConverting = true;
  cancelRequested = false;
  
  convertBtn.disabled = true;
  cancelBtn.disabled = false;
  updateStatus('PROCESSING');
  updateProgressBar(0, true);
  
  const fps = fpsInput.value;
  const width = widthInput.value;
  const quality = qualityInput.value;
  
  const startTime = Date.now();
  
  // Build file list with custom settings
  const filesToConvert = files.map((file, index) => {
    const settings = fileSettings[index];
    const customName = settings.customName || path.basename(file, path.extname(file));
    const customPath = settings.customPath || outputFolder || path.join(path.dirname(file), 'gifs');
    
    return {
      inputPath: file,
      outputPath: path.join(customPath, customName + '.gif'),
      outputFolder: customPath
    };
  });
  
  // Listen for progress updates
  window.electronAPI.onConversionProgress((data) => {
    if (cancelRequested) return;
    
    setProgressLabel(`• CONVERTING [${data.current}/${data.total}] ${data.filename}`, '');
    updateProgressBar(data.current / data.total, true);
    
    if (data.current > 1) {
      const elapsed = (Date.now() - startTime) / 1000;
      const avgTime = elapsed / (data.current - 1);
      const remaining = avgTime * (data.total - data.current);
      const mins = Math.floor(remaining / 60);
      const secs = Math.floor(remaining % 60);
      timeLabel.textContent = `• EST_TIME_REMAINING: ${mins}m ${secs}s`;
    }
  });
  
  try {
    const results = await window.electronAPI.convertFilesWithSettings({
      files: filesToConvert,
      fps,
      width,
      quality
    });
    
    if (cancelRequested) {
      setProgressLabel('• CONVERSION CANCELLED', 'error');
      updateStatus('READY');
      timeLabel.textContent = '';
      updateProgressBar(0, false);
      progressFill.style.backgroundColor = '#333333';
      
      setTimeout(() => {
        setProgressLabel('', '');
      }, 3000);
    } else {
      const mins = Math.floor(results.totalTime / 60);
      const secs = Math.floor(results.totalTime % 60);
      
      let statusParts = [`✓ COMPLETED [${files.length}/${files.length}]`];
      if (results.converted > 0) statusParts.push(`${results.converted} CONVERTED`);
      if (results.skipped > 0) statusParts.push(`${results.skipped} SKIPPED`);
      
      setProgressLabel(statusParts.join(' • '), 'success');
      timeLabel.textContent = `• TOTAL_TIME: ${mins}m ${secs}s`;
      updateProgressBar(1, true);
      updateStatus('READY');
      
      // Open the first output folder (or could open all unique folders)
      if (filesToConvert.length > 0) {
        window.electronAPI.openFolder(filesToConvert[0].outputFolder);
      }
    }
  } catch (err) {
    console.error('Conversion error:', err);
    setProgressLabel('• CONVERSION FAILED', 'error');
    updateStatus('READY');
    updateProgressBar(0, false);
  }
  
  convertBtn.disabled = false;
  cancelBtn.disabled = true;
  isConverting = false;
}