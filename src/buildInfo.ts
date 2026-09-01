const configuredBuildSha = import.meta.env?.VITE_BUILD_SHA?.trim()

export const BUILD_SHA = configuredBuildSha || 'local-dev'
export const BUILD_ID = BUILD_SHA === 'local-dev' ? BUILD_SHA : BUILD_SHA.slice(0, 12)
