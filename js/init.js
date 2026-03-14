console.log('Init.js loaded');

// Wait for DOM to be ready
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(() => {
        window.dispatchEvent(new Event('ui-ready'));
    }, 100);
} else {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            window.dispatchEvent(new Event('ui-ready'));
        }, 100);
    });
}
