// This file just waits for DOM and UI
console.log('Init.js loaded');

// If DOM is already loaded, trigger ui-ready
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(() => {
        window.dispatchEvent(new Event('ui-ready'));
    }, 100);
}
