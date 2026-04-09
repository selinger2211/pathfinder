/**
 * ================================================================
 * Pathfinder Backup & Restore Utilities
 * Version: 1.0 | March 2026
 * ================================================================
 *
 * Handles exporting all pf_* localStorage keys as JSON backups
 * and importing them back, with full validation and error handling.
 *
 * This module provides data resilience — users can backup their
 * entire Pathfinder state and restore it if needed.
 * ================================================================
 */

/**
 * Export all pf_* keys from localStorage as a JSON file download.
 * Returns the backup object for testing.
 *
 * @returns {Object} Backup object with structure:
 *   {
 *     version: '1.0',
 *     exportedAt: '2026-03-16T...',
 *     appVersion: 'pathfinder-v3.32.0',
 *     keys: { pf_roles: '...', pf_companies: '...', ... }
 *   }
 */
function exportBackup() {
  const backup = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    appVersion: 'pathfinder-v3.32.0',
    keys: {}
  };

  // Collect all pf_* keys from localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('pf_')) {
      backup.keys[key] = localStorage.getItem(key);
    }
  }

  // Trigger download
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pathfinder-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);

  // Store last backup timestamp
  localStorage.setItem('pf_last_backup', new Date().toISOString());

  return backup;
}

/**
 * Import a backup JSON file into localStorage.
 * Validates structure before importing.
 *
 * @param {string} jsonString The JSON backup content
 * @returns {Object} Result object:
 *   {
 *     success: boolean,
 *     keysRestored: number,
 *     error?: string (only if success is false)
 *   }
 */
function importBackup(jsonString) {
  try {
    const backup = JSON.parse(jsonString);

    // Validate structure
    if (!backup.keys || typeof backup.keys !== 'object') {
      return {
        success: false,
        keysRestored: 0,
        error: 'Invalid backup format: missing keys object'
      };
    }
    if (!backup.version) {
      return {
        success: false,
        keysRestored: 0,
        error: 'Invalid backup format: missing version'
      };
    }

    // Import valid pf_* keys
    let restored = 0;
    for (const [key, value] of Object.entries(backup.keys)) {
      if (key.startsWith('pf_') && typeof value === 'string') {
        localStorage.setItem(key, value);
        restored++;
      }
    }

    // Update last backup timestamp to mark successful import
    localStorage.setItem('pf_last_backup', new Date().toISOString());

    return { success: true, keysRestored: restored };
  } catch (e) {
    return {
      success: false,
      keysRestored: 0,
      error: `Failed to parse backup: ${e.message}`
    };
  }
}

/**
 * Get backup statistics without exporting.
 * Useful for displaying backup info in UI.
 *
 * @returns {Object} Stats object:
 *   {
 *     keyCount: number,
 *     totalSizeBytes: number (UTF-16 size estimate)
 *   }
 */
function getBackupStats() {
  let keyCount = 0;
  let totalSize = 0;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('pf_')) {
      keyCount++;
      const value = localStorage.getItem(key) || '';
      // UTF-16 size estimate (JavaScript strings are UTF-16)
      totalSize += value.length * 2;
    }
  }

  return { keyCount, totalSizeBytes: totalSize };
}

/**
 * Check if user has ever backed up their data.
 * Returns true if pf_last_backup key exists.
 *
 * @returns {boolean} Whether a backup has been created
 */
function hasBackupBeenCreated() {
  return localStorage.getItem('pf_last_backup') !== null;
}

/**
 * Get the timestamp of the last backup.
 *
 * @returns {Date|null} Last backup date, or null if never backed up
 */
function getLastBackupTime() {
  const timestamp = localStorage.getItem('pf_last_backup');
  return timestamp ? new Date(timestamp) : null;
}

// ================================================================
// Node.js Export Guard
// Allows this module to be used in test environments
// ================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    exportBackup,
    importBackup,
    getBackupStats,
    hasBackupBeenCreated,
    getLastBackupTime
  };
}
