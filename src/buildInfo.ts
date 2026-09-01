const configuredBuildSha = typeof import.meta.env?.VITE_BUILD_SHA === 'string'
  ? import.meta.env.VITE_BUILD_SHA.trim()
  : undefined

export const BUILD_SHA = configuredBuildSha || 'local-dev'
export const BUILD_ID = BUILD_SHA === 'local-dev' ? BUILD_SHA : BUILD_SHA.slice(0, 12)
