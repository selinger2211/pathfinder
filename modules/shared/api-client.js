/**
 * API Client for Pathfinder MCP Bridge
 * Standardizes communication with the local MCP server (same origin, port 3000).
 */

const API_BASE = window.location.origin;

window.apiClient = {
  async get(endpoint) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`);
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`[API Client] GET ${endpoint} failed:`, error);
      showToast(`Bridge error: ${error.message}`, 'error');
      throw error;
    }
  },

  async post(endpoint, body) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`[API Client] POST ${endpoint} failed:`, error);
      showToast(`Bridge error: ${error.message}`, 'error');
      throw error;
    }
  }
};
