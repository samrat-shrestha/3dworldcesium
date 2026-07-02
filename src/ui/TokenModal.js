/**
 * TokenModal — Manages the Cesium Ion access token input modal.
 *
 * Shows on first load if no token is saved in localStorage.
 * Saves the token to localStorage for future sessions.
 */

const STORAGE_KEY = 'hydroviz_cesium_token';

/**
 * Check if a token is already saved.
 * @returns {string|null} The saved token or null
 */
export function getSavedToken() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Save a token to localStorage.
 * @param {string} token - The Cesium Ion access token
 */
export function saveToken(token) {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch (e) {
    console.warn('[HydroViz] Could not save token to localStorage:', e);
  }
}

/**
 * Show the token modal and return a promise that resolves with the entered token.
 * @returns {Promise<string>} The entered token
 */
export function showTokenModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById('tokenModal');
    const input = document.getElementById('tokenInput');
    const submitBtn = document.getElementById('tokenSubmit');

    modal.style.display = 'flex';

    // Focus the input after animation
    setTimeout(() => input.focus(), 600);

    const handleSubmit = () => {
      const token = input.value.trim();
      if (!token) {
        input.style.borderColor = '#ff4d6a';
        input.style.boxShadow = '0 0 0 3px rgba(255, 77, 106, 0.15)';
        setTimeout(() => {
          input.style.borderColor = '';
          input.style.boxShadow = '';
        }, 1500);
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Launching...';
      saveToken(token);

      // Animate out
      modal.style.transition = 'opacity 0.4s ease';
      modal.style.opacity = '0';
      setTimeout(() => {
        modal.style.display = 'none';
        resolve(token);
      }, 400);
    };

    submitBtn.addEventListener('click', handleSubmit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSubmit();
    });
  });
}
