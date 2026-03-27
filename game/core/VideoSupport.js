// Browser detection utility
export const detectBrowser = () => {
    const ua = navigator.userAgent || '';
    // window.chrome existe en Chrome/Edge aunque el UA esté falseado a iPhone en DevTools
    const isRealChrome = !!(window.chrome && (window.chrome.runtime || window.chrome.app));
    const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|Edg/i.test(ua) && !isRealChrome;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    return { isSafari, isIOS, isMobile, supportsWebMAlpha: !isSafari };
};

export const browserInfo = detectBrowser();

// Video source helper - returns appropriate source based on browser
// For Safari, replaces .webm with .mov (HEVC with alpha channel)
export const getVideoSource = (webmPath, options = {}) => {
    const { fallback = null, hideIfUnsupported = false, skipMobileSuffix = false } = options;
    
    // Inject _mobile suffix for mobile devices automatically
    let processedPath = webmPath;
    if (browserInfo.isMobile && !skipMobileSuffix && typeof processedPath === 'string') {
        processedPath = processedPath.replace(/\.(webm|mov)$/i, '_mobile.$1');
    }

    if (browserInfo.supportsWebMAlpha) {
        return processedPath;
    }

    // Safari: try .mov version (HEVC with alpha)
    if (fallback) {
        let processedFallback = fallback;
        if (browserInfo.isMobile && typeof processedFallback === 'string') {
            processedFallback = processedFallback.replace(/\.(webm|mov)$/i, '_mobile.$1');
        }
        return processedFallback;
    }

    // Auto-generate .mov path by replacing extension
    // Importante: para Safari mobile no existe _mobile.mov (no se puede encodear HEVC alpha en Windows),
    // así que usamos el .mov original sin el sufijo _mobile.
    const movPath = processedPath.replace(/_mobile\.webm$/i, '.mov').replace(/\.webm$/i, '.mov');

    if (hideIfUnsupported) return null;
    return movPath;
};
