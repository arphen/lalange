export const SW_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
export const SW_RELOAD_FALLBACK_MS = 2500;

export const shouldReloadOnControllerChange = (
    userInitiatedUpdate: boolean,
    hasReloaded: boolean,
): boolean => {
    return userInitiatedUpdate && !hasReloaded;
};