export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@pinia/nuxt'],
  ui: { colorMode: false },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    apiBase: 'http://127.0.0.1:3003',
  },
  app: {
    head: {
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
})

