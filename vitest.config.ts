import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // React plugin needed so vitest can transform .tsx files that are
  // imported by tests (e.g. server-component pages whose default export
  // is an async function returning JSX). Without it Vite reports
  // "invalid JS syntax" on the JSX expressions.
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',
    globals: true,
  },
})
