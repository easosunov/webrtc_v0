// Main initialization file - load this last
window.initApp = function() {
    // Initialize auth
    if (window.initAuth) window.initAuth();
    
    log('🚀 Application fully initialized');
};

// If DOM is already loaded, run init directly
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(() => {
        if (window.initAuth) window.initAuth();
        log('🚀 Application fully initialized');
    }, 100);
}
