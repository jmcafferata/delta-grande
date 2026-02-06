// Browser detection utility
export const detectBrowser = () => {
    const ua = navigator.userAgent || '';
    const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|Edg/i.test(ua);
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    return { isSafari, isIOS, supportsWebMAlpha: !isSafari };
};

export const browserInfo = detectBrowser();

// Video source helper - returns appropriate source based on browser
// For Safari, replaces .webm with .mov (HEVC with alpha channel)
export const getVideoSource = (webmPath, options = {}) => {
    const { fallback = null, hideIfUnsupported = false } = options;
    
    if (browserInfo.supportsWebMAlpha) {
        return webmPath;
    }
    
    // Safari: try .mov version (HEVC with alpha)
    if (fallback) {
        return fallback;
    }
    
    // Auto-generate .mov path by replacing extension
    const movPath = webmPath.replace(/\.webm$/i, '.mov');
    
    // Return null to hide if specified and no fallback
    return hideIfUnsupported ? null : movPath;
};
